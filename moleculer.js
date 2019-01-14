const { ServiceBroker } = require('moleculer');
const util = require('util');

module.exports = async function create({id, socket, channel, logLevel, logger, mapLocal, findMethodIn}) {
    if (typeof socket === 'string') {
        socket = {transporter: socket};
    }

    const broker = new ServiceBroker({
        namespace: channel,
        logLevel,
        logger: bindings => ({
            trace: (...params) => logger.trace && logger.trace(bindings, util.format(...params)),
            debug: (...params) => logger.debug && logger.debug(bindings, util.format(...params)),
            info: (...params) => logger.info && logger.info(bindings, util.format(...params)),
            warn: (...params) => logger.warn && logger.warn(bindings, util.format(...params)),
            error: (...params) => logger.error && logger.error(bindings, util.format(...params)),
            fatal: (...params) => logger.fatal && logger.fatal(bindings, util.format(...params))
        }),
        ...socket
    });

    function brokerMethod(typeName, methodType) {
        return function() {
            var $meta = (arguments.length > 1 && arguments[arguments.length - 1]) || {};
            return broker.call(
                'ports.' + $meta.method.split('.').shift() + '.' + methodType,
                Array.prototype.slice.call(arguments)
            )
                .then(res => {
                    res && delete res.ctx;
                    return res;
                })
                .catch(err => {
                    err && delete err.ctx;
                    throw err;
                });
        };
    }

    function start() {
        return broker.start();
    }

    function stop() {
        return broker.stop();
    }

    function localRegister(nameSpace, name, fn) {
        mapLocal[nameSpace + '.' + name] = fn;
    }

    function exportMethod(methods, namespace, reqrep, port) {
        var actions = {};
        if (methods instanceof Array) {
            methods.forEach(function(fn) {
                if (fn instanceof Function && fn.name) {
                    actions[namespace + '.' + fn.name] = ctx => {
                        return fn.apply(null, ctx.params);
                    };
                    localRegister(namespace, fn.name, fn, reqrep);
                }
            });
        } else {
            Object.keys(methods).forEach(function(key) {
                if (methods[key] instanceof Function) {
                    actions[namespace + '.' + key] = ctx => {
                        return methods[key].apply(methods, ctx.params);
                    };
                    localRegister(namespace, key, methods[key].bind(methods), reqrep);
                }
            });
        }

        return broker.createService({
            name: broker.nodeID + '/' + port + (reqrep ? '' : '-events'),
            settings: {
                $noServiceNamePrefix: true
            },
            actions
        });
    }

    return Promise.resolve({
        stop,
        start,
        exportMethod,
        brokerMethod
    });
};
