var wire = require('wire');
var when = require('when');

var m = wire({
    master:{
        create:'../',
        init:'init',
        ready:'start',
        destroy: 'destroy',
        properties:{
            server:true,
            socket:'test',
            id:'master',
            logFactory:null,
            logLevel: 'trace'
        }
    },
    worker1:{
        create:'../',
        init:'init',
        destroy: 'destroy',
        properties:{
            server:false,
            socket:'test',
            id:'worker1',
            logFactory:null,
            logLevel: 'trace'
        }
    },
    worker2:{
        create:'../',
        init:'init',
        destroy: 'destroy',
        properties:{
            server:false,
            socket:'test',
            id:'worker2',
            logFactory:null,
            logLevel: 'trace'
        }
    }
}, {require:require});

m.then(function(c) {
    global.x = c;
    var fn1 = function() {return c.worker1.importMethod('worker2.test.m1')('worker1').then(function(result) {console.log(result);});};
    var fn2 = function() {return c.worker1.importMethod('worker2.m2')('worker1').then(function(result) {console.log(result);});};
    var fn3 = function() {return c.worker2.importMethod('worker1.m3')('worker2').then(function(result) {console.log(result);});};
    c.worker2.register({
        'test.m1': function(test) {
            console.log('test.m1 argument ' + test);
            return 'test.m1 invoked with argument ' + test;
        },
        m2: function(test) {
            console.log('m2 argument ' + test);
            return 'm2 invoked with argument ' + test;
        }
    }).then(function(r) {
        console.log(r);
        return c.worker1.register({
            m3: function(test) {
                console.log('m3 argument ' + test);
                return 'm3 invoked with argument ' + test;
            }
        });
    }).then(function(r) {
        console.log(r);
        when.all([fn1(), fn2(), fn3()]).then(function() {
            console.log('done');
            c.destroy();
        });
    }).done();
}).done();
