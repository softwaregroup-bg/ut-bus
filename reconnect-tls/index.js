var tls = require('tls');
var inject = require('reconnect-core');

module.exports = inject(function () {
    var args = [].slice.call(arguments);
    return tls.connect.apply(null, args);
});
