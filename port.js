var through2 = require('through2');
var Readable = require('readable-stream/readable');
var when = require('when');
var Buffer = require('buffer').Buffer;
var bufferCreate = Buffer;
var assign = require('lodash/object/assign');

function handleStreamClose(stream, conId) {
    if (stream) {
        stream.destroy();
    }
    if (conId) {
        delete this.queues[conId];
    } else {
        this.queue = null;
    }
}

var createQueue = function queue(config, callback) {
    var q = [];
    var r = new Readable({objectMode: true});
    var forQueue = false;
    var empty = config && config.empty;
    var t = false;

    function emitEmpty() {
        t = setTimeout(emitEmpty, empty);
        callback('empty');
    }

    function clear() {
        if (t) {
            clearTimeout(t);
            t = false;
        }
    }

    r._read = function readQueue() {
        if (q.length) {
            this.push(q.shift());
        } else {
            forQueue = false;
        }
        empty && callback && !q.length && emitEmpty();
    };

    r.add = function add(msg) {
        clear();
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
    this.bytesSent = null;
    this.bytesReceived = null;
    this.msgSent = null;
    this.msgReceived = null;
    this.latency = null;
    this.counter = null;
}

Port.prototype.init = function init() {
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name: this.config.id, context: this.config.type + ' port'}));

    if (this.config.metrics !== false && this.bus && this.bus.config.implementation && this.bus.performance) {
        this.counter = function(type, code, name) {
            return this.bus.performance.register((this.bus.performance.config.id || this.bus.config.implementation) + '_' + (this.config.metrics || this.config.id), type, code, name);
        }.bind(this);
        this.msgSent = this.counter('counter', 'ms', 'Messages sent');
        this.msgReceived = this.counter('counter', 'mr', 'Messages received');
    }

    var methods = {req: {}, pub: {}};
    methods.req[this.config.id + '.start'] = this.start;
    methods.req[this.config.id + '.stop'] = this.stop;

    (this.config.namespace || [this.config.id]).reduce(function(prev, next) {
        prev.req[next + '.request'] = this.request.bind(this);
        prev.pub[next + '.publish'] = this.publish.bind(this);
        return prev;
    }.bind(this), methods);
    return this.bus && when.all([this.bus.register(methods.req, 'ports'), this.bus.subscribe(methods.pub, 'ports')]);
};

Port.prototype.messageDispatch = function() {
    var result = this.bus && this.bus.dispatch.apply(this.bus, Array.prototype.slice.call(arguments));
    if (!result) {
        this.log && this.log.error && this.log.error('Cannot dispatch message to bus', {message: Array.prototype.slice.call(arguments)});
    }
    return result;
};

Port.prototype.start = function start() {
    this.log.info && this.log.info({$meta: {opcode: 'port.start'}, id: this.config.id, config: this.config});
    this.config.start && this.config.start.call(this);
    return true;
};

Port.prototype.stop = function stop() {
    this.log.info && this.log.info({$meta: {opcode: 'port.stop'}, id: this.config.id});
    this.config.stop && this.config.stop.call(this);
    return true;
};

Port.prototype.request = function request() {
    var port = this;
    var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
    var args = Array.prototype.slice.call(arguments);
    return when.promise(function(resolve, reject) {
        if (!args.length) {
            reject(new Error('Missing parameters'));
        } else if (!$meta) {
            reject(new Error('Missing metadata'));
        } else {
            $meta.callback = function(msg) {
                if ($meta && $meta.mtid !== 'error') {
                    resolve(Array.prototype.slice.call(arguments));
                } else {
                    reject(msg);
                }
                return true;
            };
            if (this.queue) {
                this.queue.add(args);
            } else if ($meta && $meta.conId && this.queues[$meta.conId]) {
                this.queues[$meta.conId].add(args);
            } else {
                var keys = Object.keys(this.queues).sort(function(a, b) {
                    return b - a;
                });
                var queue;
                if (keys.length && port.connRouter && typeof(port.connRouter) === 'function') {
                    queue = this.queues[port.connRouter(this.queues)];
                } else if (!(queue = keys && keys.length && this.queues[keys[0]])) {
                    var error = new Error('No connection to ' + this.config.id + '; queues: ' + JSON.stringify(Object.keys(this.queues)));
                    error.code = 'notConnected';
                    reject(error);
                }
                queue.add(args);
            }
        }
    }.bind(this));
};

Port.prototype.publish = function publish() {
    var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
    var queue;
    if (!arguments.length) {
        return when.reject(new Error('Missing parameters'));
    } else if (!$meta) {
        return when.reject(new Error('Missing metadata'));
    } else if (this.queue) {
        queue = this.queue;
    } else if ($meta && $meta.conId && this.queues[$meta.conId]) {
        queue = this.queues[$meta.conId];
    } else {
        var keys = Object.keys(this.queues).sort(function(a, b) {
            return b - a;
        });
        if (keys.length && this.connRouter && typeof(this.connRouter) === 'function') {
            queue = this.queues[this.connRouter(this.queues)];
        } else if (!(queue = keys && keys.length && this.queues[keys[0]])) {
            var error = new Error('No connection to ' + this.config.id + '; queues: ' + JSON.stringify(Object.keys(this.queues)));
            error.code = 'notConnected';
            return when.reject(error);
        }
    }
    if (queue) {
        queue.add(Array.prototype.slice.call(arguments));
        return true;
    } else {
        this.log.error && this.log.error('Queue not found', {arguments: Array.prototype.slice.call(arguments)});
        return false;
    }
};

Port.prototype.findMeta = function findMeta($meta, context) {
    if (this.codec && $meta.trace && ($meta.mtid === 'response' || $meta.mtid === 'error')) {
        var x = context.callbacks[$meta.trace];
        if (x) {
            delete context[$meta.trace];
            if (x.startTime) {
                $meta.timeTaken = Date.now() - x.startTime;
            }
            return assign(x.$meta, $meta);
        } else {
            return $meta;
        }
    } else {
        return $meta;
    }
};

Port.prototype.receive = function(stream, packet, context) {
    var port = this;
    var $meta = packet.length && packet[packet.length - 1];
    var fn = ($meta && port.config[[$meta.opcode, $meta.mtid, 'receive'].join('.')]) || port.config.receive;

    if (!fn) {
        $meta && (packet[packet.length - 1] = port.findMeta($meta, context));
        stream.push(packet);
    } else {
        when(when.lift(fn).apply(port, packet))
            .then(function(result) {
                $meta = port.findMeta($meta, context);
                stream.push([result, $meta]);
                port.log.debug && port.log.debug({message: result, $meta: $meta});
            })
            .catch(function(err) {
                $meta = port.findMeta($meta, context);
                $meta.mtid = 'error';
                $meta.errorCode = err && err.code;
                $meta.errorMessage = err && err.message;
                stream.push([err, $meta]);
            })
            .done();
    }
};

Port.prototype.decode = function decode(context) {
    var port = this;
    var buffer = bufferCreate(0);

    function convert(stream, msg) {
        var $meta;
        port.msgReceived && port.msgReceived(1);
        if (port.codec) {
            $meta = {conId: context && context.conId};
            var message = port.codec.decode(msg, $meta, context);
            port.receive(stream, [message, $meta], context);
        } else if (msg && msg.constructor && msg.constructor.name === 'Buffer') {
            port.receive(stream, [{payload: msg}, {mtid: 'notification', opcode: 'payload', conId: context && context.conId}], context);
        } else {
            $meta = msg.length && msg[msg.length - 1];
            $meta && context && context.conId && ($meta.conId = context.conId);
            port.receive(stream, msg, context);
        }
    }

    function applyPattern(rest) {
        if (port.framePatternSize) {
            var tmp = port.framePatternSize(rest);
            if (tmp) {
                return port.framePattern(tmp.data, {size: tmp.size - port.config.format.sizeAdjust});
            } else {
                return false;
            }

        } else {
            return port.framePattern(rest);
        }
    }

    return through2.obj(function decodePacket(packet, enc, callback) {
        port.log.trace && port.log.trace({$meta: {opcode: 'frameIn'}, message: packet});
        if (port.framePattern) {
            port.bytesReceived && port.bytesReceived(packet.length);
            buffer = Buffer.concat([buffer, packet]);
            var frame = applyPattern(buffer);

            while (frame) {
                buffer = frame.rest;
                convert(this, frame.data);
                frame = applyPattern(buffer);
            }
        } else {
            convert(this, packet);
        }
        callback();
    });
};

Port.prototype.traceMeta = function traceMeta($meta, context) {
    if ($meta && $meta.trace && $meta.callback && $meta.mtid === 'request') {
        context.callbacks[$meta.trace] = {$meta: $meta, expire: Date.now() + 60000, startTime: Date.now()};
    }
};

Port.prototype.encode = function encode(context) {
    var port = this;
    return through2.obj(function encodePacket(packet, enc, callback) {
        var $meta = packet.length && packet[packet.length - 1];
        var fn = ($meta && port.config[[$meta.opcode, $meta.mtid, 'send'].join('.')]) || port.config.send;
        var msgCallback = ($meta && $meta.callback) || function() {};

        if (fn) {
            packet = when.lift(fn).apply(port, packet)
                .then(function(result) {
                    return [result, $meta];
                });
        }

        when(packet)
            .then(function(message) {
                port.log.debug && port.log.debug({message: message[0], $meta: message[1]});
                var buffer;
                var size;
                var sizeAdjust = 0;
                if (port.codec) {
                    buffer = port.codec.encode(message[0], message[1], context);
                    if (port.framePatternSize) {
                        sizeAdjust = port.config.format.sizeAdjust;
                    }
                    size = buffer && buffer.length + sizeAdjust;
                    port.traceMeta($meta, context);
                } else if (message) {
                    buffer = message;
                    size = buffer && buffer.length;
                }

                if (port.frameBuilder) {
                    buffer = port.frameBuilder({size: size, data: buffer});
                    buffer = buffer.slice(0, buffer.length - sizeAdjust);
                    port.bytesSent && port.bytesSent(buffer.length);
                }
                if (buffer) {
                    port.msgSent && port.msgSent(1);
                    port.log.trace && port.log.trace({$meta: {opcode: 'frameOut'}, message: buffer});
                    callback(null, buffer);
                } else {
                    callback();
                }
            })
            .catch(function(err) {
                $meta.mtid = 'error';
                $meta.errorCode = err && err.code;
                $meta.errorMessage = err && err.message;
                msgCallback(err, $meta);
                callback();
            })
            .done();
    });
};

Port.prototype.pipe = function pipe(stream, context) {
    var queue;
    var conId = context && context.conId && context.conId.toString();
    var encode = this.encode(context);
    var decode = this.decode(context);
    var result = [encode, stream, decode];

    function queueEvent(name) {
        this.receive(decode, [{},{mtid:'notification', opcode:name}], context);
    }

    if (context && conId) {
        queue = createQueue(this.config.queue, queueEvent.bind(this));
        this.queues[conId] = queue;
        if (this.socketTimeOut) {
            stream.setTimeout(this.socketTimeOut, handleStreamClose.bind(this, stream, conId));
        }
        stream.on('end', handleStreamClose.bind(this, undefined, conId))
            .on('error', handleStreamClose.bind(this, stream, conId));
    } else {
        queue = this.queue = createQueue(this.config.queue, queueEvent.bind(this));
        stream.on('end', handleStreamClose.bind(this, undefined))
            .on('error', handleStreamClose.bind(this, stream));
    }

    result.reduce(function(prev, next) {
        return next ? prev.pipe(next) : prev;
    }, queue).on('data', function(packet) {
        var $meta = (packet.length > 1) && packet[packet.length - 1];
        var mtid = $meta.mtid;
        var opcode = $meta.opcode;
        when(this.messageDispatch.apply(this, packet)).then(function(result) {
            if (mtid === 'request' && $meta.mtid !== 'discard') {
                ($meta.mtid) || ($meta.mtid = 'response');
                ($meta.opcode) || ($meta.opcode = opcode);
                queue.add([result, $meta]);
            }
        });
    }.bind(this));

    return result;
};

Port.prototype.pipeReverse = function pipeReverse(stream, context) {
    var self = this;
    var callStream = through2({objectMode: true}, function(packet, enc, callback) {
        var $meta = packet.length && packet[packet.length - 1];
        if ($meta && ($meta.mtid === 'error' || $meta.mtid === 'response')) {
            this.push(packet);
        } else {
            //todo maybe this cb preserving logic is not needed
            var cb = $meta && $meta.callback;
            if (cb) {
                delete $meta.callback;
            }
            var push = function(result) {
                cb && ($meta.callback = cb);
                this.push([result, $meta || {}]);
            }.bind(this);

            when(self.messageDispatch.apply(self, packet)).then(push).catch(push);
        }
        callback();
    });

    [this.decode(context), callStream, this.encode(context)].reduce(function(prev, next) {
        return next ? prev.pipe(next) : prev;
    }, stream).on('data', function(packet) {
        this.messageDispatch.apply(this, packet);
    }.bind(this));

    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec, concurrency) {
    var countActive = 0;
    var latency = this.latency;
    concurrency = concurrency || 10;
    var stream = through2({objectMode: true}, function(chunk, enc, callback) {
        var $meta = chunk.length > 1 && chunk[chunk.length - 1];
        countActive += 1;
        var startTime = process.hrtime();
        $meta && ($meta.mtid === 'request') && ($meta.mtid = 'response');
        when(exec.apply(this, chunk))
            .then(function(result) {
                var diff = process.hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                $meta && ($meta.timeTaken = diff);
                latency && latency(diff, 1);
                stream.push([result, $meta]);
            })
            .catch(function(error) {
                var diff = process.hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                $meta && ($meta.timeTaken = diff);
                latency && latency(diff, 1);
                $meta.mtid = 'error';
                stream.push([error, $meta]);
            })
            .finally(function() {
                countActive -= 1;
                (countActive + 1 === concurrency) && callback();
            })
            .done();
        if (countActive < concurrency) {
            callback();
        }
    });
    return this.pipe(stream);
};

module.exports = Port;
