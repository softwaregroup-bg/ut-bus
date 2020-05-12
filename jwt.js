const { JWT, JWKS } = require('jose');
const pkg = require('./package.json');
const Boom = require('@hapi/boom');

module.exports = {
    plugin: {
        register(server, {options, logger, errors, jwks}) {
            const keys = {};
            function jose(server, options) {
                return {
                    async authenticate(request, h) {
                        try {
                            const token = request.headers.authorization && request.headers.authorization.match(/^bearer\s+(.+)$/i);
                            if (!token) throw errors['bus.jwtMissingHeader']();
                            let decoded;
                            try {
                                decoded = JWT.decode(token[1], {complete: true});
                            } catch (error) {
                                throw errors['bus.jwtInvalid']({params: error});
                            }
                            const key = (typeof options.key === 'function') ? await options.key(decoded) : options.key;
                            if (!key) throw errors['bus.jwtInvalidKey']();
                            try {
                                JWT.verify(token[1], key);
                            } catch (error) {
                                throw errors['bus.jwtInvalid']({params: error});
                            }
                            return h.authenticated({
                                credentials: {
                                    mlek: decoded.payload.enc,
                                    mlsk: decoded.payload.sig,
                                    permissionMap: Buffer.from(decoded.payload.per, 'base64'),
                                    actorId: decoded.payload.sub,
                                    sessionId: decoded.payload.ses
                                }
                            });
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized());
                        }
                    }
                };
            };
            async function key(decoded) {
                const issuerId = decoded.payload && decoded.payload.iss;
                if (!issuerId) throw errors['bus.oidcNoIssuer']();
                const kid = decoded.header && decoded.header.kid;
                if (!kid) throw errors['bus.oidcNoKid']();
                const jwk = keys[issuerId] && keys[issuerId].get({kid});
                if (jwk) return jwk;
                if (issuerId !== 'ut-login' && !(Array.isArray(options.openId) && options.openId.includes(issuerId))) {
                    throw errors['bus.oidcBadIssuer']({params: {issuerId}});
                }
                keys[issuerId] = JWKS.asKeyStore(await jwks(issuerId), {ignoreErrors: true});
                return keys[issuerId].get({kid});
            };
            server.auth.scheme('jwt', jose);
            if (options.openId) server.auth.strategy('openId', 'jwt', { key });
        },
        pkg,
        requirements: {
            hapi: '>=18'
        }
    }
};
