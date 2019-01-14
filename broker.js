const utError = require('./utError');
const errorsMap = require('./errors.json');
const defaultConfig = {
    id: null,
    socket: 'bus',
    logLevel: 'warn',
    logFactory: null,
    ssl: undefined
};
class Broker {
    constructor(config) {
        Object.assign(this, defaultConfig, config);
        this.log = this.logFactory ? this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'}) : {};
        this.mapLocal = {};
        this.errorsApi = utError(this);
        this.errors = Object.assign({}, this.errorsApi.register(errorsMap), {
            defineError: this.errorsApi.define,
            getError: this.errorsApi.get,
            fetchErrors: this.errorsApi.fetch
        });
        this.rpc = {
            start: () => Promise.reject(this.errors['bus.notInitialized']()),
            exportMethod: () => Promise.reject(this.errors['bus.notInitialized']()),
            removeMethod: () => Promise.reject(this.errors['bus.notInitialized']()),
            brokerMethod: () => Promise.reject(this.errors['bus.notInitialized']()),
            stop: () => true
        };
    }
    async init() {
        let rpc;
        if (this.hemera) {
            rpc = require('./hemera');
        } else if (this.jsonrpc) {
            rpc = require('./jsonrpc');
        } else if (this.moleculer) {
            rpc = require('./moleculer');
        } else {
            rpc = require('./utRpc');
        }
        this.rpc = await rpc({
            socket: this.hemera || this.moleculer || this.jsonrpc || this.socket,
            id: this.id,
            channel: this.channel,
            logLevel: this.logLevel,
            logger: this.log,
            isServer: this.constructor === Broker,
            isTLS: this.ssl,
            mapLocal: this.mapLocal,
            processError: this.processError,
            errors: this.errors,
            findMethodIn: (...params) => this.findMethodIn(...params)
        });
        return this.rpc;
    }
    start() {
        return this.rpc.start();
    }
    findMethod(where, methodName, type) {
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
        return result && result.method;
    }
    findMethodIn(where, type) {
        return (...args) => {
            var $meta = (args.length > 1 && args[args.length - 1]) || {};
            var method = $meta.method;
            if (!method) {
                if ($meta.mtid === 'error') {
                    if (args[0] instanceof Error) {
                        return Promise.reject(args[0]);
                    }
                    var err = this.errors['bus.unhandledError']({
                        errorCode: $meta.errorCode,
                        params: {
                            errorMessage: $meta.errorMessage ? ': ' + $meta.errorMessage : ''
                        }
                    });
                    err.cause = args[0];
                    return Promise.reject(err);
                }
                return Promise.reject(this.errors['bus.missingMethod']({}));
            }
            var fn = this.findMethod(where, $meta.destination || method, type);
            if (fn) {
                delete $meta.destination;
                return fn(...args);
            } else {
                return Promise.reject(
                    $meta.destination ? this.errors['bus.destinationNotFound']({
                        params: {
                            destination: $meta.destination
                        }
                    }) : this.errors['bus.methodNotFound']({
                        params: {method}
                    })
                );
            }
        };
    }
    processError(obj, $meta) {
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
    stop() {
        return this.rpc.stop();
    }
    destroy() {
        return this.rpc.stop();
    }
}

module.exports = Broker;
