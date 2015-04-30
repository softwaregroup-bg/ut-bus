var through2 = require('through2');
var Readable = require('readable-stream/readable');
var when = require('when');

var createQueue = function queue() {
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

    this.method = function method(methodName) {
        var tokens = methodName.split('.');
        var destination = tokens.shift() || 'ut';
        var opcode = tokens.join('.') || 'request';
        return this.bus.getMethod('req', 'request', destination, opcode);
    };
}

Port.prototype.init = function init() {
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name:this.config.id, context:this.config.type + ' port'}));

    if (this.bus) {
        var methods = {req:{}, pub:{}};
        methods.req[this.config.id + '.start'] = this.start;
        methods.req[this.config.id + '.stop'] = this.stop;

        (this.config.namespace || [this.config.id]).reduce(function(prev, next) {
            prev.req[next + '.call'] = this.call.bind(this);
            prev.pub[next + '.publish'] = this.publish.bind(this);
            return prev;
        }.bind(this), methods);
        this.messagePublish = this.bus.getMethod('pub', 'publish');
        return when.all([this.bus.register(methods.req, 'ports'), this.bus.subscribe(methods.pub, 'ports')]);
    } else {
        this.messagePublish = function() {
            this.log.error && this.log.error('Cannot publish message to bus', {message:arguments});
        };
    }
};

Port.prototype.start = function start() {
    this.log.info && this.log.info({$$:{opcode:'port.start'}, id:this.config.id, config:this.config});
    this.config.start && this.config.start.call(this);
    return true;
};

Port.prototype.stop = function stop() {
    this.log.info && this.log.info({$$:{opcode:'port.stop'}, id:this.config.id});
    this.config.stop && this.config.stop.call(this);
    return true;
};

Port.prototype.call = function call(message) {
    return when.promise(function(resolve, reject) {
        if (!message) {
            reject(new Error('Missing message parameter'));
        } else
        if (!message.$$) {
            reject(new Error('Missing message type'));
        } else {
            message.$$.callback = function(msg) {
                if (msg.$$ && msg.$$.mtid && msg.$$.mtid !== 'error') {
                    resolve(msg);
                }else {
                    reject(msg);
                }
            };
        }
        if (!this.queue) {
            reject(new Error('No connection to ' + this.config.id));
        } else {
            this.queue.add(message);
        }
    }.bind(this));
};

Port.prototype.publish = function publish(msg) {
    var conId;
    var queue;
    if (this.queue) {
        queue = this.queue;
    } else {
        conId = (msg.$$ && msg.$$.conId);
        if (conId) {
            queue = this.queues[conId];
        } else {
            queue = this.queue;
        }
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
        var $$ = msg.$$ || {};
        when(port.config.receive ? when.lift(port.config.receive).call(port, msg, context) : msg)
            .then(function(result) {
                port.findCallback(context, result);
                stream.push(result);
            })
            .catch(function(err) {
                err = err.$$ ? err : {$$ : {errorCode: err.code, errorMessage: err.message}};
                for (var prop in $$) {
                    if ($$.hasOwnProperty(prop)) {
                        err.$$[prop] = $$[prop];
                    }
                }
                err.$$.mtid = 'error';
                port.findCallback(context, err);
                stream.push(err);
            })
            .done();
    }

    function convert(stream, msg) {
        if (port.codec) {
            var message = port.codec.decode(msg, context);
            push(stream, message);
        } else if (msg && msg.constructor && msg.constructor.name === 'Buffer') {
            push(stream, {payload: msg, $$:{mtid:'notification', opcode:'payload'}});
        } else {
            push(stream, msg);
        }
    }

    return through2.obj(function decodePacket(packet, enc, callback) {
        port.log.trace && port.log.trace({$$:{opcode:'frameIn', frame:packet}});

        if (port.framePattern) {
            buffer = Buffer.concat([buffer, packet]);
            var frame = port.framePattern(buffer);
            while (frame) {
                buffer = frame.rest;
                convert(this, frame.data);
                frame = port.framePattern(buffer);
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
        var msgCallback = (packet.$$ && packet.$$.callback) || function() {};
        when(port.config.send ? when.lift(port.config.send).call(port, packet, context) : packet)
            .then(function(message) {
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
                    callback(null, buffer);
                } else {
                    callback();
                }
            })
            .catch(function(err) {
                err = err.$$ ? err : {$$ : {errorCode: err.code, errorMessage: err.message}};
                err.$$.mtid = 'error';
                msgCallback(err);
                callback();
            })
            .done();
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
    }, queue).on('data', this.messagePublish);

    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec, concurrency) {
    var countActive = 0;
    concurrency = concurrency || 10;
    var self = this;
    var stream = through2({objectMode:true}, function(chunk, enc, callback) {
        countActive += 1;

        try {
            self.exec(chunk, function(err, result) {
                countActive -= 1;
                var chunkOut = err ? err : result;
                if (chunkOut && chunk && chunk.$$ && chunk.$$.callback) {
                    (chunkOut.$$) || (chunkOut.$$ = {});
                    chunkOut.$$.callback = chunk.$$.callback;
                }
                stream.push(chunkOut);
                if (countActive + 1 === concurrency) {
                    callback(err);
                }
            });
        } catch (e) {
            countActive -= 1;
            (chunk.$$) || (chunk.$$ = {});
            chunk.$$.mtid = 'error';
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
