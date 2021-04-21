// eslint-disable-next-line no-restricted-modules
const Stream = require('stream');
const url = require('url');
const hapi = require('@hapi/hapi');
const req = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const Boom = require('@hapi/boom');
const Inert = require('@hapi/inert');
const H2o2 = require('@hapi/h2o2');
const bourne = require('@hapi/bourne');
const querystring = require('querystring');
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
const {after, spare} = require('ut-function.timing');

function initConsul({discover, ...config}) {
    const consul = require('consul')(Object.assign({
        promisify: true
    }, config));

    return consul;
}

// https://github.com/openzipkin/b3-propagation
function forward(headers) {
    return [
        ['x-request-id'],
        ['x-b3-traceid', () => uuid.v4().replace(/-/g, '')],
        ['x-b3-spanid'],
        ['x-b3-parentspanid'],
        ['x-b3-sampled'],
        ['x-b3-flags'],
        ['x-ot-span-context'],
        ['x-ut-stack']
    ].reduce(function(object, [key, value]) {
        if (Object.prototype.hasOwnProperty.call(headers, key)) object[key] = headers[key];
        else if (value) object[key] = value();
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
    const {language, ...auth} = req.auth.credentials || {};
    return {
        forward: forward(req.headers),
        frontEnd,
        latitude,
        longitude,
        deviceId,
        localAddress,
        localPort,
        ...req.auth.credentials && {auth, language},
        hostName: forwardedHost || req.info.hostname,
        ipAddress: (forwardedIp || req.info.remoteAddress).split(',')[0],
        machineName: req.server && req.server.info && req.server.info.host,
        os: osName,
        version,
        serviceName,
        httpRequest: {
            url: req.url,
            state: req.state,
            headers: req.headers
        }
    };
}

async function failPre(request, h, error) {
    if (error.isJoi) return Boom.badRequest(error.message, error);
    return Boom.internal(error.message, undefined, error.statusCode);
}

async function failPreRpc(request, h, error) {
    const code = error.statusCode || (error.isJoi && 400) || 500;
    return h
        .response({
            jsonrpc: request.payload.jsonrpc,
            id: request.payload.id,
            error: {
                type: error.type,
                message: error.message
            }
        })
        .header('x-envoy-decorator-operation', request.payload.method)
        .code(code)
        .takeover();
}

const setBody = {
    assign: 'body',
    failAction: 'error',
    method: ({payload, mime}) => {
        switch (mime) {
            case 'application/json':
                return payload.length ? bourne.parse(payload.toString('utf8')) : null; // see https://hueniverse.com/a-tale-of-prototype-poisoning-2610fa170061
            case 'application/x-www-form-urlencoded':
                return payload.length ? querystring.parse(payload.toString('utf8')) : {};
        }
        return null;
    }
};

const preArray = capture => [capture && setBody, {
    assign: 'utBus',
    failAction: failPre,
    method: (request, h) => {
        const {jsonrpc, id, method, params: [...params]} = capture ? request.pre.body : request.payload;
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
}].filter(Boolean);

const preJsonRpc = (capture, checkAuth, version, logger) => [capture && setBody, {
    assign: 'utBus',
    failAction: failPreRpc,
    method: async(request, h) => {
        try {
            const {jsonrpc, id, method, params, timeout} = capture ? request.pre.body : request.payload;
            if (request.auth.strategy && !['exchange', 'preauthorized'].includes(request.auth.strategy)) {
                await checkAuth(method, request.auth.credentials && request.auth.credentials.permissionMap);
            }
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
                        ...timeout && {timeout: after(timeout)},
                        ...extendMeta(request, version, method.split('.')[0])
                    }
                ]
            };
        } catch (error) {
            logger && logger.error && logger.error(error);
            throw error;
        }
    }
}].filter(Boolean);

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
                        part.pipe(fs.createWriteStream(filename)).on('finish', resolve);
                    }));
                }
            })
            .on('field', (field, value) => {
                if (typeof params[field] === 'undefined') params[field] = value;
            })
            .once('error', reject)
            .once('close', () => Promise.all(files).then(() => {
                const payload = request.route.settings && request.route.settings.app && request.route.settings.app.payload;
                if (payload && payload.validate) {
                    const {value, error} = payload.validate(params);
                    return error ? reject(error) : resolve(value);
                }
                return resolve(params);
            }, reject));

        request.payload.pipe(dispenser);
    });
};

const prePlain = (capture, checkAuth, workDir, method, version, logger) => [capture && setBody, {
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
                        (request.route && request.route.settings && request.route.settings.payload && !request.route.settings.payload.parse)
                            ? {payload: capture ? request.pre.body : request.payload, query: request.query, params: request.params}
                            : {...(capture ? request.pre.body : request.payload), ...request.query, ...request.params},
                        $meta
                    ]
                };
            }
        } catch (error) {
            logger && logger.error && logger.error(error);
            throw error;
        }
    }
}].filter(Boolean);

const domainResolver = (domain, errors) => {
    const resolver = require('./resolver');
    const getHostName = service => `${service}-${domain}.dns-discovery.local`;
    const cache = {};
    return async function resolve(service, invalidate, namespace) {
        try {
            const now = hrtime();
            const hostName = getHostName(service);
            if (invalidate) {
                delete cache[hostName];
            } else {
                const cached = cache[hostName];
                if (cached) {
                    if (hrtime(cached[0])[0] < 3) {
                        cached[0] = now;
                        return {...cached[1], cache: service, namespace};
                    } else {
                        delete cache[hostName];
                    }
                }
            }
            const resolved = await resolver(hostName, 'SRV');
            const result = {
                hostname: (resolved.target === '0.0.0.0' ? '127.0.0.1' : resolved.target),
                port: resolved.port
            };
            cache[hostName] = [now, result];
            return result;
        } catch (e) {
            const err = errors['bus.mdnsResolver']({params: {namespace}});
            err.cause = e;
            throw err;
        };
    };
};

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, errors, findMethodIn, metrics, service, workDir, packages, joi, test, version}) {
    const request = socket.capture ? require('ut-function.capture-request')(req, {name: `${socket.capture}/client`}) : req;

    async function discoverService(namespace) {
        const serviceName = (prefix + namespace.replace(/\//g, '-') + suffix);
        const params = {
            protocol: socket.protocol || server.info.protocol,
            hostname: socket.host || serviceName,
            port: socket.port || server.info.port,
            service
        };
        const requestParams = Object.assign({}, params);
        if (consulDiscover) {
            const services = await consul.health.service({
                service: namespace,
                passing: true
            });
            if (!services || !services.length) {
                throw errors['bus.consulServiceNotFound']({params: {serviceName}});
            }
            Object.assign(requestParams, {
                hostname: services[0].Node.Address,
                port: services[0].Service.Port
            });
        }
        if (resolver) {
            Object.assign(requestParams, await resolver(serviceName, false, namespace));
        }
        return requestParams;
    }

    const brokerRequest = brokerMethod(false, 'request');
    const session = async(token) => {
        const result = await brokerRequest({username: token.payload.oid || token.payload.sub, type: 'oidc', password: '*', channel: 'web'}, {method: 'identity.checkInternal'});
        const [{
            'identity.check': {
                actorId,
                sessionId
            },
            permissionMap
        }] = result;
        token.payload.per = permissionMap;
        token.payload.ses = sessionId;
        token.payload.sub = String(actorId);
    };

    const {verify, checkAuth, getIssuers, get} = require('./oidc')({
        request,
        discoverService,
        errorPrefix: 'bus.',
        errors,
        session,
        issuers: socket.openId || {...socket.utLogin !== false && {'ut-login': {audience: 'ut-bus'}}}
    });

    const mle = jose(socket);
    const mleClient = jose(socket.client || {});

    async function createServer(port) {
        const result = new hapi.Server({
            port: port || socket.port
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
                    verify
                }
            },
            {
                plugin: require('./exchange')
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

        if (socket.capture) {
            await result.register({
                plugin: require('ut-function.capture-hapi'),
                options: {
                    name: `${socket.capture}/server`
                }
            });
        }

        result.ext('onPreResponse', ({response, route}, h) => {
            response && response.isBoom &&
            route && route.settings && route.settings.app && route.settings.app.logError &&
            logger && logger.error && logger.error(response);
            return h.continue;
        });

        result.events.on('start', () => {
            logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'jsonrpc.listen'}, serverInfo: result.info});
        });

        return result;
    }

    const internal = socket.api && socket.api.internal && (() => Promise.all(socket.api.internal.map(name =>
        brokerRequest({}, {method: name + '.service.get'})
            .then(([result]) => ({namespace: name, ...result}))
            .catch(error => ({namespace: name, version: '?', error}))
    )).catch(error => {
        this.error(error);
        throw error;
    }));
    const utApi = await require('ut-api')(
        {
            service,
            version,
            auth: 'openId',
            ...socket.api
        },
        errors,
        async(...params) => {
            try {
                return await getIssuers(...params);
            } catch (error) {
                logger && logger.error && logger.error(error);
                throw error;
            }
        },
        internal
    );

    utApi.route([{
        method: 'GET',
        path: '/healthz',
        options: {
            cors: socket.cors || false,
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
    const resolver = socket.domain && domainResolver(domain, errors);
    const prefix = socket.prefix || '';
    const suffix = socket.suffix || '-service';
    const deleted = (request, h) => {
        return h.response('Method was deleted').code(404);
    };

    // wrap server.info in serverInfo function - hoisting not possible otherwise
    const gatewayCodec = require('./gateway')({serverInfo: key => server.info[key], mleClient, errors, get});

    function gateway($meta, methodName = $meta.method) {
        if (socket.gateway) {
            const [prefix, method] = methodName.split('/');
            if (method) {
                if (socket.gateway[prefix]) return {...socket.gateway[prefix], ...$meta.gateway, method};
            } else {
                const [namespace] = prefix.split('.');
                const gw = socket.gateway[namespace] || socket.gateway[prefix];
                if (gw) return {...gw, ...$meta.gateway, method: prefix};
            }
        }

        if ($meta.gateway) return {...$meta.gateway, method: methodName};
    }

    async function codec($meta, methodType) {
        const gatewayConfig = gateway($meta);

        if (gatewayConfig) return gatewayCodec(gatewayConfig);

        const [namespace, event] = $meta.method.split('.');

        const op = ['start', 'stop', 'drain'].includes(event) ? event : methodType;

        return {
            encode: (...params) => ({params}),
            decode: result => result,
            requestParams: {
                ...await discoverService(namespace),
                path: `/rpc/ports/${namespace}/${op}`
            }
        };
    }

    function brokerMethod(typeName, methodType) {
        return async function(msg, ...rest) {
            const {stream, ...$meta} = rest.pop();
            const {encode, decode, requestParams} = await codec($meta, methodType);
            const {params, headers, method = $meta.method} = await encode(msg, ...rest, $meta);
            const sendRequest = callback => request({
                followRedirect: false,
                json: true,
                method: 'POST',
                url: `${requestParams.protocol}://${requestParams.hostname}:${requestParams.port}${requestParams.path}`,
                body: {
                    jsonrpc: '2.0',
                    method,
                    id: 1,
                    ...$meta.timeout && $meta.timeout[0] && {timeout: spare($meta.timeout, socket.latency || 50)},
                    params
                },
                headers: {
                    'x-envoy-decorator-operation': method,
                    ...$meta.forward,
                    ...headers
                }
            }, stream ? undefined : callback);

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
                                        Object.assign(requestParams, await resolver(requestParams.cache, true, requestParams.namespace));
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
                    } else if (body && body.error !== undefined) {
                        const error =
                            body.jsonrpc
                                ? Object.assign(new Error(), decode(body.error, true))
                                : typeof body.error === 'string'
                                    ? new Error(body.error)
                                    : Object.assign(new Error(), body.error);
                        if (error.type) Object.defineProperty(error, 'name', {value: error.type, configurable: true, enumerable: false});
                        error.req = response.request && {
                            httpVersion: response.httpVersion,
                            url: response.request.href,
                            method: response.request.method
                        };
                        error.res = {
                            httpVersion: response.httpVersion,
                            statusCode: response.statusCode
                        };
                        reject(error);
                    } else if (response.statusCode < 200 || response.statusCode >= 300) {
                        reject(errors['bus.jsonRpcHttp']({
                            statusCode: response.statusCode,
                            statusText: response.statusText,
                            statusMessage: response.statusMessage,
                            httpVersion: response.httpVersion,
                            validation: response.body && response.body.validation,
                            debug: response.body && response.body.debug,
                            params: {
                                code: response.statusCode
                            },
                            ...response.request && {
                                url: response.request.href,
                                method: response.request.method
                            }
                        }));
                    } else if (body && body.result !== undefined && body.error === undefined) {
                        const result = decode(body.result);
                        if (/\.service\.get$/.test(method)) Object.assign(result[0], requestParams);
                        resolve(result);
                    } else {
                        reject(errors['bus.jsonRpcEmpty']());
                    }
                };
                const response = sendRequest(callback);
                if (stream) resolve([response]);
            });
        };
    }

    let server;

    async function start() {
        if (!packages['ut-port']) throw new Error('Unsupported ut-port version (ut-port@6.28.0 or newer expected)');
        if (socket.server != null && !socket.server) return;
        const port = server && server.info.port;
        if (server) await server.stop();
        server = await createServer(port);
        return server.start();
    }

    async function ready() {
        try {
            server && server.route(utApi.routes());
        } catch (error) {
            logger && logger.error && logger.error(error);
            throw error;
        }
    }

    function info() {
        return {
            ...server.info,
            ...mle.keys
        };
    }

    async function stop() {
        const result = server && await server.stop();
        server = false;
        await (discover && new Promise(resolve => {
            discover.destroy(resolve);
        }));
        return result;
    }

    function localRegister(nameSpace, name, fn, reqrep) {
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
        httpResponse && ['code', 'redirect', 'created', 'etag', 'location', 'ttl', 'temporary', 'permanent', 'type', 'state', 'header'].forEach(method =>
            Object.prototype.hasOwnProperty.call(httpResponse, method) &&
            response[method](...[].concat(httpResponse[method]))
        );
        return response;
    }

    async function registerRoute(namespace, name, fn, object, {version}) {
        const path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        const handler = async function({pre}, h) {
            if (Boom.isBoom(pre.utBus)) return pre.utBus;
            const {params, jsonrpc, id, shift, method} = pre.utBus;
            try {
                const results = await fn.apply(object, params);
                const $meta = results && Array.isArray(results) && results.length > 1 && results[results.length - 1];
                const result = shift ? results[0] : results;
                const result0 = [].concat(result)[0];
                const response = (type => {
                    try {
                        switch (type) {
                            case 'file:': {
                                const [file, options = {confine: workDir}] = [].concat(result);
                                return h.file(url.fileURLToPath(file), options);
                            }
                            case 'http:':
                            case 'https:': return h.response(request(result.href).pipe(new Stream.PassThrough()));
                            case 'stream': return h.response(result0.pipe(new Stream.PassThrough()));
                            case 'jsonrpc': return h.response({jsonrpc, id, result, ...shift && test && {$meta: {validation: $meta.validation, calls: $meta.calls}}});
                            default: return h.response(result);
                        }
                    } catch (error) {
                        logger && logger.error && logger.error(error);
                        throw error;
                    }
                })(
                    (result0 instanceof URL && result0.protocol) ||
                    (result0 instanceof Stream && 'stream') ||
                    (jsonrpc && 'jsonrpc')
                ).header('x-envoy-decorator-operation', method);
                if (result && typeof result.httpResponse === 'function') applyMeta(response, {httpResponse: result.httpResponse()});
                return applyMeta(response, $meta);
            } catch (error) {
                return h.response({
                    jsonrpc,
                    id,
                    error
                }).header('x-envoy-decorator-operation', method).code(error.statusCode || 500);
            }
        };

        const route = server && server.match('POST', path);
        if (route && route.settings.handler === deleted) {
            route.settings.handler = handler;
            return route;
        }
        const pre = preArray(socket.capture);
        consul && await consul.agent.service.register({
            name: name.split('.')[0],
            port: server.info.port,
            check: {
                http: `http://${server.info.host}:${server.info.port}/healthz`,
                interval: '5s',
                deregistercriticalserviceafter: '1m'
            }
        });
        discover && await (new Promise((resolve, reject) => {
            discover.announce(
                prefix + name.split('.')[0].replace(/\//g, '-') + suffix + '-' + domain,
                server.info.port,
                error => error ? reject(error) : resolve()
            );
        }));
        await utApi.route({
            method: 'POST',
            path,
            options: {
                pre,
                payload: {
                    output: 'data',
                    parse: socket.capture ? 'gunzip' : true,
                    allow: ['application/json', 'application/x-www-form-urlencoded'],
                    maxBytes: socket.maxBytes
                },
                validate: {
                    payload: socket.capture ? true : joi.object({
                        jsonrpc: joi.string().valid('2.0').required(),
                        timeout: joi.number().optional(),
                        id: joi.alternatives().try(joi.number(), joi.string()).example('1'),
                        method: joi.string().required(),
                        params: joi.array().required()
                    })
                }
            },
            handler
        }, 'utBus.jsonrpc');
        utApi && name.endsWith('.request') && await utApi.restRoutes({
            namespace: name.split('.')[0],
            fn,
            object
        });
    }

    function unregisterRoute(namespace, name) {
        const path = '/rpc/' + namespace + '/' + name.split('.').join('/');
        const route = server && server.match('POST', path);
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

    function paramsSchema(params, method) {
        const root = (params && (params._currentJoi || params.$_root)) || joi; // until we have a single joi
        return root.object({
            jsonrpc: root.string().valid('2.0').required(),
            timeout: root.number().optional().allow(null),
            id: root.alternatives().try(root.number(), root.string()).example('1'),
            method: root.string().valid(method).required(),
            params
        });
    }

    function localMethod(methods, moduleName, {version} = {}) {
        if (/\.validation|\.api|^validation$|^api$/.test(moduleName) && utApi && Object.entries(methods).length) {
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
                const jsonrpc = params && (!rest.body || rest.body.parse || rest.body.parse === undefined);
                const isGetHead = ['get', 'head'].includes(httpMethod && httpMethod.toLowerCase());
                return {
                    method,
                    route: path ? `/rpc/${method.split('.')[0]}/${path.replace(/^\/+/, '')}`.replace(/\/+$/, '') : undefined,
                    httpMethod,
                    version,
                    cors: socket.cors || false,
                    pre: jsonrpc ? preJsonRpc(socket.capture, checkAuth, version, logger) : prePlain(socket.capture, checkAuth, dir || workDir, method, version, logger),
                    validate: {
                        failAction(request, h, error) {
                            logger.error && logger.error(errors['bus.requestValidation']({
                                cause: error,
                                params: {
                                    message: error.message,
                                    path: request.path,
                                    method
                                }
                            }));
                            return h.response({
                                ...jsonrpc && {
                                    jsonrpc: request.payload.jsonrpc,
                                    id: request.payload.id
                                },
                                error: {
                                    type: 'port.paramsValidation',
                                    message: `Method ${method} parameters failed validation`,
                                    ...socket.debug && {cause: error}
                                }
                            }).header('x-envoy-decorator-operation', method).code(400).takeover();
                        },
                        options: {abortEarly: false},
                        query: false,
                        payload: jsonrpc ? paramsSchema(params, method) : (rest.body && rest.body.parse === false),
                        ...validate,
                        ...socket.capture && {
                            payload: !isGetHead
                        }
                    },
                    ...socket.capture && !isGetHead && {
                        body: {
                            output: 'data',
                            parse: socket.capture ? 'gunzip' : true,
                            allow: ['application/json', 'application/x-www-form-urlencoded'],
                            maxBytes: socket.maxBytes
                        }
                    },
                    handler: (request, ...rest) => {
                        const route = server.match('POST', rpc);
                        if (!route || !route.settings || !route.settings.handler) throw Boom.notFound();
                        return route.settings.handler(request, ...rest);
                    },
                    ...rest,
                    ...!jsonrpc && params && {app: {payload: params, ...rest.app}}
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
        gateway,
        exportMethod,
        removeMethod,
        brokerMethod,
        localMethod,
        discoverService,
        removeModule,
        info
    };
};
