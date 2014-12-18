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
    this.level.info && this.log.info('port.start ' + this.config.id);
};

Port.prototype.stop = function stop() {
    this.level.info && this.log.info('port.stop ' + this.config.id);
};

module.exports = Port;
