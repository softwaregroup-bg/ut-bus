'use strict';

var through2 = require('through2');
var Readable = require('readable-stream/readable');
var when = require('when');
var Buffer = require('buffer').Buffer;
var bufferCreate = Buffer;
var assign = require('lodash.assign');
var hrtime = require('browser-process-hrtime');
var errors = require('./errors');

function handleStreamClose(stream, conId, done) {
    if (stream) {
        stream.destroy();
    }
    if (conId) {
        try {
            this.queues[conId] && this.queues[conId].destroy();
        } finally {
            delete this.queues[conId];
        }
    } else {
        try {
            this.queue && this.queue.destroy();
        } finally {
            this.queue = null;
        }
    }
    if (done && typeof (done) === 'function') {
        done();
    }
}

var createQueue = function createQueue(config, callback) {
    var q = [];
    var r = new Readable({objectMode: true});
    var forQueue = false;
    var empty = config && config.empty;
    var idleTime = config && config.idle;
    var idleTimer;

    function emitEmpty() {
        callback('empty');
    }

    function emitIdle() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = false;
        }
        idleTimer = setTimeout(emitIdle, idleTime);
        callback('idle');
    }

    r.clearTimeout = function queueClearTimeout() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = false;
        }
    };

    r.resetTimeout = function queueResetTimeout() {
        if (idleTimer) {
            clearTimeout(idleTimer);
        }
        if (idleTime) {
            idleTimer = setTimeout(emitIdle, idleTime);
        }
    };

    r._read = function readQueue() {
        if (q.length) {
            this.push(q.shift());
        } else {
            forQueue = false;
        }
        empty && callback && !q.length && emitEmpty();
    };

    r.add = function add(msg) {
        this.resetTimeout();
        if (forQueue) {
            q.push(msg);
        } else {
            forQueue = true;
            r.push(msg);
        }
    };

    r.destroy = function createQueueDestroy() {
        r.push(null);
        r.unpipe();
        r.clearTimeout();
        r = q = undefined;
    };

    r.resetTimeout();

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
    this.streams = [];
}

Port.prototype.init = function init() {
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name: this.config.id, context: this.config.type + ' port'}, this.config.log));

    if (this.config.metrics !== false && this.bus && this.bus.config.implementation && this.bus.performance) {
        this.counter = function initCounters(type, code, name) {
            return this.bus.performance.register((this.bus.performance.config.id || this.bus.config.implementation) + '_' +
                (this.config.metrics || this.config.id), type, code, name);
        }.bind(this);
        this.msgSent = this.counter('counter', 'ms', 'Messages sent');
        this.msgReceived = this.counter('counter', 'mr', 'Messages received');
    }

    var methods = {req: {}, pub: {}};
    methods.req[this.config.id + '.start'] = this.start;
    methods.req[this.config.id + '.stop'] = this.stop;

    (this.config.namespace || this.config.imports || [this.config.id]).reduce(function initReduceMethods(prev, next) {
        prev.req[next + '.request'] = this.request.bind(this);
        prev.pub[next + '.publish'] = this.publish.bind(this);
        return prev;
    }.bind(this), methods);
    return this.bus && when.all([this.bus.register(methods.req, 'ports'), this.bus.subscribe(methods.pub, 'ports')]);
};

Port.prototype.messageDispatch = function messageDispatch() {
    var result = this.bus && this.bus.dispatch.apply(this.bus, Array.prototype.slice.call(arguments));
    if (!result) {
        this.log && this.log.error && this.log.error('Cannot dispatch message to bus', {message: Array.prototype.slice.call(arguments)});
    }
    return result;
};

Port.prototype.start = function start() {
    this.log.info && this.log.info({$meta: {mtid: 'event', opcode: 'port.start'}, id: this.config.id, config: this.config});
    var startList = this.config.start ? [this.config.start] : [];
    this.config.imports && this.config.imports.forEach(function foreachImports(imp) {
        imp.match(/\.start$/) && startList.push(this.config[imp]);
        this.config[imp + '.start'] && startList.push(this.config[imp + '.start']);
    }.bind(this));
    return when.reduce(startList, function reduceCalls(prev, start) {
        return start.call(this);
    }.bind(this), []);
};

Port.prototype.stop = function stop() {
    this.log.info && this.log.info({$meta: {mtid: 'event', opcode: 'port.stop'}, id: this.config.id});
    this.config.stop && this.config.stop.call(this);
    this.streams.forEach(stream => {
        stream.end();
    });
    return true;
};

Port.prototype.request = function request() {
    var port = this;
    var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
    var args = Array.prototype.slice.call(arguments);
    return when.promise(function requestPromise(resolve, reject) {
        if (!args.length) {
            reject(errors.missingParams());
        } else if (!$meta) {
            reject(errors.missingMeta());
        } else {
            $meta.callback = function requestPromiseCb(msg) {
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
            } else if (Object.keys(this.queues).length && port.connRouter && typeof port.connRouter === 'function') {
                var queue = this.queues[port.connRouter(this.queues, Array.prototype.slice.call(arguments))];
                queue && queue.add(args);
            } else {
                reject(errors.notConnected(this.config.id));
            }
        }
    }.bind(this));
};

Port.prototype.publish = function publish() {
    var $meta = (arguments.length && arguments[arguments.length - 1]) || {};
    var queue;
    if (!arguments.length) {
        return when.reject(errors.missingParams());
    } else if (!$meta) {
        return when.reject(errors.missingMeta());
    } else if (this.queue) {
        queue = this.queue;
    } else if ($meta && $meta.conId && this.queues[$meta.conId]) {
        queue = this.queues[$meta.conId];
    } else if (Object.keys(this.queues).length && this.connRouter && typeof this.connRouter === 'function') {
        queue = this.queues[this.connRouter(this.queues, Array.prototype.slice.call(arguments))];
    } else {
        return when.reject(errors.notConnected(this.config.id));
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
            delete context.callbacks[$meta.trace];
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

Port.prototype.error = function portError(error) {
    this.log && this.log.error && this.log.error(error);
};

Port.prototype.receive = function portReceive(stream, packet, context) {
    var port = this;
    var $meta = packet.length && packet[packet.length - 1];
    $meta = $meta && port.findMeta($meta, context);
    $meta.conId = context && context.conId;
    var fn = ($meta && $meta.method && port.config[[$meta.method, $meta.mtid, 'receive'].join('.')]) ||
        ($meta && $meta.method && port.config[[port.methodPath($meta.method), $meta.mtid, 'receive'].join('.')]) ||
        ($meta && port.config[[$meta.opcode, $meta.mtid, 'receive'].join('.')]) ||
        port.config.receive;

    $meta && (packet[packet.length - 1] = $meta);
    if (!fn) {
        stream.push(packet);
    } else {
        when.lift(fn).apply(port, Array.prototype.concat(packet, context))
            .then(function receivePromiseResolved(result) {
                stream.push([result, $meta]);
                port.log.debug && port.log.debug({message: result, $meta: $meta});
                return result;
            })
            .catch(function receivePromiseRejected(err) {
                port.error(err);
                $meta.mtid = 'error';
                $meta.errorCode = err && err.code;
                $meta.errorMessage = err && err.message;
                stream.writable && stream.push([err, $meta]);
            });
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
            when(port.codec.decode(msg, $meta, context))
                .then(function decodeConvertResolved(message) {
                    port.receive(stream, [message, $meta], context);
                    return message;
                })
                .catch(function decodeConvertError(error) {
                    port.error(error);
                });
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
        port.log.trace && port.log.trace({$meta: {mtid: 'frame', opcode: 'in'}, message: packet});
        try {
            if (port.framePattern) {
                port.bytesReceived && port.bytesReceived(packet.length);
                buffer = Buffer.concat([buffer, packet]);
                var frame = applyPattern(buffer);

                while (frame) {
                    buffer = frame.rest;
                    convert(this, frame.data); // todo handle promise
                    frame = applyPattern(buffer);
                }
            } else {
                convert(this, packet);
            }
            callback();
        } catch (error) {
            port.error(error);
            callback(null, null); // close the stream on error
            // todo recreate the stream
        }
    });
};

Port.prototype.traceMeta = function traceMeta($meta, context) {
    if ($meta && $meta.trace && $meta.callback && $meta.mtid === 'request') {
        var expireTimeout = 60000;
        context.callbacks[$meta.trace] = {
            $meta: $meta, expire: Date.now() + expireTimeout, startTime: Date.now()
        };
    }
};

Port.prototype.methodPath = function methodPath(methodName) {
    return methodName.split('/', 2)[1];
};

Port.prototype.encode = function encode(context) {
    var port = this;
    return through2.obj(function encodePacket(packet, enc, callback) {
        var $meta = packet.length && packet[packet.length - 1];
        var fn = ($meta && $meta.method && port.config[[$meta.method, $meta.mtid, 'send'].join('.')]) ||
            ($meta && $meta.method && port.config[[port.methodPath($meta.method), $meta.mtid, 'send'].join('.')]) ||
            ($meta && port.config[[$meta.opcode, $meta.mtid, 'send'].join('.')]) ||
            port.config.send;
        var msgCallback = ($meta && $meta.callback) || noop;

        if (fn) {
            packet = when.lift(fn).apply(port, Array.prototype.concat(packet, context))
                .then(function encodePacketResolve(result) {
                    return [result, $meta];
                });
        }

        when(packet)
            .then(function encodePacketResolveLog(message) {
                port.log.debug && port.log.debug({message: message[0], $meta: message[1]});
                var result = port.codec ? port.codec.encode(message[0], message[1], context) : message;
                return result;
            })
            .then(function encodePacketResolvePrepare(buffer) {
                var size;
                var sizeAdjust = 0;
                if (port.codec) {
                    port.traceMeta($meta, context);
                    if (port.framePatternSize) {
                        sizeAdjust = port.config.format.sizeAdjust;
                    }
                    size = buffer && buffer.length + sizeAdjust;
                } else {
                    size = buffer && buffer.length;
                }
                if (port.frameBuilder) {
                    buffer = port.frameBuilder({size: size, data: buffer});
                    buffer = buffer.slice(0, buffer.length - sizeAdjust);
                    port.bytesSent && port.bytesSent(buffer.length);
                }
                if (buffer) {
                    port.msgSent && port.msgSent(1);
                    port.log.trace && port.log.trace({$meta: {mtid: 'frame', opcode: 'out'}, message: buffer});
                    callback(null, buffer);
                } else {
                    callback();
                }
                return buffer;
            })
            .catch(function encodePacketResolveThrow(err) {
                port.error(err);
                $meta.mtid = 'error';
                $meta.errorCode = err && err.code;
                $meta.errorMessage = err && err.message;
                msgCallback(err, $meta);
                callback();
                // todo close and recreate stream on error
            });
    });
};

Port.prototype.disconnect = function(reason) {
    this.error(reason);
    throw errors.disconnect(reason);
};

Port.prototype.pipe = function pipe(stream, context) {
    var queue;
    var conId = context && context.conId && context.conId.toString();
    var encode = this.encode(context);
    var decode = this.decode(context);
    var result = [encode, stream, decode];
    var port = this;

    function queueEvent(name) {
        this.receive(decode, [{}, {mtid: 'notification', opcode: name}], context);
    }

    function unpipe() {
        result.reduce(function unpipeReduce(prev, next, idx) {
            return next ? prev.unpipe(next) : prev;
        }, queue);
    }

    if (context && conId) {
        queue = createQueue(this.config.queue, queueEvent.bind(this));
        this.queues[conId] = queue;
        if (this.socketTimeOut) {
            stream.setTimeout(this.socketTimeOut, handleStreamClose.bind(this, stream, conId, unpipe));
        }
        stream.on('end', handleStreamClose.bind(this, undefined, conId, unpipe))
            .on('error', handleStreamClose.bind(this, stream, conId, unpipe));
    } else {
        queue = this.queue = createQueue(this.config.queue, queueEvent.bind(this));
        stream.on('end', handleStreamClose.bind(this, undefined, undefined, unpipe))
            .on('error', handleStreamClose.bind(this, stream, undefined, unpipe));
    }

    result.reduce(function pipeReduce(prev, next, idx) {
        return next ? prev.pipe(next) : prev;
    }, queue).on('data', function queueData(packet) {
        var $meta = (packet.length > 1) && packet[packet.length - 1];
        var mtid = $meta.mtid;
        var opcode = $meta.opcode;
        if (packet[0] instanceof errors.Disconnect) {
            stream.end();
            return;
        }
        when(this.messageDispatch.apply(this, packet)).then(function messageDispatchResolve(result) {
            if (mtid === 'request' && $meta.mtid !== 'discard') {
                ($meta.mtid) || ($meta.mtid = 'response');
                ($meta.opcode) || ($meta.opcode = opcode);
                queue.add([result, $meta]);
            }
            return result;
        }).catch(function messageDispatchError(error) {
            port.error(error);
        });
    }.bind(this));
    return result;
};

Port.prototype.pipeReverse = function pipeReverse(stream, context) {
    var self = this;
    var callStream = through2({objectMode: true}, function pipeReverseThrough(packet, enc, callback) {
        var $meta = packet.length && packet[packet.length - 1];
        if ($meta && ($meta.mtid === 'error' || $meta.mtid === 'response')) {
            this.push(packet);
        } else {
            // todo maybe this cb preserving logic is not needed
            var cb = $meta && $meta.callback;
            if (cb) {
                delete $meta.callback;
            }
            var push = function pipeReverseInStreamCb(result) {
                cb && ($meta.callback = cb);
                this.push([result, $meta || {}]);
            }.bind(this);

            if ($meta.mtid === 'request') {
                when(self.messageDispatch.apply(self, packet)).then(push).catch(push);
            } else {
                self.messageDispatch.apply(self, packet);
            }
        }
        callback();
    });

    [this.decode(context), callStream, this.encode(context)].reduce(function pipeReverseReduce(prev, next) {
        return next ? prev.pipe(next) : prev;
    }, stream).on('data', function pipeReverseQueueData(packet) {
        this.messageDispatch.apply(this, packet);
    }.bind(this));
    this.streams.push(stream);
    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec, concurrency) {
    var countActive = 0;
    var latency = this.latency;
    var port = this;
    concurrency = concurrency || 10;
    var stream = through2({objectMode: true}, function pipeExecThrough(chunk, enc, callback) {
        var $meta = chunk.length > 1 && chunk[chunk.length - 1];
        countActive += 1;
        var startTime = hrtime();
        $meta && ($meta.mtid === 'request') && ($meta.mtid = 'response');
        /* eslint promise/catch-or-return:0 */
        when(exec.apply(this, chunk))
            .then(function pipeExecThroughResolved(result) {
                var diff = hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                $meta && ($meta.timeTaken = diff);
                latency && latency(diff, 1);
                stream.push([result, $meta]);
                return result;
            })
            .catch(function pipeExecThroughRejected(error) {
                port.error(error);
                var diff = hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                $meta && ($meta.timeTaken = diff);
                latency && latency(diff, 1);
                $meta.mtid = 'error';
                stream.push([error, $meta]);
            })
            .finally(function pipeExecThroughFinally() {
                countActive -= 1;
                (countActive + 1 === concurrency) && callback();
            })
            .done();
        if (countActive < concurrency) {
            callback();
        }
    });
    this.streams.push(stream);
    return this.pipe(stream);
};

Port.prototype.isDebug = function isDebug() {
    return this.config.debug || (this.config.debug == null && this.bus.config && this.bus.config.debug);
};

function noop() {};

module.exports = Port;
