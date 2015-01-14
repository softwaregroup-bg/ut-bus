var through2 = require('through2');
var Readable = require('readable-stream/readable');

createQueue = function queue() {
    var q = [];
    var r = new Readable({objectMode:true});
    var forQueue = false;

    r._read = function readQueue() {
        if (q.length) {
            this.push(q.shift());
        } else {
            forQueue = false;
        }
    };

    r.add = function add(msg) {
        if (forQueue) {
            q.push(msg);
        } else {
            forQueue = true;
            r.push(msg);
        }
    };

    return r;
};

function Port() {
    this.logOut = '';
    this.logIn = '';
    this.log = {};
    this.logFactory = null;
    this.bus = null;
    this.queue = createQueue();
    this.incoming = this.receive();
    this.outgoing = this.send();
}

Port.prototype.init = function init() {
    this.logOut = 'out ' + this.config.id + ':';
    this.logIn = 'in  ' + this.config.id + ':';
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name:this.config.id, context:this.config.type + ' port'}));

    var methods = {};
    methods['ports.' + this.config.id + '.start'] = this.start;
    methods['ports.' + this.config.id + '.stop'] = this.stop;
    if (this.bus) {
        this.bus.register(methods);
    }
};

Port.prototype.start = function start() {
    this.log.info && this.log.info({_opcode:'port.start', id:this.config.id, config:this.config});
};

Port.prototype.stop = function stop() {
    this.log.info && this.log.info({_opcode:'port.stop', id:this.config.id});
};

Port.prototype.receive = function receive() {
    var port = this;
    return through2.obj(function receive(msg, enc, callback) {
        port.log.debug && port.log.debug(msg);
        var err = port.config.receive && port.config.receive.call(port, msg);
        if (err) {
            callback(err);
        } else {
            callback(null, msg);
        }
    });
};

Port.prototype.send = function send() {
    var port = this;
    return through2.obj(function send(msg, enc, callback) {
        var err = port.config.send && port.config.send.call(port, msg);
        port.log.debug && port.log.debug(msg);
        if (err) {
            callback(err);
        } else {
            callback(null, msg);
        }
    });
};

Port.prototype.pipe = function pipe(stream) {
    if (typeof this.decode === 'function') {
        stream.pipe(this.decode()).pipe(this.incoming, {end:false});
    } else {
        stream.pipe(this.incoming, {end:false});
    }

    if (typeof this.encode === 'function') {
        this.queue.pipe(this.outgoing).pipe(this.encode()).pipe(stream);
    } else {
        this.queue.pipe(this.outgoing).pipe(stream);
    }
    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec, concurrency) {
    var countActive = 0;
    concurrency = concurrency || 10;
    var stream = through2({objectMode:true}, function(chunk, enc, callback) {
        countActive++;

        try {
            exec(chunk, function(err, result) {
                countActive--;
                stream.push(err ? err : result);
                if (countActive + 1 === concurrency) {
                    callback(err);
                }
            });
        } catch (e) {
            countActive--;
            chunk._mtid = 'error';
            chunk.error = e;
            this.push(chunk);
            if (countActive < concurrency) {
                callback(e);
            }
            return;
        }

        if (countActive < concurrency) {
            callback();
        }
    });
    return this.pipe(stream);
};

module.exports = Port;
