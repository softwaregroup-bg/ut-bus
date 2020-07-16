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
                            const {
                                // standard
                                aud,
                                exp,
                                iss,
                                iat,
                                jti,
                                nbf,
                                sub: actorId,
                                // headers
                                typ,
                                cty,
                                alg,
                                // custom
                                sig: mlsk,
                                enc: mlek,
                                ses: sessionId,
                                per = '',
                                // arbitrary
                                ...rest
                            } = decoded.payload;
                            return h.authenticated({
                                credentials: {
                                    mlek,
                                    mlsk,
                                    permissionMap: Buffer.from(per, 'base64'),
                                    actorId,
                                    sessionId,
                                    ...rest
                                }
                            });
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized(error.message));
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
            server.auth.strategy('openId', 'jwt', { key });
            server.auth.strategy('preauthorized', 'jwt', { key });
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-jwt'
        },
        requirements: {
            hapi: '>=18'
        }
    }
};
