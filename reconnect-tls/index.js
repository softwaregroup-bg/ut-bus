const tls = require('tls');
const inject = require('reconnect-core');

module.exports = inject(function() {
    const args = [].slice.call(arguments);
    return tls.connect.apply(null, args);
});
