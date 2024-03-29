const {
    decodeJwt,
    decodeProtectedHeader,
    jwtVerify,
    createLocalJWKSet
} = require('jose');
const {
    loginService,
    requestGet: get
} = require('./lib');

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
            const {protocol: loginProtocol, hostname, port} = await loginService(discoverService);
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
        const {protocol, hostname, port} = await loginService(discoverService);
        const actionsMap = await get(
            `${protocol}://${hostname}:${port}/rpc/login/action`,
            errorActionHttp,
            errorActionEmpty,
            {},
            undefined,
            tls,
            request
        );
        const fuzzyMap = Object.entries(actionsMap).reduce((all, [action, bit]) => {
            for (let i = 1, segments = action.split('.'), n = segments.length; i < n; i += 1) {
                const key = segments.slice(0, i).concat('%').join('.');
                if (!all[key]) all[key] = [];
                all[key].push(bit);
            }
            return all;
        }, {});

        actionsCache = {...fuzzyMap, ...actionsMap};

        return actionsCache[method];
    }

    function checkPermission(bit, map) {
        bit -= 1;
        const index = Math.floor(bit / 8);
        return (Number.isInteger(index) && (index < map.length) && (map[index] & (1 << (bit % 8))));
    };

    async function checkAuthSingle(method, map) {
        if (Array.isArray(method)) {
            for (const m of method) {
                if (!await checkAuthSingle(m, map)) return false;
            }
            return true;
        }
        const bit = await actions(method);
        return Array.isArray(bit)
            ? bit.some(b => checkPermission(b, map))
            : checkPermission(bit, map);
    }

    async function checkAuth(method, map, dontThrow) {
        if (!await checkAuthSingle(method, map) && !await checkAuthSingle('%', map)) {
            if (dontThrow) return false;
            throw errorUnauthorized({params: {method}});
        }
        return true;
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

    async function getKey(decoded, protectedHeader) {
        const issuerId = decoded?.iss;
        if (!issuerId) throw errorNoIssuer();
        const kid = protectedHeader?.kid;
        if (!kid) throw errorNoKid();
        if (!keys[issuerId]) keys[issuerId] = createLocalJWKSet(await jwks(issuerId));
        const result = await keys[issuerId](protectedHeader, decoded);
        if (!result) throw errorInvalid({params: {message: 'Invalid OIDC key id'}});
        return result;
    }

    async function verify(token, {nonce, audience = 'ut-bus'}, isId) {
        let decoded;
        let protectedHeader;
        try {
            decoded = decodeJwt(token);
            protectedHeader = decodeProtectedHeader(token);
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        const config = (decoded.iss && (decoded.iss !== 'ut-login') && (await issuerConfig(decoded.iss))) || {audience};
        try {
            if (isId) {
                await jwtVerify(token, await getKey(decoded, protectedHeader), {audience: config.audience, issuer: decoded.iss, nonce});
            } else {
                await jwtVerify(token, await getKey(decoded, protectedHeader), {audience: config.audience});
            }
        } catch (error) {
            throw errorInvalid({params: {message: error.message}, cause: error});
        }
        if (session && audience === 'ut-bus' && !decoded.ses) await session(decoded);
        return {
            ...decoded,
            config
        };
    }

    return {
        get: (url, errorHttp, errorEmpty, headers, protocol) => get(
            url,
            errorHttp,
            errorEmpty,
            headers,
            protocol,
            tls,
            request
        ),
        verify,
        getIssuers,
        checkAuth,
        issuerConfig
    };
};
