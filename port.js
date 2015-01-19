var through2 = require('through2');
var Readable = require('readable-stream/readable');
var when = require('when');

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
    this.log = {};
    this.logFactory = null;
    this.bus = null;
    this.queue = createQueue();
    this.incoming = this.receive();
    this.outgoing = this.send();

    function getPublish(port) {
        var fn = null;
        function publish(msg) {
            if (msg.$$ && typeof msg.$$.callback === 'function') {
                msg.$$.callback(msg);
            } else
            if (fn) {
                fn(msg);
            } else {
                var bus;
                var pub;
                var master;
                (bus = port.bus) && (pub = bus.pub) && (master = pub.master) && (fn = master.publish) && fn(msg)
            }
        }
        return publish;
    }

    this.incoming.on('data', getPublish(this));
}

Port.prototype.init = function init() {
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name:this.config.id, context:this.config.type + ' port'}));

    if (this.bus) {
        this.bus.register({
            start: this.start,
            stop: this.stop,
            call: this.call.bind(this)
        }, 'ports.' + this.config.id);
        this.bus.subscribe({
            publish: this.queue.add
        }, 'ports.' + this.config.id);
    }
};

Port.prototype.start = function start() {
    this.log.info && this.log.info({$$:{opcode:'port.start'}, id:this.config.id, config:this.config});
    return true;
};

Port.prototype.stop = function stop() {
    this.log.info && this.log.info({$$:{opcode:'port.stop'}, id:this.config.id});
    return true;
};

Port.prototype.call = function call(message) {
    return when.promise(function(resolve, reject, notify) {
        if (!message) {
            reject(new Error('Missing message parameter'))
        } else
        if (!message.$$) {
            reject(new Error('Missing message type'))
        } else {
            message.$$.callback = resolve;
        }
        this.queue.add(message);
    }.bind(this));
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

Port.prototype.findCallback = function findCallback(context, message) {
    var $$ = message.$$;
    if ($$.trace && ($$.mtid === 'response' || $$.mtid === 'error')) {
        var x = context[$$.trace];
        if (x) {
            delete context[$$.trace];
            $$.callback = x.callback;
        }
    }
};

Port.prototype.decode = function decode(context) {
    var buffer = new Buffer(0);
    var port = this;

    return through2.obj(function decodePacket(packet, enc, callback) {
        port.log.trace && port.log.trace({$$:{opcode:'bytes.in'}, buffer:packet});

        if (port.framePattern) {
            buffer = Buffer.concat([buffer, packet]);
            var frame;
            while (frame = port.framePattern(buffer)) {
                buffer = frame.rest;
                if (port.codec) {
                    var message = port.codec.decode(frame.data, context);
                    port.findCallback(context, message);
                    this.push(message);
                } else {
                    this.push({payload: frame.data});
                }
            }
            callback();
        } else {
            callback(null, {payload:packet});
        }
    });
};

Port.prototype.traceCallback = function traceCallback(context, message) {
    var $$ = message.$$;
    if ($$.trace && $$.callback && $$.mtid === 'request') {
        context[$$.trace] = {callback : $$.callback, expire : Date.now() + 60000};
    }
};

Port.prototype.encode = function encode(context) {
    var port = this;

    return through2.obj(function encodePacket(message, enc, callback) {
        port.log.trace && port.log.trace(message);
        var buffer;
        var size;
        if (port.codec) {
            buffer = port.codec.encode(message, context);
            size = buffer && buffer.length;
            port.traceCallback(context, message);
        } else if (message && message.payload) {
            buffer = message.payload;
            size = buffer && buffer.length;
        } else {
            buffer = null;
            size = null;
        }
        if (port.frameBuilder) {
            buffer =  port.frameBuilder({size:size, data:buffer});
        }
        if (buffer) {
            port.log.trace && port.log.trace({$$:{opcode:'bytes.out'}, buffer:buffer});
            callback(null, buffer)
        } else {
            callback();
        }
    });
};

Port.prototype.pipe = function pipe(stream, context, useCodec) {
    if (useCodec) {
        this.queue.pipe(this.outgoing).pipe(this.encode(context)).pipe(stream).pipe(this.decode(context)).pipe(this.incoming, {end:false});
    } else {
        this.queue.pipe(this.outgoing).pipe(stream).pipe(this.incoming, {end:false});
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
