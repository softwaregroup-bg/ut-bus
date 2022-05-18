const pkg = require('./package.json');
const Boom = require('@hapi/boom');
const LRUCache = require('lru-cache');

const {
    loginService,
    requestPostForm
} = require('./lib');

module.exports = ({
    brokerRequest,
    config,
    discoverService,
    request = require('request'),
    errorPrefix,
    tls,
    errors: {
        [`${errorPrefix}basicAuthEmpty`]: errorEmpty,
        [`${errorPrefix}basicAuthHttp`]: errorHttp,
        [`${errorPrefix}customAuthHttp`]: eCustomAuthHttp
    }
}) => ({
    plugin: {
        register(server, {options: {openId, tokenCache, assetTokenCache}, logger, errors, verify}) {
            const jwtChecker = (audience, cacheConfig, errorId, getToken) => function jose(_, options) {
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
                            } = decoded;
                            const credentials = {
                                mlek,
                                mlsk,
                                permissionMap: Buffer.from(per, 'base64'),
                                actorId,
                                sessionId,
                                ...rest
                            };
                            if (cache) cache.set(token, credentials, {ttl: exp * 1000});
                            return h.authenticated({credentials});
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            const err = Boom.unauthorized(error.message);
                            if (options.redirect) {
                                const url = new URL('/rpc/login/form', request.url.href);
                                url.searchParams.set('redirect_uri', request.url.pathname + request.url.search);
                                err.output.payload = `<script>window.location.href = "${url.pathname}${url.search}";</script>`;
                                err.output.headers.contentType = 'text/html';
                            }
                            return h.unauthenticated(err);
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
                                if (!found) throw errorHttp({params: {code: 404}});
                                actorId = found.actorId;
                            } else {
                                const {
                                    protocol,
                                    hostname,
                                    port
                                } = await loginService(discoverService);
                                actorId = (await requestPostForm(
                                    `${protocol}://${hostname}:${port}/rpc/login/auth`,
                                    errorHttp,
                                    errorEmpty,
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
                        const [{actorId}] = await brokerRequest({
                            headers: req.headers,
                            params: req.params,
                            payload: req.payload,
                            query: req.query,
                            path: req.path,
                            channel: 'web'
                        }, {method: dest});

                        if (!actorId) {
                            throw eCustomAuthHttp();
                        }
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
            server.auth.strategy('api', 'asset-cookie', {redirect: true});
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
