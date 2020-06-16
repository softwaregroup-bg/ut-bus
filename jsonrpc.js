const hapi = require('@hapi/hapi');
const joi = require('joi'); // todo migrate to @hapi/joi
const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const Boom = require('@hapi/boom');
const Inert = require('@hapi/inert');
const H2o2 = require('@hapi/h2o2');
const os = require('os');
const osName = [os.type(), os.platform(), os.release()].join(':');
const hrtime = require('browser-process-hrtime');
const Content = require('content');
const Pez = require('pez');
const fs = require('fs');
const uuid = require('uuid');
const fsplus = require('fs-plus');
const mlePlugin = require('./mle');
const jwt = require('./jwt');
const jose = require('./jose');

function initConsul({discover, ...config}) {
    const consul = require('consul')(Object.assign({
        promisify: true
    }, config));

    return consul;
}

const get = (url, errors, prefix, headers) => new Promise((resolve, reject) => {
    request({
        json: true,
        method: 'GET',
        url,
        ...headers && {
            headers: {
                'x-forwarded-proto': headers['x-forwarded-proto'],
                'x-forwarded-host': headers['x-forwarded-host']
            }
        }}, (error, response, body) => {
        if (error) {
            reject(error);
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(errors[prefix + 'Http']({
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
            reject(errors[prefix + 'Empty']());
        }
    });
});

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

function extendMeta(req, version, serviceName) {
    const {
        'user-agent': frontEnd,
        latitude,
        longitude,
        deviceId,
        'x-forwarded-host': forwardedHost,
        'x-forwarded-for': forwardedIp
    } = req.headers || {};
    const {
        localAddress,
        localPort
    } = (req.raw && req.raw.req && req.raw.req.socket && req.raw.req.socket) || {};
    return {
        forward: forward(req.headers),
        frontEnd,
        latitude,
        longitude,
        deviceId,
        localAddress,
        localPort,
        auth: req.auth.credentials,
        hostName: forwardedHost || req.info.hostname,
        ipAddress: (forwardedIp || req.info.remoteAddress).split(',')[0],
        machineName: req.server && req.server.info && req.server.info.host,
        os: osName,
        version,
        serviceName,
        httpRequest: {
            url: req.url,
            headers: req.headers
        }
    };
}

async function failPre(request, h, error) {
    return Boom.internal(error.message, undefined, error.statusCode);
}

const preArray = [{
    assign: 'utBus',
    failAction: failPre,
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

const preJsonRpc = (checkAuth, version, logger) => [{
    assign: 'utBus',
    failAction: failPre,
    method: async(request, h) => {
        try {
            const {jsonrpc, id, method, params, timeout} = request.payload;
            if (request.auth.strategy) await checkAuth(method, request.auth.credentials && request.auth.credentials.permissionMap);
            return {
                jsonrpc,
                id,
                method,
                shift: true,
                params: [
                    params,
                    {
                        mtid: !id ? 'notification' : 'request',
                        method,
                        opcode: method.split('.').pop(),
                        timeout,
                        ...extendMeta(request, version, method.split('.')[0])
                    }
                ]
            };
        } catch (error) {
            logger && logger.error && logger.error(error);
            throw error;
        }
    }
}];

const assertDir = dir => {
    if (!dir) throw new Error('Missing workDir in configuration (ut-run@10.20.0 or newer expected)');
    try {
        fs.accessSync(dir, fs.R_OK | fs.W_OK);
    } catch (error) {
        if (error.code === 'ENOENT') {
            try {
                fsplus.makeTreeSync(dir);
            } catch (e) {
                if (e.code !== 'EEXIST') {
                    throw e;
                }
            }
        } else {
            throw error;
        }
    }
};

const uploads = async(workDir, request, logger) => {
    assertDir(workDir);
    const contentType = Content.type(request.headers['content-type']);
    const dispenser = new Pez.Dispenser({boundary: contentType.boundary});
    return new Promise((resolve, reject) => {
        const params = {...request.query, ...request.params};
        const files = [];
        dispenser
            .on('part', part => {
                if (part.name && typeof params[part.name] === 'undefined') {
                    // if (!isUploadValid(part.fileName, port.config.fileUpload)) return h.response('Invalid file name').code(400);
                    files.push(new Promise((resolve, reject) => {
                        const filename = workDir + '/' + uuid.v4() + '.upload';
                        params[part.name] = {
                            originalFilename: part.filename,
                            headers: part.headers,
                            filename
                        };
                        part.on('error', function(error) {
                            logger.error && logger.error(error);
                            reject(error);
                        });
                        part.on('end', resolve);
                        part.pipe(fs.createWriteStream(filename));
                    }));
                }
            })
            .on('field', (field, value) => {
                if (typeof params[field] === 'undefined') params[field] = value;
            })
            .once('error', reject)
            .once('close', () => Promise.all(files).then(() => resolve(params), reject));

        request.payload.pipe(dispenser);
    });
};

const prePlain = (checkAuth, workDir, method, version, logger) => [{
    assign: 'utBus',
    failAction: failPre,
    method: async(request, h) => {
        try {
            if (request.auth.strategy) await checkAuth(method, request.auth.credentials && request.auth.credentials.permissionMap);
            const $meta = {
                mtid: 'request',
                method,
                opcode: method.split('.').pop(),
                ...extendMeta(request, version, method.split('.')[0])
            };
            if (request.mime === 'multipart/form-data') {
                return {
                    shift: true,
                    method,
                    params: [
                        await uploads(workDir, request, logger),
                        $meta
                    ]
                };
            } else {
                return {
                    shift: true,
                    method,
                    params: [
                        {...request.payload, ...request.query, ...request.params},
                        $meta
                    ]
                };
            }
        } catch (error) {
            logger && logger.error && logger.error(error);
            throw error;
        }
    }
}];

const domainResolver = domain => {
    const resolver = require('mdns-resolver');
    const getHostName = host => `${host}-${domain}.dns-discovery.local`;
    const cache = {};
    return async function resolve(host, invalidate) {
        const now = hrtime();
        const hostName = getHostName(host);
        if (invalidate) {
            delete cache[getHostName(host)];
        } else {
            const cached = cache[hostName];
            if (cached) {
                if (hrtime(cached[0])[0] < 3) {
                    cached[0] = now;
                    return {...cached[1], cache: host};
                } else {
                    delete cache[hostName];
                }
            }
        }
        const resolved = await resolver.resolveSrv(hostName);
        const result = {
            host: (resolved.target === '0.0.0.0' ? '127.0.0.1' : resolved.target),
            port: resolved.port
        };
        cache[hostName] = [now, result];
        return result;
    };
};

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, errors, findMethodIn, metrics, service, workDir, packages}) {
    let loginCache;
    async function loginService() {
        if (!loginCache) loginCache = discoverService('login');
        try {
            return await loginCache;
        } catch (error) {
            loginCache = false;
            throw error;
        }
    }

    async function discoverService(namespace) {
        const params = {
            host: prefix + namespace.replace(/\//g, '-') + suffix,
            port: socket.port,
            service
        };
        const requestParams = Object.assign({}, params);
        if (consulDiscover) {
            const services = await consul.health.service({
                service: namespace,
                passing: true
            });
            if (!services || !services.length) {
                throw errors['bus.consulServiceNotFound']({params: {namespace}});
            }
            Object.assign(requestParams, {
                host: services[0].Node.Address,
                port: services[0].Service.Port
            });
        }
        if (resolver) {
            Object.assign(requestParams, await resolver(params.host));
        }
        return requestParams;
    }

    async function openIdConfig(issuer, headers) {
        if (issuer === 'ut-login') {
            const {host, port} = await loginService();
            issuer = `http://${host}:${port}/rpc/login/.well-known/openid-configuration`;
        } else {
            if (!issuer.replace('https://', '').includes('/')) issuer = issuer + '/.well-known/openid-configuration';
            if (!issuer.startsWith('https://') && !issuer.startsWith('http://')) issuer = issuer + 'https://';
            headers = false;
        }
        return get(issuer, errors, 'bus.oidc', headers);
    };

    let actionsCache;
    async function actions(method) {
        if (actionsCache) return actionsCache[method];
        const {host, port} = await loginService();
        actionsCache = await get(`http://${host}:${port}/rpc/login/action`, errors, 'bus.action');
        return actionsCache[method];
    }

    async function checkAuthSingle(method, map) {
        const bit = await actions(method) - 1;
        const index = Math.floor(bit / 8);
        return (Number.isInteger(index) && (index < map.length) && (map[index] & (1 << (bit % 8))));
    }

    async function checkAuth(method, map) {
        if (!await checkAuthSingle(method, map) && !await checkAuthSingle('%', map)) {
            throw errors['bus.unauthorized']({params: {method}});
        }
    }

    const issuers = headers => Promise.all(['ut-login'].concat(socket.openId).filter(issuer => typeof issuer === 'string').map(issuer => openIdConfig(issuer, headers)));
    const mle = jose(socket);

    async function createServer() {
        const jwks = async issuer => get((await openIdConfig(issuer)).jwks_uri, errors, 'bus.oidc');

        const result = new hapi.Server({
            port: socket.port
        });

        await result.register([
            Inert,
            H2o2,
            {
                plugin: jwt,
                options: {
                    options: socket,
                    logger,
                    errors,
                    jwks
                }
            },
            {
                plugin: mlePlugin,
                options: {
                    mle,
                    logger,
                    errors
                }
            }
        ]);

        result.events.on('start', () => {
            logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'jsonrpc.listen'}, serverInfo: result.info});
        });

        return result;
    }

    const brokerRequest = brokerMethod(false, 'request');
    const internal = socket.api && socket.api.internal && (() => Promise.all(socket.api.internal.map(name =>
        brokerRequest({}, {method: name + '.service.get'})
            .then(([result]) => ({namespace: name, ...result}))
            .catch(() => ({namespace: name, version: '?'}))
    )).catch(error => {
        this.error(error);
        throw error;
    }));
    const utApi = await require('ut-api')({service, auth: 'openId', ...socket.api}, errors, issuers, internal);

    utApi.route([{
        method: 'GET',
        path: '/healthz',
        options: {
            auth: false,
            handler: (request, h) => 'ok'
        }
    }, (socket.metrics !== false) && {
        method: 'GET',
        path: '/metrics',
        options: {
            auth: false,
            handler: (request, h) => h.response(metrics() || '').type('text/plain; version=0.0.4; charset=utf-8')
        }
    }].filter(Boolean), 'utBus.jsonrpc');

    const domain = (socket.domain === true) ? require('os').hostname() : socket.domain;
    const consul = socket.consul && initConsul(socket.consul);
    const consulDiscover = socket.consul && socket.consul.discover;
    const discover = socket.domain && require('dns-discovery')();
    const resolver = socket.domain && domainResolver(domain);
    const prefix = socket.prefix || '';
    const suffix = socket.suffix || '-service';
    const deleted = (request, h) => {
        return h.response('Method was deleted').code(404);
    };

    function brokerMethod(typeName, methodType) {
        return async function(msg, $meta) {
            const [namespace, op] = $meta.method.split('.', 2);
            if (['start', 'stop', 'drain'].includes(op)) methodType = op;
            const requestParams = await discoverService(namespace);
            const sendRequest = callback => request({
                followRedirect: false,
                json: true,
                method: 'POST',
                url: `http://${requestParams.host}:${requestParams.port}/rpc/ports/${namespace}/${methodType}`,
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
            }, callback);

            return new Promise((resolve, reject) => {
                const callback = async(error, response, body) => {
                    if (error) {
                        if (resolver && requestParams.cache) { // invalidate cache and retry upon connection fail
                            switch (error.code) {
                                case 'ETIMEDOUT':
                                case 'ESOCKETTIMEDOUT':
                                    if (!error.connect) break; // https://www.npmjs.com/package/request#timeouts
                                // eslint-disable-next-line no-fallthrough
                                case 'ENOTFOUND':
                                case 'ECONNREFUSED':
                                    try {
                                        Object.assign(requestParams, await resolver(requestParams.cache, true));
                                        delete requestParams.cache;
                                    } catch (resolverError) {
                                        reject(resolverError);
                                        return;
                                    }
                                    sendRequest(callback);
                                    return;
                            }
                        };
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
                        if (/\.service\.get$/.test($meta.method)) Object.assign(body.result[0], requestParams);
                        resolve(body.result);
                    } else {
                        reject(errors['bus.jsonRpcEmpty']());
                    }
                };
                sendRequest(callback);
            });
        };
    }

    let server;

    async function start() {
        if (!packages['ut-port']) throw new Error('Unsupported ut-port version (ut-port@6.28.0 or newer expected)');
        if (server) await server.stop();
        server = await createServer();
        return server.start();
    }

    async function ready() {
        server.route(utApi.routes());
    }

    function info() {
        return {
            ...server.info,
            ...mle.keys
        };
    }

    async function stop() {
        const result = await server.stop();
        server = false;
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

    function registerRoute(namespace, name, fn, object, {version}) {
        const path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        const handler = async function(request, h) {
            if (Boom.isBoom(request.pre.utBus)) return request.pre.utBus;
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
                name: name.split('.')[0],
                port: server.info.port,
                check: {
                    http: `http://${server.info.host}:${server.info.port}/healthz`,
                    interval: '5s',
                    deregistercriticalserviceafter: '1m'
                }
            }))
            .then(() => discover && new Promise((resolve, reject) => {
                discover.announce(
                    prefix + name.split('.')[0].replace(/\//g, '-') + suffix + '-' + domain,
                    server.info.port,
                    error => error ? reject(error) : resolve()
                );
            }))
            .then(() => utApi.route({
                method: 'POST',
                path,
                options: {
                    pre: preArray,
                    payload: {
                        output: 'data',
                        parse: true,
                        maxBytes: socket.maxBytes
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
            }, 'utBus.jsonrpc'))
            .then(() => utApi && name.endsWith('.request') && utApi.restRoutes({
                namespace: name.split('.')[0],
                fn,
                object
            }));
    }

    function unregisterRoute(namespace, name) {
        const path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        const route = server.match('POST', path);
        if (route) route.settings.handler = deleted;
        utApi.deleteRoute({namespace, method: 'POST', path});
    }

    function exportMethod(methods, namespace, reqrep, port, pkg = {}) {
        const methodNames = [];
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    methodNames.push(registerRoute(namespace, fn.name, fn, null, pkg));
                    localRegister(namespace, fn.name, fn, reqrep);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    methodNames.push(registerRoute(namespace, key, methods[key], methods, pkg));
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

    function localMethod(methods, moduleName, {version} = {}) {
        if (moduleName.endsWith('.validation') && utApi && Object.entries(methods).length) {
            utApi.rpcRoutes(Object.entries(methods).map(([method, validation]) => {
                const {
                    params,
                    route,
                    path = route,
                    method: httpMethod,
                    validate,
                    workDir: dir,
                    ...rest
                } = typeof validation === 'function' ? validation() : validation;
                const rpc = '/rpc/ports/' + method.split('.')[0] + '/request';
                return {
                    method,
                    route: path ? `/rpc/${method.split('.')[0]}/${path.replace(/^\/+/, '')}`.replace(/\/+$/, '') : undefined,
                    httpMethod,
                    version,
                    pre: params ? preJsonRpc(checkAuth, version, logger) : prePlain(checkAuth, dir || workDir, method, version, logger),
                    validate: {
                        options: {abortEarly: false},
                        query: false,
                        payload: params && joi.object({
                            jsonrpc: '2.0',
                            timeout: joi.number().optional().allow(null),
                            id: joi.alternatives().try(joi.number().example(1), joi.string().example('1')).example('1'),
                            method,
                            ...params && {params}
                        }),
                        ...validate
                    },
                    handler: (request, ...rest) => {
                        const route = server.match('POST', rpc);
                        if (!route || !route.settings || !route.settings.handler) throw Boom.notFound();
                        return route.settings.handler(request, ...rest);
                    },
                    ...rest
                };
            }), moduleName);
        } else if (moduleName.endsWith('.asset') && utApi && Object.entries(methods).length) {
            utApi.route(Object.entries(methods).map(([method, validation]) => {
                const {
                    file,
                    directory,
                    auth = false
                } = typeof validation === 'function' ? validation() : validation;
                return {
                    method: 'GET',
                    path: '/a/' + (directory ? method + '/{path*}' : method),
                    options: {auth},
                    handler: {
                        ...file && {file},
                        ...directory && {directory}
                    }
                };
            }), moduleName);
        }
    }

    function removeModule(moduleName) {
        utApi.deleteRoute({namespace: moduleName});
    }

    return {
        stop,
        start,
        ready,
        exportMethod,
        removeMethod,
        brokerMethod,
        localMethod,
        discoverService,
        removeModule,
        info
    };
};
