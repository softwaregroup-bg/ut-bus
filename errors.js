const utError = require('ut-error');
module.exports = (bus) => {
    utError.init(bus);
    const create = utError.define;
    const get = utError.get;
    const fetch = utError.fetch;

    if (!get('bus')) {
        const Bus = create('bus', undefined, 'Bus generic');
        create('timeout', Bus, 'Time out');
        create('methodNotFound', Bus, 'Method {method} not found');
        create('remoteMethodNotFound', Bus, 'Remote method not found for "{bus}"');
        create('destinationNotFound', Bus, 'Destination {destination} not found');
        create('missingMethod', Bus, 'Missing method');
        create('notInitialized', Bus, 'Not initialized');
        create('unhandledError', Bus, 'Unhandled error {errorMessage}');
    }
    function unhandledError($meta) {
        var context = {
            params: {
                errorMessage: $meta.errorMessage ? ': ' + $meta.errorMessage : ''
            }
        };
        if ($meta.errorCode) {
            context.code = $meta.errorCode;
        }
        const UnhandledError = get('bus.unhandledError');
        return new UnhandledError(context);
    };

    return Object.assign({}, fetch('bus'), {
        defineError: create,
        getError: get,
        fetchErrors: fetch,
        'bus.unhandledError': unhandledError
    });
};
