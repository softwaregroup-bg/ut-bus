const pkg = require('./package.json');
const Boom = require('@hapi/boom');
const LRUCache = require('lru-cache');

module.exports = {
    plugin: {
        register(server, {options: {openId, tokenCache}, logger, errors, verify}) {
            function jose() {
                const cache = (![0, false, 'false'].includes(tokenCache)) && new LRUCache({max: 1000, ...tokenCache});
                return {
                    async authenticate(request, h) {
                        try {
                            const token = request.headers.authorization && request.headers.authorization.match(/^bearer\s+(.+)$/i);
                            if (!token) throw errors['bus.jwtMissingHeader']();
                            const cachedCredentials = cache && cache.get(token[1]);
                            if (cachedCredentials) return h.authenticated({credentials: cachedCredentials});
                            const decoded = await verify(token[1], {issuer: openId, audience: 'ut-bus'});
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
                            const credentials = {
                                mlek,
                                mlsk,
                                permissionMap: Buffer.from(per, 'base64'),
                                actorId,
                                sessionId,
                                ...rest
                            };
                            if (cache) cache.set(token[1], credentials, exp * 1000 - Date.now());
                            return h.authenticated({credentials});
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized(error.message));
                        }
                    }
                };
            }
            server.auth.scheme('jwt', jose);
            server.auth.strategy('openId', 'jwt');
            server.auth.strategy('preauthorized', 'jwt');
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
