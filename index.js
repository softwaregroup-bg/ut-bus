(function(define) {define(function(require) {

    var when = require('when');
    var jsonrpc = require('multitransport-jsonrpc');

    return {
        //properties
        id:null,
        serverPort:null,
        clientPort:null,
        clients:null,
        server:null,
        rpc:null,

        init:function() {
            this.clients = [];
            this.rpc = {};
            this.server = new jsonrpc.server(new jsonrpc.transports.server.tcp(this.serverPort), {
                reload:this.reload.bind(this)
            });
            if (this.clientPort) {
                this.connect('localhost', this.clientPort);
            }
        },

        reload:function(x, cb) {
            var adapt = function(r, f) {
                return function() {
                    if (!r || !r[f] || !r[f] instanceof Function) {
                        return when.reject(new Error('Remote method "' + f + '" not found for object "' + (r && r.id) ? r.id : r + '"'));
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
                        r[f].apply(undefined, args);
                    });
                };
            };

            var rpc = this.rpc;
            when.all(
                when.reduce(this.clients, function(prev, cur) {
                    prev.push(when.promise(function(resolve, reject) {
                        cur.request('rpc.methodList', [], function(err, result) {
                            if (!err) {
                                if (!(result instanceof Array)) {
                                    result = [result];
                                }
                                cur.register(result);
                                result.forEach(function(fn) {
                                    var path = fn.split('.');
                                    var last = path.pop();
                                    path.reduce(function(prev, current) {
                                        if (!prev.hasOwnProperty(current)) prev[current]={};
                                        return (prev[current]);
                                    }, rpc)[last] = adapt(cur, fn);
                                });
                                resolve(result);
                            } else {
                                reject(err);
                            }
                        });
                    }));
                    return prev;
                }, [])
            ).then(function(res) {
                cb(undefined, 'reloaded ' + this.id);
            }.bind(this)).catch(function(err) {
                cb(err);
            });
        },

        connect:function(host, port, cb) {
            var x = new jsonrpc.client(new jsonrpc.transports.client.tcp(host, port));
            x.register('reload');
            this.clients.push(x);
            if (cb) {
                cb(null, 0);
            }
        },

        /**
         * Push message to queue
         *
         * @param {object} msg object to send
         *
         */
        nq:function(msg) {
            if (this.clients[0]) {
                return this.clients[0].enqueue(msg);
            }
        },

        /**
         * Register methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @returns {promise}
         */
        register:function(methods) {
            var adapt = function(self, f) {
                return function() {
                    var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
                    var callback = arguments[arguments.length - 1];
                    when(f.apply(self, args))
                        .then(function(result) {callback(undefined, result);})
                        .catch(function(error) {callback(error);});
                };
            };

            if (methods instanceof Array) {
                methods.forEach(function(fn) {
                    if (fn.name) {
                        this.server.register(this.id + '.' + fn.name, adapt(null, fn));
                    }
                }.bind(this));
            } else {
                Object.keys(methods).forEach(function(key) {
                    if (methods[key] instanceof Function) {
                        this.server.register(this.id + '.' + key, adapt(methods, methods[key]));
                    }
                }.bind(this));
            }
            return when.all(
                when.reduce(this.clients, function(prev, cur) {
                    prev.push(when.promise(function(resolve, reject) {
                        cur.reload({}, function(err, res) {
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
    };

});}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
