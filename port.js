'use strict';

var through2 = require('through2');
var Readable = require('readable-stream/readable');
var Buffer = require('buffer').Buffer;
var bufferCreate = Buffer;
var assign = require('lodash.assign');
var hrtime = require('browser-process-hrtime');
var errors = require('./errors');
var includes = require('./includes');
var discardChunk = Symbol('discard chunk');

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

function createQueue(config, callback) {
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
    return this.bus && Promise.all([this.bus.register(methods.req, 'ports'), this.bus.subscribe(methods.pub, 'ports')]);
};

Port.prototype.messageDispatch = function messageDispatch() {
    var result = this.bus && this.bus.dispatch.apply(this.bus, Array.prototype.slice.call(arguments));
    if (!result) {
        this.log.error && this.log.error('Cannot dispatch message to bus', {message: Array.prototype.slice.call(arguments)});
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
    var promise = Promise.resolve();
    startList.forEach((start) => {
        promise = promise.then(() => start.call(this));
    });
    return promise;
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
    var $meta = arguments.length && arguments[arguments.length - 1];
    var args = Array.prototype.slice.call(arguments);
    return new Promise(function requestPromise(resolve, reject) {
        if (!args.length) {
            reject(errors.missingParams());
        } else if (!$meta) {
            reject(errors.missingMeta());
        } else {
            $meta.callback = function requestPromiseCb(msg) {
                if ($meta.mtid !== 'error') {
                    resolve(Array.prototype.slice.call(arguments));
                } else {
                    reject(msg);
                }
                return true;
            };
            if (port.queue) {
                port.queue.add(args);
            } else if ($meta.conId && port.queues[$meta.conId]) {
                port.queues[$meta.conId].add(args);
            } else if (Object.keys(port.queues).length && port.connRouter && typeof port.connRouter === 'function') {
                var queue = port.queues[port.connRouter(port.queues, Array.prototype.slice.call(arguments))];
                queue && queue.add(args);
            } else {
                reject(errors.notConnected(port.config.id));
            }
        }
    });
};

Port.prototype.publish = function publish() {
    var $meta = (arguments.length && arguments[arguments.length - 1]);
    var queue;
    if (!arguments.length) {
        return Promise.reject(errors.missingParams());
    } else if (!$meta) {
        return Promise.reject(errors.missingMeta());
    } else if (this.queue) {
        queue = this.queue;
    } else if ($meta.conId && this.queues[$meta.conId]) {
        queue = this.queues[$meta.conId];
    } else if (Object.keys(this.queues).length && this.connRouter && typeof this.connRouter === 'function') {
        queue = this.queues[this.connRouter(this.queues, Array.prototype.slice.call(arguments))];
    } else {
        return Promise.reject(errors.notConnected(this.config.id));
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
    this.log.error && this.log.error(error);
};

Port.prototype.receive = function portReceive(stream, packet, context) {
    var port = this;
    var $meta = packet.length && packet[packet.length - 1];
    $meta = $meta && port.findMeta($meta, context);
    $meta.conId = context && context.conId;
    var fn = this.getConversion($meta, 'receive');
    $meta && (packet[packet.length - 1] = $meta);
    if (!fn) {
        stream.push(packet);
    } else {
        return Promise.resolve()
            .then(function receivePromise() {
                return fn.apply(port, Array.prototype.concat(packet, context));
            })
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

Port.prototype.decode = function decode(context, concurrency) {
    var port = this;
    var buffer = bufferCreate(0);

    function convert(stream, msg) {
        var $meta;
        port.msgReceived && port.msgReceived(1);
        if (port.codec) {
            $meta = {conId: context && context.conId};
            return Promise.resolve()
                .then(function decodeConvert() {
                    return port.codec.decode(msg, $meta, context);
                })
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

    return this.createStream(function decodePacket(packet) {
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
            return discardChunk;
        } catch (error) {
            return Promise.reject(error);
        }
    }, concurrency);
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

Port.prototype.getConversion = function getConversion($meta, type) {
    var fn;
    if ($meta) {
        if ($meta.method) {
            fn = this.config[[$meta.method, $meta.mtid, type].join('.')];
            if (!fn) {
                fn = this.config[[this.methodPath($meta.method), $meta.mtid, type].join('.')];
            }
        }
        if (!fn) {
            fn = this.config[[$meta.opcode, $meta.mtid, type].join('.')];
        }
    }
    if (!fn) {
        fn = this.config[type];
    }
    return fn;
};

// concurrency can be a number (indicating the treshhold) or true (for unmilited concurrency)
Port.prototype.createStream = function createStream(handler, concurrency) {
    var countActive = 0;
    var port = this;
    if (!concurrency) {
        // don't allow setting concurrency:true from config
        concurrency = Number.isInteger(this.config.concurrency) ? this.config.concurrency : 10;
    }
    var stream = through2({objectMode: true}, function createStreamThrough(packet, enc, callback) {
        countActive++;
        if (concurrency === true || (countActive < concurrency)) {
            callback();
        }
        return Promise.resolve()
            .then(function createStreamPromise() {
                return handler.call(stream, packet);
            })
            .catch(function createStreamPromiseCatch(e) {
                // TODO: handle error (e.g. close and recreate stream)
                port.error(e);
                stream.push(null);
                return discardChunk;
            })
            .then(function createStreamPromiseThen(res) {
                if (res !== discardChunk) {
                    stream.push(res);
                }
                if (countActive-- === concurrency) {
                    callback();
                }
                return res;
            });
    });
    return stream;
};

Port.prototype.encode = function encode(context, concurrency) {
    var port = this;
    return this.createStream((packet) => {
        var $meta = packet.length && packet[packet.length - 1];
        var fn = port.getConversion($meta, 'send');
        var msgCallback = ($meta && $meta.callback) || noop;
        if (fn) {
            packet = Promise.resolve()
                .then(function encodeConvert() {
                    return fn.apply(port, Array.prototype.concat(packet, context));
                })
                .then(function encodeConvertResolve(result) {
                    return [result, $meta];
                });
        }
        return Promise.resolve()
            .then(function encodePacket() {
                return packet;
            })
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
                    return buffer;
                }
                return discardChunk;
            })
            .catch(function encodePacketResolveThrow(err) {
                port.error(err);
                $meta.mtid = 'error';
                $meta.errorCode = err && err.code;
                $meta.errorMessage = err && err.message;
                msgCallback(err, $meta);
                return discardChunk;
            });
    }, concurrency);
};

Port.prototype.disconnect = function(reason) {
    this.error(reason);
    throw errors.disconnect(reason);
};

Port.prototype.pipe = function pipe(stream, context) {
    var conId = context && context.conId && context.conId.toString();
    var encode = this.encode(context);
    var decode = this.decode(context);
    var port = this;
    var queue = createQueue(this.config.queue, function queueEvent(name) {
        return port.receive(decode, [{}, {mtid: 'notification', opcode: name}], context);
    });
    var streamSequence = [queue, encode, stream, decode];
    function unpipe() {
        return streamSequence.reduce((prev, next) => {
            return next ? prev.unpipe(next) : prev;
        });
    }
    if (context && conId) {
        this.queues[conId] = queue;
        if (this.socketTimeOut) {
            stream.setTimeout(this.socketTimeOut, handleStreamClose.bind(this, stream, conId, unpipe));
        }
    } else {
        this.queue = queue;
    }
    stream
        .on('end', handleStreamClose.bind(this, undefined, conId, unpipe))
        .on('error', handleStreamClose.bind(this, stream, conId, unpipe));

    return streamSequence
        .reduce((prev, next) => {
            return next ? prev.pipe(next) : prev;
        })
        .on('data', function queueData(packet) {
            var $meta = (packet.length > 1) && packet[packet.length - 1];
            var mtid = $meta.mtid;
            var opcode = $meta.opcode;
            if (packet[0] instanceof errors.disconnect) {
                return stream.end();
            }
            return Promise.resolve()
                .then(function pipeMessageDispatch() {
                    return port.messageDispatch.apply(port, packet);
                })
                .then(function pipeMessageDispatchResolve(result) {
                    if (mtid === 'request' && $meta.mtid !== 'discard') {
                        if (!$meta.mtid) {
                            $meta.mtid = 'response';
                        }
                        if (!$meta.opcode) {
                            $meta.opcode = opcode;
                        }
                        queue.add([result, $meta]);
                    }
                    return result;
                })
                .catch(function pipeMessageDispatchReject(e) {
                    return port.error(e);
                });
        });
};

Port.prototype.pipeReverse = function pipeReverse(stream, context) {
    var self = this;
    var encode = this.encode(context, true);
    var decode = this.decode(context, true);
    var callStream = this.createStream(function pipeReverseThrough(packet) {
        var $meta = (packet.length && packet[packet.length - 1]) || {};
        if ($meta.mtid === 'error' || $meta.mtid === 'response') {
            return packet;
        } else {
            // todo maybe this cb preserving logic is not needed
            var cb;
            if ($meta.callback) {
                cb = $meta.callback;
                delete $meta.callback;
            }
            var push = function pipeReverseInStreamCb(result) {
                if (cb) {
                    $meta.callback = cb;
                }
                return [result, $meta];
            };

            if ($meta.mtid === 'request') {
                return Promise.resolve()
                    .then(function pipeReverseInStream() {
                        return self.messageDispatch.apply(self, packet);
                    })
                    .then(push)
                    .catch(push);
            } else {
                self.messageDispatch.apply(self, packet);
                return discardChunk;
            }
        }
    }, true);
    var streamSequence = [stream, decode, callStream, encode];
    streamSequence.reduce(function pipeReverseReduce(prev, next) {
        return next ? prev.pipe(next) : prev;
    })
    .on('data', function pipeReverseQueueData(packet) {
        self.messageDispatch.apply(self, packet);
    });
    this.streams.push(stream);
    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec) {
    var port = this;
    var stream = this.createStream(function pipeExecThrough(chunk) {
        var $meta = chunk.length > 1 && chunk[chunk.length - 1];
        var startTime = hrtime();
        return Promise.resolve()
            .then(function pipeExecThrough() {
                return exec.apply(port, chunk);
            })
            .then(function pipeExecThroughResolved(result) {
                var diff = hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                port.latency && port.latency(diff, 1);
                if ($meta) {
                    if ($meta.mtid === 'request') {
                        $meta.mtid = 'response';
                    }
                    $meta.timeTaken = diff;
                }
                return [result, $meta];
            })
            .catch(function pipeExecThroughRejected(error) {
                port.error(error);
                var diff = hrtime(startTime);
                diff = diff[0] * 1000 + diff[1] / 1000000;
                port.latency && port.latency(diff, 1);
                if ($meta) {
                    $meta.timeTaken = diff;
                    $meta.mtid = 'error';
                }
                return [error, $meta];
            });
    });
    this.streams.push(stream);
    return this.pipe(stream);
};

Port.prototype.isDebug = function isDebug() {
    return this.config.debug || (this.config.debug == null && this.bus.config && this.bus.config.debug);
};

Port.prototype.includesConfig = function includesConfig(name, values, defaultValue) {
    var configValue = this.config[name];
    if (configValue == null) {
        return defaultValue;
    }
    if (!Array.isArray(values)) {
        values = [values];
    }
    return includes(configValue, values);
};

function noop() {};

module.exports = Port;
