let tap = require('tap');
let tests = require('./tests');

tap.test('bus', test => tests(test, {
    jsonrpc: {domain: true}
}, {
    jsonrpc: {domain: true}
}));
