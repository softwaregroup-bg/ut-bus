const utError = require('ut-error');
var errors;
module.exports = (bus) => {
    utError.init(bus);
    const create = utError.define;
    // error constructors
    const defineErrors = () => {
        const Bus = create('bus', undefined, 'Bus generic');
        const UnhandledError = create('unhandledError', Bus, 'Unhandled error{errorMessage}');

        return {
            bus: Bus,
            timeout: create('timeout', Bus, 'Time out'),
            methodNotFound: create('methodNotFound', Bus, 'Method {method} not found'),
            remoteMethodNotFound: create('remoteMethodNotFound', Bus, 'Remote method not found for "{bus}"'),
            destinationNotFound: create('destinationNotFound', Bus, 'Destination {destination} not found'),
            missingMethod: create('missingMethod', Bus, 'Missing method'),
            notInitialized: create('notInitialized', Bus, 'Not initialized'),
            unhandledError: function($meta) {
                var context = {
                    params: {
                        errorMessage: $meta.errorMessage ? ': ' + $meta.errorMessage : ''
                    }
                };
                if ($meta.errorCode) {
                    context.code = $meta.errorCode;
                }
                return new UnhandledError(context);
            }
        };
    };
    errors = errors || defineErrors();

    return {
        defineError: create,
        getError: utError.get,
        fetchErrors: utError.fetch,
        ...errors
    };
};
