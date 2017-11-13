var create = require('ut-error').define;

var Bus = create('bus');
var UnhandledError = create('unhandledError', Bus);

module.exports = {
    bus: Bus,
    defineError: create,
    timeout: create('timeout', Bus, 'Time out'),
    methodNotFound: create('methodNotFound', Bus, 'Method {method} not found'),
    destinationNotFound: create('destinationNotFound', Bus, 'Destination {destination} not found'),
    missingMethod: create('missingMethod', Bus),
    unhandledError: function($meta) {
        var err = new UnhandledError('Unhandled Error' + ($meta.errorMessage ? ': ' + $meta.errorMessage : ''));
        if ($meta.errorCode) {
            err.code = $meta.errorCode;
        }
        return err;
    }
};
