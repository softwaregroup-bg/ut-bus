const Boom = require('@hapi/boom');
const pkg = require('./package.json');

module.exports = {
    plugin: {
        register(server, {mle, logger, errors}) {
            server.ext('onPostAuth', (request, h) => {
                try {
                    if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params) {
                        request.payload.params = mle.decrypt(request.payload.params, request.auth.credentials && request.auth.credentials.mlsk);
                    }
                } catch (error) {
                    logger && logger.error && logger.error(errors['bus.mleDecrypt']({cause: error, params: request.payload}));
                    return Boom.badRequest();
                }
                return h.continue;
            });

            server.ext('onPreResponse', (request, h) => {
                const response = request.response;
                if (response.isBoom) return h.continue;
                if (request.auth.strategy) {
                    try {
                        const jsonrpc = request.pre.utBus && request.pre.utBus.jsonrpc;
                        const encrypt = message => mle.encrypt(message, request.auth.credentials && request.auth.credentials.mlek);
                        if (jsonrpc && response.source && Object.prototype.hasOwnProperty.call(response.source, 'result')) {
                            response.source.result = encrypt(response.source.result);
                            return h.continue;
                        }
                        if (jsonrpc && response.source && Object.prototype.hasOwnProperty.call(response.source, 'error')) {
                            response.source.error = encrypt({...response.source.error});
                            return h.continue;
                        }
                        if (!jsonrpc) {
                            response.source = encrypt(response.source);
                            return h.continue;
                        }
                    } catch (error) {
                        logger && logger.error && logger.error(errors['bus.mleEncrypt']({cause: error, params: request.payload}));
                        return Boom.badRequest();
                    }
                }
                return h.continue;
            });
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-mle'
        },
        requirements: {
            hapi: '>=18'
        }
    }
};
