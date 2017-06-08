/* eslint no-console:0, no-process-exit:0 */

var assign = require('lodash.assign');
var Bus = require('../');

var master = assign(new Bus(), {
    server: true,
    logLevel: 'trace',
    socket: 'test',
    id: 'master',
    logFactory: null
});

var worker1 = assign(new Bus(), {
    server: false,
    logLevel: 'trace',
    socket: 'test',
    id: 'worker1',
    logFactory: null
});

var worker2 = assign(new Bus(), {
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
                return 'test.m1 invoked with argument ' + test;
            },
            m2: function(test) {
                console.log('m2 argument ' + test);
                return 'm2 invoked with argument ' + test;
            }
        })
        .then(function(r) {
            console.log(r);
            return worker1.register({
                m3: function(test) {
                    console.log('m3 argument ' + test);
                    return 'm3 invoked with argument ' + test;
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
    .then(function() {
        worker1.destroy();
        worker2.destroy();
        master.destroy();
        return true;
    });
}

test();
