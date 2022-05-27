const Boom = require('@hapi/boom');
const pkg = require('./package.json');

module.exports = {
    plugin: {
        register(server, {options: {debug}, mle, logger, errors}) {
            server.ext('onPostAuth', async(request, h) => {
                try {
                    if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params) {
                        const {credentials} = request.auth;
                        if (credentials.mlsk === 'header' && credentials.mlek === 'header') {
                            const {protectedHeader: {mlsk, mlek}, plaintext} = await mle.decrypt(request.payload.params, { complete: true });
                            credentials.mlsk = mlsk;
                            credentials.mlek = mlek;
                            request.payload.params = await mle.verify(plaintext, mlsk);
                        } else {
                            request.payload.params = await mle.decryptVerify(request.payload.params, credentials.mlsk);
                        }
                    }
                } catch (error) {
                    logger && logger.error && logger.error(errors['bus.mleDecrypt']({cause: error, params: request.payload}));
                    return Boom.badRequest();
                }
                return h.continue;
            });

            server.ext('onPreResponse', async(request, h) => {
                const response = request.response;
                if (response.isBoom) return h.continue;
                if (request.auth.strategy && request.payload && request.payload.jsonrpc && request.payload.params && response.source) {
                    try {
                        const encrypt = message => mle.signEncrypt(message, request.auth.credentials && request.auth.credentials.mlek);
                        if (Object.prototype.hasOwnProperty.call(response.source, 'result')) {
                            response.source.result = await encrypt(response.source.result);
                            return h.continue;
                        }
                        if (Object.prototype.hasOwnProperty.call(response.source, 'error')) {
                            const error = debug
                                ? Object
                                    .entries(Object.getOwnPropertyDescriptors(response.source.error))
                                    .reduce((all, [key, {writable, value}]) => {
                                        if (writable) all[key] = value;
                                        return all;
                                    }, {})
                                : {
                                    type: response.source.error.type,
                                    message: response.source.error.message,
                                    print: response.source.error.print,
                                    params: response.source.error.params,
                                    validation: response.source.error.validation
                                };
                            response.source.error = await encrypt(error);
                            return h.continue;
                        }
                        response.source = await encrypt(response.source);
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
