/* eslint no-console:0 */

const tap = require('tap');

const {Broker, ServiceBus} = require('../');

tap.test('bus', async function test(t) {
    const broker = new Broker({
        logLevel: 'trace',
        socket: 'test',
        id: 'broker',
        logFactory: null
    });

    const bus1 = new ServiceBus({
        logLevel: 'trace',
        socket: 'test',
        id: 'bus1',
        logFactory: null
    });

    const bus2 = new ServiceBus({
        logLevel: 'trace',
        socket: 'test',
        id: 'bus2',
        logFactory: null
    });

    const bus3 = new ServiceBus({
        logLevel: 'trace',
        socket: false,
        id: 'bus3',
        logFactory: null
    });
    await t.test('Init broker', () => broker.init());
    await t.test('Init bus1', () => bus1.init());
    await t.test('Init bus2', () => bus2.init());
    await t.test('Init bus3', () => bus3.init());
    await t.test('Start broker', () => broker.start(broker));
    // test method imports
    const fn1 = function() {
        return bus1.importMethod('bus2.test.m1')({x: 'bus1'}).then(function(result) {
            t.comment(result);
            return result;
        });
    };
    const fn2 = function() {
        return bus1.importMethod('bus2.m2')('bus1').then(function(result) {
            t.comment(result);
            return result;
        });
    };
    const fn3 = function() {
        return bus2.importMethod('bus1.m3')('bus2').then(function(result) {
            t.comment(result);
            return result;
        });
    };
    await t.test('Call methods', t => bus2.register({
        'test.m1': function(test) {
            t.comment('test.m1 argument ' + test);
            return Promise.resolve('test.m1 invoked with argument ' + test);
        },
        m2: function(test) {
            t.comment('m2 argument ' + test);
            return Promise.resolve('m2 invoked with argument ' + test);
        }
    })
        .then(function(r) {
            t.comment(r);
            return bus1.register({
                m3: function(test) {
                    t.comment('m3 argument ' + test);
                    return Promise.resolve('m3 invoked with argument ' + test);
                }
            });
        })
        .then(function(r) {
            t.comment(r);
            return Promise.all([fn1(), fn2(), fn3()]);
        })
    );
    await t.test('Call methods', t => {
        // test errors
        t.comment('\nerror tests:');
        const indent = '    ';

        t.comment(`${indent}inspect errors' properties`);
        const errorsMap = {
            'error.simple': 'simple error text',
            'error.interpolation': 'interpolation {placeholder}'
        };
        const errors = bus1.publicApi.registerErrors(errorsMap);
        const inspect = (type, params) => {
            const print = (what, obj) => {
                t.comment(`${indent.repeat(3)}${what} properties`);
                t.comment(`${indent.repeat(4)}${Object.keys(obj).map(key => `${key}: ${JSON.stringify(obj[key])}`).join(`\n${indent.repeat(4)}`)}`);
            };
            const errorHandler = errors[type];
            const error = errors[type](params);
            t.comment(`${indent.repeat(2)}key: ${type}`);
            print('errorHandler', errorHandler);
            print('error', error);
        };
        inspect('error.simple');
        inspect('error.interpolation', {params: {placeholder: 'test'}});

        t.comment(`${indent}register error handlers in bus`);
        return bus1.register(errors, 'test')
            .then(result => {
                t.comment('call ');
                return Promise.all([
                    bus1.importMethod('test.error.simple')({})
                        .then(function(result) {
                            t.comment(result);
                            return result;
                        }),
                    bus1.importMethod('test.error.interpolation')({params: {placeholder: 'test'}})
                        .then(function(result) {
                            t.comment(result);
                            return result;
                        })
                ]);
            });
    });
    t.throws(() => bus3.dispatch({}, {method: 'unknown'}));
    await t.test('Destroy bus1', () => bus1.destroy());
    await t.test('Destroy bus2', () => bus2.destroy());
    await t.test('Destroy broker', () => broker.destroy());
});
