const pkg = require('./package.json');
const Boom = require('@hapi/boom');
const LRUCache = require('lru-cache');

module.exports = {
    plugin: {
        register(server, {options: {openId, tokenCache, assetTokenCache}, logger, errors, verify}) {
            const checker = (audience, cacheConfig, errorId, getToken) => function jose() {
                const cache = (![0, false, 'false'].includes(cacheConfig)) && new LRUCache({max: 1000, ...cacheConfig});
                return {
                    async authenticate(request, h) {
                        try {
                            const token = getToken(request);
                            if (!token) throw errors[errorId]();
                            const cachedCredentials = cache && cache.get(token);
                            if (cachedCredentials) return h.authenticated({credentials: cachedCredentials});
                            const decoded = await verify(token, {issuer: openId, audience});
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
                            if (cache) cache.set(token, credentials, exp * 1000 - Date.now());
                            return h.authenticated({credentials});
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized(error.message));
                        }
                    }
                };
            };

            server.auth.scheme('jwt', checker(
                'ut-bus',
                tokenCache,
                'bus.jwtMissingHeader',
                request => request.headers.authorization && request.headers.authorization.match(/^bearer\s+(.+)$/i)?.[1]
            ));
            server.auth.scheme('asset-cookie', checker(
                'ut-bus/asset',
                assetTokenCache,
                'bus.jwtMissingAssetCookie',
                request => request.state['ut-bus-asset']
            ));
            server.auth.strategy('openId', 'jwt');
            server.auth.strategy('preauthorized', 'jwt');
            server.auth.strategy('asset', 'asset-cookie');
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
