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
        rpcRoutes: function swaggerRpcRoutes(schemas) {
            return schemas.map(({method, params, result}) => {
                const path = '/rpc/' + method.replace(/\./g, '/');
                document.paths[path] = {
                    post: {
                        operationId: method,
                        parameters: [{
                            name: 'body',
                            in: 'body',
                            description: 'body',
                            type: 'object',
                            additionalProperties: false,
                            required: ['id', 'jsonrpc', 'method', 'params'],
                            properties: {
                                id: {
                                    schema: {
                                        oneOf: [
                                            { type: 'string', example: '1' },
                                            { type: 'number', example: 1 }
                                        ]
                                    },
                                    example: '1'
                                },
                                timeout: {
                                    type: 'number',
                                    example: null,
                                    'x-nullable': true
                                },
                                jsonrpc: {
                                    type: 'string',
                                    enum: ['2.0'],
                                    example: '2.0'
                                },
                                method: {
                                    type: 'string',
                                    enum: [method],
                                    example: method
                                },
                                params
                            }
                        }],
                        responses: {
                            default: {
                                description: 'Invalid request',
                                schema: {}
                            },
                            200: {
                                description: 'Successful response',
                                schema: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['id', 'jsonrpc', 'method'],
                                    properties: {
                                        id: {
                                            schema: {
                                                oneOf: [
                                                    { type: 'string', example: '1' },
                                                    { type: 'number', example: 1 }
                                                ]
                                            },
                                            example: '1'
                                        },
                                        timeout: {
                                            type: 'number',
                                            example: null,
                                            'x-nullable': true
                                        },
                                        jsonrpc: {
                                            type: 'string',
                                            enum: ['2.0'],
                                            example: '2.0'
                                        },
                                        method: {
                                            type: 'string',
                                            enum: [method],
                                            example: method
                                        },
                                        result: result.type ? result : {type: 'object'}
                                    }
                                }
                            }
                        }
                    }
                };
                return {
                    method: 'POST',
                    path,
                    options: {
                        auth: false,
                        handler: async(request, h) => {
                            return h.response({test: true});
                        }
                    }
                };
            });
        },
        restRoutes: function swaggerRestRoutes({namespace, fn, object}) {
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
