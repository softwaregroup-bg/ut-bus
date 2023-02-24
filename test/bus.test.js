const tap = require('tap');

const {Broker, ServiceBus} = require('../');
const joi = require('joi');

tap.test('bus', async function test(t) {
    const broker = new Broker({
        joi,
        logLevel: 'trace',
        socket: 'test',
        id: 'broker',
        logFactory: {
            createLog: () => ({
                info: () => {},
                error: () => {}
            })
        }
    });

    const bus1 = new ServiceBus({
        joi,
        logLevel: 'trace',
        socket: 'test',
        id: 'bus1',
        logFactory: null
    });

    const bus2 = new ServiceBus({
        joi,
        logLevel: 'trace',
        socket: 'test',
        id: 'bus2',
        logFactory: null
    });

    const bus3 = new ServiceBus({
        joi,
        logLevel: 'trace',
        socket: false,
        id: 'bus3',
        logFactory: null
    });

    const bus4 = new ServiceBus({
        joi,
        logLevel: 'trace',
        socket: 'test',
        id: 'bus4',
        canSkipSocket: true,
        logFactory: null,
        jsonrpc: true
    });

    await t.test('Init broker', () => broker.init());
    t.rejects(() => bus1.start(), {type: 'bus.notInitialized'}, 'Uninitialized start throws');
    t.rejects(() => bus1.publicApi.register(), {type: 'bus.notInitialized'}, 'Uninitialized register throws');
    t.rejects(() => bus1.publicApi.unregister(), {type: 'bus.notInitialized'}, 'Uninitialized unregister throws');
    t.rejects(() => bus1.rpc.brokerMethod(), {type: 'bus.notInitialized'}, 'Uninitialized brokerMethod throws');
    await t.test('Init bus1', () => bus1.init());
    await t.test('Init bus2', () => bus2.init());
    await t.test('Init bus3', () => bus3.init());
    await t.test('Init bus4', () => bus4.init());
    await t.test('Start broker', () => broker.start(broker));
    const bus1Api = bus1.publicApi;
    const bus2Api = bus2.publicApi;
    const bus3Api = bus3.publicApi;
    const bus4Api = bus4.publicApi;
    await t.test('Call methods', async t => {
        t.matchSnapshot(await bus2Api.register({
            'test.m1': async(...params) => [['test.m1 invoked with params', ...params]],
            m2: async(...params) => [['m2 invoked with params', ...params]],
            error1: () => bus2Api.importMethod('bus1.error1')({}),
            error2: () => bus2Api.importMethod('bus1.error2')({})
        }), 'bus2 register');
        t.matchSnapshot(await bus1.register({
            m3: async(...params) => [['m3 invoked with params', ...params]],
            error1: () => bus1Api.importMethod('bus2.error2')({}),
            error2: () => {
                // throw bus1Api.importMethod('test.error.simple')({});
                throw new Error('trace');
            }
        }), 'bus1 register');
        t.matchSnapshot({result: await bus1Api.importMethod('bus2.test.m1')({x: 'bus1'})}, 'm1');
        t.matchSnapshot({result: await bus1Api.importMethod('bus2.m2')('bus1')}, 'm2');
        t.matchSnapshot({result: await bus2Api.importMethod('bus1.m3')('bus2')}, 'm3');
    });
    await t.test('Call errors', async t => {
        const errorsMap = {
            'error.simple': 'simple error text',
            'error.interpolation': 'interpolation {placeholder}'
        };
        const errors = bus1Api.registerErrors(errorsMap);
        const inspect = (type, params) => {
            t.matchSnapshot({properties: Object.entries(errors[type])}, type + ' error handler properties');
            t.matchSnapshot(errors[type](params), type + ' error');
        };
        inspect('error.simple');
        inspect('error.interpolation', {params: {placeholder: 'test'}});

        t.matchSnapshot(await bus1Api.register(errors, 'test'), 'register errors');
        t.matchSnapshot(await bus1Api.importMethod('test.error.simple')({}), 'simple error');
        t.matchSnapshot(await bus1Api.importMethod('test.error.interpolation')({
            params: {
                placeholder: 'test'
            }
        }), 'interpolated error');
        t.rejects(bus2Api.importMethod('bus2.error1')(), {
            method: [
                'bus1.error2',
                'bus2.error2',
                'bus1.error1',
                'bus2.error1'
            ]
        }, 'error');
    });
    t.throws(() => bus3Api.dispatch({}, {method: 'unknown'}), {type: 'bus.methodNotFound'}, 'dispatch unknown');
    t.rejects(() => bus3Api.importMethod('unknown')(), {type: 'bus.bindingFailed'}, 'import unknown');
    t.rejects(() => bus2Api.importMethod('bus1.unknown')({}), {type: 'bus.methodNotFound'}, 'import namespaced unknown');
    t.rejects(() => bus2Api.importMethod('bus1.m3')({}, {destination: 'unknown'}), {type: 'bus.destinationNotFound'}, 'import namespaced unknown destination');
    t.rejects(() => bus2Api.dispatch({}, {destination: 'bus2', mtid: 'request'}), {type: 'bus.missingMethod'}, 'dispatch missing method');
    t.ok(await bus2Api.dispatch({}, {destination: 'bus2', mtid: 'error'}), 'trigger unhandled error');
    bus4.register({
        'test.request': () => 'bus4'
    }, 'ports');
    t.matchSnapshot({result: await bus4Api.importMethod('test.entity.action')('bus2')}, 'm3');
    await t.test('Gateway', async t => {
        bus4Api.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
        bus4Api.registerLocal({
            'login.identity.check'() {
                return {
                    auth: false,
                    params: joi.object(),
                    result: joi.object()
                };
            }
        }, 'login.validation', {version: '1.0.0'});
        bus4Api.register({
            'login.request'(msg, $meta) {
                switch ($meta.method) {
                    case 'login.identity.check': return [];
                    default: return [{}];
                }
            }
        }, 'ports');
        await t.test('bus4 started', () => bus4.start());
        await t.test('bus4 ready', () => bus4Api.ready());
        const {host, port} = bus4.rpc.info();
        try {
            await bus4Api.importMethod('test.request')({}, {
                gateway: {
                    host,
                    port,
                    username: 'unknown',
                    password: 'unknown'
                }
            });
        } catch (e) {
            t.equal(e.type, 'bus.jsonRpcEmpty', 'JSON RPC response without response and error');
        }
    });

    await t.test('Destroy bus1', () => bus1.destroy());
    await t.test('Destroy bus2', () => bus2.destroy());
    await t.test('Destroy bus3', () => bus3.destroy());
    await t.test('Destroy bus4', () => bus4.destroy());
    await t.test('Destroy broker', () => broker.destroy());
});
