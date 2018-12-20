const Bus = require('./bus');
const rpc = require('../utRpc');
class MasterBus extends Bus {
    constructor(config) {
        super(config);
        this.server = true;
    }
    async init() {
        this.rpc = await rpc({
            socket: this.socket,
            id: this.id,
            logLevel: this.logLevel,
            logger: this.log,
            isServer: this.server,
            isTLS: this.ssl,
            mapLocal: this.mapLocal,
            processError: this.processError,
            errors: this.errors,
            findMethodIn: (...params) => this.findMethodIn(...params)
        });
        return this.rpc;
    }
}

module.exports = MasterBus;
