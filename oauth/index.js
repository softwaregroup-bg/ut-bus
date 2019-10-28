const jwt = require('jsonwebtoken');
module.exports = async function oauth({ key = 'ut5' } = {}) {
    return {
        routes: [
            {
                method: 'GET',
                path: '/oauth/authorize',
                options: {
                    auth: false,
                    handler: async({
                        query: {
                            response_type: responseType,
                            client_id: clientId,
                            redirect_uri: redirectUri,
                            state,
                            scope
                        }
                    }, h) => {
                        // https://www.oauth.com/oauth2-servers/authorization/the-authorization-request/
                        return h.file('authorize.html', {confine: __dirname});
                    }
                }
            },
            {
                method: 'POST',
                path: '/oauth/login',
                options: {
                    auth: false,
                    handler: async({
                        payload: {
                            client_id: clientId,
                            redirect_uri: redirectUri,
                            response_type: responseType,
                            state,
                            scope,
                            username,
                            password
                        }
                    }, h) => {
                        // verify user credentials and generate client access code
                        const code = 'sdfIUYRsdYYTdsrsdtyKGds';
                        return h.redirect(`${redirectUri}?state=${state}&code=${code}`);
                    }
                }
            },
            {
                method: 'POST',
                path: '/oauth/token',
                options: {
                    auth: false,
                    handler: async({
                        payload: {
                            client_id: clientId,
                            client_secret: clientSecret,
                            grant_type: grantType,
                            redirect_uri: redirectUri,
                            code
                        }
                    }, h) => {
                        // https://www.oauth.com/oauth2-servers/access-tokens/authorization-code-request/
                        // verify client credentials and access code and generate tokens
                        const expiresIn = 300000; // milliseconds
                        const token = jwt.sign({ test: true }, key, { expiresIn });
                        return h.response({
                            access_token: token,
                            token_type: 'bearer',
                            expires_in: expiresIn / 1000, // seconds
                            refresh_token: 'dfdsauyYTRTDsTdtstyTs',
                            scope: 'create'
                        });
                    }
                }
            }
        ]
    };
};
