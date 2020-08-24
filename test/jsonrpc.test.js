const tap = require('tap');
const tests = require('./tests');
const request = require('request');
const { JWT, JWK } = require('jose');
const jose = require('../jose');

const logFactory = {
    createLog: () => ({
        info: () => {},
        error: () => {}
    })
};

tap.test('Bus', test => tests(test, {
    logFactory,
    workDir: __dirname,
    jsonrpc: {
        domain: true,
        api: true
    }
}, {
    logFactory,
    workDir: __dirname,
    jsonrpc: {
        domain: true,
        api: true
    }
}));

tap.test('Bus routes', async test => {
    const sign = JWK.generateSync('EC', 'P-384', {use: 'sig'});
    const encrypt = JWK.generateSync('EC', 'P-384', {use: 'enc'});
    const server = await tests(test, false, {
        workDir: __dirname,
        jsonrpc: {
            domain: true,
            api: true,
            metrics: true,
            openId: [
                'https://accounts.google.com'
            ],
            sign,
            encrypt
        }
    });
    const {uri} = server.rpc.info();

    let auth;
    // const mleServer = jose({sign, encrypt});
    const clientSign = JWK.generateSync('EC', 'P-384', {use: 'sig'});
    const clientEncrypt = JWK.generateSync('EC', 'P-384', {use: 'enc'});
    const mleClient = jose({
        sign: clientSign,
        encrypt: clientEncrypt
    });

    const decrypt = ({result, error, ...rest}) => ({
        ...result && {result: mleClient.decryptVerify(result, sign)},
        ...error && {error: mleClient.decryptVerify(error, sign)},
        ...rest
    });

    test.test('Login', t => {
        request({
            url: new URL('/rpc/login/auth', uri),
            json: true,
            method: 'POST',
            body: {
                sign: clientSign.toJWK(),
                encrypt: clientEncrypt.toJWK()
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            const decoded = JWT.decode(body);
            auth = 'Bearer ' + body;
            delete decoded.exp;
            delete decoded.iat;
            delete decoded.enc.kid;
            delete decoded.enc.x;
            delete decoded.enc.y;
            delete decoded.sig.kid;
            delete decoded.sig.x;
            delete decoded.sig.y;
            t.matchSnapshot(decoded, 'Return valid JWT');
            t.end();
        });
    });

    test.test('JSON RPC', t => {
        request({
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
                params: mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(decrypt(body), 'Return JSON RPC response');
            t.end();
        });
    });

    test.test('REST', t => {
        request({
            url: new URL('/rpc/module/entity/1', uri),
            headers: {
                Authorization: auth
            },
            json: true,
            method: 'GET'
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return entity');
            t.end();
        });
    });

    test.test('File', t => {
        request({
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
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return file');
            t.end();
        });
    });

    test.test('Stream', t => {
        request({
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
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return stream');
            t.end();
        });
    });

    test.test('Forbidden', t => {
        request({
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
                params: mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return 403');
            t.end();
        });
    });

    test.test('Forbidden', t => {
        request({
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
                params: mleClient.signEncrypt({
                    text: 'JSON RPC 2.0'
                }, encrypt)
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return 404');
            t.end();
        });
    });

    test.test('OIDC no auth', t => {
        request({
            url: new URL('/rpc/module/oidc/test', uri),
            json: true,
            method: 'POST',
            body: {
                jsonrpc: '2.0',
                method: 'module.oidc.test',
                id: 1,
                params: {}
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return entity');
            t.end();
        });
    });

    test.test('OIDC auth', t => {
        request.get({
            url: 'https://www.googleapis.com/oauth2/v3/certs',
            json: true
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.ok(body && body.keys && body.keys[0] && body.keys[0].kid && body.keys[0].alg, 'Return oauth key id');
            const header = Buffer.from(JSON.stringify({
                alg: body.keys[0].alg,
                typ: 'JWT',
                kid: body.keys[0].kid
            })).toString('base64').replace(/=/g, '');
            request({
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
            }, (error, response, body) => {
                if (error) t.threw(error);
                t.matchSnapshot(body, 'Return entity');
                t.end();
            });
        });
    });

    test.test('Metrics', t => {
        request({
            url: new URL('/metrics', uri),
            json: true,
            method: 'GET'
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(body, 'Return metrics');
            t.end();
        });
    });

    await test.test('Server stop', () => server.stop());
});
