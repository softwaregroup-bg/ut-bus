var when = require('when');
var utRPC = require('ut-rpc');
var net = require('net');
var _ = require('lodash');
var joi = require('joi');

function createFieldError(errType, module, validation) {
    var joiErrors = validation.error.details || [];
    var fieldErrors = {};
    var fieldErrorType = '';
    var fieldErrorTypePieces = [];
    module = module.split('.');
    var errorCode = _.capitalize(module[0]) + errType;
    var error = new Error(errorCode);
    error.code = errorCode;
    joiErrors.forEach(function(err) {
        fieldErrorType = 'Joi';
        fieldErrorTypePieces = err.type.split('.');
        fieldErrorTypePieces.forEach(function(errorPiece) {
            fieldErrorType += _.capitalize(errorPiece);
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
            var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
            var $$ = (args.length && args[args.length - 1]) || {};
            var d = $$.destination;
            if (d) {
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = thisPub[d]) || (pub[d] = fn = thisPub['ports.' + d + '.publish'])) {
                    delete $$.destination;
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
            var $$ = (arguments.length && arguments[arguments.length - 1]) || {};
            var d = $$.destination;
            if (d) {
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = RPC[d]) || (RPC[d] = fn = thisRPC['ports.' + d + '.request']) || (RPC[d] = fn = thisRPC[d + '.' + $$.opcode])) {
                    delete $$.destination;
                    return fn.apply(undefined, arguments);
                }
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

    return {
        //properties
        id: null,
        socket: 'bus',
        server: false,
        req: {},
        pub: {},
        local: {},
        logLevel : 'warn',
        logFactory: null,

        init: function() {
            this.masterRequest = this.getMethod('req', 'request');
            this.masterPublish = this.getMethod('pub', 'publish');
            this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'}));
            var self = this;
            return when.promise(function(resolve, reject) {
                var pipe = (process.platform === 'win32') ? '\\\\.\\pipe\\ut5-' + self.socket : '/tmp/ut5-' + self.socket + '.sock';

                if (self.server) {
                    if (process.platform !== 'win32') {
                        var fs = require('fs');
                        if (fs.existsSync(pipe)) {
                            fs.unlinkSync(pipe);
                        }
                    }
                    net.createServer(function(socket) {
                        socket.on('data', function(msg) {
                            log.trace && log.trace({$$: {opcode: 'frameIn', frame: msg}});
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
                            log.trace && log.trace({$$: {opcode: 'frameIn', frame: msg}});
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
            var adapt = {req: function req(fn) {
                    return function() {
                        if (!fn) {
                            return when.reject(new Error('Remote method not found for object "' + id + '"'));
                        }
                        var args = Array.prototype.slice.call(arguments);
                        return when.promise(function(resolve, reject) {
                            args.push(function(err, res) {
                                if (err) {
                                    if (err.length === 2) {
                                        err[0].$$ = err[1];
                                        reject(err[0]);
                                    } else {
                                        reject(err);
                                    }
                                } else {
                                    if (res.length === 2) {
                                        if (!res[0] && res[1]) {res[0].$$ = res[1];}
                                        resolve(res[0]);
                                    } else {
                                        resolve(res);
                                    }
                                }
                            });
                            fn.apply(undefined, args);
                        });
                    };
                },
                pub:function subscribe(fn) {
                    return function() {
                        fn.apply(undefined, arguments);
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
                            var $$ = result && result.$$;
                            result && delete result.$$;
                            callback(undefined, [result, $$]);
                        })
                        .catch(function(error) {
                            var $$ = error && error.$$;
                            error && delete error.$$;
                            callback([error, $$]);
                        });
                };
            }

            return serverRegister(methods, namespace ? namespace : this.id, adapt);
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
                var msg = (arguments.length) ? arguments[0] : {};
                var $$ = (msg && msg.$$);
                var applyArgs = arguments;
                if (!destination && $$ && typeof $$.callback === 'function') {
                    var cb = $$.callback;
                    delete $$.callback;
                    return cb.apply(this, arguments);
                } else if (!fn) {
                    var type;
                    var master;
                    //noinspection JSUnusedAssignment
                    (destination && opcode && (type = bus.local) && (master = type[destination]) && (fn = master[opcode]) && (local = true)) ||
                    ((type = bus[typeName]) &&  (fn = type['master.' + methodName]) && (local = false));
                }
                if (fn) {
                    if (!local) {
                        if (destination && opcode) {
                            $$ = $$ || {};
                            $$.destination = destination;
                            $$.opcode = opcode;
                            $$.method = destination + '.' + opcode;
                        }
                        applyArgs = Array.prototype.slice.call(arguments);
                        if (applyArgs.length && applyArgs[0] && applyArgs[0].$$) {
                            applyArgs[0] = (msg instanceof Array) ? _.assign([], msg) : _.assign({}, msg);
                            delete applyArgs[0].$$;
                        }
                        applyArgs.push($$);
                    }
                    if (local && validate && bus.local[destination] && bus.local[destination][opcode]) {
                        var requestSchema = (validate.request && bus.local[destination][opcode].request) || false;
                        var responseSchema = (validate.response && bus.local[destination][opcode].response) || false;
                        if (requestSchema) {
                            var requestValidation = joi.validate(msg, requestSchema, {abortEarly: false});
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
                    //todo return some error
                    return {
                        $$:{
                            mtid:'error',
                            errorCode:'111',
                            errorMessage:'Method binding failed for ' + typeName + ' ' + methodName + ' ' + destination + ' ' + opcode
                        }
                    };
                }
            }
            if (bus.local[destination]) {
                _.assign(busMethod, bus.local[destination][opcode]);
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
                var method = self.getMethod('req', 'request', destination, opcode, validate);
                target[methodName] = binding ? _.assign(method.bind(binding),method) : method;
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

        dispatch: function(msg) {
            var $$ = msg && msg.$$;
            var mtid;
            if ($$) {
                mtid = $$.mtid;
                if (mtid === 'request') {
                    return this.masterRequest(msg);
                } else {
                    return this.masterPublish(msg);
                }
            } else {
                return false;
            }
        }
    };
};
