const sortKeys = require('sort-keys');
const {ServiceBus} = require('..');
const clean = result => {
    if (result && typeof result === 'object') return sortKeys(result, {deep: true});
    return result;
};

module.exports = async(test, clientConfig, serverConfig) => {
    const client = new ServiceBus(clientConfig);
    const server = new ServiceBus(serverConfig);
    await test.test('server init', () => server.init());
    await test.test('server start', () => server.start());
    await test.test('client init', () => client.init());
    await test.test('client start', () => client.start());
    const serverApi = server.publicApi;
    const clientApi = client.publicApi;
    const errors = serverApi.registerErrors({
        'module.invalidParameter': 'Invalid parameter'
    });
    await test.test('server register', () => {
        return serverApi.register({
            'module.request': async({text}, {method}) => {
                switch (method) {
                    case 'module.entity.action': {
                        if (text) {
                            return [text.toUpperCase()];
                        } else {
                            throw errors['module.invalidParameter']();
                        }
                    }
                }
            }
        }, 'ports');
    });
    await test.test('server call success', async assert => {
        assert.matchSnapshot(clean(await clientApi.importMethod('module.entity.action')({
            text: 'hello world'
        })), 'result');
    });
    await test.test('server call error', async assert => {
        let result = clientApi.importMethod('module.entity.action')({});
        assert.rejects(result);
        try {
            await result;
        } catch (error) {
            assert.matchSnapshot(clean({...error}), 'error');
        }
    });
    await test.test('client stop', () => client.stop());
    await test.test('server stop', () => server.stop());
};
