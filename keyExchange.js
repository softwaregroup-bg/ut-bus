const pkg = require('./package.json');
module.exports = {
    plugin: {
        register(server) {
            server.auth.scheme('key-exchange', () => {
                return {
                    async authenticate(request, h) {
                        return h.authenticated({
                            credentials: {
                                mlsk: 'header',
                                mlek: 'header'
                            }});
                    }
                }
            });
            server.auth.strategy('mle', 'key-exchange');
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-key-exchange'
        },
        requirements: {
            hapi: '>=18'
        }
    }
};
