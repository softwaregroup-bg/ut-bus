const Boom = require('@hapi/boom');
const pkg = require('./package.json');

module.exports = {
    plugin: {
        register(server, {mle, logger, errors}) {
            server.ext('onPostAuth', (request, h) => {
                try {
                    if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params) {
                        const {mlsk, mlek} = request.auth.credentials;
                        if (mlsk === 'header' && mlek === 'header') {
                            const {protected, cleartext} = mle.decrypt(request.payload.params, { complete: true });
                            request.auth.credentials.mlsk = protected.mlsk;
                            request.auth.credentials.mlek = protected.mlek;
                            request.payload.params = mle.verify(cleartext, protected.mlsk);
                        } else {
                            request.payload.params = mle.decryptVerify(request.payload.params, mlsk);
                        }

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
                if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params) {
                    try {
                        const jsonrpc = request.pre.utBus && request.pre.utBus.jsonrpc;
                        const encrypt = message => mle.signEncrypt(message, request.auth.credentials && request.auth.credentials.mlek);
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
