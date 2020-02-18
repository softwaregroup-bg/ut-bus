const Hemera = require('nats-hemera');
const nats = require('nats');
const util = require('util');

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, findMethodIn}) {
    const hemeraParams = typeof socket === 'object' ? {...socket} : {};
    delete hemeraParams.nats;
    const hemera = new Hemera(nats.connect((socket && socket.nats) || socket), {
        logLevel,
        logger: {
            trace: function(data) {
                return logger.trace && logger.trace(util.format.apply(util, arguments));
            },
            debug: function(data) {
                if (logger.debug) {
                    if (data.inbound) {
                        logger.debug && data.inbound.trace$ && logger.debug({
                            trace$: data.inbound.trace$,
                            $meta: {mtid: 'response', opcode: data.inbound.trace$.service}
                        });
                    } else if (data.outbound) {
                        logger.debug && data.outbound.trace$ && logger.debug({
                            trace$: data.outbound.trace$,
                            $meta: {mtid: 'request', opcode: data.outbound.trace$.service}
                        });
                    } else logger.debug(util.format.apply(util, arguments));
                }
            },
            info: function(data) {
                return logger.info && logger.info(util.format.apply(util, arguments));
            },
            warn: function(data) {
                return logger.warn && logger.warn(util.format.apply(util, arguments));
            },
            error: function(data) {
                return logger.error && logger.error(util.format.apply(util, arguments));
            },
            fatal: function(data) {
                return logger.fatal && logger.fatal(util.format.apply(util, arguments));
            },
            child: function(data) {
                return this;
            }
        },
        timeout: 60000,
        ...hemeraParams
    });

    function brokerMethod(typeName, methodType) {
        return function() {
            const $meta = (arguments.length > 1 && arguments[arguments.length - 1]) || {};
            return hemera.act({
                channel: channel,
                topic: 'ports.' + $meta.method.split('.').shift() + '.' + methodType,
                args: Array.prototype.slice.call(arguments)
            }).then(resp => resp.data);
        };
    }

    function start() {
        return true;
    }

    function stop() {
        return hemera.close();
    }

    function localRegister(nameSpace, name, fn) {
        mapLocal[nameSpace + '.' + name] = fn;
    }

    function exportMethod(methods, namespace, reqrep) {
        const methodNames = [];
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    methodNames.push(hemera.add({
                        pubsub$: !reqrep,
                        channel: channel,
                        topic: namespace + '.' + fn.name
                    }, async(req) => fn.apply(null, req.args)));
                    localRegister(namespace, fn.name, fn, reqrep);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    methodNames.push(hemera.add({
                        pubsub$: !reqrep,
                        channel: channel,
                        topic: namespace + '.' + key
                    }, async(req) => methods[key].apply(methods, req.args)));
                    localRegister(namespace, key, methods[key].bind(methods), reqrep);
                }
            });
        }

        return Promise.all(methodNames);
    }

    return hemera.ready().then(() => {
        return {
            stop,
            start,
            exportMethod,
            brokerMethod
        };
    });
};
