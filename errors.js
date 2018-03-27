const utError = require('ut-error');

module.exports = (bus) => {
    utError.init(bus);
    const create = utError.define;
    // error constructors
    const Bus = create('bus');
    const UnhandledError = create('unhandledError', Bus);

    return {
        bus: Bus,
        defineError: create,
        getError: utError.get,
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
};
