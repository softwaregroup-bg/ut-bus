var create = require('errno').custom.createError;

var BusError = create('BusError');

module.exports = {
    busError: function(cause) {
        return new BusError('Bus error', cause);
    }
};
