var wire = require('wire');
var when = require('when');

var m = wire({
    log : {
        create : {
            module  : 'ut-log',
            args    : {
                type : 'bunyan',
                name : 'bunyan_test',
                streams :  [
                    {
                        level: 'trace',
                        stream: 'process.stdout'
                    }
                ]
            }
        }
    },
    bus1:{
        create:'../',
        init:'init',
        destroy: 'destroy',
        properties:{
            server:true,
            socket:'test',
            id:'bus',
            logFactory:{$ref:'log'},
            logLevel: 'trace'
        }
    },
    bus2:{
        create:'../',
        init:'init',
        destroy: 'destroy',
        properties:{
            server:false,
            socket:'test',
            id:'port',
            logFactory:{$ref:'log'},
            logLevel: 'trace'
        }
    }
}, {require:require});

m.then(function(c) {
    global.x = c;
    var fn1 = function() {return c.bus2.req.bus.test.m1('bus2').then(function(result) {console.log(result);});};
    var fn2 = function() {return c.bus2.req.bus.m2('bus2').then(function(result) {console.log(result);});};
    var fn3 = function() {return c.bus1.req.port.m3('bus1').then(function(result) {console.log(result);});};
    setTimeout(function() {
        c.bus1.register({
            'test.m1': function(test) {
                return 'test.m1 invoked with argument ' + test;
            },
            m2: function(test) {
                return 'm2 invoked with argument ' + test;
            }
        }).then(function(r) {
            console.log(r);
            return c.bus2.register({
                m3: function(test) {
                    return 'm3 invoked with argument ' + test;
                }
            });
        }).then(function(r) {
            console.log(r);
            when.all([fn1(), fn2(), fn3()]).then(function() {
                c.destroy();
            });
        }).done();
    }, 1000);
}).done();
