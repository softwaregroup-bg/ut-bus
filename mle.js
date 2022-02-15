const Boom = require('@hapi/boom');
const pkg = require('./package.json');

module.exports = {
    plugin: {
        register(server, {options: {debug}, mle, logger, errors}) {
            server.ext('onPostAuth', (request, h) => {
                try {
                    if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params) {
                        const {credentials} = request.auth;
                        if (credentials.mlsk === 'header' && credentials.mlek === 'header') {
                            const {protected: {mlsk, mlek}, cleartext} = mle.decrypt(request.payload.params, { complete: true });
                            credentials.mlsk = mlsk;
                            credentials.mlek = mlek;
                            request.payload.params = mle.verify(cleartext, mlsk);
                        } else {
                            request.payload.params = mle.decryptVerify(request.payload.params, credentials.mlsk);
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
                if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params && response.source) {
                    try {
                        const encrypt = message => mle.signEncrypt(message, request.auth.credentials && request.auth.credentials.mlek);
                        if (Object.prototype.hasOwnProperty.call(response.source, 'result')) {
                            response.source.result = encrypt(response.source.result);
                            return h.continue;
                        }
                        if (Object.prototype.hasOwnProperty.call(response.source, 'error')) {
                            const props = debug ? Object.getOwnPropertyNames(response.source.error) : ['type', 'message', 'print', 'params'];
                            const error = props.reduce((all, prop) => ({...all, [prop]: response.source.error[prop]}), {});
                            response.source.error = encrypt(error);
                            return h.continue;
                        }
                        response.source = encrypt(response.source);
                        return h.continue;
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
