'use strict';
var errors = require('./errors');
var hrtime = require('browser-process-hrtime');

function flattenAPI(data) {
    var result = {};
    function recurse(cur, prop) {
        if (Object(cur) !== cur) {
            result[prop] = cur;
        } else if (Array.isArray(cur) || typeof cur === 'function') {
            result[prop] = cur;
        } else {
            var isEmpty = true;
            Object.keys(cur).forEach(function(p) {
                isEmpty = false;
                recurse(cur[p], prop ? prop + '.' + p : p);
            });
            if (isEmpty && prop) {
                result[prop] = {};
            }
        }
    }
    recurse(data, '');
    return result;
}

module.exports = function Bus() {
    // private fields
    var remotes = [];
    var locals = [];
    var log = {};
    var importCache = {};
    var listReq = [];
    var listPub = [];
    var mapLocal = {};

    function findMethod(where, methodName, type) {
        var key = ['ports', methodName, type].join('.');
        var result = where[key] || where[methodName];
        if (!result) {
            var names = methodName.split('.');
            while (names.length) {
                result = where[['ports', names.join('.'), type].join('.')];
                if (result) {
                    where[key] = result;
                    break;
                }
                names.pop();
            }
        }
        return result;
    }

    function findMethodIn(where, type) {
        function search() {
            var $meta = (arguments.length > 1 && arguments[arguments.length - 1]) || {};
            var method = $meta.method;
            if (!method) {
                if ($meta.mtid === 'error') {
                    if (arguments[0] instanceof Error) {
                        return Promise.reject(arguments[0]);
                    }
                    var err = errors.unhandledError($meta);
                    err.cause = arguments[0];
                    return Promise.reject(err);
                }
                return Promise.reject(errors.missingMethod());
            }
            var fn = findMethod(where, $meta.destination || method, type);
            if (fn) {
                delete $meta.destination;
                return fn.apply(undefined, Array.prototype.slice.call(arguments));
            } else {
                return Promise.reject(
                    $meta.destination ? errors.destinationNotFound({
                        params: {
                            destination: $meta.destination
                        }
                    }) : errors.methodNotFound({
                        params: {method}
                    })
                );
            }
        }

        return search;
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
                rpc.createLocalCall(name, methods[name]);
            });
        });
    }

    function localRegister(nameSpace, name, fn, adapted) {
        adapted ? listReq.push(nameSpace + '.' + name) : listPub.push(nameSpace + '.' + name);
        mapLocal[nameSpace + '.' + name] = fn;
    }

    /**
     * Register methods available to the bus and notify each remote to reload the bus methods
     *
     * @param {object} methods object containing methods to be registered
     * @param {string} namespace to use when registering
     * @param {function()} [adapt] function to adapt a promise method to callback suitable for RPC
     * @returns {promise|object}
     */
    function serverRegister(methods, namespace, adapt) {
        var methodNames = [];
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
        registerLocalMethods(locals, mapLocal);

        return registerRemoteMethods(remotes, methodNames, adapt);
    }

    function processError(obj, $meta) {
        if (obj && $meta && $meta.method) {
            if (Array.isArray(obj.method)) {
                obj.method.push($meta.method);
            } else if (obj.method) {
                obj.method = [obj.method, $meta.method];
            } else {
                obj.method = $meta.method;
            }
        }
        return obj;
    }

    function handleRPCResponse(obj, fn, args, server) {
        var $meta = (args.length > 1 && args[args.length - 1]);
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

    function noOp() {
        return Promise.resolve();
    };

    return {
        // properties
        id: null,
        socket: 'bus',
        canSkipSocket: true,
        server: false,
        req: {},
        pub: {},
        modules: {},
        local: {}, // todo remove
        last: {},
        decay: {},
        logLevel: 'warn',
        logFactory: null,
        performance: null,
        stop: noOp,
        errors,

        init: function() {
            this.masterRequest = this.getMethod('req', 'request', undefined, {returnMeta: true});
            this.masterPublish = this.getMethod('pub', 'publish', undefined, {returnMeta: true});
            this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'}));
            var self = this;
            return new Promise(function(resolve, reject) {
                var pipe;
                if (!self.socket) {
                    resolve();
                    return;
                } else if (typeof self.socket === 'string') {
                    pipe = (process.platform === 'win32') ? '\\\\.\\pipe\\ut5-' + self.socket : '/tmp/ut5-' + self.socket + '.sock';
                } else {
                    pipe = self.socket;
                }
                var net = require('net');
                var utRPC = require('ut-rpc');
                function connectionHandler(socket) {
                    var connection = {
                        localAddress: socket.localAddress,
                        localPort: socket.localPort,
                        remoteAddress: socket.remoteAddress,
                        remotePort: socket.remotePort
                    };
                    log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.connected'}, connection});
                    socket.on('close', () => {
                        log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.disconnected'}, connection});
                    }).on('error', (err) => {
                        log && log.error && log.error(err);
                    }).on('data', function(msg) {
                        log && log.trace && log.trace({$meta: {mtid: 'frame', opcode: 'in'}, message: msg});
                    });
                    var rpc = utRPC({
                        registerRemote: self.registerRemote.bind(self, locals.length)
                    }, self.server, log);
                    locals.push(rpc);
                    rpc.on('remote', function(remote) {
                        remotes.push(remote);
                        var methods = [
                            registerRemoteMethods([remote], listReq, true),
                            registerRemoteMethods([remote], listPub, false),
                            registerLocalMethods([rpc], mapLocal)
                        ];
                        return self.server ? methods : Promise.all(methods).then(resolve).catch(reject);
                    });
                    rpc.pipe(socket).pipe(rpc);
                }
                if (self.server) {
                    if (process.platform !== 'win32') {
                        var fs = require('fs');
                        if (fs.existsSync(pipe)) {
                            fs.unlinkSync(pipe);
                        }
                    }
                    var server = net.createServer(connectionHandler)
                        .on('close', () => {
                            log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.close'}, address: pipe});
                        })
                        .on('error', err => {
                            log && log.error && log.error(err);
                            reject(err);
                        })
                        .on('listening', () => {
                            log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.listening'}, address: pipe});
                            resolve();
                        })
                        .listen(pipe);
                    // todo set on error handler
                    self.stop = function() {
                        self.stop = noOp;
                        return new Promise(function(resolve, reject) {
                            server.close(function(err) {
                                server.unref();
                                if (err) {
                                    log && log.error && log.error(err);
                                    reject(err);
                                }
                                resolve();
                            });
                        });
                    };
                } else {
                    var reconnect = self.ssl ? require('./reconnect-tls') : require('./reconnect-net');
                    var connection = reconnect(connectionHandler)
                        .on('error', (err) => {
                            log && log.error && log.error(err);
                        })
                        .connect(pipe);
                    // todo set on error handler
                    self.stop = function() {
                        var emitter = connection.disconnect();
                        emitter._connection && emitter._connection.unref();
                        self.stop = noOp;
                        return Promise.resolve();
                    };
                }

                // todo handle out frames
                // log.trace && log.trace({$$:{opcode:'frameOut'}, payload:msg});
            });
        },

        destroy: function() {
            remotes.forEach(function(remote) {
                // todo destroy connection
            });
            return this.stop();
        },

        registerRemote: function(index, type, methods) {
            var id = this.id;
            var server = this.server;
            var adapt = {
                req: function req(fn) {
                    return function() {
                        if (!fn) {
                            return Promise.reject(errors.bus('Remote method not found for object "' + id + '"'));
                        }
                        var args = Array.prototype.slice.call(arguments);
                        return handleRPCResponse(undefined, fn, args, server);
                    };
                },
                pub: function subscribe(fn) {
                    return function() {
                        fn.apply(undefined, Array.prototype.slice.call(arguments));
                        return true;
                    };
                }
            }[type];

            var root = this[type];

            if (!(methods instanceof Array)) {
                methods = [methods];
            }

            var remote = locals[index];
            methods.forEach(function(method) {
                root[method] = adapt(remote.createRemote(method, type));
            });

            return 'remotes registered in ' + this.id;
        },

        /**
         * Register RPC methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        register: function(methods, namespace) {
            return serverRegister(methods, namespace || this.id, true);
        },

        /**
         * Register subscribe methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        subscribe: function(methods, namespace) {
            return serverRegister(methods, namespace || this.id, false);
        },

        registerLocal: function(methods, namespace) {
            var x = {};
            x[namespace] = methods;
            Object.assign(this.modules, flattenAPI(x));
        },

        start: function() {
            return Promise.all([
                this.register({request: findMethodIn(this.req, 'request')}),
                this.subscribe({publish: findMethodIn(this.pub, 'publish')})
            ]);
        },

        getMethod: function(typeName, methodType, methodName, options) {
            var bus = this;
            var fn = null;
            var unpack = true;
            var fallback = options && options.fallback;
            var timeoutSec = options && options.timeout && (Math.floor(options.timeout / 1000));
            var timeoutNSec = options && options.timeout && (options.timeout % 1000 * 1000000);

            function busMethod(...params) {
                var $meta = (params.length > 1 && params[params.length - 1]);
                var $applyMeta;
                if (!$meta) {
                    params.push($applyMeta = {method: methodName});
                } else {
                    $applyMeta = params[params.length - 1] = Object.assign({}, $meta);
                }
                if (options && options.timeout && !$applyMeta.timeout) {
                    $applyMeta.timeout = hrtime();
                    $applyMeta.timeout[1] += timeoutNSec;
                    $applyMeta.timeout[0] += timeoutSec;
                    if ($applyMeta.timeout[1] >= 1000000000) {
                        $applyMeta.timeout[0]++;
                        $applyMeta.timeout[1] -= 1000000000;
                    }
                }
                if (!fn) {
                    if (methodName) {
                        bus.canSkipSocket && (fn = findMethod(mapLocal, methodName, methodType));
                        fn && (unpack = true);
                    }
                    if (!fn && bus[typeName]) {
                        fn = bus[typeName]['master.' + methodType];
                    }
                }
                if (fn) {
                    if (methodName) {
                        $applyMeta.opcode = methodName.split('.').pop();
                        $applyMeta.mtid = 'request';
                        $applyMeta.method = methodName;
                    }
                    return Promise.resolve()
                        .then(() => {
                            return fn.apply(this, params);
                        })
                        .then(result => {
                            if ($meta.timer) {
                                let $resultMeta = (result.length > 1 && result[result.length - 1]);
                                $resultMeta && $resultMeta.calls && $meta.timer($resultMeta.calls);
                            }
                            if (!unpack || (options && options.returnMeta)) {
                                return result;
                            }
                            return result[0];
                        }, error => {
                            if (fallback && error instanceof errors.methodNotFound) {
                                fn = fallback;
                                fallback = false;
                                unpack = false;
                                return fn.apply(this, params);
                            }
                            return Promise.reject(processError(error, $applyMeta));
                        });
                } else {
                    return Promise.reject(errors.bus('Method binding failed for ' + typeName + ' ' + methodType + ' ' + methodName));
                }
            }

            if (bus.modules[methodName]) {
                Object.assign(busMethod, bus.modules[methodName]);
            }
            return busMethod;
        },

        importMethods: function(target, methods, options, binding, single) {
            var modules = this.modules;
            var self = this;

            function startRetry(fn, {timeout, retry}) {
                return new Promise((resolve, reject) => {
                    const attempt = () => fn()
                    .then(resolve)
                    .catch(error => { // todo maybe log these errors
                        if (Date.now() > timeout) {
                            reject(errors.timeout(error));
                        } else {
                            setTimeout(attempt, retry);
                        }
                    });
                    attempt();
                });
            };

            function importMethod(methodName) {
                if (!binding && importCache !== target && importCache[methodName]) {
                    target[methodName] = importCache[methodName];
                    return;
                }
                var method;
                method = self.getMethod('req', 'request', methodName, options);
                target[methodName] = Object.assign(function(msg, $meta) {
                    if ($meta && $meta.timeout && $meta.retry) {
                        return startRetry(() => method.apply(binding, arguments), $meta);
                    } else {
                        return method.apply(binding, arguments);
                    }
                }, method);

                if (target !== importCache) {
                    importCache[methodName] = target[methodName];
                }
            }

            if (methods && methods.length) {
                var unmatched = methods.slice();
                // create regular expression matching all listed methods as passed or as prefixes
                var exp = new RegExp(methods.map(function(m) { return '(^' + m.replace(/\./g, '\\.') + (single ? '$)' : '(?:\\.(?!\\.).+)?$)'); }).join('|'), 'i');

                Object.keys(modules).forEach(function(name) {
                    var match = name.match(exp);
                    if (match) {
                        var x = modules[name];
                        if (typeof x === 'function') {
                            if (!binding) {
                                importMethod(name);
                            } else {
                                var f = target[name] = Object.assign((...params) => {
                                    x.super = f.super;
                                    return x.apply(binding, params);
                                }, x, {super: target[name]});
                            }
                        } else {
                            target[name] = x;
                        }
                        match.forEach(function(value, index) {
                            if (index > 0) { // clear all methods that exists in local e.g. abc, a.b, a.b.c .. etc.
                                unmatched[index - 1] = null;
                            }
                        });
                    }
                });
                // import all nonexisting
                unmatched.forEach(function(name) {
                    name && importMethod(name);
                });
            }
        },

        importMethod: function(methodName, options) {
            var result = importCache[methodName];
            if (!result) {
                this.importMethods(importCache, [methodName], options, undefined, true);
                result = importCache[methodName];
            }

            return result;
        },

        notification: function(method) {
            return (msg, $meta) => this.dispatch(msg, Object.assign({}, $meta, {mtid: 'notification', method}));
        },

        decayTime: function(key) {
            var longestPrefix = (prev, cur) => (prev.length < cur.length && key.substr(0, cur.length) === cur) ? cur : prev;
            return this.decay[Object.keys(this.decay).reduce(longestPrefix, '')];
        },

        dispatch: function() {
            var $meta = (arguments.length > 1 && arguments[arguments.length - 1]);
            var mtid;
            if ($meta) {
                mtid = $meta.mtid;
                if ($meta.resample) { // check if we need to discard messages coming earlier than specified decay time
                    var now = Date.now();
                    var last = this.last[$meta.resample];
                    if (last) {
                        if (last.decay > 0 && last.timeout <= now) {
                            last.count = 1;
                        } else {
                            last.count++;
                            mtid = 'discard';
                        }
                        last.timeout = now + last.decay;
                        // todo persist last object in case decay > 0
                    } else {
                        var decay = this.decayTime($meta.resample);
                        this.last[$meta.resample] = {
                            count: 1,
                            timeout: now + decay,
                            decay
                        };
                        if (decay <= 0) {
                            mtid = 'discard';
                        }
                        // todo persist last object in case decay > 0
                    }
                }
                if (mtid === 'discard') {
                    return true;
                }
                if (this.socket) {
                    if (mtid === 'request') {
                        return this.masterRequest.apply(this, Array.prototype.slice.call(arguments));
                    } else {
                        return this.masterPublish.apply(this, Array.prototype.slice.call(arguments));
                    }
                } else {
                    var f = findMethod(mapLocal, $meta.destination || $meta.method, mtid === 'request' ? 'request' : 'publish');
                    if (f) {
                        return Promise.resolve(f.apply(undefined, Array.prototype.slice.call(arguments)));
                    } else {
                        throw errors.methodNotFound({params: {method: $meta.method}});
                    }
                }
            } else {
                return false;
            }
        },

        get publicApi() {
            let bus = this;
            return {
                get config() {
                    return bus.config;
                },
                get local() {
                    log && log.warn && log.warn('Accessing bus.local directly is deprecated and will be removed in the next major version!');
                    return bus.local;
                },
                get errors() {
                    return bus.errors;
                },
                get performance() {
                    return bus.performance;
                },
                registerLocal(methods, namespace) {
                    return bus.registerLocal(methods, namespace);
                },
                importMethod(methodName, options) {
                    return bus.importMethod(methodName, options);
                },
                importMethods(target, methods, options, binding, single) {
                    return bus.importMethods(target, methods, options, binding, single);
                },
                notification(method) {
                    return bus.notification(method);
                },
                register(methods, namespace) {
                    return bus.register(methods, namespace);
                },
                subscribe(methods, namespace) {
                    return bus.subscribe(methods, namespace);
                },
                dispatch(...params) {
                    return bus.dispatch(...params);
                }
            };
        }
    };
};
