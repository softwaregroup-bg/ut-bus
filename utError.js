const regExp = /\{([^}]*)\}/g;
const interpolate = (msg, params) => {
    return msg.replace(regExp, (placeholder, label) => {
        return !params || typeof params[label] === 'undefined' ? `?${label}?` : params[label];
    });
};

module.exports = ({logFactory, logLevel}) => {
    var deprecationWarning = () => {};
    if (logFactory) {
        var log = logFactory.createLog(logLevel, {name: 'utError', context: 'utError'});
        if (log.warn) {
            deprecationWarning = (msg, context) => {
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
    const errors = {};
    const api = {
        get(type) { // to be removed (left for backwards compatibility)
            return type ? errors[type] : errors;
        },
        fetch(type) { // to be removed (left for backwards compatibility)
            const result = {};
            Object.keys(errors).forEach(key => {
                if (key.startsWith(type)) {
                    result[key] = errors[key];
                }
            });
            return result;
        },
        define(id, superType, message) { // to be removed (left for backwards compatibility)
            const type = [
                superType
                ? typeof superType === 'string'
                    ? superType
                    : superType.type
                : null,
                id
            ].filter(x => x).join('.');
            deprecationWarning(`Error ${id} is already defined! Type: ${type}`, {args: {id: type}, method: 'utError.define'});
            return api.register({[type]: message});
        },
        register(errorsMap) {
            return Object.keys(errorsMap).reduce((result, type) => {
                const message = errorsMap[type];
                const handler = (x, shouldThrow) => {
                    const error = new Error(interpolate(message, x && x.params));
                    Object.assign(error, {...x, type});
                    if (shouldThrow) {
                        throw error;
                    }
                    return error;
                };
                result[type] = errors[type] = Object.assign(handler, {type, message});
                return result;
            }, {});
        }
    };
    return api;
};
