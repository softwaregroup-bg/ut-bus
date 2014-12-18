var wire = require('wire');

m = wire({
    bunyan : {
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
        create:'ut-bus',
        init:'init',
        properties:{
            serverPort:3000,
            clientPort:3001,
            id:'bus',
            logger: {$ref : 'bunyan'},
            logLevel: 'trace'
        }
    },
    bus2:{
        create:'ut-bus',
        init:'init',
        properties:{
            serverPort:3001,
            clientPort:3000,
            id:'port',
            logger: {$ref : 'bunyan'},
            logLevel: 'trace'
        }
    }
}, {require:require});

m.then(function(c) {
    x = c;
    fn1 = function() {c.bus2.rpc.bus.test.m1('bus2').then(function(result) {console.log(result);});};
    fn2 = function() {c.bus2.rpc.bus.m2('bus2').then(function(result) {console.log(result);});};
    fn3 = function() {c.bus1.rpc.port.m3('bus1').then(function(result) {console.log(result);});};
    c.bus1.register({
        'test.m1':function(test) { return 'test.m1 invoked with argument ' + test;},
        m2:function(test) { return 'm2 invoked with argument ' + test;}
    }).then(function(r) {
        console.log(r);
        return c.bus2.register({
            m3:function(test) { return 'm3 invoked with argument ' + test;}
        });
    }).then(function(r) {
        console.log(r);
        fn1();
        fn2();
        fn3();
    }).catch(function(err) {
        console.log(err);
    });
}).done();
