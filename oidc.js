const { JWKS, JWT } = require('jose');

module.exports = ({
    issuers,
    tls,
    request = require('request'),
    discoverService = false,
    session = false,
    errorPrefix,
    errors: {
        [`${errorPrefix}oidcEmpty`]: errorOidcEmpty,
        [`${errorPrefix}oidcHttp`]: errorOidcHttp,
        [`${errorPrefix}actionEmpty`]: errorActionEmpty,
        [`${errorPrefix}actionHttp`]: errorActionHttp,
        [`${errorPrefix}unauthorized`]: errorUnauthorized,
        [`${errorPrefix}oidcNoIssuer`]: errorNoIssuer,
        [`${errorPrefix}oidcNoKid`]: errorNoKid,
        [`${errorPrefix}oidcBadIssuer`]: errorBadIssuer,
        [`${errorPrefix}jwtInvalid`]: errorInvalid
    }
}) => {
    const get = (url, errorHttp, errorEmpty, headers, protocol) => new Promise((resolve, reject) => {
        request({
            json: true,
            method: 'GET',
            url,
            ...tls,
            ...headers && {
                headers: {
                    'x-forwarded-proto': headers['x-forwarded-proto'] || protocol,
                    'x-forwarded-host': headers['x-forwarded-host'] || headers.host
                }
            }
        }, (error, response, body) => {
            if (error) {
                reject(error);
            } else if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(errorHttp({
                    statusCode: response.statusCode,
                    statusText: response.statusText,
                    statusMessage: response.statusMessage,
                    httpVersion: response.httpVersion,
                    validation: response.body && response.body.validation,
                    debug: response.body && response.body.debug,
                    params: {
                        code: response.statusCode
                    },
                    ...response.request && {
                        req: {
                            httpVersion: response.httpVersion,
                            url: response.request.href,
                            method: response.request.method
                        }
                    }
                }));
            } else if (body) {
                resolve(body);
            } else {
                reject(errorEmpty());
            }
        });
    });

    async function openIdConfig(issuer, headers, protocol) {
        if (issuer === 'ut-login') {
            const {protocol: loginProtocol, hostname, port} = await loginService();
            issuer = `${loginProtocol}://${hostname}:${port}/rpc/login/.well-known/openid-configuration`;
        } else {
            headers = false;
        }
        return await get(issuer, errorOidcHttp, errorOidcEmpty, headers, protocol);
    }

    let loginCache;
    async function loginService() {
        if (!loginCache) loginCache = discoverService('login');
        try {
            return await loginCache;
        } catch (error) {
            loginCache = false;
            throw error;
        }
    }

    let actionsCache;
    async function actions(method) {
        if (actionsCache) return actionsCache[method];
        const {protocol, hostname, port} = await loginService();
        actionsCache = await get(`${protocol}://${hostname}:${port}/rpc/login/action`, errorActionHttp, errorActionEmpty);
        return actionsCache[method];
    }

    async function checkAuthSingle(method, map) {
        const bit = await actions(method) - 1;
        const index = Math.floor(bit / 8);
        return (Number.isInteger(index) && (index < map.length) && (map[index] & (1 << (bit % 8))));
    }

    async function checkAuth(method, map) {
        if (!await checkAuthSingle(method, map) && !await checkAuthSingle('%', map)) {
            throw errorUnauthorized({params: {method}});
        }
    }

    const issuerUrl = (base, url) => (base === 'ut-login' ? 'ut-login' : new URL(url, base.replace(/\/?$/, '/')).href);

    const loadIssuers = () => Promise.all(
        Object.entries(issuers)
            .filter(([, config]) => config)
            .map(([issuer, {
                configuration,
                url = '.well-known/openid-configuration',
                audience = 'ut-bus'
            }]) => (async() => [issuer, {
                ...await openIdConfig(configuration || issuerUrl(issuer, url)),
                audience
            }])())
    );

    async function cache() {
        return (await loadIssuers()).reduce((prev, [issuer, config]) => ({...prev, [config.issuer]: config, [issuer]: config}), {});
    }

    const getIssuers = (headers, protocol) => Promise.all(
        Object.entries(issuers)
            .filter(([, config]) => config)
            .map(([issuer, {
                configuration,
                url = '.well-known/openid-configuration'
            }]) => openIdConfig(configuration || issuerUrl(issuer, url), headers, protocol))
    );

    let issuersCache;

    async function issuerConfig(issuerId) {
        if (issuerId === 'ut-login') return openIdConfig('ut-login');
        issuersCache = issuersCache || cache();
        const result = (await issuersCache)[issuerId];
        if (!result) {
            throw errorBadIssuer({params: {issuerId}});
        }
        return result;
    }

    async function jwks(issuerId) {
        return get((await issuerConfig(issuerId)).jwks_uri, errorOidcHttp, errorOidcEmpty);
    }

    const keys = {};

    async function getKey(decoded) {
        const issuerId = decoded.payload && decoded.payload.iss;
        if (!issuerId) throw errorNoIssuer();
        const kid = decoded.header && decoded.header.kid;
        if (!kid) throw errorNoKid();
        const jwk = keys[issuerId] && keys[issuerId].get({kid});
        if (jwk) return jwk;
        keys[issuerId] = JWKS.asKeyStore(await jwks(issuerId), {ignoreErrors: true});
        const result = keys[issuerId].get({kid});
        if (!result) throw errorInvalid({params: {message: 'Invalid OIDC key id'}});
        return result;
    }

    async function verify(token, {nonce, audience: aud}, isId) {
        let decoded;
        try {
            decoded = JWT.decode(token, {complete: true});
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        const audience = (decoded.payload.iss && (decoded.payload.iss !== 'ut-login') && (await issuerConfig(decoded.payload.iss)).audience) || aud || 'ut-bus';
        try {
            if (isId) {
                JWT.IdToken.verify(token, await getKey(decoded), {issuer: decoded.payload.iss, nonce, audience});
            } else {
                JWT.verify(token, await getKey(decoded), {audience});
            }
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        if (session && !decoded.payload.ses) await session(decoded);
        return decoded;
    }

    return {get, verify, getIssuers, checkAuth, issuerConfig};
};
