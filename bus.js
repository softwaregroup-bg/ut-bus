'use strict';
const EventEmitter = require('events');
const errors = require('./errors');
const hrtime = require('browser-process-hrtime');
const noOp = () => Promise.resolve();

class Bus extends EventEmitter {
    constructor() {
        super();
        this.socket = 'bus';
        this.canSkipSocket = true;
        this.req = {};
        this.pub = {};
        this.modules = {};
        this.local = {}; // todo remove
        this.last = {};
        this.decay = {};
        this.logLevel = 'warn';
        this.logFactory = null;
        this.performance = null;
        this.errors = errors;
    }

    init() {
        if (this.logFactory) {
            this.log = this.logFactory.createLog(this.logLevel, {name: this.id, context: 'bus'});
        }
        this.on('connect', (connection) => {
            var connection = {
                localAddress: socket.localAddress,
                localPort: socket.localPort,
                remoteAddress: socket.remoteAddress,
                remotePort: socket.remotePort
            };
            log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.connected'}, connection});
            socket.on('close', () => {
                log && log.info && log.info({$meta: {mtid: 'event', opcode: 'bus.disconnected'}, connection});
            }).on('error', (err) => {
                log && log.error && log.error(err);
            }).on('data', function(msg) {
                log && log.trace && log.trace({$meta: {mtid: 'frame', opcode: 'in'}, message: msg});
            });
        });
    }

    stop() {
        return noOp();
    }
    destroy() {
        this.stop();
    }
};

module.exports = Bus;
