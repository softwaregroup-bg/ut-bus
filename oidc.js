const { JWKS, JWT } = require('jose');
const {
    resolveService,
    requestGet: get
} = require('./helpers');

module.exports = ({
    issuers,
    tls = {},
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
    async function openIdConfig(issuer, headers, protocol) {
        if (issuer === 'ut-login') {
            const {protocol: loginProtocol, hostname, port} = await resolveService(discoverService);
            issuer = `${loginProtocol}://${hostname}:${port}/rpc/login/.well-known/openid-configuration`;
        } else {
            headers = false;
        }
        return await get(
            issuer,
            errorOidcHttp,
            errorOidcEmpty,
            headers,
            protocol,
            tls,
            request
        );
    }

    let actionsCache;
    async function actions(method) {
        if (actionsCache) return actionsCache[method];
        const {protocol, hostname, port} = await resolveService(discoverService);
        actionsCache = await get(
            `${protocol}://${hostname}:${port}/rpc/login/action`,
            errorActionHttp,
            errorActionEmpty,
            tls,
            request
        );
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
            .map(([issuerId, {
                configuration,
                url = '.well-known/openid-configuration',
                audience = 'ut-bus',
                ...rest
            }]) => (async() => [issuerId, {
                ...await openIdConfig(configuration || issuerUrl(issuerId, url)),
                audience,
                issuerId,
                ...rest
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
        return get(
            (await issuerConfig(issuerId)).jwks_uri,
            errorOidcHttp,
            errorOidcEmpty,
            {},
            undefined,
            tls,
            request
        );
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

    async function verify(token, {nonce, audience = 'ut-bus'}, isId) {
        let decoded;
        try {
            decoded = JWT.decode(token, {complete: true});
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        const config = (decoded.payload.iss && (decoded.payload.iss !== 'ut-login') && (await issuerConfig(decoded.payload.iss))) || {audience};
        try {
            if (isId) {
                JWT.IdToken.verify(token, await getKey(decoded), {issuer: decoded.payload.iss, nonce, audience: config.audience});
            } else {
                JWT.verify(token, await getKey(decoded), {audience: config.audience});
            }
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        if (session && !decoded.payload.ses) await session(decoded);
        return {
            ...decoded,
            config
        };
    }

    return {get, verify, getIssuers, checkAuth, issuerConfig};
};
