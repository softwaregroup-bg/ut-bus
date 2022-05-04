const tap = require('tap');
const tests = require('./tests');
const request = require('util').promisify(require('request'));
const { decodeJwt, generateKeyPair, exportJWK } = require('jose');
const jose = require('../jose');
const joi = require('joi');
const uuid = require('uuid');

const logFactory = {
    createLog: () => ({
        info: () => {},
        error: () => {}
    })
};

tap.test('Bus', test => tests(test, {
    joi,
    logFactory,
    workDir: __dirname,
    jsonrpc: {
        domain: true,
        api: true
    }
}, {
    joi,
    logFactory,
    workDir: __dirname,
    jsonrpc: {
        domain: true,
        api: true
    }
}));

tap.test('Bus routes', async test => {
    const {privateKey: sign} = await generateKeyPair('ES384', { crv: 'P-384'});
    const {privateKey: encrypt} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});

    const server = await tests(test, false, {
        workDir: __dirname,
        joi,
        jsonrpc: {
            domain: true,
            api: true,
            metrics: true,
            openId: {
                'ut-login': {
                    audience: 'ut-bus'
                },
                'https://accounts.google.com': {
                    audience: 'audience'
                }
            },
            sign: {...await exportJWK(sign), use: 'sig', kid: uuid.v4()},
            encrypt: {...await exportJWK(encrypt), use: 'enc', kid: uuid.v4()}
        }
    });
    const {uri} = server.rpc.info();

    let auth;
    // const mleServer = jose({sign, encrypt});

    const {privateKey: clientSign, publicKey: clientSignPub} = await generateKeyPair('ES384', { crv: 'P-384'});
    const {privateKey: clientEncrypt, publicKey: clientEncryptPub} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});

    const mleClient = await jose({
        sign: clientSign,
        encrypt: clientEncrypt
    });

    const decrypt = async({result, error, ...rest}) => ({
        ...result && {result: await mleClient.decryptVerify(result, sign)},
        ...error && {error: await mleClient.decryptVerify(error, sign)},
        ...rest
    });

    test.test('Login', async t => {
        return request({
            url: new URL('/rpc/login/auth', uri),
            json: true,
            method: 'POST',
            body: {
                sign: {...await exportJWK(clientSignPub), use: 'sig', kid: uuid.v4()},
                encrypt: {...await exportJWK(clientEncryptPub), use: 'enc', kid: uuid.v4()}
            }
        }).then(({body}) => {
            const decoded = decodeJwt(body);
            auth = 'Bearer ' + body;
            delete decoded.exp;
            delete decoded.iat;
            delete decoded.enc.kid;
            delete decoded.enc.x;
            delete decoded.enc.y;
            delete decoded.sig.kid;
            delete decoded.sig.x;
            delete decoded.sig.y;
            return t.matchSnapshot(decoded, 'Return valid JWT');
        }).catch(t.threw);
    });

    test.test('JSON RPC', async t => {
        return request({
            url: new URL('/rpc/module/entity/action', uri),
            json: true,
            method: 'POST',
            headers: {
                Authorization: auth
            },
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.action',
                id: 1,
                params: await mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        })
            .then(async({body}) => t.matchSnapshot(await decrypt(body), 'Return JSON RPC response'))
            .catch(t.threw);
    });

    test.test('REST', t => {
        return request({
            url: new URL('/rpc/module/entity/1', uri),
            headers: {
                Authorization: auth
            },
            json: true,
            method: 'GET'
        })
            .then(({body}) => t.matchSnapshot(body, 'Return entity'))
            .catch(t.threw);
    });

    test.test('File', t => {
        return request({
            url: new URL('/rpc/module/entity/file', uri),
            headers: {
                Authorization: auth
            },
            json: true,
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.file',
                id: 1
            },
            method: 'POST'
        })
            .then(({body}) => t.matchSnapshot(body, 'Return file'))
            .catch(t.threw);
    });

    test.test('Stream', t => {
        return request({
            url: new URL('/rpc/module/entity/stream', uri),
            headers: {
                Authorization: auth
            },
            json: true,
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.stream',
                id: 1
            },
            method: 'POST'
        })
            .then(({body}) => t.matchSnapshot(body, 'Return stream'))
            .catch(t.threw);
    });

    test.test('Forbidden', async t => {
        return request({
            url: new URL('/rpc/module/entity/empty', uri),
            json: true,
            method: 'POST',
            headers: {
                Authorization: auth
            },
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.empty',
                id: 1,
                params: await mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        })
            .then(({body}) => t.matchSnapshot(body, 'Return 403'))
            .catch(t.threw);
    });

    test.test('Forbidden', async t => {
        return request({
            url: new URL('/rpc/module/entity/notFound', uri),
            json: true,
            method: 'POST',
            headers: {
                Authorization: auth
            },
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.empty',
                id: 1,
                params: await mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        })
            .then(({body}) => t.matchSnapshot(body, 'Return 404'))
            .catch(t.threw);
    });

    test.test('OIDC no auth', t => {
        return request({
            url: new URL('/rpc/module/oidc/test', uri),
            json: true,
            method: 'POST',
            body: {
                jsonrpc: '2.0',
                method: 'module.oidc.test',
                id: 1,
                params: {}
            }
        })
            .then(({body}) => t.matchSnapshot(body, 'Return entity'))
            .catch(t.threw);
    });

    test.test('OIDC auth', t => {
        return request({
            url: 'https://www.googleapis.com/oauth2/v3/certs',
            method: 'GET',
            json: true
        }).then(({body}) => {
            t.ok(body && body.keys && body.keys[0] && body.keys[0].kid && body.keys[0].alg, 'Return oauth key id');
            const header = Buffer.from(JSON.stringify({
                alg: body.keys[0].alg,
                typ: 'JWT',
                kid: body.keys[0].kid
            })).toString('base64').replace(/=/g, '');
            return request({
                url: new URL('/rpc/module/oidc/test', uri),
                headers: {
                    Authorization: `Bearer ${header}.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJpYXQiOjE1ODE4OTg2NzMsImV4cCI6MTU4MTg5ODY4NSwiYXVkIjoiYXVkaWVuY2UiLCJzdWIiOiJzdWJqZWN0In0.ZQ1R_hOeWNwTMB3ikZqG4eJzWoM7KGy8fp6OKFp_tAlpKEC1jPuTaWS0-YtgaVZ2sMSyoIryxOk80zRgZZp6hXVxg2X74bLf9GxkrK4-zfY4vta_od4k2i9KE1azUgR5Sl1bNi61BdaTvYpQQLbK4AxNnQZIyQVLGp7FOfg9L3vRRe7nuFdW8Q9yRL1xTMECFanYqGrxP3U6SaqYNsIjo3pubD73CkZXYJEaJ44_Cai3AjhTmiqLVRT1p0docGdxRVuh4tcQYO_Mn7ybN_6pAlVYWTKZaYmgp6Nnbo6e8bDEMZ1sN5uz6J1A2LphitYpaEaZp3oZtEWEL6DGCbPDyQ`
                },
                json: true,
                method: 'POST',
                body: {
                    jsonrpc: '2.0',
                    method: 'module.oidc.test',
                    id: 1,
                    params: {}
                }
            }).then(({body}) => t.matchSnapshot(body, 'Return entity'));
        }).catch(t.threw);
    });

    test.test('Metrics', t => {
        return request({
            url: new URL('/metrics', uri),
            json: true,
            method: 'GET'
        })
            .then(({body}) => t.matchSnapshot(body, 'Return metrics'))
            .catch(t.threw);
    });

    await test.test('Server stop', () => server.stop());
});
