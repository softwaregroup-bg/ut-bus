const swaggerValidator = require('ut-swagger2-validator');
const swaggerParser = require('swagger-parser');
const joiToJsonSchema = require('joi-to-json-schema');
const merge = require('ut-function.merge');
const Boom = require('@hapi/boom');
const Inert = require('@hapi/inert');
const Jwt = require('hapi-auth-jwt2');
const convertJoi = joiSchema => joiToJsonSchema(joiSchema, (schema, j) => {
    if (schema.type === 'array' && !schema.items) schema.items = {};
    return schema;
});

module.exports = async function swagger(server, {
    document,
    jwt: {
        key = 'ut5'
    } = {}
}, errors) {
    await server.register([Inert, Jwt]);
    server.auth.strategy('jwt', 'jwt', {
        key,
        async validate(decoded, request, h) {
            return { isValid: true };
        }
    });

    const routes = {};
    const swaggerDocument = {
        swagger: '2.0',
        info: {
            title: 'API',
            description: 'API',
            version: '1.0.0'
        },
        securityDefinitions: {
            OAuth2: {
                type: 'oauth2',
                flow: 'accessCode',
                authorizationUrl: '/oauth/authorize',
                tokenUrl: '/oauth/token',
                scopes: {
                    read: 'Grants read access',
                    write: 'Grants write access',
                    admin: 'Grants read and write access to administrative information'
                }
            }
        },
        paths: {}
    };
    switch (typeof document) {
        case 'function':
            merge(swaggerDocument, document());
            break;
        case 'string':
            merge(swaggerDocument, await swaggerParser.bundle(document));
            break;
        case 'object':
            merge(swaggerDocument, document);
            break;
        default:
            break;
    }

    await swaggerParser.validate(swaggerDocument);

    const validator = await swaggerValidator(swaggerDocument);

    const getRoutePath = path => [swaggerDocument.basePath, path].filter(x => x).join('');

    Object.entries(swaggerDocument.paths).forEach(([path, methods]) => {
        Object.entries(methods).forEach(([method, schema]) => {
            const {operationId, responses, security = []} = schema;
            if (!operationId) throw new Error('operationId must be defined');
            const successCodes = Object.keys(responses).map(x => +x).filter(code => code >= 200 && code < 300);
            if (successCodes.length !== 1) throw new Error('Exactly 1 successful HTTP status code must be defined');
            const [namespace] = operationId.split('.');
            if (!routes[namespace]) routes[namespace] = [];
            routes[namespace].push({
                method,
                path: getRoutePath(path),
                operationId,
                security,
                successCode: successCodes[0]
            });
        });
    });

    return {
        document: swaggerDocument,
        rpcRoutes: function swaggerRpcRoutes(definitions) {
            return definitions.map(({
                tags,
                app,
                timeout,
                method,
                description = method,
                notes,
                params,
                result,
                validate,
                handler
            }) => {
                const paramsSchema = (params && params.isJoi) ? convertJoi(params) : params;
                const resultSchema = (result && result.isJoi) ? convertJoi(result) : result;
                const path = '/rpc/' + method.replace(/\./g, '/');
                swaggerDocument.paths[path] = {
                    post: {
                        tags: ['rpc/' + method.split('.').shift()],
                        summary: description,
                        description: notes && [].concat(notes).join('\n'),
                        operationId: method,
                        parameters: [{
                            name: 'body',
                            in: 'body',
                            description: 'body',
                            required: true,
                            schema: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['id', 'jsonrpc', 'method', 'params'],
                                properties: {
                                    id: {
                                        schema: {
                                            oneOf: [
                                                {type: 'string'},
                                                {type: 'number'}
                                            ]
                                        },
                                        example: '1'
                                    },
                                    timeout: {
                                        type: 'number',
                                        example: null,
                                        nullable: true
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
                                    ...paramsSchema && {params: paramsSchema}
                                }
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
                                                    {type: 'string'},
                                                    {type: 'number'}
                                                ]
                                            },
                                            example: '1'
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
                                        ...resultSchema && {result: resultSchema}
                                    }
                                }
                            }
                        }
                    }
                };
                return {
                    method: 'POST',
                    path: getRoutePath(path),
                    options: {
                        auth: false,
                        app,
                        timeout,
                        description,
                        notes,
                        tags,
                        validate,
                        handler
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
                security,
                successCode
            }) => {
                const validate = validator[operationId];
                const $meta = {mtid: 'request', method: operationId};
                return {
                    method,
                    path,
                    options: {
                        auth: security.find(({OAuth2}) => OAuth2) ? 'jwt' : false,
                        handler: async(request, h) => {
                            const {params, query, payload, headers} = request;

                            const validation = await validate.request({
                                query,
                                body: payload,
                                headers,
                                pathParameters: params
                            });
                            if (validation.length > 0) throw Boom.boomify(errors['bus.swagger.requestValidation']({validation}), {statusCode: 400});

                            const msg = {
                                ...(Array.isArray(payload) ? {list: payload} : payload),
                                ...params,
                                ...query
                            };

                            let body, mtid;
                            try {
                                [body, {mtid}] = await fn.call(object, msg, $meta);
                            } catch (e) {
                                return h
                                    .response({
                                        type: e.type,
                                        message: e.message,
                                        ...e
                                    })
                                    .header('x-envoy-decorator-operation', operationId)
                                    .code(e.statusCode || 500);
                            }
                            if (mtid === 'error') {
                                const error = Boom.boomify(body instanceof Error ? body : {}, {statusCode: (body && body.statusCode) || 500});
                                error.output.headers['x-envoy-decorator-operation'] = operationId;
                                throw error;
                            }
                            const responseValidation = await validate.response({status: successCode, body});
                            if (responseValidation.length > 0) {
                                const error = Boom.boomify(errors['bus.swagger.responseValidation']({responseValidation}), {statusCode: 500});
                                error.output.headers['x-envoy-decorator-operation'] = operationId;
                                throw error;
                            }
                            return h
                                .response(body)
                                .header('x-envoy-decorator-operation', operationId)
                                .code(successCode);
                        }
                    }
                };
            });
        }
    };
};
