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
    this.queue = null;
    this.queues = {};

    function getMasterPublish(port) {
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
    this.masterPublish = getMasterPublish(this);
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
            publish: this.publish.bind(this)
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

Port.prototype.publish = function publish(msg) {
    var conId;
    var queue;
    if (this.queue) {
        queue = this.queue;
    } else
    if (conId = (msg.$$ && msg.$$.conId)) {
        queue = this.queues[conId];
    } else {
        queue = this.queue;
    }
    if (queue) {
        queue.add(msg);
    } else {
        this.log.error && this.log.error('Queue not found', {message:msg});
    }
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

    function push(stream, msg) {
        if (context && context.conId) {
            if (msg.$$) {
                msg.$$.conId = context.conId;
            } else {
                msg.$$ = {conId:context.conId};
            }
        }
        port.log.debug && port.log.debug(msg);
        when(port.config.receive ? port.config.receive.call(port, msg, context) : msg).then(function(result) {
            stream.push(result);
        })
    }

    function convert(stream, msg) {
        if (port.codec) {
            var message = port.codec.decode(msg, context);
            port.findCallback(context, message);
            push(stream, message);
        } else if (msg && msg.constgructor && msg.constructor.name === 'Buffer') {
            push(stream, {payload: msg, $$:{mtid:'notification', opcode:'payload'}});
        } else {
            push(stream, msg);
        }
    }

    return through2.obj(function decodePacket(packet, enc, callback) {
        port.log.trace && port.log.trace({$$:{opcode:'frameIn', frame:packet}});

        if (port.framePattern) {
            buffer = Buffer.concat([buffer, packet]);
            var frame;
            while (frame = port.framePattern(buffer)) {
                buffer = frame.rest;
                convert(this, frame.data);
            }
            callback();
        } else {
            convert(this, packet);
            callback();
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

    return through2.obj(function encodePacket(packet, enc, callback) {
        when(port.config.send ? port.config.send.call(port, packet, context) : packet).then(function(message) {
            port.log.debug && port.log.debug(message);
            var buffer;
            var size;
            if (port.codec) {
                buffer = port.codec.encode(message, context);
                size = buffer && buffer.length;
                port.traceCallback(context, message);
            } else if (message) {
                buffer = message;
                size = buffer && buffer.length;
            }

            if (port.frameBuilder) {
                buffer = port.frameBuilder({size: size, data: buffer});
            }

            if (buffer) {
                port.log.trace && port.log.trace({$$: {opcode: 'frameOut', frame: buffer}});
                callback(null, buffer)
            } else {
                callback();
            }
        });
    });
};

Port.prototype.pipe = function pipe(stream, context) {
    var queue;
    if (context && context.conId) {
        queue = createQueue();
        this.queues[context.conId] = queue;
    } else {
        queue = this.queue = createQueue();
    }

    [this.encode(context), stream, this.decode(context)].reduce(function(prev, next) {
        return next ? prev.pipe(next) : prev;
    }, queue).on('data', this.masterPublish);

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
