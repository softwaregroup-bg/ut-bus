var namespace = process.argv[2];
var methods = require(process.argv[3]);
var errors = require('./errors');
process.on('message', function(data) {
    var method = methods[data.method];
    if (!method) {
        return process.send({
            // jsonrpc: '2.0',
            id: data.id,
            method: data.method,
            error: errors.methodNotFound({
                params: {
                    method: namespace + '.' + data.method
                }
            })
        });
    } else if (!(typeof method === 'function')) {
        return process.send({
            // jsonrpc: '2.0',
            id: data.id,
            method: data.method,
            error: errors.methodNotAFunction({
                params: {
                    method: namespace + '.' + data.method
                }
            })
        });
    }
    try {
        return Promise.resolve(methods[data.method](data.params))
            .then(function(result) {
                return {
                    result: result
                };
            })
            .catch(function(error) {
                return {
                    error: error
                };
            })
            .then(function(response) {
                // response.jsonrpc: '2.0';
                response.id = data.id;
                response.method = data.method;
                return process.send(response);
            });
    } catch (error) {
        return process.send({
            // jsonrpc: '2.0',
            id: data.id,
            method: data.method,
            error: error
        });
    }
});
