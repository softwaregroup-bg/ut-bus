var create = require('ut-error').define;

var Bus = create('bus');
var MethodNotFound = create('methodNotFound', Bus);
var DestinationNotFound = create('destinationNotFound', Bus);
var MissingMethod = create('missingMethod', Bus);
var UnhandledError = create('unhandledError', Bus);
var Timeout = create('timeout', Bus);

var Port = create('port');
var MissingParams = create('missingParameters', Port, 'Missing parameters');
var MissingMeta = create('missingMeta', Port, 'Missing metadata');
var NotConnected = create('notConnected', Port, 'No connection, port: {port}');
var Disconnect = create('disconnect', Port, 'Port disconnected');

module.exports = {
    bus: cause => new Bus(cause),
    timeout: cause => new Timeout(cause),
    methodNotFound: method => new MethodNotFound({message: 'Method {method} not found', params: {method: method}}),
    destinationNotFound: destination => new DestinationNotFound({message: 'Destination {destination} not found', params: {destination: destination}}),
    missingMethod: () => new MissingMethod('Missing method'),
    missingParams: cause => new MissingParams(cause),
    missingMeta: cause => new MissingMeta(cause),
    notConnected: port => new NotConnected({params: {port}}),
    disconnect: reason => new Disconnect(reason),
    unhandledError: function($meta) {
        var err = new UnhandledError('Unhandled Error' + ($meta.errorMessage ? ': ' + $meta.errorMessage : ''));
        if ($meta.errorCode) {
            err.code = $meta.errorCode;
        }
        return err;
    },
    Disconnect
};
