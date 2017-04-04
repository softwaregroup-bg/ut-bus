var fork = require('child_process').fork;
var childProcessPath = require('path').join(__dirname, 'childProcess');
var debugMode = process.execArgv.filter((arg) => arg.startsWith('--debug')).length > 0;
var net = require('net');
var errors = require('./errors');

function getRandomPort() {
    return new Promise(function(resolve, reject) {
        var server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, function() {
            var port = server.address().port;
            server.close(function() {
                resolve(port);
            });
        });
    });
}

function childProcessFactory() {
    var childProcesses = {};
    var callbacks = {};
    var requestId = 0;
    return {
        registerChildProcess: function(namespace, modulePath) {
            var promise = Promise.resolve();
            var childProcess;
            if (debugMode) {
                promise = promise
                    .then(() => getRandomPort())
                    .then((port) => {
                        childProcess = fork(childProcessPath, [namespace, modulePath], {
                            execArgv: ['--debug=' + port]
                        });
                        return true;
                    });
            } else {
                childProcess = fork(childProcessPath, [namespace, modulePath]);
            }
            return promise
                .then(function() {
                    childProcess.on('message', function(response) {
                        var callback = callbacks[response.id];
                        if (callback) {
                            delete callbacks[response.id];
                            callback(response);
                        }
                    });
                    childProcesses[namespace] = childProcess;
                    return true;
                });
        },
        importMethod: function(methodName) {
            var tokens = methodName.split('.');
            var namespace = tokens.shift();
            var method = tokens.join('.');
            return function(params) {
                if (!childProcesses[namespace]) {
                    return Promise.reject(errors.namespaceNotFound({
                        params: {
                            namespace: namespace
                        }
                    }));
                }
                return new Promise(function(resolve, reject) {
                    if (requestId === Number.MAX_SAFE_INTEGER) {
                        requestId = 0;
                    }
                    callbacks[++requestId] = function(response) {
                        return response.error ? reject(response.error) : resolve(response.result);
                    };
                    childProcesses[namespace].send({
                        // jsonrpc: '2.0',
                        method: method,
                        id: requestId,
                        params: params
                    });
                });
            };
        }
    };
}

module.exports = {
    getInstance: function() {
        return childProcessFactory();
    }
};
