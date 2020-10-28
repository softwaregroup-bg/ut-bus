const request = (process.type === 'renderer') ? require('ut-browser-request') : require('request');
const [httpGet, httpPost] = [request.get, request.post].map(require('util').promisify);
const {JWT} = require('jose');
module.exports = ({serverInfo, mle}) => {
    const localCache = {};
    const localKeys = mle.keys.sign && mle.keys.encrypt && {mlsk: mle.keys.sign, mlek: mle.keys.encrypt};
    return async function gateway({
        username,
        password,
        channel = 'web',
        protocol = serverInfo('protocol'),
        host = 'localhost',
        port = serverInfo('port'),
        url,
        key,
        auth,
        encrypt = true
    }, method) {
        // don't put a default value for uri in arguments as it can be empty string or null
        if (!url) url = `${protocol}://${host}:${port}`;

        const codec = {
            requestParams: {
                url: `${url}/rpc/${method.replace(/\./g, '/')}`
            }
        };

        if (!key) key = url;

        const cache = localCache[key] = localCache[key] || {};

        if (localKeys && !cache.remoteKeys) {
            const {body} = await httpGet({
                url: `${url}/rpc/login/.well-known/mle`,
                json: true
            });
            if (body.sign && body.encrypt) cache.remoteKeys = body;
        }

        if (auth) {
            cache.auth = auth;
            cache.tokenInfo = JWT.decode(auth.access_token);
        }

        if (!cache.auth && !(username && password)) {
            if (cache.remoteKeys) {
                codec.encode = params => ({
                    params: mle.signEncrypt(params, cache.remoteKeys.encrypt, localKeys),
                    method
                });
                codec.decode = result => [mle.decryptVerify(result, cache.remoteKeys.sign), {mtid: 'response', method}];
            } else {
                codec.encode = params => ({params, method});
                codec.decode = result => [result, {mtid: 'response', method}];
            }
            return;
        }

        async function login() {
            const {sign, encrypt} = (localKeys && (cache.auth || cache.remoteKeys)) || {};
            if (sign && encrypt) {
                const {body: {result, error}} = await httpPost({
                    url: `${url}/rpc/login/identity/exchange`,
                    body: {
                        jsonrpc: '2.0',
                        method: 'login.identity.exchange',
                        id: 1,
                        params: mle.signEncrypt({username, password, channel}, encrypt, localKeys)
                    },
                    json: true
                });
                if (error) throw Object.assign(new Error(), mle.decryptVerify(error, sign));
                cache.auth = mle.decryptVerify(result, sign);
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

        if (!cache.auth) await login();

        const exp = Math.floor(Date.now() / 1000) + 5; // add 5 seconds just in case

        if (exp > cache.tokenInfo.exp) {
            if (exp > cache.tokenInfo.exp + cache.auth.refresh_token_expires_in - cache.auth.expires_in) {
                await login();
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
                params: mle.signEncrypt(params, cache.auth.encrypt),
                headers: {
                    authorization: 'Bearer ' + cache.auth.access_token
                },
                method
            });
            codec.decode = result => [mle.decryptVerify(result, cache.auth.sign), {mtid: 'response', method}];
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
