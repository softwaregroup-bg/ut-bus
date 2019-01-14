const typeRegex = /^[a-z]\w*(\.!?\w+)*$/;

const interpolate = (regExp => (msg, params = {}) => {
    return msg.replace(regExp, (placeholder, label) => {
        return typeof params[label] === 'undefined' ? `?${label}?` : params[label];
    });
})(/\{([^}]*)\}/g);

const getWarnHandler = ({logFactory, logLevel}) => {
    if (logFactory) {
        const log = logFactory.createLog(logLevel, {name: 'utError', context: 'utError'});
        if (log.warn) {
            return (msg, context) => {
                const e = new Error();
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

module.exports = ({logFactory, logLevel}) => {
    const warn = getWarnHandler({logFactory, logLevel});
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
            const result = {};
            Object.keys(errorsMap).forEach(type => {
                if (!typeRegex.test(type)) {
                    warn(`Invalid error type format: '${type}'!`, {
                        args: {type, expectedFormat: typeRegex.toString()},
                        method: 'utError.register'
                    });
                }
                if (errors[type]) {
                    if (errors[type].message !== errorsMap[type]) {
                        throw new Error(`Error '${type}' is already defined with different message!`);
                    }
                    result[type] = errors[type];
                    return;
                }
                const message = errorsMap[type];
                const handler = (x = {}, $meta) => {
                    const error = new Error();
                    if (x instanceof Error) {
                        error.cause = x;
                    } else {
                        Object.assign(error, x);
                    }
                    error.type = type;
                    error.message = interpolate(message, x.params);
                    return $meta ? [error] : error; // to do - fix once bus.register allows to configure unpack
                };
                handler.type = type;
                handler.message = message;
                result[type] = errors[type] = handler;
            });
            return result;
        }
    };
    return api;
};
