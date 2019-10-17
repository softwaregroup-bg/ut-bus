const swaggerValidator = require('ut-swagger2-validator');
const swaggerParser = require('swagger-parser');

module.exports = async(swagger, errors) => {
    const routes = {};

    let document;
    switch (typeof swagger) {
        case 'function':
            document = swagger();
            break;
        case 'string':
            document = await swaggerParser.bundle(swagger);
            break;
        default:
            document = swagger;
    }

    await swaggerParser.validate(document);

    const validator = await swaggerValidator(document);

    Object.entries(document.paths).forEach(([path, methods]) => {
        const fullPath = [document.basePath, path].filter(x => x).join('');
        Object.entries(methods).forEach(([method, schema]) => {
            const {operationId, responses} = schema;
            if (!operationId) throw new Error('operationId must be defined');
            const successCodes = Object.keys(responses).filter(code => code >= 200 && code < 300);
            if (successCodes.length !== 1) throw new Error('Exactly 1 successful HTTP status code must be defined');
            const [namespace] = operationId.split('.');
            if (!routes[namespace]) routes[namespace] = [];
            routes[namespace].push({
                method,
                path: fullPath,
                operationId,
                successCode: successCodes[0]
            });
        });
    });

    return {
        document,
        routes: function swaggerRoutes({namespace, fn, object}) {
            if (!routes[namespace]) return [];
            return routes[namespace].map(({
                method,
                path,
                operationId,
                successCode
            }) => {
                const validate = validator[operationId];
                const $meta = {mtid: 'request', method: operationId};
                return {
                    method,
                    path,
                    options: {
                        auth: false,
                        handler: async(request, h) => {
                            const {params, query, payload, headers} = request;

                            const errors = await validate.request({
                                query,
                                body: payload,
                                headers,
                                pathParameters: params
                            });
                            if (errors.length > 0) return h.response(errors['bus.swagger.requestValidation']({errors})).code(400);

                            const msg = {
                                ...(Array.isArray(payload) ? {list: payload} : payload),
                                ...params,
                                ...query
                            };

                            try {
                                const [body, {mtid}] = await fn.call(object, msg, $meta);
                                if (mtid === 'error') return h.response(body).code((body && body.statusCode) || 500);
                                const errors = await validate.response({ body });
                                if (errors.length > 0) return h.response(errors['bus.swagger.responseValidation']({errors})).code(500);
                                return h.response(body).header('x-envoy-decorator-operation', operationId).code(successCode);
                            } catch (e) {
                                return h.response(e).header('x-envoy-decorator-operation', operationId).code(e.statusCode || 500);
                            }
                        }
                    }
                };
            });
        }
    };
};
