var create = require('ut-error').define;

var Bus = create('bus');
var UnhandledError = create('unhandledError', Bus);
var Port = create('port');

module.exports = {
    bus: Bus,
    timeout: create('timeout', Bus, 'Time out'),
    methodNotFound: create('methodNotFound', Bus, 'Method {method} not found'),
    destinationNotFound: create('destinationNotFound', Bus, 'Destination {destination} not found'),
    missingMethod: create('missingMethod', Bus),
    missingParams: create('missingParameters', Port, 'Missing parameters'),
    missingMeta: create('missingMeta', Port, 'Missing metadata'),
    notConnected: create('notConnected', Port, 'No connection'),
    disconnect: create('disconnect', Port, 'Port disconnected'),
    unhandledError: function($meta) {
        var err = new UnhandledError('Unhandled Error' + ($meta.errorMessage ? ': ' + $meta.errorMessage : ''));
        if ($meta.errorCode) {
            err.code = $meta.errorCode;
        }
        return err;
    }
};
