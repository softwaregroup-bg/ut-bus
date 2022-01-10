const pkg = require('./package.json');
const Boom = require('@hapi/boom');
const LRUCache = require('lru-cache');
const {
    loginService,
    requestPostForm,
    requestPost
} = require('./lib');

module.exports = ({
    config,
    discoverService,
    request = require('request'),
    errorPrefix,
    tls,
    errors: {
        [`${errorPrefix}basicAuthEmpty`]: errorBasicEmpty,
        [`${errorPrefix}basicAuthHttp`]: errorBasicHttp,
        [`${errorPrefix}customAuthEmpty`]: errorCustomEmpty,
        [`${errorPrefix}customAuthHttp`]: errorCustomHttp
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
                            if (Array.isArray(config.auth?.basic)) {
                                const found = config.auth.basic.find(item => username === item.username && password === item.password);
                                if (!found) throw errorBasicHttp({params: {code: 404}});
                                actorId = found.actorId;
                            } else {
                                const {
                                    protocol,
                                    hostname,
                                    port
                                } = await loginService(discoverService);
                                actorId = (await requestPostForm(
                                    `${protocol}://${hostname}:${port}/rpc/login/auth`,
                                    errorBasicHttp,
                                    errorBasicEmpty,
                                    {},
                                    undefined,
                                    tls,
                                    request,
                                    {username, password, channel: 'web'}
                                )).actorId;
                            }
                            if (cache) cache.set(token, {actorId}, Date.now());
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
            server.auth.scheme('basic', basicAuthChecker(
                tokenCache,
                request => request.headers.authorization && request.headers.authorization.match(/^basic\s+(.+)$/i)?.[1]
            ));

            server.auth.scheme('swagger.apiKey.custom', (cacheConfig) => ({
                authenticate: async(req, h) => {
                    const dest = req.route.settings?.app?.securityRequestMethod;
                    try {
                        if (!dest) {
                            throw new Error('Missing method in <uri>.method.x-options.app.securityRequestMethod');
                        }
                        const {
                            protocol,
                            hostname,
                            port
                        } = await loginService(discoverService, dest.split('.')[0]);
                        const actorId = (await requestPost(
                            `${protocol}://${hostname}:${port}/rpc/${dest.split('.').join('/')}`,
                            errorCustomHttp,
                            errorCustomEmpty,
                            {},
                            undefined,
                            tls,
                            request,
                            {
                                jsonrpc: '2.0',
                                method: dest,
                                params: {
                                    headers: req.headers,
                                    params: req.params,
                                    payload: req.payload,
                                    query: req.query,
                                    path: req.path,
                                    route: req.route,
                                    channel: 'web'
                                }
                            }
                        )).actorId;
                        return h.authenticated({credentials: {actorId}});
                    } catch (error) {
                        logger && logger.error && logger.error(error);
                        return h.unauthenticated(Boom.unauthorized(error.message));
                    }
                }
            }));

            server.auth.strategy('openId', 'jwt');
            server.auth.strategy('preauthorized', 'jwt');
            server.auth.strategy('asset', 'asset-cookie');
            server.auth.strategy('swagger.apiKey', 'jwt');
            server.auth.strategy('openapi.http.bearer', 'jwt');
            server.auth.strategy('swagger.basic', 'basic');
            server.auth.strategy('openapi.http.basic', 'basic');
            server.auth.strategy('swagger.apiKey.custom', 'swagger.apiKey.custom');
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
