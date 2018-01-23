const Bus = require('./bus');

class WorkerBus extends Bus {
    constructor() {
        super();
        this.id = 'worker';
    }
    init() {
        super.init();
    }
    get publicApi() {
        let bus = this;
        return {
            get config() {
                return bus.config;
            },
            get local() {
                this.log && this.log.warn && this.log.warn('Accessing bus.local directly is deprecated and will be removed in the next major version!');
                return bus.local;
            },
            get errors() {
                return bus.errors;
            },
            get performance() {
                return bus.performance;
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
            register(methods, namespace) {
                return bus.register(methods, namespace);
            },
            subscribe(methods, namespace) {
                return bus.subscribe(methods, namespace);
            },
            dispatch(...params) {
                return bus.dispatch(...params);
            }
        };
    }
}

module.exports = WorkerBus;
