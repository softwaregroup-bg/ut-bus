'use strict';

var when = require('when');
var assign = require('lodash.assign');
var capitalize = require('lodash.capitalize');
var errors = require('./errors');

function createFieldError(errType, module, validation) {
    var joiErrors = validation.error.details || [];
    var fieldErrors = {};
    var fieldErrorType = '';
    var fieldErrorTypePieces = [];
    module = module.split('.');
    var errorCode = capitalize(module[0]) + errType;
    var error = errors.bus(errorCode); // todo define validation errors hierarchy rules
    error.code = errorCode;
    joiErrors.forEach(function(err) {
        fieldErrorType = 'Joi';
        fieldErrorTypePieces = err.type.split('.');
        fieldErrorTypePieces.forEach(function(errorPiece) {
            fieldErrorType += capitalize(errorPiece);
        });
        fieldErrors[err.path] = {
            code: fieldErrorType,
            message: err.message,
            errorPrint: err.message
        };
    });
    error.fieldErrors = fieldErrors;
    throw error;
}

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

function getOpcode(methodName) {
    return methodName.split('.').pop() || 'request';
}

module.exports = function Bus() {
    // private fields
    var remotes = [];
    var locals = [];
    var log = {};
    var cacheNotBound = {};
    var cacheBound = {};
    var listReq = [];
    var listPub = [];
    var mapLocal = {};

    function findMethod(where, cache, methodName, type) {
        var key = ['ports', methodName, type].join('.');
        var result = cache[key] || where[key] || where[methodName];
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

    /**
     * Get publishing method
     *
     * @returns {function()} publish(msg) that publishes message
     *
     */
    function _publish(thisPub) {
        var pub = {};

        function publish() {
            var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
            var method = $meta.method;
            if (!method) {
                if ($meta.mtid === 'error') {
                    if (arguments[0] instanceof Error) {
                        return when.reject(arguments[0]);
                    }
                    var err = errors.unhandledError($meta);
                    err.cause = arguments[0];
                    return when.reject(err);
                }
                return when.reject(errors.missingMethod());
            }
            var fn = findMethod(thisPub, pub, $meta.destination || method, 'publish');
            if (fn) {
                delete $meta.destination;
                return fn.apply(undefined, Array.prototype.slice.call(arguments));
            } else {
                return when.reject($meta.destination ? errors.destinationNotFound({destination: {method: $meta.destination}}) : errors.methodNotFound({params: {method}}));
            }
        }

        return publish;
    }

    /**
     * Get rpc method
     *
     * @returns {function()} request(msg) that executes remote procedure
     *
     */
    function _request(thisRPC) {
        var RPC = {};

        function request() {
            var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
            var method = $meta.method;
            if (!method) {
                return when.reject(errors.missingMethod());
            }
            var fn = findMethod(thisRPC, RPC, $meta.destination || method, 'request');
            if (fn) {
                delete $meta.destination;
                return fn.apply(undefined, Array.prototype.slice.call(arguments))
                    .then(function(result) {
                        return [result, $meta];
                    })
                    .catch(function(error) {
                        $meta.mtid = 'error';
                        throw error;
                    });
            } else {
                return when.reject($meta.destination ? errors.destinationNotFound({params: {destination: $meta.destination}}) : errors.methodNotFound({params: {method}}));
            }
        }

        return request;
    }

    function registerRemoteMethods(where, methodNames, adapt) {
        return when.all(
            when.reduce(where, function(prev, remote) {
                prev.push(when.promise(function(resolve, reject) {
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
                    localRegister(namespace, fn.name, adapt ? adapt(null, fn) : fn, adapt);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    methodNames.push(namespace + '.' + key);
                    localRegister(namespace, key, adapt ? adapt(methods, methods[key]) : methods[key].bind(methods), adapt);
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
        var $meta = (args.length && args[args.length - 1]);
        return when.promise(function(resolve, reject) {
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
                    if (res.length > 1) {
                        assign($meta, res[res.length - 1]);
                        resolve(res[0]);
                    } else {
                        resolve(res);
                    }
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
        server: false,
        req: {},
        pub: {},
        local: {},
        logLevel: 'warn',
        logFactory: null,
        performance: null,
        stop: noOp,

        init: function() {
            this.masterRequest = this.getMethod('req', 'request');
            this.masterPublish = this.getMethod('pub', 'publish');
            this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'}));
            var self = this;
            return when.promise(function(resolve, reject) {
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
                    socket.on('data', function(msg) {
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
                        .listen(pipe, function(err) {
                            if (err) {
                                log && log.error && log.error(err);
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
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
            return this.stop()
                .then(() => {
                    return this.performance && this.performance.stop();
                });
        },

        registerRemote: function(index, type, methods, cb) {
            var id = this.id;
            var server = this.server;
            var adapt = {
                req: function req(fn) {
                    return function() {
                        if (!fn) {
                            return when.reject(errors.bus('Remote method not found for object "' + id + '"'));
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

            cb(undefined, 'remotes registered in ' + this.id);
        },

        /**
         * Register RPC methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        register: function(methods, namespace) {
            function adapt(self, f) {
                return function() {
                    var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
                    var callback = arguments[arguments.length - 1];
                    when(f.apply(self, args))
                        .then(function(result) {
                            callback(undefined, result);
                            return result;
                        })
                        .catch(function(error) {
                            callback(error);
                        });
                };
            }

            return serverRegister(methods, namespace || this.id, this.socket ? adapt : false);
        },

        /**
         * Register subscribe methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        subscribe: function(methods, namespace) {
            return serverRegister(methods, namespace || this.id);
        },

        registerLocal: function(methods, namespace) {
            var x = {};
            x[namespace] = methods;
            assign(this.local, flattenAPI(x));
        },

        start: function() {
            return when.all([
                this.register([_request(this.req)]),
                this.subscribe([_publish(this.pub)])
            ]);
        },

        getMethod: function(typeName, methodType, methodName, validate) {
            var bus = this;
            var fn = null;
            var local;

            function busMethod() {
                var $meta = (arguments.length > 1 && arguments[arguments.length - 1]);
                var applyArgs = Array.prototype.slice.call(arguments);
                if (!$meta) {
                    applyArgs.push($meta = {method: methodName});
                }
                if (!methodName && $meta && typeof $meta.callback === 'function') {
                    var cb = $meta.callback;
                    delete $meta.callback;
                    return cb.apply(this, applyArgs);
                } else if (!fn) {
                    var type;
                    // noinspection JSUnusedAssignment
                    (methodName && (type = bus.local) && (fn = type[methodName]) && (local = true)) ||
                    (methodName && (!bus.socket) && (fn = findMethod(mapLocal, mapLocal, methodName, methodType)) && !(local = false)) ||
                    ((type = bus[typeName]) && (fn = type['master.' + methodType]) && (local = false));
                }
                if (fn) {
                    if (!local) {
                        if (!bus.socket) {
                            throw errors.bus('Invalid use of getMethod when not using socket');
                        }

                        if (methodName) {
                            if (!$meta) {
                                applyArgs.push({
                                    opcode: methodName.split('.').pop(),
                                    mtid: 'request',
                                    method: methodName
                                });
                            } else {
                                $meta.opcode = methodName.split('.').pop();
                                $meta.mtid = 'request';
                                $meta.method = methodName;
                            }
                        }
                        // else {applyArgs.push({});}
                    }
                    if (local && validate && bus.local[methodName]) {
                        var requestSchema = validate.request && bus.local[methodName].request;
                        var responseSchema = validate.response && bus.local[methodName].response;
                        var joi = (requestSchema || responseSchema) && require('joi');
                        if (requestSchema) {
                            var requestValidation = joi.validate(applyArgs[0], requestSchema, {abortEarly: false});
                            if (requestValidation.error) {
                                return createFieldError('RequestFieldError', methodName, requestValidation);
                            }
                        }
                        if (responseSchema) {
                            var response = fn.apply(this, applyArgs);
                            var validateResult = function(result) {
                                var responseValidation = joi.validate(result, responseSchema, {abortEarly: false});
                                if (responseValidation.error) {
                                    return createFieldError('ResponseFieldError', methodName, responseValidation);
                                } else {
                                    return result;
                                }
                            };
                            return when(response).then(validateResult).catch(validateResult);
                        }
                    }
                    return when(fn.apply(this, applyArgs));
                } else {
                    return when.reject(errors.bus('Method binding failed for ' + typeName + ' ' + methodType + ' ' + methodName));
                }
            }

            if (bus.local[methodName]) {
                assign(busMethod, bus.local[methodName]);
            }
            return busMethod;
        },

        importMethods: function(target, methods, validate, binding, single) {
            var local = this.local;
            var self = this;
            var cache = binding ? cacheNotBound : cacheBound;

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
                if (cache[methodName]) {
                    if (target !== cache) {
                        target[methodName] = binding ? cache[methodName].bind(binding) : cache[methodName];
                    }
                    return;
                }
                var method;
                if (self.socket) {
                    method = self.getMethod('req', 'request', methodName, validate);
                } else {
                    method = function(msg) {
                        var fn = local[methodName];
                        if (fn) {
                            return Promise.resolve(fn.apply(this, Array.prototype.slice.call(arguments)));
                        }

                        fn = findMethod(mapLocal, mapLocal, methodName, 'request');
                        if (fn) {
                            return fn(msg, {mtid: 'request', opcode: getOpcode(methodName), method: methodName})
                                .then(function(result) {
                                    return result[0];
                                });
                        } else {
                            throw errors.methodNotFound({params: {method: methodName}});
                        }
                    };
                }

                // target[methodName] = binding ? assign(method.bind(binding), method) : method;
                target[methodName] = assign(function(msg, $meta) {
                    if ($meta && $meta.timeout) {
                        return startRetry(() => method.apply(binding, arguments), $meta);
                    } else {
                        return method.apply(binding, arguments);
                    }
                }, method);

                if (target !== cacheBound) {
                    cacheBound[methodName] = target[methodName];
                    cacheNotBound[methodName] = method;
                }
            }

            if (methods && methods.length) {
                var unmatched = methods.slice();
                // create regular expression matching all listed methods as passed or as prefixes
                var exp = new RegExp(methods.map(function(m) { return '(^' + m.replace(/\./g, '\\.') + (single ? '$)' : '(?:\\..*)?$)'); }).join('|'), 'i');

                Object.keys(local).forEach(function(name) {
                    var match = name.match(exp);
                    if (match) {
                        var x = local[name];
                        if (typeof x === 'function') {
                            importMethod(name);
                        } else {
                            target[name] = x;
                        }
                        match.forEach(function(value, index) {
                            (index > 0) && (unmatched[index - 1] = null);
                        });
                    }
                });
                unmatched.forEach(function(name) {
                    name && importMethod(name);
                });
            }
        },

        importMethod: function(methodName, validate) {
            var result = cacheBound[methodName];
            if (!result) {
                this.importMethods(cacheBound, [methodName], validate, undefined, true);
                result = cacheBound[methodName];
            }

            return result;
        },

        notification: function(method) {
            return msg => this.dispatch(msg, {mtid: 'notification', method});
        },

        dispatch: function() {
            var $meta = (arguments.length && arguments[arguments.length - 1]);
            var mtid;
            if ($meta) {
                mtid = $meta.mtid;
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
                    if ($meta && typeof $meta.callback === 'function') {
                        var cb = $meta.callback;
                        delete $meta.callback;
                        return cb.apply(this, Array.prototype.slice.call(arguments));
                    }
                    var f = findMethod(mapLocal, mapLocal, $meta.destination || $meta.method, mtid === 'request' ? 'request' : 'publish');
                    if (f) {
                        return Promise.resolve(f.apply(undefined, Array.prototype.slice.call(arguments)))
                            .then(function(result) {
                                return result[0];
                            });
                    } else {
                        throw errors.methodNotFound({params: {method: $meta.method}});
                    }
                }
            } else {
                return false;
            }
        }
    };
};
