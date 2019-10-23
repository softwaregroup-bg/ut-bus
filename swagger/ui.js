const uiDistPath = require('swagger-ui-dist').getAbsoluteFSPath();
const uiPath = '/docs';
const path = require('path');
require('inert');

module.exports = swaggerDocument => {
    return {
        routes: [{
            method: 'GET',
            path: `${uiPath}/swagger.json`,
            options: {
                auth: false,
                handler: (request, h) => h.response(swaggerDocument).type('application/json')
            }
        }, {
            method: 'GET',
            path: `${uiPath}`,
            options: {
                auth: false,
                handler: (request, h) => h.redirect(uiPath + '/')
            }
        }, {
            method: 'GET',
            path: `${uiPath}/{page*}`,
            options: {auth: false},
            handler: {
                directory: {
                    path: path.join(__dirname, 'docs'),
                    index: true,
                    defaultExtension: 'html'
                }
            }
        }, {
            method: 'GET',
            path: `${uiPath}/ui/{page*}`,
            options: {auth: false},
            handler: {
                directory: {
                    path: uiDistPath,
                    index: false
                }
            }
        }]
    };
};
