module.exports = {
    resolveService: (() => {
        let loginCache;

        return async(discovery, {name = 'login'} = {}) => {
            if (!loginCache) loginCache = discovery(name);
            try {
                return await loginCache;
            } catch (error) {
                loginCache = false;
                throw error;
            }
        };
    })(),
    requestGet(
        url,
        errorHttp,
        errorEmpty,
        headers,
        protocol,
        tls,
        request
    ) {
        return new Promise((resolve, reject) => {
            request({
                json: true,
                method: 'GET',
                url,
                ...tls,
                ...headers && {
                    headers: {
                        'x-forwarded-proto': headers['x-forwarded-proto'] || protocol,
                        'x-forwarded-host': headers['x-forwarded-host'] || headers.host
                    }
                }
            }, (error, response, body) => {
                if (error) {
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(errorHttp({
                        statusCode: response.statusCode,
                        statusText: response.statusText,
                        statusMessage: response.statusMessage,
                        httpVersion: response.httpVersion,
                        validation: response.body && response.body.validation,
                        debug: response.body && response.body.debug,
                        params: {
                            code: response.statusCode
                        },
                        ...response.request && {
                            req: {
                                httpVersion: response.httpVersion,
                                url: response.request.href,
                                method: response.request.method
                            }
                        }
                    }));
                } else if (body) {
                    resolve(body);
                } else {
                    reject(errorEmpty());
                }
            });
        });
    },
    requestPostForm(
        url,
        errorHttp,
        errorEmpty,
        headers,
        protocol,
        tls,
        request,
        form
    ) {
        return new Promise((resolve, reject) => {
            request({
                method: 'POST',
                url,
                form,
                ...tls,
                ...headers && {
                    headers: {
                        'x-forwarded-proto': headers['x-forwarded-proto'] || protocol,
                        'x-forwarded-host': headers['x-forwarded-host'] || headers.host
                    }
                }
            }, (error, response, body) => {
                if (error) {
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(errorHttp({
                        statusCode: response.statusCode,
                        statusText: response.statusText,
                        statusMessage: response.statusMessage,
                        httpVersion: response.httpVersion,
                        validation: response.body && response.body.validation,
                        debug: response.body && response.body.debug,
                        params: {
                            code: response.statusCode
                        },
                        ...response.request && {
                            req: {
                                httpVersion: response.httpVersion,
                                url: response.request.href,
                                method: response.request.method
                            }
                        }
                    }));
                } else if (body) {
                    resolve(body);
                } else {
                    reject(errorEmpty());
                }
            });
        });
    }
};
