module.exports = function create({id, socket, logger, isServer, isTLS, mapLocal, processError, errors, findMethodIn}) {
    function noOp() {
        return Promise.resolve();
    };

    const remotes = [];
    const listReq = [];
    const listPub = [];
    const rpcLocal = [];
    const map = {
        req: {},
        pub: {}
    };

    function handleRPCResponse(obj, fn, args, server) {
        const $meta = (args.length > 1 && args[args.length - 1]);
        return new Promise(function(resolve, reject) {
            args.push(function(err, res) {
                if (err) {
                    if (err.length > 1) {
                        $meta.mtid = 'error';
                        reject(server ? err[0] : processError(err[0], $meta));
                    } else {
                        $meta.mtid = 'error';
                        reject(server ? err : processError(err, $meta));
                    }
                } else {
                    resolve(res);
                }
            });
            fn.apply(obj, args);
        });
    }

    function brokerMethod(typeName, methodType) {
        return map[typeName] && map[typeName]['broker.' + methodType] && map[typeName]['broker.' + methodType].method;
    }

    function start() {
        return Promise.all([
            exportMethod({request: findMethodIn(map.req, 'request')}, id, true),
            exportMethod({publish: findMethodIn(map.pub, 'publish')}, id, false)
        ]);
    }

    function registerRemote(index, type, methods) {
        const adapt = {
            req: function req(fn) {
                return function() {
                    if (!fn) {
                        return Promise.reject(errors['bus.remoteMethodNotFound']({
                            params: {bus: id}
                        }));
                    }
                    const args = Array.prototype.slice.call(arguments);
                    return handleRPCResponse(undefined, fn, args, isServer);
                };
            },
            pub: function subscribe(fn) {
                return function() {
                    fn.apply(undefined, Array.prototype.slice.call(arguments));
                    return true;
                };
            }
        }[type];

        const root = map[type];

        if (!(methods instanceof Array)) {
            methods = [methods];
        }

        const remote = rpcLocal[index];
        methods.forEach(function(method) {
            root[method] = {method: adapt(remote.createRemote(method, type))};
        });

        return 'remotes registered in ' + id;
    }

    function registerRemoteMethods(where, methodNames, adapt) {
        return Promise.all(
            where.reduce(function(prev, remote) {
                prev.push(new Promise(function(resolve, reject) {
                    remote.registerRemote(adapt ? 'req' : 'pub', methodNames, function(err, res) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(res);
                        }
                    });
                }));
                return prev;
            }, [])
        );
    }

    function registerLocalMethods(where, methods) {
        where.forEach(function(rpc) {
            Object.keys(methods).forEach(function(name) {
                rpc.createLocalCall(name, methods[name].method);
            });
        });
    }

    function localRegister(nameSpace, name, fn, adapted) {
        adapted ? listReq.push(nameSpace + '.' + name) : listPub.push(nameSpace + '.' + name);
        const local = mapLocal[nameSpace + '.' + name];
        if (local) {
            local.method = fn;
        } else {
            mapLocal[nameSpace + '.' + name] = {method: fn};
        }
    }

    /**
     * Register methods available to the bus and notify each remote to reload the bus methods
     *
     * @param {object} methods object containing methods to be registered
     * @param {string} namespace to use when registering
     * @param {function()} [adapt] function to adapt a promise method to callback suitable for RPC
     * @returns {promise|object}
     */
    function exportMethod(methods, namespace, adapt) {
        const methodNames = [];
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    methodNames.push(namespace + '.' + fn.name);
                    localRegister(namespace, fn.name, fn, adapt);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    methodNames.push(namespace + '.' + key);
                    localRegister(namespace, key, methods[key].bind(methods), adapt);
                }
            });
        }

        if (!methodNames.length) {
            return 0;
        }
        registerLocalMethods(rpcLocal, mapLocal);

        return registerRemoteMethods(remotes, methodNames, adapt);
    }

    function removeMethod(names, namespace, reqrep) {
        names.forEach(name => {
            const local = mapLocal[namespace + '.' + name];
            if (local) delete local.method;
        });
    }

    return new Promise(function(resolve, reject) {
        const result = {
            stop: noOp,
            start: start,
            exportMethod,
            removeMethod,
            brokerMethod
        };

        let pipe;
        if (!socket) {
            resolve(result);
            return;
        } else if (typeof socket === 'string') {
            pipe = (process.platform === 'win32') ? '\\\\.\\pipe\\ut5-' + socket : '/tmp/ut5-' + socket + '.sock';
        } else {
            pipe = socket;
        }
        const net = require('net');
        const utRPC = require('ut-rpc');
        function connectionHandler(socket) {
            const connection = {
                localAddress: socket.localAddress,
                localPort: socket.localPort,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort
            };
            logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'bus.connected'}, connection});
            socket.on('close', () => {
                logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'bus.disconnected'}, connection});
            }).on('error', (err) => {
                logger && logger.error && logger.error(err);
            }).on('data', function(msg) {
                logger && logger.trace && logger.trace({$meta: {mtid: 'frame', method: 'in'}, message: msg});
            });
            const rpc = utRPC({
                registerRemote: registerRemote.bind(null, rpcLocal.length)
            }, isServer, logger);
            rpcLocal.push(rpc);
            rpc.on('remote', function(remote) {
                remotes.push(remote);
                const methods = [
                    registerRemoteMethods([remote], listReq, true),
                    registerRemoteMethods([remote], listPub, false),
                    registerLocalMethods([rpc], mapLocal)
                ];
                return isServer ? methods : Promise.all(methods).then(() => resolve(result)).catch(reject);
            });
            rpc.pipe(socket).pipe(rpc);
        }
        if (isServer) {
            if (process.platform !== 'win32') {
                const fs = require('fs');
                if (fs.existsSync(pipe)) {
                    fs.unlinkSync(pipe);
                }
            }
            const server = net.createServer(connectionHandler)
                .on('close', () => {
                    logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'bus.close'}, address: pipe});
                })
                .on('error', err => {
                    logger && logger.error && logger.error(err);
                    reject(err);
                })
                .on('listening', () => {
                    logger && logger.info && logger.info({$meta: {mtid: 'event', method: 'bus.listening'}, address: pipe});
                    resolve(result);
                })
                .listen(pipe);
            // todo set on error handler
            result.stop = function() {
                result.stop = noOp;
                return new Promise(function(resolve, reject) {
                    server.close(function(err) {
                        server.unref();
                        if (err) {
                            logger && logger.error && logger.error(err);
                            reject(err);
                        }
                        resolve();
                    });
                });
            };
        } else {
            const reconnect = isTLS ? require('./reconnect-tls') : require('./reconnect-net');
            const connection = reconnect(connectionHandler)
                .on('error', (err) => {
                    logger && logger.error && logger.error(err);
                })
                .connect(pipe);
            // todo set on error handler
            result.stop = function() {
                const emitter = connection.disconnect();
                emitter._connection && emitter._connection.unref();
                result.stop = noOp;
                return Promise.resolve();
            };
        }
        // todo destroy connection
        // remotes.forEach(function(remote) {
        // });
        // todo handle out frames
        // log.trace && log.trace({$$:{method:'frameOut'}, payload:msg});
    });
};
