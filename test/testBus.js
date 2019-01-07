/* eslint no-console:0, no-process-exit:0 */

const {Broker, Bus} = require('..');

var broker = new Broker({
    logLevel: 'trace',
    socket: 'test',
    id: 'broker',
    logFactory: null
});

var bus1 = new Bus({
    logLevel: 'trace',
    socket: 'test',
    id: 'bus1',
    logFactory: null
});

var bus2 = new Bus({
    logLevel: 'trace',
    socket: 'test',
    id: 'bus2',
    logFactory: null
});

function test() {
    return broker.init()
        .then(bus1.init.bind(bus1))
        .then(bus2.init.bind(bus2))
        .then(broker.start.bind(broker))
        .then(function(ports) {
            // test method imports
            var fn1 = function() {
                return bus1.importMethod('bus2.test.m1')({x: 'bus1'}).then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            var fn2 = function() {
                return bus1.importMethod('bus2.m2')('bus1').then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            var fn3 = function() {
                return bus2.importMethod('bus1.m3')('bus2').then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            return bus2.register({
                'test.m1': function(test) {
                    console.log('test.m1 argument ' + test);
                    return Promise.resolve('test.m1 invoked with argument ' + test);
                },
                m2: function(test) {
                    console.log('m2 argument ' + test);
                    return Promise.resolve('m2 invoked with argument ' + test);
                }
            })
                .then(function(r) {
                    console.log(r);
                    return bus1.register({
                        m3: function(test) {
                            console.log('m3 argument ' + test);
                            return Promise.resolve('m3 invoked with argument ' + test);
                        }
                    });
                })
                .then(function(r) {
                    console.log(r);
                    return Promise.all([fn1(), fn2(), fn3()]);
                });
        })
        .then(() => {
            // test errors
            console.log('\nerror tests:');
            const indent = '    ';

            console.log(`${indent}inspect errors' properties`);
            const errorsMap = {
                'error.simple': 'simple error text',
                'error.interpolation': 'interpolation {placeholder}'
            };
            const errors = bus1.publicApi.registerErrors(errorsMap);
            const inspect = (type, params) => {
                const print = (what, obj) => {
                    console.log(`${indent.repeat(3)}${what} properties`);
                    console.log(`${indent.repeat(4)}${Object.keys(obj).map(key => `${key}: ${JSON.stringify(obj[key])}`).join(`\n${indent.repeat(4)}`)}`);
                };
                const errorHandler = errors[type];
                const error = errors[type](params);
                console.log(`${indent.repeat(2)}key: ${type}`);
                print('errorHandler', errorHandler);
                print('error', error);
            };
            inspect('error.simple');
            inspect('error.interpolation', {params: {placeholder: 'test'}});

            console.log(`${indent}register error handlers in bus`);
            return bus1.register(errors, 'test')
                .then(result => {
                    console.log('call ');
                    return Promise.all([
                        bus1.importMethod('test.error.simple')({})
                            .then(function(result) {
                                console.log(result);
                                return result;
                            }),
                        bus1.importMethod('test.error.interpolation')({params: {placeholder: 'test'}})
                            .then(function(result) {
                                console.log(result);
                                return result;
                            })
                    ]);
                });
        })
        .then(function() {
            bus1.destroy();
            bus2.destroy();
            broker.destroy();
            console.log('done');
            return true;
        })
        .catch(e => {
            console.error(e);
            process.exit(1);
        });
}

test();
