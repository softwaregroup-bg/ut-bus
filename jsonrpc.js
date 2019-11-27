const hapi = require('@hapi/hapi');
const joi = require('joi'); // todo migrate to @hapi/joi
const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const Boom = require('@hapi/boom');
const Inert = require('@hapi/inert');
const H2o2 = require('@hapi/h2o2');
const jwksRsa = require('jwks-rsa');
const Jwt = require('hapi-auth-jwt2');

function initConsul(config) {
    const consul = require('consul')(Object.assign({
        promisify: true
    }, config));

    return consul;
}

const get = url => new Promise((resolve, reject) => {
    request({json: true, method: 'GET', url}, (error, response, body) => {
        if (error) {
            reject(error);
        } else if (body && body.error) {
            reject(Object.assign(new Error(), body.error));
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error('HTTP error ' + response.statusCode));
        } else if (body) {
            resolve(body);
        } else {
            reject(new Error('Empty response'));
        }
    });
});

const openIdUrl = url => {
    if (!url.replace('https://', '').includes('/')) url = url + '/.well-known/openid-configuration';
    if (!url.startsWith('https://')) url = url + 'https://';
    return url;
};

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, errors, findMethodIn, metrics, service}) {
    const server = new hapi.Server({
        port: socket.port
    });

    const issuers = {};
    const oidc = {};
    const key = async decoded => {
        const issuerId = decoded.payload && decoded.payload.iss;
        if (!issuerId) throw new Error('Missing issuer in authentication token');
        if (!oidc[issuerId]) throw new Error('Unsupported issuer ' + issuerId);
        let issuer = issuers[issuerId];
        if (!issuer) {
            issuers[issuerId] = issuer = jwksRsa.hapiJwt2KeyAsync({
                cache: true,
                rateLimit: true,
                jwksRequestsPerMinute: 2,
                jwksUri: (await oidc[issuerId]).jwks_uri
            });
        }
        return issuer(decoded);
    };

    if (socket.openId) {
        await server.register([Inert, H2o2, Jwt]);
        socket.openId.forEach(issuerId => {
            oidc[issuerId] = get(openIdUrl(issuerId));
        });
        server.auth.strategy('openId', 'jwt', {
            complete: true,
            key,
            async validate(decoded, request, h) {
                return {isValid: true};
            }
        });
    } else {
        await server.register(Inert, H2o2);
    }

    server.events.on('start', () => {
        logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'jsonrpc.listen'}, serverInfo: server.info});
    });

    const utApi = socket.api && await require('ut-api')({service, oidc, auth: socket.openId ? 'openId' : false, ...socket.api}, errors);
    if (utApi && utApi.uiRoutes) server.route(utApi.uiRoutes);

    server.route([{
        method: 'GET',
        path: '/healthz',
        options: {
            auth: false,
            handler: (request, h) => 'ok'
        }
    }, socket.metrics && {
        method: 'GET',
        path: '/metrics',
        options: {
            auth: false,
            handler: (request, h) => h.response(metrics() || '').type('text/plain; version=0.0.4; charset=utf-8')
        }
    }].filter(x => x));

    const domain = (socket.domain === true) ? require('os').hostname() : socket.domain;
    const consul = socket.consul && initConsul(socket.consul);
    const discover = socket.domain && require('dns-discovery')();
    const resolver = socket.domain && require('mdns-resolver');
    const prefix = socket.prefix || '';
    const suffix = socket.suffix || '-service';
    const deleted = (request, h) => {
        return h.response('Method was deleted').code(404);
    };

    function brokerMethod(typeName, methodType) {
        return function(msg, $meta) {
            const [namespace, op] = $meta.method.split('.', 2);
            if (['start', 'stop', 'drain'].includes(op)) methodType = op;
            return Promise.resolve({host: prefix + namespace.replace(/\//g, '-') + suffix, port: socket.port, service})
                .then(params => {
                    if (consul) {
                        return consul.health.service({
                            service: namespace,
                            passing: true
                        })
                            .then(services => {
                                if (!services || !services.length) {
                                    throw Error('Service ' + namespace + ' cannot be found');
                                }
                                return {
                                    ...params,
                                    host: services[0].Node.Address,
                                    port: services[0].Service.Port
                                };
                            });
                    } else {
                        return params;
                    }
                })
                .then(params => {
                    if (resolver) {
                        return resolver.resolveSrv(params.host + '-' + domain + '.dns-discovery.local')
                            .then(result => ({
                                ...params,
                                host: (result.target === '0.0.0.0' ? '127.0.0.1' : result.target),
                                port: result.port
                            }));
                    } else {
                        return params;
                    }
                })
                .then(params => {
                    return new Promise((resolve, reject) => {
                        request({
                            followRedirect: false,
                            json: true,
                            method: 'POST',
                            url: `http://${params.host}:${params.port}/rpc/ports/${namespace}/${methodType}`,
                            body: {
                                jsonrpc: '2.0',
                                method: $meta.method,
                                id: 1,
                                // timeout: timeout && (timeout - this.config.minLatency),
                                params: Array.prototype.slice.call(arguments)
                            },
                            headers: Object.assign({
                                'x-envoy-decorator-operation': $meta.method
                            }, $meta.forward)
                        }, (error, response, body) => {
                            if (error) {
                                reject(error);
                            } else if (body && body.error) {
                                reject(Object.assign(new Error(), body.error));
                            } else if (response.statusCode < 200 || response.statusCode >= 300) {
                                reject(new Error('HTTP error ' + response.statusCode));
                            } else if (body && body.result !== undefined && body.error === undefined) {
                                if (/\.service\.get$/.test($meta.method)) Object.assign(body.result[0], params);
                                resolve(body.result);
                            } else {
                                reject(new Error('Empty response'));
                            }
                        });
                    });
                });
        };
    }

    function start() {
        return server.start();
    }

    async function stop() {
        let result = await server.stop();
        await (discover && new Promise(resolve => {
            discover.destroy(resolve);
        }));
        return result;
    }

    function localRegister(nameSpace, name, fn) {
        let local = mapLocal[nameSpace + '.' + name];
        if (local) {
            local.method = fn;
        } else {
            mapLocal[nameSpace + '.' + name] = {method: fn};
        }
    }

    function registerRoute(namespace, name, fn, object) {
        let path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        let handler = function(request, h) {
            let unpack = false;
            if (request.payload.meta || !Array.isArray(request.payload.params)) {
                unpack = true;
                request.payload.params = [request.payload.params, request.payload.meta || {mtid: 'request', method: request.payload.method}];
            }
            request.payload.params[1] = Object.assign({}, request.payload.params[1], {
                opcode: request.payload.method.split('.').pop(),
                forward: ['x-request-id', 'x-b3-traceid', 'x-b3-spanid', 'x-b3-parentspanid', 'x-b3-sampled', 'x-b3-flags', 'x-ot-span-context']
                    .reduce(function(object, key) {
                        var value = request.headers[key];
                        if (value !== undefined) object[key] = value;
                        return object;
                    }, {})
            });
            return Promise.resolve(fn.apply(object, request.payload.params))
                .then(result => h.response({
                    jsonrpc: request.payload.jsonrpc,
                    id: request.payload.id,
                    result: unpack ? result[0] : result
                }).header('x-envoy-decorator-operation', request.payload.method))
                .catch(error => h.response({
                    jsonrpc: request.payload.jsonrpc,
                    id: request.payload.id,
                    error
                }).header('x-envoy-decorator-operation', request.payload.method).code(error.statusCode || 500));
        };

        let route = server.match('POST', path);
        if (route && route.settings.handler === deleted) {
            route.settings.handler = handler;
            return route;
        }

        return Promise.resolve()
            .then(() => consul && consul.agent.service.register({
                name: name.split('.').shift(),
                port: server.info.port,
                check: {
                    http: `http://${server.info.host}:${server.info.port}/healthz`,
                    interval: '5s',
                    deregistercriticalserviceafter: '1m'
                }
            }))
            .then(() => discover && discover.announce(prefix + name.split('.').shift().replace(/\//g, '-') + suffix + '-' + domain, server.info.port))
            .then(() => server.route({
                method: 'POST',
                path,
                options: {
                    payload: {
                        output: 'data',
                        parse: true
                    },
                    validate: {
                        payload: joi.object({
                            jsonrpc: joi.string().valid('2.0').required(),
                            timeout: joi.number().optional(),
                            id: joi.alternatives().try(joi.number().example(1), joi.string().example('1')),
                            method: joi.string().required(),
                            params: joi.array().required()
                        })
                    }
                },
                handler
            }))
            .then(() => utApi && name.endsWith('.request') && server.route(utApi.restRoutes({
                namespace: name.split('.')[0],
                fn,
                object
            })));
    }

    function unregisterRoute(namespace, name) {
        let route = server.match('POST', '/rpc/' + namespace + '/' + name.split('.').join('/'));
        if (route) route.settings.handler = deleted;
    }

    function exportMethod(methods, namespace, reqrep) {
        var methodNames = [];
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    registerRoute(namespace, fn.name, fn, null);
                    localRegister(namespace, fn.name, fn, reqrep);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    registerRoute(namespace, key, methods[key], methods);
                    localRegister(namespace, key, methods[key].bind(methods), reqrep);
                }
            });
        }

        return Promise.all(methodNames);
    }

    function removeMethod(names, namespace, reqrep) {
        names.forEach(name => {
            unregisterRoute(namespace, name);
            let local = mapLocal[namespace + '.' + name];
            if (local) delete local.method;
        });
    }

    function localMethod(methods, namespace, {version} = {}) {
        if (namespace.endsWith('.validation') && utApi && Object.entries(methods).length) {
            server.route(utApi.rpcRoutes(Object.entries(methods).map(([method, validation]) => {
                const {params, ...rest} = typeof validation === 'function' ? validation() : validation;
                let path = '/rpc/ports/' + method.split('.').shift() + '/request';
                return {
                    method,
                    params,
                    version,
                    validate: {
                        options: {abortEarly: false},
                        query: false,
                        payload: joi.object({
                            jsonrpc: '2.0',
                            timeout: joi.number().optional().allow(null),
                            id: joi.alternatives().try(joi.number().example(1), joi.string().example('1')),
                            method,
                            ...params && {params}
                        })
                    },
                    handler: (request, ...rest) => {
                        const route = server.match('POST', path);
                        if (!route || !route.settings || !route.settings.handler) throw Boom.notFound();
                        return route.settings.handler(request, ...rest);
                    },
                    ...rest
                };
            })));
        }
    }

    return {
        stop,
        start,
        exportMethod,
        removeMethod,
        brokerMethod,
        localMethod
    };
};
