const tap = require('tap');
const tests = require('./tests');
const { JWK } = require('jose');
const joi = require('joi');

tap.test('Bus to bus MLE', async test => {
    let bus1, bus2, bus3, bus4;
    test.test('Bus 1', async test => {
        bus1 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus1',
                sign: JWK.generateSync('EC', 'P-384', {use: 'sig'}).toJWK(true),
                encrypt: JWK.generateSync('EC', 'P-384', {use: 'enc'}).toJWK(true)
            }
        });
    });

    test.test('Bus 2', async test => {
        bus2 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus2',
                gateway: {
                    bus1: {
                        url: bus1.rpc.info().uri,
                        username: 'test',
                        password: 'test'
                    }
                },
                client: {
                    sign: JWK.generateSync('EC', 'P-384', {use: 'sig'}).toJWK(true),
                    encrypt: JWK.generateSync('EC', 'P-384', {use: 'enc'}).toJWK(true)
                }
            }
        });
    });

    test.test('Bus 3', async test => {
        const {hostname: host, port, protocol} = new URL(bus1.rpc.info().uri);
        bus3 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus3',
                gateway: {
                    bus1: {
                        host,
                        port,
                        protocol
                    },
                    bus2: {
                        url: bus2.rpc.info().uri,
                        username: 'test',
                        password: 'test'
                    }
                }
            }
        });
    });

    test.test('Bus 4', async test => {
        bus4 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus4',
                gateway: {
                    bus1: {
                        url: bus1.rpc.info().uri,
                        username: 'test',
                        password: 'wrong'
                    },
                    bus2: {
                        url: bus2.rpc.info().uri,
                        username: 'test',
                        password: 'wrong'
                    },
                    bus3: {
                        url: bus3.rpc.info().uri
                    }
                },
                client: {
                    sign: JWK.generateSync('EC', 'P-384', {use: 'sig'}).toJWK(true),
                    encrypt: JWK.generateSync('EC', 'P-384', {use: 'enc'}).toJWK(true)
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
        t.matchSnapshot(await bus3.importMethod('bus1/module.entity.public')({}), 'Call bus 1 public');
        t.matchSnapshot(await bus3.importMethod('bus1/module.entity.public')({}), 'Call bus 1 public cached');
        t.matchSnapshot(await bus3.importMethod('bus2/module.entity.public')({}), 'Call bus 2 public');
        t.matchSnapshot(await bus3.importMethod('bus2/module.entity.public')({}), 'Call bus 2 public cached');
        t.rejects(bus4.importMethod('bus1/module.entity.public')({}), {type: 'bus.authenticationFailed'}, 'Authentication failed');
        t.rejects(bus4.importMethod('bus2/module.entity.public')({}), {type: 'bus.authenticationFailed'}, 'Authentication failed');
        t.matchSnapshot(await bus4.importMethod('bus3/module.entity.public')({}), 'Call bus 3 action');
        t.matchSnapshot(await bus4.importMethod('bus3/module.entity.public')({}), 'Call bus 3 action cached');
    });
    await test.test('Bus 1 stop', () => bus1.stop());
    await test.test('Bus 2 stop', () => bus2.stop());
    await test.test('Bus 3 stop', () => bus3.stop());
    await test.test('Bus 4 stop', () => bus4.stop());
});
