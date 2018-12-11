/* eslint no-console:0, no-process-exit:0 */

var Bus = require('../');

var master = Object.assign(new Bus(), {
    server: true,
    logLevel: 'trace',
    socket: 'test',
    id: 'master',
    logFactory: null
});

var worker1 = Object.assign(new Bus(), {
    server: false,
    logLevel: 'trace',
    socket: 'test',
    id: 'worker1',
    logFactory: null
});

var worker2 = Object.assign(new Bus(), {
    server: false,
    logLevel: 'trace',
    socket: 'test',
    id: 'worker2',
    logFactory: null
});

function test() {
    return master.init()
        .then(worker1.init.bind(worker1))
        .then(worker2.init.bind(worker2))
        .then(master.start.bind(master))
        .then(function(ports) {
            // test method imports
            var fn1 = function() {
                return worker1.importMethod('worker2.test.m1')('worker1').then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            var fn2 = function() {
                return worker1.importMethod('worker2.m2')('worker1').then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            var fn3 = function() {
                return worker2.importMethod('worker1.m3')('worker2').then(function(result) {
                    console.log(result);
                    return result;
                });
            };
            return worker2.register({
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
                    return worker1.register({
                        m3: function(test) {
                            console.log('m3 argument ' + test);
                            return Promise.resolve('m3 invoked with argument ' + test);
                        }
                    });
                })
                .then(function(r) {
                    console.log(r);
                    return Promise.all([fn1(), fn2(), fn3()]).then(function() {
                        console.log('done');
                        return true;
                    });
                });
        })
        .then(() => {
            // test errors
            console.log('\nerror tests:');
            const errorsMap = {
                'error.simple': 'simple error text',
                'error.interpolation': 'interpolation {placeholder}'
            };
            const errors = worker1.publicApi.errors.registerErrors(errorsMap);
            const indent = '    ';
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
            console.log(`${indent}errors object`);
            inspect('error.simple');
            inspect('error.interpolation', {params: {placeholder: 'test'}});
        })
        .then(function() {
            worker1.destroy();
            worker2.destroy();
            master.destroy();
            return true;
        })
        .catch(() => process.exit(1));
}

test();
