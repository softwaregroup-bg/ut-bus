const tap = require('tap');
const utError = require('../utError');
const logFactory = {
    createLog: () => ({
        info: () => {},
        error: () => {},
        warn: msg => {
            throw new Error(msg);
        }
    })
};

tap.test('utError', async function test(t) {
    const apiNoLog = utError({});
    t.ok(apiNoLog, 'Create utError without logger');
    const api = utError({
        logFactory,
        logLevel: 'error'
    });
    t.ok(api, 'Create utError');
    const parent = api.define('parent', false, 'Parent error');
    t.ok(parent, 'Define parent error');
    const child = api.define('child', parent, 'Child error');
    t.ok(child, 'Define child error');
    const interpolated = api.define('interpolated', 'parent', 'Error {name}');
    t.ok(interpolated, 'Define interpolated error');
    t.matchSnapshot(parent(), 'Create parent error');
    t.matchSnapshot(child(), 'Create child error');
    t.matchSnapshot(interpolated({
        params: {
            name: 'interpolated'
        }
    }), 'Create interpolated error');
    t.matchSnapshot(interpolated(), 'Create interpolated error without params');
    t.throws(() => api.register({
        '1a': 'test'
    }), {
        message: 'Invalid error type format: \'1a\''
    }, 'Warning for error type');
    t.matchSnapshot(Object.keys(apiNoLog.register({
        '1a': 'test'
    })), 'No warning for error type');
    t.throws(() => api.register({
        test: []
    }), {
        message: 'Missing message for error \'test\''
    }, 'Missing message error');
    t.throws(() => api.register({
        parent: 'test'
    }), {
        message: 'Error \'parent\' is already defined with different message!'
    }, 'Already defined');
    t.matchSnapshot(Object.keys(api.register({
        'parent.child': 'Child error'
    })).sort(), 'Registered matching errors');
    t.matchSnapshot(Object.keys(api.register({
        root: 'Root error',
        'root.child': 'Child error',
        'root.child.grandchild': 'Grandchild error'
    })).sort(), 'Registered errors');
    t.matchSnapshot(api.get('root')(), 'Get root error');
    t.matchSnapshot(Object.keys(api.get()).sort(), 'Get all errors');
    t.matchSnapshot(Object.keys(api.fetch('root')).sort(), 'Fetch root errors');
    t.matchSnapshot(Object.keys(api.fetch('root.child')).sort(), 'Fetch child errors');
});
