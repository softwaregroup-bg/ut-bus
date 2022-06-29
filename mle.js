const Boom = require('@hapi/boom');
const pkg = require('./package.json');

module.exports = {
    plugin: {
        register(server, {options: {debug}, mle, logger, errors}) {
            server.ext('onPostAuth', async(request, h) => {
                if (request.auth.strategy && request.mime === 'application/json') {
                    const [where, what] = request.payload?.jsonrpc ? [request.payload, 'params'] : [request, 'payload'];
                    if (where[what]) {
                        const {credentials} = request.auth;
                        try {
                            if (credentials.mlsk === 'header' && credentials.mlek === 'header') {
                                const {protectedHeader: {mlsk, mlek}, plaintext} = await mle.decrypt(where[what], { complete: true });
                                credentials.mlsk = mlsk;
                                credentials.mlek = mlek;
                                where[what] = await mle.verify(plaintext, mlsk);
                            } else {
                                where[what] = await mle.decryptVerify(where[what], credentials.mlsk);
                            }
                        } catch (error) {
                            logger && logger.error && logger.error(errors['bus.mleDecrypt']({cause: error, params: where}));
                            return Boom.badRequest();
                        }
                    }
                }
                return h.continue;
            });

            server.ext('onPreResponse', async(request, h) => {
                const response = request.response;
                if (response.isBoom) return h.continue;
                if (request.auth.strategy && request.mime === 'application/json' && response.source) {
                    const encrypt = message => mle.signEncrypt(message, request.auth.credentials && request.auth.credentials.mlek);
                    const [where, result, error] = request.payload.jsonrpc ? [response.source, 'result', 'error'] : [response, 'source'];
                    try {
                        if (Object.prototype.hasOwnProperty.call(where, result)) {
                            where[result] = await encrypt(where[result]);
                            return h.continue;
                        }
                        if (error && Object.prototype.hasOwnProperty.call(where, error)) {
                            const err = debug
                                ? Object
                                    .entries(Object.getOwnPropertyDescriptors(where[error]))
                                    .reduce((all, [key, {writable, value}]) => {
                                        if (writable) all[key] = value;
                                        return all;
                                    }, {})
                                : {
                                    type: where[error].type,
                                    message: where[error].message,
                                    print: where[error].print,
                                    params: where[error].params,
                                    validation: where[error].validation
                                };
                            where[error] = await encrypt(err);
                            return h.continue;
                        }
                        return h.continue;
                    } catch (error) {
                        logger && logger.error && logger.error(errors['bus.mleEncrypt']({cause: error, params: where}));
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
