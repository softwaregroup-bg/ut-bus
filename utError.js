const typeRegex = /^[a-z]\w+(\.\w)*$/;

const interpolate = (regExp => (msg, params = {}) => {
    return msg.replace(regExp, (placeholder, label) => {
        return typeof params[label] === 'undefined' ? `?${label}?` : params[label];
    });
})(/\{([^}]*)\}/g);

const getWarnHandler = ({logFactory, logLevel}) => {
    if (logFactory) {
        var log = logFactory.createLog(logLevel, {name: 'utError', context: 'utError'});
        if (log.warn) {
            return (msg, context) => {
                var e = new Error();
                log.warn(msg, {
                    $meta: {
                        mtid: 'deprecation',
                        method: context.method
                    },
                    args: context.args,
                    error: {
                        type: 'utError.deprecation',
                        stack: e.stack.split('\n').splice(3).join('\n')
                    }
                });
            };
        }
    }
    return () => {};
};

module.exports = bus => {
    const warn = getWarnHandler(bus);
    const errors = {};
    const api = {
        get(type) {
            return type ? errors[type] : errors;
        },
        fetch(type) {
            const result = {};
            Object.keys(errors).forEach(key => {
                if (key.startsWith(type)) {
                    result[key] = errors[key];
                }
            });
            return result;
        },
        define(id, superType, message) {
            const type = [
                superType
                ? typeof superType === 'string'
                    ? superType
                    : superType.type
                : null,
                id
            ].filter(x => x).join('.');
            return api.register({[type]: message})[type];
        },
        register(errorsMap) {
            return Object.keys(errorsMap).reduce((result, type) => {
                if (!typeRegex.test(type)) {
                    warn(`Invalid type: '${type}'!`, {
                        args: {actual: type, expected: typeRegex},
                        method: 'utError.register'
                    });
                }
                if (errors[type]) {
                    warn(`Error '${type}' is already defined!`, {
                        args: {type},
                        method: 'utError.register'
                    });
                }
                const message = errorsMap[type];
                const handler = (x = {}, $meta) => {
                    const error = new Error();
                    Object.assign(error, { ...x, type, message: interpolate(message, x.params) });
                    return $meta ? [error] : error; // to do - fix once bus.register allows to configure unpack
                };
                result[type] = errors[type] = Object.assign(handler, {type, message});
                return result;
            }, {});
        }
    };
    return api;
};
