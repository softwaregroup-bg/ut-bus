var create = require('ut-error').define;

var Bus = create('bus');
var MethodNotFound = create('methodNotFound', Bus);
var DestinationNotFound = create('destinationNotFound', Bus);
var MissingMethod = create('missingMethod', Bus);
var UnhandledError = create('unhandledError', Bus);
var Port = create('port');
var MissingParams = create('missingParameters', Port, 'Missing parameters');
var MissingMeta = create('missingMeta', Port, 'Missing metadata');
var NotConnected = create('notConnected', Port, 'No connection, port: {port}');

module.exports = {
    bus: function(cause) {
        return new Bus(cause);
    },
    methodNotFound: function(method) {
        return new MethodNotFound({message: 'Method {method} not found', params: {method: method}});
    },
    destinationNotFound: function(destination) {
        return new DestinationNotFound({message: 'Destination {destination} not found', params: {destination: destination}});
    },
    missingMethod: function() {
        return new MissingMethod('Missing method');
    },
    unhandledError: function($meta) {
        var err = new UnhandledError('Unhandled Error' + ($meta.errorMessage ? ': ' + $meta.errorMessage : ''));
        if ($meta.errorCode) {
            err.code = $meta.errorCode;
        }
        return err;
    },
    missingParams: function(cause) {
        return new MissingParams(cause);
    },
    missingMeta: function(cause) {
        return new MissingMeta(cause);
    },
    notConnected: function(port) {
        return new NotConnected({params: {port}});
    }
};
