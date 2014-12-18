function Port() {
    this.logOut = '';
    this.logIn = '';
    this.level = {};
    this.log = null;
    this.bus = null;
}

Port.prototype.init = function init() {
    this.logOut = 'out ' + this.config.id + ':';
    this.logIn = 'in  ' + this.config.id + ':';
    this.log && (this.level = this.log.initLevels(this.config.logLevel));

    var methods = {};
    methods['ports.' + this.config.id + '.start'] = this.start;
    methods['ports.' + this.config.id + '.stop'] = this.stop;
    if (this.bus) {
        this.bus.register(methods);
    }
};

Port.prototype.start = function start() {
    this.level.info && this.log.info({_opcode:'port.start', id:this.config.id, config:this.config});
};

Port.prototype.stop = function stop() {
    this.level.info && this.log.info({_opcode:'port.stop', id:this.config.id});
};

Port.prototype.receive = function(msg) {
    this.level.debug && this.log.debug(msg);
    return this.config.receive && this.config.receive.call(this, msg);
};

module.exports = Port;
