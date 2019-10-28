module.exports = () => {
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
                        return h.redirect(`${redirectUri}?state=${state}&code=h1YHZmNkWnPXJ`);
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
                        return h.response({
                            access_token: 'sdfIUYRsdYYTdsrsdtyKGds',
                            token_type: 'bearer',
                            expires_in: 3600,
                            refresh_token: 'dfdsauyYTRTDsTdtstyTs',
                            scope: 'create'
                        });
                    }
                }
            }
        ]
    };
};
