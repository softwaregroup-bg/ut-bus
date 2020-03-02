const Broker = require('./broker');
const hrtime = require('browser-process-hrtime');
const flattenAPI = (data, pkg) => {
    const result = {};
    function recurse(cur, prop, depth) {
        if (!depth) {
            throw new Error('API exceeds max depth: ' + prop);
        }
        if (Object(cur) !== cur || Array.isArray(cur)) {
            result[prop] = cur;
        } else if (typeof cur === 'function') {
            cur.pkg = pkg;
            result[prop] = cur;
        } else {
            let isEmpty = true;
            Object.keys(cur).forEach(function(p) {
                isEmpty = false;
                recurse(cur[p], prop ? prop + '.' + p : p, depth - 1);
            });
            if (isEmpty && prop) {
                result[prop] = {};
            }
        }
    }
    recurse(data, '', 4);
    return result;
};

const defaultConfig = {
    canSkipSocket: true,
    // transports
    hemera: null,
    moleculer: null,
    jsonrpc: null,
    // transport channel in case hemera or moleculer transport is enabled
    channel: ''
};

class Bus extends Broker {
    constructor(config) {
        super(Object.assign({}, defaultConfig, config));
        this.importCache = {};
        this.modules = {};
        this.last = {};
        this.decay = {};
        this.performance = null;
    }

    init(...params) {
        this.brokerRequest = this.getMethod('req', 'request', undefined, {returnMeta: true});
        this.brokerPublish = this.getMethod('pub', 'publish', undefined, {returnMeta: true});
        return super.init(...params);
    }

    register(methods, namespace, port, pkg) {
        return this.rpc.exportMethod(methods, namespace || this.id, true, port, pkg);
    }

    unregister(methods, namespace, port) {
        this.importCache = {}; // todo do not loose whole cache
        return this.rpc.removeMethod(methods, namespace || this.id, true, port);
    }

    /**
     * Register subscribe methods available to the server and notify each client to reload the server's methods
     *
     * @param {object} methods object containing methods to be registered
     * @param {string} [namespace] to use when registering
     * @returns {promise}
     */
    subscribe(methods, namespace, port, pkg) {
        return this.rpc.exportMethod(methods, namespace || this.id, false, port, pkg);
    }

    unsubscribe(methods, namespace, port) {
        return this.rpc.removeMethod(methods, namespace || this.id, false, port);
    }

    registerLocal(methods, moduleName, pkg) {
        if (!this.modules[moduleName]) this.modules[moduleName] = {methods: {}, imported: []};
        const methodsMap = flattenAPI(methods, pkg);
        if (this.rpc.localMethod) this.rpc.localMethod(methodsMap, moduleName, pkg);
        Object.assign(this.modules[moduleName].methods, methodsMap);
        this.modules[moduleName].imported.push(methodsMap);
    }

    unregisterLocal(moduleName) {
        const mod = this.modules[moduleName];
        if (mod) {
            for (const key in mod.methods) { delete mod.methods[key]; }
            mod.imported.splice(0, mod.imported.length);
        }
    }

    getMethod(typeName, methodType, methodName, options) {
        const bus = this;
        let fn = null;
        let unpack = true;
        const fallback = options && options.fallback;
        const timeoutSec = options && options.timeout && (Math.floor(options.timeout / 1000));
        const timeoutNSec = options && options.timeout && (options.timeout % 1000 * 1000000);
        let fnCache = null;
        const cache = options && options.cache;

        async function busMethod(...params) {
            const $meta = (params.length > 1 && params[params.length - 1]);
            let $applyMeta;
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
                    bus.canSkipSocket && (fn = bus.findMethod(bus.mapLocal, methodName, methodType));
                    fn && (unpack = true);
                }
                if (!fn) {
                    fn = bus.rpc.brokerMethod(typeName, methodType);
                }
            }
            if (cache && !fnCache) {
                fnCache = bus.findMethod(bus.mapLocal, `${cache.port || 'cache'}`, methodType) ||
                    bus.rpc.brokerMethod(typeName, methodType);
                if (!fnCache && !cache.optional) {
                    return Promise.reject(bus.errors['bus.cacheFailed']({
                        params: {
                            typeName, methodType, methodName
                        }
                    }));
                }
            }
            if (fn) {
                let $metaBefore, $metaAfter;
                if (methodName) {
                    $applyMeta.opcode = bus.getOpcode(methodName);
                    $applyMeta.mtid = 'request';
                    $applyMeta.method = methodName;
                    if (cache) {
                        const before = cache.before || {
                            get: 'get',
                            fetch: 'get',
                            add: false,
                            create: false,
                            edit: 'drop',
                            update: 'drop',
                            delete: 'drop',
                            remove: 'drop'
                        }[$applyMeta.opcode];
                        $metaBefore = before && {
                            method: methodName,
                            timeout: $applyMeta.timeout,
                            cache: {
                                key: cache.key,
                                ttl: cache.ttl,
                                operation: before
                            }
                        };
                        const after = cache.after || {
                            get: 'set',
                            fetch: 'set',
                            add: 'set',
                            create: 'set',
                            edit: 'set',
                            update: 'set',
                            delete: false,
                            remove: false
                        }[$applyMeta.opcode];
                        $metaAfter = after && {
                            method: methodName,
                            timeout: $applyMeta.timeout,
                            cache: {
                                key: cache.key,
                                ttl: cache.ttl,
                                operation: after
                            }
                        };
                        if (!$metaBefore && !$metaAfter) {
                            return Promise.reject(bus.errors['bus.cacheOperationMissing']({
                                params: {
                                    typeName, methodType, methodName
                                }
                            }));
                        }
                        if (typeof cache.key === 'function') {
                            const key = await cache.key(params[0]);
                            if ($metaBefore) $metaBefore.cache.key = key;
                            if ($metaAfter) $metaAfter.cache.key = key;
                        }
                    }
                }
                let applyFn;
                try {
                    const cached = fnCache && $metaBefore && await fnCache.call(this, params[0], $metaBefore);
                    if (cached && cached[0] !== null) return cached[0];
                    applyFn = fn;
                    const result = await fn.apply(this, params);
                    if (fnCache && $metaAfter) await fnCache.call(this, result[0], $metaAfter);
                    if ($meta.timer) {
                        const $resultMeta = (result.length > 1 && result[result.length - 1]);
                        $resultMeta && $resultMeta.calls && $meta.timer($resultMeta.calls);
                    }
                    if (!unpack || (options && options.returnMeta)) {
                        return result;
                    }
                    return result[0];
                } catch (error) {
                    if (fallback && (fallback !== applyFn) && error.type === 'bus.methodNotFound') {
                        fn = fallback;
                        unpack = false;
                        return fn.apply(this, params);
                    }
                    return Promise.reject(bus.processError(error, $applyMeta));
                }
            } else {
                return Promise.reject(bus.errors['bus.bindingFailed']({
                    params: {
                        typeName, methodType, methodName
                    }
                }));
            }
        }

        return busMethod;
    }

    attachHandlers(target, patterns) {
        if (patterns && patterns.length) {
            target.importedMap = new Map(); // preserve patterns order
            target.imported = {};
            Object.setPrototypeOf(target.imported, target);
            patterns.forEach(pattern => {
                Object.entries(this.modules).forEach(function([moduleName, mod]) {
                    if ((pattern instanceof RegExp && pattern.test(moduleName)) || (pattern === moduleName)) {
                        target.importedMap.set(moduleName, mod.methods);
                        mod.imported.forEach(imported => {
                            Object.setPrototypeOf(imported, target.imported);
                            target.imported = imported;
                        });
                    }
                });
            });
        }
    }

    importMethod(methodName, options) {
        let result = this.importCache[methodName];

        const startRetry = (fn, {timeout, retry}) => {
            return new Promise((resolve, reject) => {
                const attempt = () => fn()
                    .then(resolve)
                    .catch(error => { // todo maybe log these errors
                        if (Date.now() > timeout) {
                            if (error) error.params = {method: 'methodName'};
                            reject(this.errors['bus.timeout'](error));
                        } else {
                            setTimeout(attempt, retry);
                        }
                    });
                attempt();
            });
        };

        if (!result) {
            const method = this.getMethod('req', 'request', methodName, options);
            result = this.importCache[methodName] = Object.assign(function(msg, $meta) {
                if ($meta && $meta.timeout && $meta.retry) {
                    return startRetry(() => method.apply(undefined, arguments), $meta);
                } else {
                    return method.apply(undefined, arguments);
                }
            }, method);
        }

        return result;
    }

    notification(method) {
        return (msg, $meta) => this.dispatch(msg, Object.assign({}, $meta, {mtid: 'notification', method}));
    }

    decayTime(key) {
        const longestPrefix = (prev, cur) => (prev.length < cur.length && key.substr(0, cur.length) === cur) ? cur : prev;
        return this.decay[Object.keys(this.decay).reduce(longestPrefix, '')];
    }

    dispatch() {
        const $meta = (arguments.length > 1 && arguments[arguments.length - 1]);
        let mtid;
        if ($meta) {
            mtid = $meta.mtid;
            if ($meta.resample) { // check if we need to discard messages coming earlier than specified decay time
                const now = Date.now();
                const last = this.last[$meta.resample];
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
                    const decay = this.decayTime($meta.resample);
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
            const f = this.canSkipSocket && this.findMethod(this.mapLocal, $meta.destination || $meta.method, mtid === 'request' ? 'request' : 'publish');
            if (f) {
                return Promise.resolve(f.apply(undefined, Array.prototype.slice.call(arguments)));
            } else if (this.socket) {
                if (mtid === 'request') {
                    return this.brokerRequest.apply(this, Array.prototype.slice.call(arguments));
                } else {
                    return this.brokerPublish.apply(this, Array.prototype.slice.call(arguments));
                }
            } else {
                throw this.errors['bus.methodNotFound']({params: {method: $meta.method}});
            }
        } else {
            return false;
        }
    }

    get publicApi() {
        const bus = this;
        return {
            get config() {
                return bus.config;
            },
            get local() {
                throw new Error('Accessing bus.local directly is forbidden');
            },
            get errors() { // to be removed (left for backward compatibility)
                return bus.errors;
            },
            get performance() {
                return bus.performance;
            },
            set performance(performance) {
                bus.performance = performance;
            },
            registerErrors: (...params) => bus.errorsApi.register(...params),
            registerLocal: (...params) => bus.registerLocal(...params),
            unregisterLocal: (...params) => bus.unregisterLocal(...params),
            importMethod: (...params) => bus.importMethod(...params),
            attachHandlers: (...params) => bus.attachHandlers(...params),
            notification: (...params) => bus.notification(...params),
            register: (...params) => bus.register(...params),
            unregister: (...params) => bus.unregister(...params),
            subscribe: (...params) => bus.subscribe(...params),
            unsubscribe: (...params) => bus.unsubscribe(...params),
            getPath: (...params) => bus.getPath(...params),
            getOpcode: (...params) => bus.getOpcode(...params),
            dispatch: (...params) => bus.dispatch(...params)
        };
    }
}

module.exports = Bus;
