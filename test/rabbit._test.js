const tap = require('tap');
const tests = require('./tests');
const id = require('uuid').v4();
const channel = 'impl-test';
const rabbot = {
    connection: {
        server: '192.168.133.104',
        port: 5672,
        user: 'admin',
        pass: 'admin'
    },
    _debug: true
};

tap.test('bus', test => tests(test, {
    rabbot,
    id,
    channel,
    logLevel: 'trace'
}, {
    rabbot,
    id,
    channel,
    logLevel: 'trace'
}));
