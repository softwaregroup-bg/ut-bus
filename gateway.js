const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const [httpPost] = [request.post].map(require('util').promisify);
const decode = (result, method, unpack) => unpack ? result : [result, {method, mtid: 'response'}];

// required by other modules with require('ut-bus/gateway')
module.exports = ({serverInfo, mleClient, errors, get}) => {
    const localCache = {};
    const localKeys = mleClient.keys.sign && mleClient.keys.encrypt && {mlsk: mleClient.keys.sign, mlek: mleClient.keys.encrypt};

    function tokenInfo(auth) {
        const now = Date.now() - 5000; // latency tolerance of 5 seconds
        return {
            tokenExpire: now + auth.expires_in * 1000,
            refreshTokenExpire: now + auth.refresh_token_expires_in * 1000
        };
    }

    async function login(cache, url, username, password, channel) {
        const {sign, encrypt} = (localKeys && (cache.auth || cache.remoteKeys)) || {};
        if (sign && encrypt) {
            const {body: {result, error}} = await httpPost({
                url: `${url}/rpc/login/identity/exchange`,
                body: {
                    jsonrpc: '2.0',
                    method: 'login.identity.exchange',
                    id: 1,
                    params: mleClient.signEncrypt({username, password, channel}, encrypt, localKeys)
                },
                json: true
            });
            if (error) throw Object.assign(new Error(), mleClient.decryptVerify(error, sign));
            cache.auth = mleClient.decryptVerify(result, sign);
        } else {
            const {body: {result, error}} = await httpPost({
                url: `${url}/rpc/login/identity/check`,
                body: {
                    jsonrpc: '2.0',
                    method: 'login.identity.check',
                    id: 1,
                    params: {username, password, channel}
                },
                json: true
            });
            if (error) throw Object.assign(new Error(), error);
            cache.auth = result;
        }
        cache.tokenInfo = tokenInfo(cache.auth);
    }

    return async function gateway({
        username,
        password,
        channel = 'web',
        protocol = serverInfo('protocol'),
        host: hostname = 'localhost',
        port = serverInfo('port'),
        url,
        tls,
        auth,
        encrypt = true,
        method
    }) {
        // don't put a default value for uri in arguments as it can be empty string or null
        if (url) {
            const parsed = new URL(url);
            hostname = parsed.hostname;
            port = parsed.port;
            protocol = parsed.protocol.split(':')[0];
            if (parsed.username) username = parsed.username;
            if (parsed.password) password = parsed.password;
        } else {
            protocol = protocol && protocol.split(':')[0];
            url = `${protocol}://${hostname}:${port}`;
        }

        const codec = {
            requestParams: {
                protocol,
                hostname,
                port,
                path: `/rpc/${method.replace(/\./g, '/')}`
            }
        };

        const cache = localCache[url] = localCache[url] || {};

        if (localKeys && !cache.remoteKeys) {
            const body = await get(
                `${url}/rpc/login/.well-known/mle`,
                errors['bus.jsonRpcHttp'],
                errors['bus.jsonRpcEmpty']
            );
            if (body.sign && body.encrypt) cache.remoteKeys = body;
        }

        if (auth) {
            cache.auth = auth;
            cache.tokenInfo = tokenInfo(auth);
        }

        if (!cache.auth && !(username && password)) {
            if (cache.remoteKeys) {
                codec.encode = params => ({
                    params: mleClient.signEncrypt(params, cache.remoteKeys.encrypt, localKeys),
                    method
                });
                codec.decode = (result, unpack) => decode(mleClient.decryptVerify(result, cache.remoteKeys.sign), method, unpack);
            } else {
                codec.encode = params => ({params, method});
                codec.decode = (result, unpack) => decode(result, method, unpack);
            }
            return codec;
        }

        if (!cache.auth) await login(cache, url, username, password, channel);

        const exp = Date.now();

        if (exp > cache.tokenInfo.tokenExpire) {
            if (exp > cache.tokenInfo.refreshTokenExpire) {
                await login(cache, url, username, password, channel);
            } else {
                const {body} = await httpPost({
                    url: `${url}/rpc/login/token`,
                    body: {
                        grant_type: 'refresh_token',
                        refresh_token: cache.auth.refresh_token
                    },
                    json: true
                });
                Object.assign(cache.auth, body);
                cache.tokenInfo = tokenInfo(body);
            }
        }

        if (cache.auth.sign && cache.auth.encrypt) {
            codec.encode = params => ({
                params: mleClient.signEncrypt(params, cache.auth.encrypt),
                headers: {
                    authorization: 'Bearer ' + cache.auth.access_token
                },
                method
            });
            codec.decode = (result, unpack) => decode(mleClient.decryptVerify(result, cache.auth.sign), method, unpack);
        } else {
            codec.encode = params => ({
                params,
                headers: {
                    authorization: 'Bearer ' + cache.auth.access_token
                },
                method
            });
            codec.decode = (result, unpack) => decode(result, method, unpack);
        }

        return codec;
    };
};
