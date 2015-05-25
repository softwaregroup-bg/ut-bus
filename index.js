var when = require('when');
var utRPC = require('ut-rpc');
var net = require('net');
var _ = require('lodash');

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
        function publish(msg) {
            var d = msg.$$ && msg.$$.destination;
            if (d) {
                var ports;
                var port;
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = thisPub[d]) || ((ports = thisPub.ports) && (port = ports[d]) && (pub[d] = fn = port.publish))) {
                    delete msg.$$.destination;
                    fn(msg);
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
        function request(msg) {
            var d = msg.$$ && msg.$$.destination;
            if (d) {
                var ports;
                var port;
                var fn;
                //noinspection JSUnusedAssignment
                if ((fn = RPC[d]) || ((ports = thisRPC.ports) && (port = ports[d]) && (RPC[d] = fn = port.call))) {
                    delete msg.$$.destination;
                    return fn(msg);
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
            var self = this;
            var pipe = (process.platform === 'win32') ? '\\\\.\\pipe\\ut5-' + this.socket : '/tmp/ut5-' +  this.socket + '.sock';

            if (this.server) {
                if (process.platform !== 'win32') {
                    var fs = require('fs');
                    if (fs.existsSync(pipe)) {
                        fs.unlinkSync(pipe);
                    }
                }
                net.createServer(function(socket) {
                    socket.on('data', function(msg) {
                        log.trace && log.trace({$$:{opcode:'frameIn', frame:msg}});
                        //console.log(self.id, msg.toString());
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
                }).listen(pipe);
            } else {
                var connection = net.createConnection(pipe, function() {
                    connection.on('data', function(msg) {
                        log.trace && log.trace({$$:{opcode:'frameIn', frame:msg}});
                        //console.log(self.id, msg.toString());
                    });
                    var rpc = utRPC({
                        registerRemote: self.registerRemote.bind(self, locals.length)
                    }, false);
                    locals.push(rpc);
                    rpc.on('remote', function(remote) {
                        remotes.push(remote);
                        registerRemoteMethods([remote], listReq, true);
                        registerRemoteMethods([remote], listPub, false);
                        registerLocalMethods([rpc], mapLocal);
                    });
                    rpc.pipe(connection).pipe(rpc);
                });
            }

            //todo handle out frames
            //log.trace && log.trace({$$:{opcode:'frameOut'}, payload:msg});

            this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name:this.id, context:'bus'}));
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
                                    reject(err);
                                } else {
                                    resolve(res);
                                }
                            });
                            fn.apply(undefined, args);
                        });
                    };
                },
                pub:function subscribe(fn) {
                    return fn;
                }
            }[type];

            var root = this[type];

            if (!(methods instanceof Array)) {
                methods = [methods];
            }

            var remote = locals[index];
            methods.forEach(function(method) {
                var remoteMethod = remote.createRemote(method, type);
                var path = method.split('.');
                var last = path.pop();
                path.reduce(function(prev, current) {
                    if (!prev.hasOwnProperty(current)) {
                        prev[current] = {};
                    }
                    return (prev[current]);
                }, root)[last] = adapt(remoteMethod);
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
            this.register([_request(this.req)]);
            this.subscribe([_publish(this.pub)]);
        },

        getMethod: function(typeName, methodName, destination, opcode) {
            var bus = this;
            var fn = null;
            var local;
            function busMethod() {
                var msg = (arguments.length) ? arguments[0] : {};
                if (msg && msg.$$ && typeof msg.$$.callback === 'function') {
                    var cb = msg.$$.callback;
                    delete msg.$$.callback;
                    return cb.apply(this, arguments);
                } else if (!fn) {
                    var type;
                    var master;
                    //noinspection JSUnusedAssignment
                    (destination && opcode && (type = bus.local) && (master = type[destination]) && (fn = master[opcode]) && (local = true)) ||
                    ((type = bus[typeName]) && (master = type.master) && (fn = master[methodName]) && (local = false));
                }
                if (fn) {
                    if (!local && destination && opcode) {
                        (msg) || (msg = {$$:{destination:destination, opcode: opcode}});
                        if (msg.$$ instanceof Object) {
                            msg.$$.destination = destination;
                            msg.$$.opcode = opcode;
                        } else {
                            msg.$$ = {destination:destination, opcode: opcode};
                        }
                        if (!arguments.length) {
                            return fn.apply(this, [msg]);
                        } else {
                            var args = Array.prototype.slice.call(arguments);
                            args[0] = msg;
                            return fn.apply(this, args);
                        }
                    }
                    return fn.apply(this, arguments);
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

        importMethods: function(target, methods) {
            var local = this.local;
            var self = this;

            function importMethod(methodName) {
                var tokens = methodName.split('.');
                var destination = tokens.shift() || 'ut';
                var opcode = tokens.join('.') || 'request';
                target[methodName] = self.getMethod('req', 'request', destination, opcode);
            }

            if (methods) {
                methods.forEach(function(methodOrModuleName) {
                    var i = methodOrModuleName.indexOf('.');
                    if (i >= 0) {
                        importMethod(methodOrModuleName);
                    } else if (local[methodOrModuleName]) {
                        Object.keys(local[methodOrModuleName]).forEach(function(methodName) {
                            importMethod(methodOrModuleName + '.' + methodName);
                        });
                    }
                });
            }
        },

        importMethod: function(methodName) {
            var result = cache[methodName];
            if (!result) {
                this.importMethods(cache, [methodName]);
                result = cache[methodName];
            }

            return result;
        }
    };
};
