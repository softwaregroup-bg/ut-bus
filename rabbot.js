const rabbot = require('rabbot');
const uuid = require('uuid');
rabbot.nackOnError();
rabbot.nackUnhandled();

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, findMethodIn}) {
    function brokerMethod(typeName, methodType) {
        return async function() {
            var $meta = (arguments.length > 1 && arguments[arguments.length - 1]) || {};
            const reply = await rabbot.request(id, {
                appId: 'ut',
                type: 'ports.' + $meta.method.split('.').shift() + '.' + methodType,
                body: {
                    jsonrpc: '2.0',
                    method: $meta.method,
                    id: 1,
                    // timeout: timeout && (timeout - this.config.minLatency),
                    params: Array.prototype.slice.call(arguments)
                }
            });
            reply.ack();
            if (reply.body && reply.body.result !== undefined && reply.body.error === undefined) {
                return reply.body.result;
            } else if (reply.body && reply.body.error) {
                throw Object.assign(new Error(), reply.body.error);
            } else {
                throw new Error('Unexpected error');
            }
        };
    }

    function start() {
        return rabbot.configure({
            connection: {
                replyQueue: socket.debug ? {
                    name: uuid.v4() + '(reply)',
                    subscribe: false,
                    autoDelete: false
                } : {
                    name: uuid.v4() + '(reply)',
                    subscribe: true,
                    autoDelete: true
                },
                vhost: channel,
                ...socket.connection
            },
            exchanges: socket.exchanges || [{
                name: id,
                type: 'fanout',
                autoDelete: true
            }].filter(x => x),
            queues: socket.queues || [{
                name: id,
                subscribe: true,
                autoDelete: true
            }, socket.debug && {
                name: id + '(debug)',
                subscribe: false,
                autoDelete: false
            }].filter(x => x),
            bindings: socket.bindings || [{
                exchange: id,
                target: id,
                keys: []
            }, socket.debug && {
                exchange: id,
                target: id + '(debug)',
                keys: []
            }].filter(x => x)
        });
    }

    function stop() {
        return rabbot.shutdown(true);
    }

    function localRegister(nameSpace, name, fn) {
        mapLocal[nameSpace + '.' + name] = fn;
    }

    async function exportMethod(methods, namespace, reqrep, port) {
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    rabbot.handle({
                        queue: id,
                        type: namespace + '.' + fn.name,
                        autoNack: true,
                        handler: message => Promise.resolve()
                            .then(() => fn(...message.body.params))
                            .then(
                                result => message.reply({
                                    jsonrpc: message.body.jsonrpc,
                                    id: message.body.id,
                                    result
                                }, {contentType: 'application/json'}),
                                error => message.reply({
                                    jsonrpc: message.body.jsonrpc,
                                    id: message.body.id,
                                    error
                                }, {contentType: 'application/json'})
                            )
                    });
                    localRegister(namespace, fn.name, fn, reqrep);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    rabbot.handle({
                        queue: id,
                        type: namespace + '.' + key,
                        autoNack: true,
                        handler: message => Promise.resolve()
                            .then(() => methods[key](...message.body.params))
                            .then(
                                result => message.reply({
                                    jsonrpc: message.body.jsonrpc,
                                    id: message.body.id,
                                    result
                                }, {contentType: 'application/json'}),
                                error => message.reply({
                                    jsonrpc: message.body.jsonrpc,
                                    id: message.body.id,
                                    error
                                }, {contentType: 'application/json'})
                            )
                    });
                    localRegister(namespace, key, methods[key].bind(methods), reqrep);
                }
            });
        }
        return [];
    }

    return Promise.resolve({
        stop,
        start,
        exportMethod,
        brokerMethod
    });
};
