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

const get = (url, errors) => new Promise((resolve, reject) => {
    request({json: true, method: 'GET', url}, (error, response, body) => {
        if (error) {
            reject(error);
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(errors['bus.oidcHttp']({
                statusCode: response.statusCode,
                statusText: response.statusText,
                statusMessage: response.statusMessage,
                validation: response.body && response.body.validation,
                debug: response.body && response.body.debug,
                params: {
                    code: response.statusCode
                }
            }));
        } else if (body) {
            resolve(body);
        } else {
            reject(errors['bus.oidcEmpty']());
        }
    });
});

const openIdUrl = url => {
    if (!url.replace('https://', '').includes('/')) url = url + '/.well-known/openid-configuration';
    if (!url.startsWith('https://')) url = url + 'https://';
    return url;
};

function forward(headers) {
    return [
        'x-request-id',
        'x-b3-traceid',
        'x-b3-spanid',
        'x-b3-parentspanid',
        'x-b3-sampled',
        'x-b3-flags',
        'x-ot-span-context'
    ].reduce(function(object, key) {
        if (Object.prototype.hasOwnProperty.call(headers, key)) object[key] = headers[key];
        return object;
    }, {});
}

const preArray = [{
    assign: 'utBus',
    method: (request, h) => {
        const {jsonrpc, id, method, params: [...params]} = request.payload;
        const meta = params.pop();
        return {
            jsonrpc,
            id,
            method,
            params: [
                ...params,
                {
                    ...meta,
                    method,
                    opcode: method.split('.').pop(),
                    forward: forward(request.headers)
                }
            ]
        };
    }
}];

const preJsonRpc = [{
    assign: 'utBus',
    method: (request, h) => {
        const {jsonrpc, id, method, params} = request.payload;
        return {
            jsonrpc,
            id,
            method,
            shift: true,
            params: [
                params,
                {
                    mtid: 'request',
                    method,
                    opcode: method.split('.').pop(),
                    forward: forward(request.headers)
                }
            ]
        };
    }
}];

const preGet = method => [{
    assign: 'utBus',
    method: (request, h) => ({
        shift: true,
        method,
        params: [
            {...request.query, ...request.params},
            {
                method,
                opcode: method.split('.').pop(),
                forward: forward(request.headers)
            }
        ]
    })
}];

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, errors, findMethodIn, metrics, service}) {
    const server = new hapi.Server({
        port: socket.port
    });

    const issuers = {};
    const oidc = {};
    const key = async decoded => {
        const issuerId = decoded.payload && decoded.payload.iss;
        if (!issuerId) throw errors['bus.oidcNoIssuer']();
        if (!oidc[issuerId]) throw errors['bus.oidcBadIssuer']({params: {issuerId}});
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
            oidc[issuerId] = get(openIdUrl(issuerId), errors);
        });
        server.auth.strategy('openId', 'jwt', {
            complete: true,
            key,
            async validate(decoded, request, h) {
                return {isValid: true};
            }
        });
    } else {
        await server.register([Inert, H2o2]);
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
    }].filter(Boolean));

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
                                    throw errors['bus.consulServiceNotFound']({params: {namespace}});
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
                                reject(errors['bus.jsonRpcHttp']({
                                    statusCode: response.statusCode,
                                    statusText: response.statusText,
                                    statusMessage: response.statusMessage,
                                    validation: response.body && response.body.validation,
                                    debug: response.body && response.body.debug,
                                    params: {
                                        code: response.statusCode
                                    }
                                }));
                            } else if (body && body.result !== undefined && body.error === undefined) {
                                if (/\.service\.get$/.test($meta.method)) Object.assign(body.result[0], params);
                                resolve(body.result);
                            } else {
                                reject(errors['bus.jsonRpcEmpty']());
                            }
                        });
                    });
                });
        };
    }

    function start() {
        return server.start();
    }

    function info() {
        return server.info;
    }

    async function stop() {
        const result = await server.stop();
        await (discover && new Promise(resolve => {
            discover.destroy(resolve);
        }));
        return result;
    }

    function localRegister(nameSpace, name, fn) {
        const local = mapLocal[nameSpace + '.' + name];
        if (local) {
            local.method = fn;
        } else {
            mapLocal[nameSpace + '.' + name] = {method: fn};
        }
    }

    function applyMeta(response, {
        httpResponse
    } = {}) {
        httpResponse && ['code', 'redirect', 'created', 'etag', 'location', 'ttl', 'temporary', 'permanent', 'type'].forEach(method =>
            Object.prototype.hasOwnProperty.call(httpResponse, method) &&
            response[method](...[].concat(httpResponse[method]))
        );
        return response;
    }

    function registerRoute(namespace, name, fn, object) {
        const path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        const handler = async function(request, h) {
            const {params, jsonrpc, id, shift, method} = request.pre.utBus;
            try {
                const result = await Promise.resolve(fn.apply(object, params));
                const response = h.response(jsonrpc ? {
                    jsonrpc,
                    id,
                    result: shift ? result[0] : result
                } : (shift ? result[0] : result)).header('x-envoy-decorator-operation', method);
                return applyMeta(response, result && result.length && result[result.length - 1]);
            } catch (error) {
                return jsonrpc
                    ? h.response({
                        jsonrpc,
                        id,
                        error
                    }).header('x-envoy-decorator-operation', method).code(error.statusCode || 500)
                    : Boom.boomify(error, { statusCode: error.statusCode || 500 });
            }
        };

        const route = server.match('POST', path);
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
                    pre: preArray,
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
        const route = server.match('POST', '/rpc/' + namespace + '/' + name.split('.').join('/'));
        if (route) route.settings.handler = deleted;
    }

    function exportMethod(methods, namespace, reqrep) {
        const methodNames = [];
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
            const local = mapLocal[namespace + '.' + name];
            if (local) delete local.method;
        });
    }

    function localMethod(methods, namespace, {version} = {}) {
        if (namespace.endsWith('.validation') && utApi && Object.entries(methods).length) {
            server.route(utApi.rpcRoutes(Object.entries(methods).map(([method, validation]) => {
                const {
                    params,
                    path: route,
                    method: httpMethod,
                    query = false,
                    ...rest
                } = typeof validation === 'function' ? validation() : validation;
                const rpc = '/rpc/ports/' + method.split('.').shift() + '/request';
                return {
                    method,
                    params,
                    route,
                    httpMethod,
                    version,
                    pre: params ? preJsonRpc : preGet(method),
                    validate: {
                        options: {abortEarly: false},
                        query,
                        payload: params && joi.object({
                            jsonrpc: '2.0',
                            timeout: joi.number().optional().allow(null),
                            id: joi.alternatives().try(joi.number().example(1), joi.string().example('1')),
                            method,
                            ...params && {params}
                        })
                    },
                    handler: (request, ...rest) => {
                        const route = server.match('POST', rpc);
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
        localMethod,
        info
    };
};
