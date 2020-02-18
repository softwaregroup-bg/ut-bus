const joi = require('joi');
const sortKeys = require('sort-keys');
const {ServiceBus} = require('..');
const clean = result => {
    if (result && typeof result === 'object') return sortKeys(result, {deep: true});
    return result;
};

module.exports = async(test, clientConfig, serverConfig) => {
    const server = new ServiceBus(serverConfig);
    await test.test('Server init', () => server.init());
    await test.test('Server start', () => server.start());
    const serverApi = server.publicApi;
    const errors = serverApi.registerErrors({
        'module.invalidParameter': 'Invalid parameter'
    });
    test.matchSnapshot(serverApi.performance, 'server.performance before');
    serverApi.performance = {prometheus: () => 'sample metrics'};
    test.matchSnapshot(serverApi.performance, 'server.performance after');
    test.matchSnapshot(clean({errors: Object.keys(serverApi.errors).sort()}), 'server.errors');
    test.matchSnapshot(clean(serverApi.config), 'server.config');
    test.throws(() => serverApi.local, Error, 'server.local error');
    await test.test('Server register map', () => {
        return serverApi.register({
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
            }
        }, 'ports');
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

    await test.test('Server register local', async() => {
        return serverApi.registerLocal({
            'module.entity.action'() {
                return {
                    params: joi.object().keys({text: joi.string()})
                };
            },
            'module.entity.get'() {
                return {
                    method: 'GET',
                    path: '/module/entity/{entityId}'
                };
            },
            'module.oidc.test'() {
                return {
                    params: joi.object(),
                    auth: 'openId'
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
    if (clientConfig) {
        const client = new ServiceBus(clientConfig);
        client.decay = {
            event1: 1000,
            event2: 0
        };
        await test.test('Client init', () => client.init());
        await test.test('Client start', () => client.start());
        const clientApi = client.publicApi;
        test.throws('Client register local max depth', () => clientApi.registerLocal({
            a: {b: {c: {d: true}}}
        }, 'client', {version: '1.0.0'}));
        clientApi.registerLocal({
            a: {b: { c: true}},
            d: [true],
            e: {}
        }, 'client', {version: '1.0.0'});
        test.matchSnapshot(clean(client.modules), 'client.modules');
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
            assert.matchSnapshot(clean(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            })), 'call with object parameter');
            assert.matchSnapshot(clean(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }, {
                timer: calls => assert.matchSnapshot(calls, 'calls')
            })), 'call with timer');
            assert.matchSnapshot(clean(await clientApi.importMethod('module.entity.actionTimeout', {
                timeout: 999
            })({
                text: 'hello world'
            })), 'call with timeout');
            assert.matchSnapshot(clean(await clientApi.importMethod('module.entity.actionCached', {
                cache: {
                    key: () => 'key',
                    before: 'get',
                    after: 'set'
                }
            })({
                text: 'hello world'
            })), 'call with cache');
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
        await test.test('Server unregister', async() => serverApi.unregister(['module.request'], 'ports'));
        await test.test('Call unregistered method', async assert =>
            assert.rejects(clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), {type: 'bus.jsonRpcHttp'}, 'call with object parameter')
        );
        await test.test('Server unregister local', async() => serverApi.unregisterLocal('module.validation'));
        await test.test('Server unsubscribe', async() => serverApi.unsubscribe(['module.publish'], 'ports'));
        await test.test('Client stop', () => client.stop());
        await test.test('Server stop', () => server.stop());
    } else return server;
};
