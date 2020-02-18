const net = require('net');
const inject = require('reconnect-core');

module.exports = inject(function() {
    const args = [].slice.call(arguments);
    return net.connect.apply(null, args);
});
