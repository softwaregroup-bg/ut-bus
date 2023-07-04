const {Readable} = require('readable-stream');
const url = require('url');
const path = require('path');
const joi = require('joi');
const { SignJWT, generateKeyPair, exportJWK } = require('jose');
const {ServiceBus} = require('..');
const uuid = require('uuid');
const additionalServerConfig = {
    // logLevel: 'error',
    // logFactory: {
    //     createLog: () => ({
    //         error: console.error // eslint-disable-line no-console
    //     })
    // }
};
module.exports = async(test, clientConfig, serverConfig) => {
    serverConfig = {...serverConfig, ...additionalServerConfig};
    const {privateKey: key, publicKey} = await generateKeyPair('ES384', { crv: 'P-384', extractable: true});
    const jwk = {...await exportJWK(publicKey), kid: uuid.v4(), use: 'sig'};
    const api = (server, errors) => ({
        'module.request': async({text, entityId, echo, error, ...rest} = {}, $meta) => {
            const {method} = $meta;
            switch (method) {
                case 'module.entity.actionTimeout':
                case 'module.entity.actionCached':
                case 'module.entity.action': {
                    if (text) {
                        return [text.toUpperCase(), {calls: ['module.entity.action']}];
                    } else {
                        throw errors['module.invalidParameter']();
                    }
                }
                case 'module.entity.get':
                    return ['Entity ' + entityId];
                case 'module.entity.empty':
                    return;
                case 'module.entity.public':
                    if (error) throw errors['module.invalidParameter'](error);
                    return ['public'];
                case 'module.entity.echo':
                    return [echo];
                case 'module.entity.validate':
                    return [rest];
                case 'module.entity.xml':
                    if (!rest.payload.length) {
                        const error = new Error('Invalid xml');
                        error.response = '<error>Invalid xml</error>';
                        error.httpResponse = {
                            code: 400,
                            type: 'application/xml'
                        };
                        throw error;
                    }
                    return [rest.payload.toString().replace(/params>/g, 'result>'), {httpResponse: {type: 'application/xml'}}];
                case 'module.entity.file':
                    return [url.pathToFileURL(path.join(__dirname, 'file.txt'))];
                case 'module.entity.stream': {
                    const result = new Readable();
                    result.push('stream content');
                    result.push(null);
                    return [result];
                }
                default:
                    throw server.errors['bus.methodNotFound']({params: {method}});
            }
        },
        'login.request': async(params, {auth, method, httpRequest: {url}}) => {
            switch (method) {
                case 'login.identity.authenticate':
                    if (params.password === 'wrong') throw server.errors['bus.authenticationFailed']();
                    return [
                        await new SignJWT({
                            typ: 'Bearer',
                            ses: 'test',
                            per: Buffer.from([127]).toString('Base64'),
                            enc: params.encrypt,
                            sig: params.sign
                        })
                            .setProtectedHeader({ alg: 'ES384', kid: jwk.kid })
                            .setIssuedAt()
                            .setIssuer('ut-login')
                            .setAudience('ut-bus')
                            .setExpirationTime('8h')
                            .sign(key)
                    ];
                case 'login.oauth.token':
                    auth = JSON.parse(params.refresh_token); // eslint-disable-line no-fallthrough
                case 'login.identity.check':
                case 'login.identity.exchange': {
                    if (params.password === 'wrong') throw server.errors['bus.authenticationFailed']();
                    const {sign, encrypt} = server.publicApi.info();
                    return [{
                        encrypt,
                        sign,
                        token_type: 'Bearer',
                        scope: 'openid',
                        access_token: await new SignJWT({
                            typ: 'Bearer',
                            ses: 'test_exchange',
                            per: Buffer.from([127]).toString('Base64'),
                            ...auth && auth.mlek && {enc: auth.mlek},
                            ...auth && auth.mlsk && {sig: auth.mlsk}
                        })
                            .setProtectedHeader({ alg: 'ES384', kid: jwk.kid, use: jwk.use })
                            .setIssuer('ut-login')
                            .setAudience('ut-bus')
                            .setExpirationTime('3s')
                            .sign(key),
                        expires_in: 3,
                        refresh_token: auth && JSON.stringify(auth),
                        refresh_token_expires_in: 5
                    }];
                }
                case 'login.oidc.getConfiguration':
                    return [{
                        jwks_uri: new URL('../jwks', url.href).href
                    }];
                case 'login.oidc.mle': {
                    const {sign, encrypt} = server.publicApi.info();
                    return [{sign, encrypt}];
                }
                case 'login.action.map':
                    return [{
                        'module.entity.action': 1,
                        'module.entity.get': 2,
                        'module.entity.file': 3,
                        'module.entity.stream': 4,
                        'module.entity.echo': 5,
                        'module.entity.validate': 6,
                        'module.entity.xml': 7
                    }];
                case 'login.oidc.getKeys':
                    return [{keys: [jwk]}];
                default:
                    throw server.errors['bus.methodNotFound']({params: {method}});
            }
        }
    });
    const server = new ServiceBus(serverConfig);
    await test.test('Server init', () => server.init());
    const serverApi = server.publicApi;
    serverApi.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
    await test.test('Server start', () => server.start());
    const errors = serverApi.registerErrors({
        'module.invalidParameter': 'Invalid parameter'
    });
    test.matchSnapshot(serverApi.performance, 'server.performance before');
    serverApi.performance = {prometheus: () => 'sample metrics'};
    test.matchSnapshot(serverApi.performance, 'server.performance after');
    test.matchSnapshot({errors: Object.keys(serverApi.errors).sort()}, 'server.errors');
    test.matchSnapshot(serverApi.config, 'server.config');
    test.throws(() => serverApi.local, Error, 'server.local error');
    await test.test('Server register map', () => {
        return serverApi.register(api(server, errors), 'ports');
    });
    await test.test('Server register array', () => {
        return serverApi.register([
            async function get() {

            }
        ], 'ports');
    });

    await test.test('Server publish map', () => {
        return serverApi.subscribe({
            'module.publish': async(params, {method}) => 'notified ' + method
        }, 'ports');
    });

    await test.test('Server getPath', t => {
        t.matchSnapshot(serverApi.getPath('module.entity.action[0]'), 'method with []');
        t.matchSnapshot(serverApi.getPath('module.entity.action?test'), 'method with ?');
        t.matchSnapshot(serverApi.getPath('module.entity.action#test'), 'method with #');
        t.matchSnapshot(serverApi.getPath('destination/module.entity.action?test'), 'method with /');
        t.end();
    });

    await test.test('Server getOpcode', t => {
        t.matchSnapshot(serverApi.getOpcode('module.entity.action[0]'), 'method with []');
        t.matchSnapshot(serverApi.getOpcode('module.entity.action?test'), 'method with ?');
        t.matchSnapshot(serverApi.getOpcode('module.entity.action#test'), 'method with #');
        t.matchSnapshot(serverApi.getOpcode('destination/module.entity.action?test'), 'method with /');
        t.end();
    });

    await test.test('Server register local module', async() => {
        return serverApi.registerLocal({
            'login.identity.authenticate'() {
                return {
                    method: 'POST',
                    path: '/auth',
                    auth: false,
                    validate: {
                        payload: joi.object()
                    }
                };
            },
            'login.identity.exchange'() {
                return {
                    auth: 'exchange',
                    params: joi.object(),
                    result: joi.object()
                };
            },
            'login.identity.check'() {
                return {
                    auth: false,
                    params: joi.object(),
                    result: joi.object()
                };
            },
            'login.oauth.token'() {
                return {
                    method: 'POST',
                    path: '/token',
                    auth: false,
                    validate: {
                        payload: joi.object()
                    }
                };
            },
            'login.oidc.getConfiguration'() {
                return {
                    method: 'GET',
                    path: '/.well-known/openid-configuration',
                    auth: false
                };
            },
            'login.oidc.mle'() {
                return {
                    method: 'GET',
                    path: '/.well-known/mle',
                    auth: false
                };
            },
            'login.oidc.getKeys'() {
                return {
                    method: 'GET',
                    path: '/jwks',
                    auth: false
                };
            },
            'login.action.map': () => ({
                method: 'GET',
                path: '/action',
                auth: false
            })
        }, 'login.validation', {version: '1.0.0'});
    });
    await test.test('Server register local login', async() => {
        return serverApi.registerLocal({
            'module.entity.action'() {
                return {
                    params: joi.object().keys({text: joi.string()})
                };
            },
            'module.entity.get'() {
                return {
                    method: 'GET',
                    path: '/entity/{entityId}'
                };
            },
            'module.oidc.test'() {
                return {
                    params: joi.object()
                };
            },
            'module.entity.empty'() {
                return {
                };
            },
            'module.entity.public'() {
                return {
                    auth: false,
                    params: joi.object()
                };
            },
            'module.entity.echo'() {
                return {
                    params: joi.object()
                };
            },
            'module.entity.validate'() {
                return {
                    params: joi.object({
                        string: joi.string()
                    }).unknown()
                };
            },
            'module.entity.xml'() {
                return {
                    body: {
                        parse: false,
                        allow: ['application/soap+xml', 'application/xml', 'application/xop+xml', 'text/xml']
                    }
                };
            },
            'module.entity.file'() {
                return {
                    params: joi.object()
                };
            },
            'module.entity.stream'() {
                return {
                    params: joi.object()
                };
            }
        }, 'module.validation', {version: '1.0.0'});
    });
    await test.test('Server attach handlers', async assert => {
        const handlers = {};
        assert.matchSnapshot(serverApi.attachHandlers(handlers, ['module.validation']), 'validation handlers');
    });
    await test.test('Server ready', () => serverApi.ready());
    if (clientConfig) {
        const client = new ServiceBus(clientConfig);
        client.decay = {
            event1: 1000,
            event2: 0
        };
        await test.test('Client init', () => client.init());
        const clientApi = client.publicApi;
        clientApi.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
        await test.test('Client start', () => client.start());
        test.throws('Client register local max depth', () => clientApi.registerLocal({
            a: {b: {c: {d: true}}}
        }, 'client', {version: '1.0.0'}));
        clientApi.registerLocal({
            a: {b: { c: true}},
            d: [true],
            e: {}
        }, 'client', {version: '1.0.0'});
        test.matchSnapshot(client.modules, 'client.modules');
        await test.test('Client register', async() => {
            return clientApi.register({
                method() {
                    return 'local result';
                }
            }, 'client', {version: '1.0.0'});
        });
        await test.test('Client register cache', async() => {
            return clientApi.register({
                'cache.request'() {
                    return ['local result'];
                }
            }, 'ports', {version: '1.0.0'});
        });
        await test.test('Client ready', () => clientApi.ready());
        await test.test('Client notification', async assert => {
            assert.matchSnapshot(await clientApi.notification('client.method')({}), 'notification success');
        });
        await test.test('Client register new', async() => {
            clientApi.unregister(['method'], 'client');
            return clientApi.register({
                method() {
                    return 'local result new';
                }
            }, 'client', {version: '1.0.0'});
        });
        await test.test('Client call new', async assert => {
            assert.matchSnapshot(await clientApi.notification('client.method')({}), 'notification success');
        });
        await test.test('Server call success', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }, {
                timer: calls => assert.matchSnapshot(calls, 'calls')
            }), 'call with timer');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.actionTimeout', {
                timeout: 999
            })({
                text: 'hello world'
            }), 'call with timeout');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.actionCached', {
                cache: {
                    key: () => 'key',
                    before: 'get',
                    after: 'set'
                }
            })({
                text: 'hello world'
            }), 'call with cache');
            assert.matchSnapshot(await clientApi.dispatch({
                text: 'hello world'
            }, {
                mtid: 'request',
                method: 'module.entity.action'
            }), 'dispatch()');
        });
        await test.test('Server call error', async assert => {
            assert.rejects(clientApi.importMethod('module.entity.action')({}), {type: 'module.invalidParameter'}, 'error module.invalidParameter');
            assert.matchSnapshot(await clientApi.importMethod('module.entity.unknown', {
                fallback: () => 'fallback'
            })({}), 'fallback');
            assert.rejects(clientApi.importMethod('module.entity.actionCachedBad', {
                cache: {
                    key: () => 'key'
                }
            })({
                text: 'hello world'
            }), {
                type: 'bus.cacheOperationMissing'
            }, 'call with invalid cache params');
            assert.rejects(clientApi.importMethod('module.entity.action')({}, {
                timeout: Date.now() + 500,
                retry: 300
            }), {
                type: 'bus.timeout'
            }, 'retry');
            assert.rejects(clientApi.importMethod('module.entity.empty')({}), {
                type: 'bus.jsonRpcEmpty'
            }, 'call for empty result');
        });
        await test.test('Server notification', async assert => {
            assert.matchSnapshot(await clientApi.notification('module.entity.event')(), 'notification()');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event'
            }), 'dispatch()');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample init');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample skip');
            await new Promise(resolve => setTimeout(resolve, 1001));
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event1'
            }), 'dispatch() resample delay');
            assert.matchSnapshot(await clientApi.dispatch({}, {
                mtid: 'notification',
                method: 'module.entity.event',
                resample: 'event2'
            }), 'dispatch() resample disabled');
            assert.matchSnapshot(await clientApi.dispatch({}), 'dispatch() no meta');
        });
        const server2 = new ServiceBus(serverConfig);
        await test.test('Server2 init', () => server2.init());
        const server2Api = server2.publicApi;
        server2Api.registerLocal({}, 'ut-port', {name: 'ut-port', version: '6.28.0'});
        await test.test('Server2 start', () => server2.start());
        const errors2 = server2Api.registerErrors({
            'module.invalidParameter': 'Invalid parameter'
        });
        await test.test('Fill cache', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
        });
        await test.test('Server stop', () => server.stop());
        await test.test('Server2 register map', () => {
            return server2Api.register(api(server2, errors2), 'ports');
        });
        await test.test('Server2 ready', () => server2Api.ready());
        await test.test('Server moved to different port', async assert => {
            assert.matchSnapshot(await clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), 'call with object parameter');
        });
        await test.test('Server unregister', async() => server2Api.unregister(['module.request'], 'ports'));
        await test.test('Call unregistered method', async assert =>
            assert.rejects(clientApi.importMethod('module.entity.action')({
                text: 'hello world'
            }), {type: 'bus.jsonRpcHttp'}, 'call with object parameter')
        );
        await test.test('Server unregister local', async() => server2Api.unregisterLocal('module.validation'));
        await test.test('Server unsubscribe', async() => server2Api.unsubscribe(['module.publish'], 'ports'));
        await test.test('Client stop', () => client.stop());
        await test.test('Server2 stop', () => server2.stop());
    } else return server;
};
