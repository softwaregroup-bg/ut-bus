var create = require('ut-error').define;

var Bus = create('Bus');
var MethodNotFound = create('MethodNotFound', Bus);
var DestinationNotFound = create('DestinationNotFound', Bus);
var MissingMethod = create('MissingMethod', Bus);

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
    }
};
