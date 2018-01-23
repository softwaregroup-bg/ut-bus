const Bus = require('./bus');

class MasterBus extends Bus {
    constructor() {
        super();
        this.id = 'master';
    }
    init() {
        super.init();
    }
}

module.exports = MasterBus;
