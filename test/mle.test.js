const tap = require('tap');
const tests = require('./tests');
const { JWK } = require('jose');
const joi = require('joi');

tap.test('Bus to bus MLE', async test => {
    let bus1, bus2, bus3;
    test.test('Bus 1', async test => {
        bus1 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus1',
                sign: JWK.generateSync('EC', 'P-384', {use: 'sig'}),
                encrypt: JWK.generateSync('EC', 'P-384', {use: 'enc'})
            }
        });
    });

    test.test('Bus 2', async test => {
        const {uri: url} = bus1.rpc.info();
        bus2 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus2',
                gateway: {
                    bus1: {
                        url,
                        username: 'test',
                        password: 'test'
                    }
                },
                sign: JWK.generateSync('EC', 'P-384', {use: 'sig'}).toJWK(true),
                encrypt: JWK.generateSync('EC', 'P-384', {use: 'enc'}).toJWK(true)
            }
        });
    });

    test.test('Bus 3', async test => {
        const {uri: url} = bus1.rpc.info();
        const {hostname: host, port, protocol} = new URL(url);
        bus3 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus2',
                gateway: {
                    bus1: {
                        host,
                        port,
                        protocol,
                        username: 'test',
                        password: 'test'
                    }
                }
            }
        });
    });
    test.test('Call methods through gateway', async t => {
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.action')({text: 'text'}), 'Return encrypted object');
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.echo')({echo: []}), 'Return encrypted array');
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.echo')({echo: true}), 'Return encrypted boolean');
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.echo')({echo: 0}), 'Return encrypted integer');
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.echo')({echo: null}), 'Return encrypted null');
        t.matchSnapshot(await bus3.importMethod('bus1/module.entity.public')({}), 'Call public');
    });
    await test.test('Bus 1 stop', () => bus1.stop());
    await test.test('Bus 2 stop', () => bus2.stop());
    await test.test('Bus 3 stop', () => bus3.stop());
});
