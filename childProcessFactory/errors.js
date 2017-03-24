var create = require('ut-error').define;
var Bus = require('../errors').bus;
var ChildProcess = create('childProcess', Bus);

module.exports = {
    childProcess: ChildProcess,
    namespaceNotFound: create('namespaceNotFound', ChildProcess, 'child process namespace {namespace} not found'),
    methodNotFound: create('methodNotFound', ChildProcess, 'child process method {method} not found'),
    methodNotAFunction: create('methodNotAFunction', ChildProcess, 'child process method {method} must be a function')
};
