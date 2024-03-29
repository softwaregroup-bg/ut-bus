const tap = require('tap');
const tests = require('./tests');
const { generateKeyPair, exportJWK } = require('jose');
const joi = require('joi');

tap.test('Bus to bus MLE', async test => {
    let bus1, bus2, bus3, bus4;
    test.test('Bus 1', async test => {
        const {privateKey: sign} = await generateKeyPair('ES384', { crv: 'P-384'});
        const {privateKey: encrypt} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});
        bus1 = await tests(test, false, {
            workDir: __dirname,
            joi,
            jsonrpc: {
                domain: 'bus1',
                sign: await exportJWK(sign),
                encrypt: await exportJWK(encrypt)
            }
        });
    });

    test.test('Bus 2', async test => {
        const {privateKey: sign} = await generateKeyPair('ES384', { crv: 'P-384'});
        const {privateKey: encrypt} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});
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
                    sign: await exportJWK(sign),
                    encrypt: await exportJWK(encrypt)
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
        const {privateKey: sign} = await generateKeyPair('ES384', { crv: 'P-384'});
        const {privateKey: encrypt} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});
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
                    },
                    busX: {
                        url: bus3.rpc.info().uri + '/wrong',
                        username: 'whatever',
                        password: 'whatever'
                    }
                },
                client: {
                    sign: await exportJWK(sign),
                    encrypt: await exportJWK(encrypt)
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
        await new Promise(resolve => setTimeout(resolve, 3001));
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.action')({text: 'text'}), 'Return encrypted object after using refresh token');
        await new Promise(resolve => setTimeout(resolve, 5001));
        t.matchSnapshot(await bus2.importMethod('bus1/module.entity.action')({text: 'text'}), 'Return encrypted object after re-login');
        t.matchSnapshot(await bus3.importMethod('bus1/module.entity.public')({}), 'Call bus 1 public');
        t.matchSnapshot(await bus3.importMethod('bus1/module.entity.public')({}), 'Call bus 1 public cached');
        t.matchSnapshot(await bus3.importMethod('bus2/module.entity.public')({}), 'Call bus 2 public');
        t.matchSnapshot(await bus3.importMethod('bus2/module.entity.public')({}), 'Call bus 2 public cached');
        t.rejects(bus4.importMethod('bus1/module.entity.public')({}), {type: 'bus.authenticationFailed'}, 'Authentication failed');
        t.rejects(bus4.importMethod('bus2/module.entity.public')({}), {type: 'bus.authenticationFailed'}, 'Authentication failed');
        t.matchSnapshot(await bus4.importMethod('bus3/module.entity.public')({}), 'Call bus 3 action');
        t.matchSnapshot(await bus4.importMethod('bus3/module.entity.public')({}), 'Call bus 3 action cached');
        t.rejects(bus4.importMethod('busX/module.entity.public')({}), {type: 'bus.jsonRpcHttp'}, 'Incorrect gateway url');
    });
    await test.test('Bus 1 stop', () => bus1.stop());
    await test.test('Bus 2 stop', () => bus2.stop());
    await test.test('Bus 3 stop', () => bus3.stop());
    await test.test('Bus 4 stop', () => bus4.stop());
});
