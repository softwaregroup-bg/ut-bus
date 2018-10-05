const hapi = require('hapi');
const joi = require('joi');
const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');

function initConsul(config) {
    const consul = require('consul')(Object.assign({
        promisify: true
    }, config));

    return consul;
}

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, findMethodIn}) {
    const server = new hapi.Server({
        port: socket.port
    });

    server.route({
        method: 'GET',
        path: '/health',
        options: {
            auth: false,
            handler: (request, h) => 'ok'
        }
    });

    const consul = socket.consul && initConsul(socket.consul);

    function masterMethod(typeName, methodType) {
        return function(msg, $meta) {
            var service = $meta.method.split('.').shift();
            return Promise.resolve({host: service.replace(/\//g, '-'), port: socket.port})
                .then(params => {
                    if (consul) {
                        return consul.health.service({
                            service
                        })
                            .then(services => {
                                if (!services || !services.length) {
                                    throw Error('Service ' + service + ' cannot be found');
                                }
                                return {
                                    host: services[0].Node.Address,
                                    port: services[0].Service.Port
                                };
                            });
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
                            url: `http://${params.host}:${params.port}/rpc/ports/${service}/${methodType}`,
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
                            } else if (response.statusCode < 200 || response.statusCode >= 300) {
                                reject(new Error());
                            } else if (body && body.result !== undefined && body.error === undefined) {
                                resolve(body.result);
                            } else if (body && body.error) {
                                reject(Object.assign(new Error(), body.error));
                            } else {
                                reject(new Error());
                            }
                        });
                    });
                });
        };
    }

    function start() {
        return server.start();
    }

    function stop() {
        return server.stop();
    }

    function localRegister(nameSpace, name, fn) {
        mapLocal[nameSpace + '.' + name] = fn;
    }

    function registerRoute(namespace, name, fn, object) {
        return Promise.resolve()
            .then(() => consul && consul.agent.service.register({
                name: name.split('.').shift(),
                port: server.info.port
            }))
            .then(() => server.route({
                method: 'POST',
                path: '/rpc/' + namespace + '/' + name.split('.').join('/'),
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
                            params: joi.any().required()
                        })
                    }
                },
                handler: function(request, h) {
                    request.payload.params[1] = Object.assign({}, request.payload.params[1], {
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
                            result
                        }).header('x-envoy-decorator-operation', request.payload.method))
                        .catch(error => h.response({
                            jsonrpc: request.payload.jsonrpc,
                            id: request.payload.id,
                            error
                        }).header('x-envoy-decorator-operation', request.payload.method));
                }
            }));
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

    return {
        stop,
        start,
        exportMethod,
        masterMethod
    };
};
