const joi = require('joi');
const { JWKS, JWK, JWT } = require('jose');
const {ServiceBus} = require('..');

const key = JWK.generateSync('OKP', 'Ed25519', {use: 'sig'});
const jwks = new JWKS.KeyStore();
jwks.add(key);

const api = (server, errors) => ({
    'module.request': async({text, entityId}, {method}) => {
        switch (method) {
            case 'module.entity.actionTimeout':
            case 'module.entity.actionCached':
            case 'module.entity.action': {
                if (text) {
                    return [text.toUpperCase(), {calls: ['module.entity.action']}];
                } else {
                    throw errors['module.invalidParameter']();
                }
            }
            case 'module.entity.get':
                return ['Entity ' + entityId];
            case 'module.entity.empty':
                return;
            default:
                throw server.errors['bus.methodNotFound']({params: {method}});
        }
    },
    'login.request': async(params, {method, httpRequest: {url}}) => {
        switch (method) {
            case 'login.identity.authenticate':
                return [
                    JWT.sign({
                        typ: 'Bearer',
                        per: Buffer.from([3]).toString('Base64'),
                        enc: JWK.asKey(params.encrypt),
                        sig: JWK.asKey(params.sign)
                    }, key, {
                        issuer: 'ut-login',
                        audience: 'ut-bus',
                        expiresIn: '8 h'
                    })
                ];
            case 'login.oidc.getConfiguration':
                return [{
                    jwks_uri: new URL('../jwks', url.href).href
                }];
            case 'login.action.map':
                return [{
                    'module.entity.action': 1,
                    'module.entity.get': 2
                }];
            case 'login.oidc.getKeys':
                return [jwks.toJWKS()];
            default:
                throw server.errors['bus.methodNotFound']({params: {method}});
        }
    }
});

module.exports = async(test, clientConfig, serverConfig) => {
    const server = new ServiceBus(serverConfig);
    await test.test('Server init', () => server.init());
    const serverApi = server.publicApi;
    serverApi.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
    await test.test('Server start', () => server.start());
    const errors = serverApi.registerErrors({
        'module.invalidParameter': 'Invalid parameter'
    });
    test.matchSnapshot(serverApi.performance, 'server.performance before');
    serverApi.performance = {prometheus: () => 'sample metrics'};
    test.matchSnapshot(serverApi.performance, 'server.performance after');
    test.matchSnapshot({errors: Object.keys(serverApi.errors).sort()}, 'server.errors');
    test.matchSnapshot(serverApi.config, 'server.config');
    test.throws(() => serverApi.local, Error, 'server.local error');
    await test.test('Server register map', () => {
        return serverApi.register(api(server, errors), 'ports');
    });
    await test.test('Server register array', () => {
        return serverApi.register([
            async function get() {

            }
        ], 'ports');
    });

    await test.test('Server publish map', () => {
        return serverApi.subscribe({
            'module.publish': async(params, {method}) => 'notified ' + method
        }, 'ports');
    });

    await test.test('Server getPath', t => {
        t.matchSnapshot(serverApi.getPath('module.entity.action[0]'), 'method with []');
        t.matchSnapshot(serverApi.getPath('module.entity.action?test'), 'method with ?');
        t.matchSnapshot(serverApi.getPath('module.entity.action#test'), 'method with #');
        t.matchSnapshot(serverApi.getPath('destination/module.entity.action?test'), 'method with /');
        t.end();
    });

    await test.test('Server getOpcode', t => {
        t.matchSnapshot(serverApi.getOpcode('module.entity.action[0]'), 'method with []');
        t.matchSnapshot(serverApi.getOpcode('module.entity.action?test'), 'method with ?');
        t.matchSnapshot(serverApi.getOpcode('module.entity.action#test'), 'method with #');
        t.matchSnapshot(serverApi.getOpcode('destination/module.entity.action?test'), 'method with /');
        t.end();
    });

    await test.test('Server register local module', async() => {
        return serverApi.registerLocal({
            'login.identity.authenticate'() {
                return {
                    method: 'POST',
                    path: '/auth',
                    auth: false,
                    validate: {
                        payload: joi.object()
                    }
                };
            },
            'login.oidc.getConfiguration'() {
                return {
                    method: 'GET',
                    path: '/.well-known/openid-configuration',
                    auth: false
                };
            },
            'login.oidc.getKeys'() {
                return {
                    method: 'GET',
                    path: '/jwks',
                    auth: false
                };
            },
            'login.action.map': () => ({
                method: 'GET',
                path: '/action',
                auth: false
            })
        }, 'login.validation', {version: '1.0.0'});
    });
    await test.test('Server register local login', async() => {
        return serverApi.registerLocal({
            'module.entity.action'() {
                return {
                    params: joi.object().keys({text: joi.string()})
                };
            },
            'module.entity.get'() {
                return {
                    method: 'GET',
                    path: '/entity/{entityId}'
                };
            },
            'module.oidc.test'() {
                return {
                    params: joi.object()
                };
            },
            'module.entity.empty'() {
                return {
                };
            }
        }, 'module.validation', {version: '1.0.0'});
    });
    await test.test('Server attach handlers', async assert => {
        const handlers = {};
        assert.matchSnapshot(serverApi.attachHandlers(handlers, ['module.validation']), 'validation handlers');
    });
    await test.test('Server ready', () => serverApi.ready());
    if (clientConfig) {
        const client = new ServiceBus(clientConfig);
        client.decay = {
            event1: 1000,
            event2: 0
        };
        await test.test('Client init', () => client.init());
        const clientApi = client.publicApi;
        clientApi.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
        await test.test('Client start', () => client.start());
        test.throws('Client register local max depth', () => clientApi.registerLocal({
            a: {b: {c: {d: true}}}
        }, 'client', {version: '1.0.0'}));
        clientApi.registerLocal({
            a: {b: { c: true}},
            d: [true],
            e: {}
        }, 'client', {version: '1.0.0'});
        test.matchSnapshot(client.modules, 'client.modules');
        await test.test('Client register', async() => {
            return clientApi.register({
                method() {
                    return 'local result';
                }
            }, 'client', {version: '1.0.0'});
        });
        await test.test('Client register cache', async() => {
            return clientApi.register({
                'cache.request'() {
                    return ['local result'];
                }
            }, 'ports', {version: '1.0.0'});
        });
        await test.test('Client ready', () => clientApi.ready());
        await test.test('Client notification', async assert => {
            assert.matchSnapshot(await clientApi.notification('client.method')({}), 'notification success');
        });
        await test.test('Client register new', async() => {
            clientApi.unregister(['method'], 'client');
            return clientApi.register({
                method() {
                    return 'local result new';
                }
            }, 'client', {version: '1.0.0'});
        });
        await test.test('Client call new', async assert => {
            assert.matchSnapshot(await clientApi.notification('client.method')({}), 'notification success');
        });
        await test.test('Server call success', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }, {
                timer: calls => assert.matchSnapshot(calls, 'calls')
            }), 'call with timer');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.actionTimeout', {
                timeout: 999
            })({
                text: 'hello world'
            }), 'call with timeout');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.actionCached', {
                cache: {
                    key: () => 'key',
                    before: 'get',
                    after: 'set'
                }
            })({
                text: 'hello world'
            }), 'call with cache');
            assert.matchSnapshot(await clientApi.dispatch({
                text: 'hello world'
            }, {
                mtid: 'request',
                method: 'module.entity.action'
            }), 'dispatch()');
        });
        await test.test('Server call error', async assert => {
            assert.rejects(clientApi.importMethod('module.entity.action')({}), {type: 'module.invalidParameter'}, 'error module.invalidParameter');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.unknown', {
                fallback: () => 'fallback'
            })({}), 'fallback');
            assert.rejects(clientApi.importMethod('module.entity.actionCachedBad', {
                cache: {
                    key: () => 'key'
                }
            })({
                text: 'hello world'
            }), {
                type: 'bus.cacheOperationMissing'
            }, 'call with invalid cache params');
            assert.rejects(clientApi.importMethod('module.entity.action')({}, {
                timeout: Date.now() + 500,
                retry: 300
            }), {
                type: 'bus.timeout'
            }, 'retry');
            assert.rejects(clientApi.importMethod('module.entity.empty')({}), {
                type: 'bus.jsonRpcEmpty'
            }, 'call for empty result');
        });
        await test.test('Server notification', async assert => {
            assert.matchSnapshot(await clientApi.notification('module.entity.event')(), 'notification()');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event'
            }), 'dispatch()');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample init');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample skip');
            await new Promise(resolve => setTimeout(resolve, 1001));
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample delay');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event2'
            }), 'dispatch() resample disabled');
            assert.matchSnapshot(await clientApi.dispatch({}), 'dispatch() no meta');
        });
        const server2 = new ServiceBus(serverConfig);
        await test.test('Server2 init', () => server2.init());
        const server2Api = server2.publicApi;
        server2Api.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
        await test.test('Server2 start', () => server2.start());
        const errors2 = server2Api.registerErrors({
            'module.invalidParameter': 'Invalid parameter'
        });
        await test.test('Fill cache', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
        });
        await test.test('Server stop', () => server.stop());
        await test.test('Server2 register map', () => {
            return server2Api.register(api(server2, errors2), 'ports');
        });
        await test.test('Server2 ready', () => server2Api.ready());
        await test.test('Server moved to different port', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
        });
        await test.test('Server unregister', async() => server2Api.unregister(['module.request'], 'ports'));
        await test.test('Call unregistered method', async assert =>
            assert.rejects(clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), {type: 'bus.jsonRpcHttp'}, 'call with object parameter')
        );
        await test.test('Server unregister local', async() => server2Api.unregisterLocal('module.validation'));
        await test.test('Server unsubscribe', async() => server2Api.unsubscribe(['module.publish'], 'ports'));
        await test.test('Client stop', () => client.stop());
        await test.test('Server2 stop', () => server2.stop());
    } else return server;
};
