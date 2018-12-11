const regExp = /\{([^}]*)\}/g;
const interpolate = (msg, params) => {
    return msg.replace(regExp, (placeholder, label) => {
        return !params || typeof params[label] === 'undefined' ? `?${label}?` : params[label];
    });
};

module.exports = bus => {
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
