const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const [httpPost] = [request.post].map(require('util').promisify);
const {JWT} = require('jose');
module.exports = ({serverInfo, mleClient, errors, get}) => {
    const localCache = {};
    const localKeys = mleClient.keys.sign && mleClient.keys.encrypt && {mlsk: mleClient.keys.sign, mlek: mleClient.keys.encrypt};

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
        cache.tokenInfo = JWT.decode(cache.auth.access_token);
    }

    return async function gateway({
        username,
        password,
        channel = 'web',
        protocol = serverInfo('protocol'),
        host: hostname = 'localhost',
        port = serverInfo('port'),
        url,
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
            const body = await get(`${url}/rpc/login/.well-known/mle`, errors, 'bus.jsonRpc');
            if (body.sign && body.encrypt) cache.remoteKeys = body;
        }

        if (auth) {
            cache.auth = auth;
            cache.tokenInfo = JWT.decode(auth.access_token);
        }

        if (!cache.auth && !(username && password)) {
            if (cache.remoteKeys) {
                codec.encode = params => ({
                    params: mleClient.signEncrypt(params, cache.remoteKeys.encrypt, localKeys),
                    method
                });
                codec.decode = result => [mleClient.decryptVerify(result, cache.remoteKeys.sign), {mtid: 'response', method}];
            } else {
                codec.encode = params => ({params, method});
                codec.decode = result => [result, {mtid: 'response', method}];
            }
            return codec;
        }

        if (!cache.auth) await login(cache, url, username, password, channel);

        const exp = Math.floor(Date.now() / 1000) + 5; // add 5 seconds just in case

        if (exp > cache.tokenInfo.exp) {
            if (exp > cache.tokenInfo.exp + cache.auth.refresh_token_expires_in - cache.auth.expires_in) {
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
                cache.tokenInfo = JWT.decode(body.access_token);
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
            codec.decode = result => [mleClient.decryptVerify(result, cache.auth.sign), {mtid: 'response', method}];
        } else {
            codec.encode = params => ({
                params,
                headers: {
                    authorization: 'Bearer ' + cache.auth.access_token
                },
                method
            });
            codec.decode = result => [result, {mtid: 'response', method}];
        }

        return codec;
    };
};
