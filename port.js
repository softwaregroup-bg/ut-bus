var through2 = require('through2');
var Readable = require('readable-stream/readable');
var when = require('when');

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
}

Port.prototype.init = function init() {
    this.logFactory && (this.log = this.logFactory.createLog(this.config.logLevel, {name:this.config.id, context:this.config.type + ' port'}));

    var methods = {req:{}, pub:{}};
    methods.req[this.config.id + '.start'] = this.start;
    methods.req[this.config.id + '.stop'] = this.stop;

    (this.config.namespace || [this.config.id]).reduce(function(prev, next) {
        prev.req[next + '.request'] = this.request.bind(this);
        prev.pub[next + '.publish'] = this.publish.bind(this);
        return prev;
    }.bind(this), methods);
    return this.bus && when.all([this.bus.register(methods.req, 'ports'), this.bus.subscribe(methods.pub, 'ports')]);
};

Port.prototype.messageDispatch = function(msg) {
    var result = this.bus && this.bus.dispatch(msg);
    if (!result) {
        this.log && this.log.error && this.log.error('Cannot dispatch message to bus', {message:msg});
    }
    return result;
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

Port.prototype.request = function request(message) {
    var port = this;
    var $$ = (arguments.length && arguments[arguments.length - 1]) || {};
    return when.promise(function(resolve, reject) {
        if (!message) {
            reject(new Error('Missing message parameter'));
        } else
        if (!$$) {
            reject(new Error('Missing message type'));
        } else {
            $$.callback = function(msg) {
                if (msg.$$ && msg.$$.mtid && msg.$$.mtid !== 'error') {
                    resolve(msg);
                }else {
                    reject(msg);
                }
                return true;
            };
            if (this.queue) {
                message.$$ = $$;
                this.queue.add(message);
            } else if ($$ && $$.conId && this.queues[$$.conId]) {
                message.$$ = $$;
                this.queues[$$.conId].add(message);
            } else {
                var q = Object.keys(this.queues).sort(function(a, b){return b-a});

                if (q.length && port.connRouter && typeof(port.connRouter) === 'function') {
                    q = this.queues[port.connRouter(this.queues)];
                } else if(!(q = q && q.length && this.queues[q[0]])) {
                    reject(new Error('No connection to ' + this.config.id));
                }

                message.$$ = $$;
                q.add(message);
            }
        }
    }.bind(this));
};

Port.prototype.publish = function publish(msg, $$) {
    var conId;
    var queue;
    if (this.queue) {
        queue = this.queue;
    } else {
        conId = ($$ && $$.conId);
        if (conId) {
            queue = this.queues[conId];
        } else {
            queue = this.queue;
        }
    }
    if (queue) {
        msg.$$ = $$;
        queue.add(msg);
        return true;
    } else {
        this.log.error && this.log.error('Queue not found', {message:msg});
        return false;
    }
};

Port.prototype.findCallback = function findCallback(context, message) {
    var $$ = message.$$;
    if ($$.trace && ($$.mtid === 'response' || $$.mtid === 'error')) {
        var x = context[$$.trace];
        if (x) {
            delete context[$$.trace];
            $$.callback = x.callback;
            if (x.startTime) {
                $$.timeTaken = Date.now() - x.startTime;
            }
        }
    }
};

Port.prototype.receive = function(stream, msg, context) {
    var port = this;
    var fn = (msg.$$ && port.config[[msg.$$.opcode, msg.$$.mtid, 'receive'].join('.')]) || port.config.receive;

    when(fn ? when.lift(fn).call(port, msg, context) : msg)
        .then(function(result) {
            port.findCallback(context, result);
            stream.push(result);
            port.log.debug && port.log.debug(result);
        })
        .catch(function(err) {
            var $$ = msg.$$ || {};
            err = err.$$ ? err : {$$ : {errorCode: err.code, errorMessage: err.message, stack: err.stack}};
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
        port.receive(stream, msg, context);
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
            if (frame) {
                while (frame) {
                    buffer = frame.rest;
                    convert(this, frame.data);
                    frame = port.framePattern(buffer);
                }
            } else {
                push(this, {payload: buffer, $$:{mtid:'error', opcode:'decode'}});
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
    if ($$ && $$.trace && $$.callback && $$.mtid === 'request') {
        context[$$.trace] = {callback : $$.callback, expire : Date.now() + 60000, startTime: Date.now()};
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
                err = err.$$ ? err : {$$ : {errorCode: err.code, errorMessage: err.message, stack: err.stack}};
                err.$$.mtid = 'error';
                msgCallback(err);
                callback();
            })
            .done();
    });
};

Port.prototype.pipe = function pipe(stream, context) {
    var queue;
    var conId = context && context.conId && context.conId.toString();

    if (context && conId) {
        queue = createQueue();
        this.queues[conId] = queue;
        if (this.socketTimeOut) {
            stream.setTimeout(this.socketTimeOut, handleStreamClose.bind(this, stream, conId));
        }
        stream.on('end', handleStreamClose.bind(this, undefined, conId))
        .on('error', handleStreamClose.bind(this, stream, conId));
    } else {
        queue = this.queue = createQueue();
        stream.on('end', handleStreamClose.bind(this, undefined))
        .on('error', handleStreamClose.bind(this, stream));
    }

    var result = [this.encode(context), stream, this.decode(context)];

    result.reduce(function(prev, next) {
        return next ? prev.pipe(next) : prev;
    //}, queue).on('data', this.messageDispatch.bind(this));
    //todo handle messageDispatch response
    }, queue).on('data', function(msg) {
        when(this.messageDispatch(msg)).then(function(result){
            if (msg && msg.$$ && msg.$$.mtid === 'request') {
                (result.$$) || (result.$$ = {});
                (result.$$.mtid) || (result.$$.mtid = 'response');
                (result.$$.opcode) || (result.$$.opcode = msg.$$.opcode);
                queue.add(result);
            }
        });
    }.bind(this));

    return result;
};

Port.prototype.pipeReverse = function pipe2(stream, context) {
    var self = this;
    var callStream = through2({objectMode:true}, function(chunk, enc, callback) {
        if (chunk.$$ && (chunk.$$.mtid === 'error' || chunk.$$.mtid === 'response')) {
            this.push(chunk);
        } else {
            var cb = chunk && chunk.$$ && chunk.$$.callback;
            if (cb) {delete chunk.$$.callback;}
            var push = function(result) {
                if (cb) {
                    result.$$ || (result.$$ = {});
                    result.$$.callback = cb;
                }
                this.push(result);
            }.bind(this);

            when(self.messageDispatch(chunk)).then(push).catch(push);
        }
        callback();
    });

    [this.decode(context), callStream, this.encode(context)].reduce(function(prev, next) {
        return next ? prev.pipe(next) : prev;
    }, stream).on('data', this.messageDispatch.bind(this));

    return stream;
};

Port.prototype.pipeExec = function pipeExec(exec, concurrency) {
    var countActive = 0;
    concurrency = concurrency || 10;
    var self = this;
    var stream = through2({objectMode:true}, function(chunk, enc, callback) {
        countActive += 1;
        try {
            var startTime = Date.now();
            self.exec(chunk, function(err, result) {
                countActive -= 1;
                if (err) {
                    err.$$ || (err.$$ = {});
                    err.$$.mtid = 'error';
                }
                var chunkOut = err ? err : result;
                if (chunkOut && chunk && chunk.$$ && chunk.$$.callback) {
                    (chunkOut.$$) || (chunkOut.$$ = {});
                    chunkOut.$$.callback = chunk.$$.callback;
                    chunkOut.$$.timeTaken = (Date.now() - startTime);
                }
                stream.push(chunkOut);
                if (countActive + 1 === concurrency) {
                    callback();
                }
            });
        } catch (e) {
            countActive -= 1;
            (chunk.$$) || (chunk.$$ = {});
            chunk.$$.mtid = 'error';
            chunk.error = e;
            this.push(chunk);
            if (countActive + 1 >= concurrency) {
                callback();
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
