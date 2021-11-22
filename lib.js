const discoveryService = (() => {
    const cache = {};

    return async(discovery, what = 'login') => {
        if (!cache[what]) {
            cache[what] = discovery(what);
        }
        try {
            return await cache[what];
        } catch (error) {
            cache[what] = false;
            throw error;
        }
    };
})();
module.exports = {
    discoveryService,
    loginService: discoveryService,
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
    },
    requestPost(
        url,
        errorHttp,
        errorEmpty,
        headers,
        protocol,
        tls,
        request,
        payload
    ) {
        return new Promise((resolve, reject) => {
            request({
                method: 'POST',
                json: true,
                url,
                body: payload,
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
    async collectReq(req) {
        let collection = Buffer.from([]);
        return new Promise((resolve, reject) => {
            req.on('data', (d) => {
                collection = Buffer.concat([collection, d]);
            });
            req.on('end', () => resolve(collection));
        });
    }
};
