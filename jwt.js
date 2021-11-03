const pkg = require('./package.json');
const Boom = require('@hapi/boom');
const LRUCache = require('lru-cache');
const {
    resolveService,
    requestPostForm
} = require('./helpers');

module.exports = ({
    config,
    discoverService,
    request = require('request'),
    errorPrefix,
    tls,
    errors: {
        [`${errorPrefix}basicAuthEmpty`]: errorEmpty,
        [`${errorPrefix}basicAuthHttp`]: errorHttp
    }
}) => ({
    plugin: {
        register(server, {options: {openId, tokenCache, assetTokenCache}, logger, errors, verify}) {
            const jwtChecker = (audience, cacheConfig, errorId, getToken) => function jose() {
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
            const basicAuthChecker = (cacheConfig, getToken) => () => {
                const cache = (![0, false, 'false'].includes(cacheConfig)) && new LRUCache({max: 1000, ...cacheConfig});
                return {
                    async authenticate(req, h) {
                        try {
                            const token = getToken(req);
                            if (!token) throw errors['bus.basicAuthMissingHeader']();
                            const cachedCredentials = cache && cache.get(token);
                            if (cachedCredentials) return h.authenticated({credentials: cachedCredentials});
                            const [username, password] = Buffer.from(token, 'base64')
                                .toString('utf8')
                                .split(':');
                            let actorId;
                            if (config.auth && config.auth['basicauth.basic']) {
                                const found = config.auth['basicauth.basic']
                                    .find(({username: u, password: p}) => {
                                        return username === u && password === p
                                    });
                                if (!found) {
                                    throw errorHttp({
                                        statusCode: 500,
                                        params: {
                                            code: 500
                                        }
                                    });
                                }
                                actorId = found.username;
                            } else {
                                const {
                                    protocol: loginProtocol,
                                    hostname,
                                    port
                                } = await resolveService(discoverService);
                                const {actorId: aId} = await requestPostForm(
                                    `${loginProtocol}://${hostname}:${port}/rpc/login/auth`,
                                    errorHttp,
                                    errorEmpty,
                                    {},
                                    undefined,
                                    tls,
                                    request,
                                    {username, password, channel: 'web'}
                                );
                                actorId = aId;
                            }
                            if (cache) cache.set(token, {}, Date.now());
                            return h.authenticated({credentials: {actorId}});
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized(error.message));
                        }
                    }
                };
            };

            server.auth.scheme('jwt', jwtChecker(
                'ut-bus',
                tokenCache,
                'bus.jwtMissingHeader',
                request => request.headers.authorization && request.headers.authorization.match(/^bearer\s+(.+)$/i)?.[1]
            ));
            server.auth.scheme('asset-cookie', jwtChecker(
                'ut-bus/asset',
                assetTokenCache,
                'bus.jwtMissingAssetCookie',
                request => request.state['ut-bus-asset']
            ));
            server.auth.scheme('basicauth.basic', basicAuthChecker(
                tokenCache,
                request => request.headers.authorization && request.headers.authorization.match(/^basic\s+(.+)$/i)?.[1]
            ));

            server.auth.strategy('openId', 'jwt');
            server.auth.strategy('preauthorized', 'jwt');
            server.auth.strategy('asset', 'asset-cookie');
            server.auth.strategy('jwt.apikey', 'jwt');
            server.auth.strategy('basicauth.basic', 'basicauth.basic');
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-jwt'
        },
        requirements: {
            hapi: '>=18'
        }
    }
});
