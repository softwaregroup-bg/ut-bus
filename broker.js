const utError = require('./utError');
const errorsMap = require('./errors.json');
const defaultConfig = {
    id: null,
    socket: 'bus',
    logLevel: 'warn',
    logFactory: null,
    ssl: undefined
};
const METHOD = /^[^[#?]*/;

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
        this.packages = {};
    }

    async init() {
        let rpc;
        if (this.hemera) {
            rpc = require('./hemera');
        } else if (this.jsonrpc) {
            rpc = require('./jsonrpc');
        } else if (this.rabbot) {
            rpc = require('./rabbot');
        } else if (this.moleculer) {
            rpc = require('./moleculer');
        } else {
            rpc = require('./utRpc');
        }
        this.rpc = await rpc({
            socket: this.hemera || this.moleculer || this.jsonrpc || this.rabbot || this.socket,
            id: this.id,
            channel: this.channel,
            logLevel: this.logLevel,
            logger: this.log,
            isServer: this.constructor === Broker,
            isTLS: this.ssl,
            mapLocal: this.mapLocal,
            workDir: this.workDir,
            joi: this.joi,
            test: this.test,
            version: this.version,
            processError: this.processError,
            service: this.service,
            errors: this.errors,
            packages: this.packages,
            findMethodIn: (...params) => this.findMethodIn(...params),
            metrics: (...params) => {
                try {
                    return this.performance && this.performance.prometheus(...params);
                } catch (error) {
                    this.log && this.log.error && this.log.error(error);
                    return '';
                }
            }
        });
        return this.rpc;
    }

    start() {
        return this.rpc.start();
    }

    getPath(name) {
        return name.match(METHOD)[0];
    }

    getOpcode(name) {
        return this.getPath(name).split('.').pop();
    }

    findMethod(where, methodName, type) {
        methodName = this.getPath(methodName);
        const key = ['ports', methodName, type].join('.');
        let result = where[key] || where[methodName];
        if (!result) {
            const names = methodName.split('.');
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
            const $meta = (args.length > 1 && args[args.length - 1]) || {};
            const method = $meta.method;
            if (!method) {
                if ($meta.mtid === 'error') {
                    if (args[0] instanceof Error) {
                        return Promise.reject(args[0]);
                    }
                    const err = this.errors['bus.unhandledError']({
                        errorCode: $meta.errorCode,
                        params: {
                            errorMessage: $meta.errorMessage ? ': ' + $meta.errorMessage : ''
                        }
                    });
                    err.cause = args[0];
                    return Promise.reject(err);
                }
                return Promise.reject(this.errors['bus.missingMethod']());
            }
            const fn = this.findMethod(where, $meta.destination || method, type);
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
