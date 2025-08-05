const typeRegex = /^[a-z]\w*(\.!?\w+)*$/;
const paramsRegex = /\{([^}]*)\}/g;
const interpolate = (regExp => (msg, params = {}) => {
    return msg.replace(regExp, (placeholder, label) => {
        return typeof params[label] === 'undefined' ? `?${label}?` : params[label];
    });
})(paramsRegex);

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

module.exports = ({logFactory, logLevel, errorPrint}) => {
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
            Object.entries(errorsMap).forEach(([type, message]) => {
                if (!typeRegex.test(type)) {
                    warn(`Invalid error type format: '${type}'!`, {
                        args: {type, expectedFormat: typeRegex.toString()},
                        method: 'utError.register'
                    });
                }
                const props = typeof message === 'string'
                    ? {message}
                    : Array.isArray(message)
                        ? {message: message[0], print: message[1]}
                        : message;
                if (!props.message) throw new Error(`Missing message for error '${type}'`);
                if (errors[type]) {
                    if (errors[type].message !== props.message) {
                        throw new Error(`Error '${type}' is already defined with different message!`);
                    }
                    result[type] = errors[type];
                    return;
                }

                if (!props.print && errorPrint) props.print = typeof errorPrint === 'string' ? errorPrint : props.message;

                const handler = (params = {}, $meta) => {
                    const error = new Error();
                    if (params instanceof Error) {
                        error.cause = params;
                    } else {
                        Object.assign(error, params);
                    }
                    Object.assign(error, props);
                    Object.defineProperty(error, 'name', {value: type, configurable: true, enumerable: false});
                    error.type = type;
                    if (props.print) error.print = props.print;
                    error.message = interpolate(props.message, params.params);
                    return $meta ? [error] : error; // to do - fix once bus.register allows to configure unpack
                };
                handler.type = type;
                handler.message = props.message;
                if (props.print) handler.print = props.print;
                handler.params = handler.message.match(paramsRegex)?.map(param => param.replace('{', '').replace('}', ''));
                result[type] = errors[type] = handler;
            });
            return result;
        },
        translate(error, translation) {
            error.originalMessage = error.message;
            if (error.params) {
                error.message = interpolate(translation, error.params);
            } else {
                error.message = translation;
            }
            error.stack = `<<<${error.message}>>>\n${error.stack}`;
            return error;
        }
    };
    return api;
};
