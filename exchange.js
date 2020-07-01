const pkg = require('./package.json');
module.exports = {
    plugin: {
        register(server) {
            server.auth.scheme('exchange-scheme', () => {
                return {
                    async authenticate(request, h) {
                        return h.authenticated({
                            credentials: {
                                mlsk: 'header',
                                mlek: 'header'
                            }
                        });
                    }
                };
            });
            server.auth.strategy('exchange', 'exchange-scheme');
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-exchange'
        },
        requirements: {
            hapi: '>=18'
        }
    }
};
