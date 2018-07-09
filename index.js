'use strict';
var errorsFactory = require('./errors');
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
    var log = {};
    var importCache = {};
    var mapLocal = {};
    var errors;

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

    return {
        // properties
        id: null,
        socket: 'bus',
        canSkipSocket: true,
        server: false,
        rpc: {
            start: () => Promise.reject(errors.notInitialized()),
            exportMethod: () => Promise.reject(errors.notInitialized()),
            masterMethod: () => Promise.reject(errors.notInitialized()),
            stop: () => true
        },
        modules: {},
        local: {}, // todo remove
        last: {},
        decay: {},
        logLevel: 'warn',
        logFactory: null,
        performance: null,
        stop: function() {
            return this.rpc.stop();
        },
        init: function() {
            this.masterRequest = this.getMethod('req', 'request', undefined, {returnMeta: true});
            this.masterPublish = this.getMethod('pub', 'publish', undefined, {returnMeta: true});
            this.logFactory && (log = this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'}));
            this.errors = errors = errorsFactory(this);
            var createRpc;
            if (this.hemera) {
                createRpc = require('./hemera');
            } else if (this.moleculer) {
                createRpc = require('./moleculer');
            } else {
                createRpc = require('./utRpc');
            }
            return createRpc({
                id: this.id,
                socket: this.hemera || this.moleculer || this.socket,
                channel: this.channel,
                logLevel: this.logLevel,
                logger: log,
                isServer: this.server,
                isTLS: this.ssl,
                mapLocal,
                processError,
                errors,
                findMethodIn
            }).then(rpc => {
                this.rpc = rpc;
                return rpc;
            });
        },

        destroy: function() {
            return this.rpc.stop();
        },

        /**
         * Register RPC methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        register: function(methods, namespace, port) {
            return this.rpc.exportMethod(methods, namespace || this.id, true, port);
        },

        /**
         * Register subscribe methods available to the server and notify each client to reload the server's methods
         *
         * @param {object} methods object containing methods to be registered
         * @param {string} [namespace] to use when registering
         * @returns {promise}
         */
        subscribe: function(methods, namespace, port) {
            return this.rpc.exportMethod(methods, namespace || this.id, false, port);
        },

        registerLocal: function(methods, namespace) {
            var x = {};
            x[namespace] = methods;
            Object.assign(this.modules, flattenAPI(x));
        },

        start: function() {
            return this.rpc.start();
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
                    if (!fn) {
                        fn = bus.rpc.masterMethod(typeName, methodType);
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
                                var local = name.split('/').pop();
                                var f = target[local] = Object.assign((...params) => {
                                    x.super = f.super;
                                    return x.apply(binding, params);
                                }, x, {super: target[local]});
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
                set performance(performance) {
                    bus.performance = performance;
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
                register(methods, namespace, port) {
                    return bus.register(methods, namespace, port);
                },
                subscribe(methods, namespace, port) {
                    return bus.subscribe(methods, namespace, port);
                },
                dispatch(...params) {
                    return bus.dispatch(...params);
                }
            };
        }
    };
};
