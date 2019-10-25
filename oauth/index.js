const path = require('path');
module.exports = () => {
    return {
        routes: [
            {
                method: 'GET',
                path: '/oauth/{page*}',
                options: {
                    auth: false
                },
                handler: {
                    directory: {
                        path: path.join(__dirname, 'static'),
                        index: true,
                        defaultExtension: 'html'
                    }
                }
            },
            {
                method: 'POST',
                path: '/oauth/token',
                options: {
                    auth: false,
                    handler: async(request, h) => {
                        return h.response('ok');
                    }
                }
            },
            {
                method: 'POST',
                path: '/oauth/login',
                options: {
                    auth: false,
                    handler: async({payload}, h) => {
                        return h.redirect(payload.redirect_uri);
                    }
                }
            }
        ]
    };
};
