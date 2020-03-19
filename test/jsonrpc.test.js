const tap = require('tap');
const sortKeys = require('sort-keys');
const tests = require('./tests');
const request = require('request');

const clean = result => {
    if (result && typeof result === 'object') return sortKeys(result, {deep: true});
    return result;
};

const logFactory = {
    createLog: () => ({
        info: () => {},
        error: () => {}
    })
};

tap.test('Bus', test => tests(test, {
    logFactory,
    jsonrpc: {
        domain: true,
        api: true
    }
}, {
    logFactory,
    jsonrpc: {
        domain: true,
        api: true
    }
}));

tap.test('Bus routes', async test => {
    const server = await tests(test, false, {
        jsonrpc: {
            domain: true,
            api: true,
            metrics: true,
            openId: [
                'https://accounts.google.com'
            ]
        }
    });
    const {uri} = server.rpc.info();

    test.test('JSON RPC', t => {
        request({
            url: new URL('/rpc/module/entity/action', uri),
            json: true,
            method: 'POST',
            body: {
                jsonrpc: '2.0',
                method: 'module.entity.action',
                id: 1,
                params: {
                    text: 'JSON RPC 2.0'
                }
            }
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(clean(body), 'Return JSON RPC response');
            t.end();
        });
    });

    test.test('REST', t => {
        request({
            url: new URL('/rpc/module/entity/1', uri),
            json: true,
            method: 'GET'
        }, (error, response, body) => {
            if (error) t.threw(error);
            t.matchSnapshot(clean(body), 'Return entity');
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
            t.matchSnapshot(clean(body), 'Return entity');
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
                t.matchSnapshot(clean(body), 'Return entity');
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
            t.matchSnapshot(clean(body), 'Return metrics');
            t.end();
        });
    });

    await test.test('Server stop', () => server.stop());
});
