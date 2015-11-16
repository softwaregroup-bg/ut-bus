var when = require('when');
var assign = require('lodash/object/assign');
var capitalize = require('lodash/string/capitalize');
var errors = require('./errors');

function createFieldError(errType, module, validation) {
    var joiErrors = validation.error.details || [];
    var fieldErrors = {};
    var fieldErrorType = '';
    var fieldErrorTypePieces = [];
    module = module.split('.');
    var errorCode = capitalize(module[0]) + errType;
    var error = errors.busError(errorCode);
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

module.exports = function Bus() {
    //private fields
    var remotes = [];
    var locals = [];
    var log = {};
    var cache = {};
    var listReq = [];
    var listPub = [];
    var mapLocal = {};

    /**
     * Get publishing method
     *
     * @returns {function} publish(msg) that publishes message
     *
     */
    function _publish(thisPub) {
        var pub = {};

        function publish() {
            var args = Array.prototype.slice.call(arguments);
            var $meta = (args.length && args[args.length - 1]) || {};
            var d = $meta.destination;
            if (d) {
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = thisPub[d]) || (pub[d] = fn = thisPub['ports.' + d + '.publish'])) {
                    delete $meta.destination;
                    return fn.apply(undefined, args);
                }
            }
        }

        return publish;
    }

    /**
     * Get rpc method
     *
     * @returns {function} request(msg) that executes remote procedure
     *
     */
    function _request(thisRPC) {
        var RPC = {};

        function request() {
            var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
            var d = $meta.destination;
            if (d) {
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = RPC[d]) || (RPC[d] = fn = thisRPC['ports.' + d + '.request']) || (RPC[d] = fn = thisRPC[d + '.' + $meta.opcode])) {
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
                    $meta.mtid = 'error';
                    $meta.errorMessage = 'Destination not found';
                    return when.reject($meta);
                }
            } else {
                $meta.mtid = 'error';
                $meta.errorMessage = 'Missing destination';
                return when.reject($meta);
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
     * @param {function} [adapt] function to adapt a promise method to callback suitable for RPC
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
            }.bind(this));
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    methodNames.push(namespace + '.' + key);
                    localRegister(namespace, key, adapt ? adapt(methods, methods[key]) : methods[key].bind(methods), adapt);
                }
            }.bind(this));
        }

        if (!methodNames.length) {
            return 0;
        }
        registerLocalMethods(locals, mapLocal);

        return registerRemoteMethods(remotes, methodNames, adapt);
    }

    function objectToError(obj) {
        var e = new Error(obj.message);
        e.opcode = obj.opcode;
        e.type = obj.type;
        e.code = obj.code;
        e.print = obj.print;
        e.fields = obj.fields;
        return e;
    }

    function handleRPCResponse(obj, fn, args) {
        var $meta = (args.length && args[args.length - 1]);
        return when.promise(function(resolve, reject) {
            args.push(function(err, res) {
                if (err) {
                    if (err.length > 1) {
                        $meta.mtid = 'error';
                        reject(objectToError(err[0]));
                    } else {
                        $meta.mtid = 'error';
                        reject(objectToError(err));
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

    return {
        //properties
        id: null,
        socket: 'bus',
        server: false,
        req: {},
        pub: {},
        local: {},
        logLevel: 'warn',
        logFactory: null,

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
                if (self.server) {
                    if (process.platform !== 'win32') {
                        var fs = require('fs');
                        if (fs.existsSync(pipe)) {
                            fs.unlinkSync(pipe);
                        }
                    }
                    net.createServer(function(socket) {
                        socket.on('data', function(msg) {
                            log.trace && log.trace({$meta: {opcode: 'frameIn'}, message: msg});
                        });
                        var rpc = utRPC({
                            registerRemote: self.registerRemote.bind(self, locals.length)
                        }, true);
                        locals.push(rpc);
                        rpc.on('remote', function(remote) {
                            remotes.push(remote);
                            registerRemoteMethods([remote], listReq, true);
                            registerRemoteMethods([remote], listPub, false);
                            registerLocalMethods([rpc], mapLocal);
                        });
                        rpc.pipe(socket).pipe(rpc);
                    }).listen(pipe, function(err) {
                        err ? reject(err) : resolve();
                    });
                } else {
                    var connection = net.createConnection(pipe, function() {
                        connection.on('data', function(msg) {
                            log.trace && log.trace({$meta: {opcode: 'frameIn'}, message: msg});
                        });
                        var rpc = utRPC({
                            registerRemote: self.registerRemote.bind(self, locals.length)
                        }, false);
                        locals.push(rpc);
                        rpc.on('remote', function(remote) {
                            remotes.push(remote);
                            when.all([
                                registerRemoteMethods([remote], listReq, true),
                                registerRemoteMethods([remote], listPub, false),
                                registerLocalMethods([rpc], mapLocal)
                            ]).then(resolve).catch(reject);
                        });
                        rpc.pipe(connection).pipe(rpc);
                    });
                }

                //todo handle out frames
                //log.trace && log.trace({$$:{opcode:'frameOut'}, payload:msg});

            }.bind(this));
        },

        destroy: function() {
            remotes.forEach(function(remote) {
                //todo destroy connection
            });
        },

        registerRemote: function(index, type, methods, cb) {
            var id = this.id;
            var adapt = {
                req: function req(fn) {
                    return function() {
                        if (!fn) {
                            return when.reject(errors.busError('Remote method not found for object "' + id + '"'));
                        }
                        var args = Array.prototype.slice.call(arguments);
                        return handleRPCResponse(undefined, fn, args);
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
                        })
                        .catch(function(error) {
                            callback(error);
                        });
                };
            }

            return serverRegister(methods, namespace ? namespace : this.id, this.socket ? adapt : false);
        },

        /**
         * Register subscribe methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        subscribe: function(methods, namespace) {
            return serverRegister(methods, namespace ? namespace : this.id);
        },

        registerLocal: function(methods, namespace) {
            if (arguments.length === 1) {
                Object.keys(methods).forEach(function(namespace) {
                    this.local[namespace] = methods.namespace;
                }.bind(this));
            } else {
                this.local[namespace] = methods;
            }
        },

        start: function() {
            return when.all([
                this.register([_request(this.req)]),
                this.subscribe([_publish(this.pub)])
            ]);
        },

        getMethod: function(typeName, methodName, destination, opcode, validate) {
            var bus = this;
            var fn = null;
            var local;

            function busMethod() {
                var $meta = (arguments.length > 1 && arguments[arguments.length - 1]);
                var applyArgs = Array.prototype.slice.call(arguments);
                if (!destination && $meta && typeof $meta.callback === 'function') {
                    var cb = $meta.callback;
                    delete $meta.callback;
                    return cb.apply(this, applyArgs);
                } else if (!fn) {
                    var type;
                    var master;
                    //noinspection JSUnusedAssignment
                    (destination && opcode && (type = bus.local) && (master = type[destination]) && (fn = master[opcode]) && (local = true)) ||
                    (destination && opcode && (!bus.socket) && (fn = mapLocal[['ports', destination, methodName].join('.')]) && !(local = false)) ||
                    ((type = bus[typeName]) && (fn = type['master.' + methodName]) && (local = false));
                }
                if (fn) {
                    if (!local) {
                        if (!bus.socket) {
                            throw errors.busError('Invalid use of getMethod when not using socket');
                        }

                        if (destination && opcode) {
                            if (!$meta) {
                                applyArgs.push({
                                    destination: destination,
                                    opcode: opcode,
                                    mtid: 'request',
                                    method: destination + '.' + opcode
                                });
                            } else {
                                $meta.destination = destination;
                                $meta.opcode = opcode;
                                $meta.mtid = 'request';
                                $meta.method = destination + '.' + opcode;
                            }
                        }
                        //else {applyArgs.push({});}
                    }
                    if (local && validate && bus.local[destination] && bus.local[destination][opcode]) {
                        var requestSchema = (validate.request && bus.local[destination][opcode].request) || false;
                        var responseSchema = (validate.response && bus.local[destination][opcode].response) || false;
                        var joi = (requestSchema || responseSchema) && require('joi');
                        if (requestSchema) {
                            var requestValidation = joi.validate(applyArgs[0], {abortEarly: false});
                            if (requestValidation.error) {
                                return createFieldError('RequestFieldError', destination, requestValidation);
                            }
                        }
                        if (responseSchema) {
                            var response = fn.apply(this, applyArgs);
                            var validateResult = function(result) {
                                var responseValidation = joi.validate(result, responseSchema, {abortEarly: false});
                                if (responseValidation.error) {
                                    return createFieldError('ResponseFieldError', destination, responseValidation);
                                } else {
                                    return result;
                                }
                            };
                            return when(response).then(validateResult).catch(validateResult);
                        }
                    }
                    return fn.apply(this, applyArgs);
                } else {
                    return when.reject(errors.busError('Method binding failed for ' + typeName + ' ' + methodName + ' ' + destination + ' ' + opcode));
                }
            }

            if (bus.local[destination]) {
                assign(busMethod, bus.local[destination][opcode]);
            }
            return busMethod;
        },

        importMethods: function(target, methods, validate, binding) {
            var local = this.local;
            var self = this;

            function importMethod(methodName) {
                if (cache[methodName]) {
                    if (target !== cache) {
                        target[methodName] = cache[methodName];
                    }
                    return;
                }
                var tokens = methodName.split('.');
                var opcode = tokens.pop() || 'request';
                var destination = tokens.join('.') || 'ut';
                var method;
                if (self.socket) {
                    method = self.getMethod('req', 'request', destination, opcode, validate);
                } else {
                    method = function(msg) {
                        var fn = local[destination] && local[destination][opcode];
                        if (fn) {
                            return fn.apply(this, Array.prototype.slice.call(arguments));
                        }
                        fn = mapLocal[['ports', destination, 'request'].join('.')];
                        return fn(msg, {mtid:'request', destination: destination, opcode: opcode, method: methodName})
                            .then(function(result) {
                                return result[0];
                            });
                    };
                }
                target[methodName] = binding ? assign(method.bind(binding), method) : method;
                if (target !== cache) {
                    cache[methodName] = target[methodName];
                }
            }

            if (methods) {
                methods.forEach(function(methodOrModuleName) {
                    if (!local[methodOrModuleName]) {
                        importMethod(methodOrModuleName);
                    } else {
                        Object.keys(local[methodOrModuleName]).forEach(function(methodName) {
                            importMethod(methodOrModuleName + '.' + methodName);
                        });
                    }
                });
            }
        },

        importMethod: function(methodName, validate) {
            var result = cache[methodName];
            if (!result) {
                this.importMethods(cache, [methodName], validate);
                result = cache[methodName];
            }

            return result;
        },

        dispatch: function() {
            var $meta = (arguments.length && arguments[arguments.length - 1]);
            var mtid;
            if ($meta) {
                mtid = $meta.mtid;
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
                    var f = $meta.destination && mapLocal[['ports', $meta.destination, mtid].join('.')];
                    return f && f.apply(undefined, Array.prototype.slice.call(arguments))
                            .then(function(result) {
                                return result[0];
                            });
                }
            } else {
                return false;
            }
        }
    };
};
