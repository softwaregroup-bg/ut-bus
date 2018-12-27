const MasterBus = require('./bus/master');
const WorkerBus = require('./bus/worker');
const busFactory = (config = {}) => config.server ? new MasterBus(config) : new WorkerBus(config);
module.exports = Object.assign(busFactory, {MasterBus, WorkerBus});
