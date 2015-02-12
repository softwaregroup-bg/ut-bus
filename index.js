(function(define) {define(function(require) {
    //dependencies
    var when = require('when');
    var jsonrpc = require('ut-multitransport-jsonrpc');

    return function Bus() {
        //private fields
        var clients = [];
        var server = null;
        var log = {};

        /**
         * Register methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} namespace to use when registering
         * @param {function} adapt function to adapt a promise method to callback suitable for RPC
         * @returns {promise}
         */
        function serverRegister(methods, namespace, adapt) {
            var methodNames = [];
            if (methods instanceof Array) {
                methods.forEach(function(fn) {
                    if (fn instanceof Function && fn.name) {
                        methodNames.push(namespace + '.' + fn.name);
                        server.register(namespace + '.' + fn.name, adapt ? adapt(null, fn) : fn);
                    }
                }.bind(this));
            } else {
                Object.keys(methods).forEach(function(key) {
                    if (methods[key] instanceof Function) {
                        methodNames.push(namespace + '.' + key);
                        server.register(namespace + '.' + key, adapt ? adapt(methods, methods[key]) : methods[key].bind(methods));
                    }
                }.bind(this));
            }

            if (!methodNames.length) {
                return 0;
            }

            return when.all(
                when.reduce(clients, function(prev, cur) {
                    prev.push(when.promise(function(resolve, reject) {
                        cur.registerRemote(adapt ? 'req' : 'pub', methodNames, function(err, res) {
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

        return {
            //properties
            id: null,
            serverPort: null,
            clientPort: null,
            req: {},
            pub: {},
            local: {},
            logLevel : 'warn',
            logFactory: null,

            init: function() {
                var transport = new jsonrpc.transports.server.tcp(this.serverPort);
                transport.on('outMessage', function(msg) {
                    log.trace && log.trace({$$:{opcode:'frameOut'}, payload:msg});
                });
                transport.on('message', function(msg) {
                    log.trace && log.trace({$$:{opcode:'frameIn'}, payload:msg});
                });
                server = new jsonrpc.server(transport, {
                    registerRemote: this.registerRemote.bind(this)
                });
                if (this.clientPort) {
                    this.connect('localhost', this.clientPort);
                }
                this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name:this.id, context:'bus'}));
            },

            destroy: function() {
                server.shutdown();
                clients.forEach(function(client){
                    client.shutdown();
                });
            },

            registerRemote: function(type, methods, cb) {
                var adapt = {req: function req(client, methodName) {
                        var fn = client && client[methodName] && (client[methodName] instanceof Function) && client[methodName];
                        return function() {
                            if (!fn) {
                                return when.reject(new Error('Remote method "' + methodName + '" not found for object "' +
                                    (client && client.id) ? client.id : client + '"'));
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
                    pub:function subscribe(client, methodName) {
                        return client && client[methodName];
                    }
                }[type];

                var root = this[type];

                if (!(methods instanceof Array)) {
                    methods = [methods];
                }
                clients.forEach(function(cur) {
                    cur.register(methods);
                    methods.forEach(function(method) {
                        var path = method.split('.');
                        var last = path.pop();
                        path.reduce(function(prev, current) {
                            if (!prev.hasOwnProperty(current)) {
                                prev[current] = {};
                            }
                            return (prev[current]);
                        }, root)[last] = adapt(cur, method);
                    });
                });

                cb(undefined, 'remotes registered in ' + this.id);
            },

            connect: function(host, port, cb) {
                var transport = new jsonrpc.transports.client.tcp(host, port);
                var x = new jsonrpc.client(transport, {namespace : this.id});
                transport.on('outMessage', function(msg) {
                    log.trace && log.trace({$$:{opcode:'frameOut'}, payload:msg});
                });
                transport.on('message', function(msg) {
                    log.trace && log.trace({$$:{opcode:'frameIn'}, payload:msg});
                });
                x.register('registerRemote');
                clients.push(x);
                if (cb) {
                    cb(null, 0);
                }
            },

            /**
             * Get publishing method
             *
             * @returns {function} publish(msg) that publishes message
             *
             */
            getPublish: function() {
                var pub = {};
                var thisPub = this.pub;
                function publish(msg) {
                    var d = msg.$$ && msg.$$.destination;
                    if (d) {
                        var ports;
                        var port;
                        var fn;
                        if ((fn = thisPub[d]) || ((ports = thisPub.ports) && (port = ports[d]) && (pub[d] = fn = port.publish))) {
                            delete msg.$$.destination;
                            fn(msg);
                        }
                    }
                }
                return publish;
            },

            /**
             * Get rpc method
             *
             * @returns {function} rpc(msg) that executes remote procedure
             *
             */
            getRequest: function() {
                var RPC = {};
                var thisRPC = this.req;
                function request(msg) {
                    var d = msg.$$ && msg.$$.destination;
                    if (d) {
                        var ports;
                        var port;
                        var fn;
                        if ((fn = RPC[d]) || ((ports = thisRPC.ports) && (port = ports[d]) && (RPC[d] = fn = port.call))) {
                            delete msg.$$.destination;
                            return fn(msg);
                        }
                    }
                }
                return request;
            },

            /**
             * Register RPC methods available to the server and notify each client to reload the server's methods
             *
             * @param {object} methods object containing methods to be registered
             * @param {namespace} namespace to use when registering
             * @returns {promise}
             */
            register: function(methods, namespace) {
                function adapt(self, f) {
                    return function() {
                        var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
                        var callback = arguments[arguments.length - 1];
                        when(f.apply(self, args))
                            .then(function(result,a,b,c) {
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
             * @param {namespace} namespace to use when registering
             * @returns {promise}
             */
            subscribe: function(methods, namespace) {
                return serverRegister(methods, namespace ? namespace : this.id);
            },

            registerLocal: function(methods, namespace){
                this.local[namespace] = methods;
            },

            start: function(){
                this.register([this.getRequest()]);
                this.subscribe([this.getPublish()]);
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
                        (destination && opcode && (type = bus.local) && (master = type[destination]) && (fn = master[opcode]) && (local = true)) ||
                        ((type = bus[typeName]) && (master = type.master) && (fn = master[methodName]) && (local = false))
                    };
                    if (fn) {
                        if (!local && destination && opcode) {
                            (msg) || (msg = {$$:{destination:destination, opcode: opcode}});
                            if (msg.$$ instanceof Object) {
                                msg.$$.destination = destination;
                                msg.$$.opcode = opcode;
                            } else {
                                (msg.$$ = {destination:destination, opcode: opcode})
                            }
                            if (!arguments.length){
                                return fn.apply(this, [msg]);
                            } else
                                arguments[0] = msg;
                        }
                        return fn.apply(this, arguments)
                    } else {
                        //todo return some error
                        return {$$:{mtid:'error',errorcode:'111',errorMessage:'Method binding failed for ' + typeName + ' ' + methodName + ' ' + destination + ' ' + opcode}}
                    }
                }
                return busMethod;
            },

            importMethods: function(target, methods) {
                var local = this.local;
                var self = this;

                function importMethod(methodName){
                    var tokens = methodName.split('.');
                    var destination = tokens.shift() || 'ut';
                    var opcode = tokens.join('.') || 'request';
                    target[methodName] = self.getMethod('req', 'request', destination, opcode);
                }

                if (methods) {
                    methods.forEach(function (methodOrModuleName) {
                        var i = methodOrModuleName.indexOf('.');
                        if (i >= 0) {
                            importMethod(methodOrModuleName)
                        } else if (local[methodOrModuleName]) {
                            Object.keys(local[methodOrModuleName]).forEach(function (methodName) {
                                importMethod(methodOrModuleName + '.' + methodName)
                            })
                        }
                    })
                }
            }
        };
    }

});}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
