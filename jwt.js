const pkg = require('./package.json');
const Boom = require('@hapi/boom');

module.exports = {
    plugin: {
        register(server, {options: {openId}, logger, errors, verify}) {
            function jose() {
                return {
                    async authenticate(request, h) {
                        try {
                            const token = request.headers.authorization && request.headers.authorization.match(/^bearer\s+(.+)$/i);
                            if (!token) throw errors['bus.jwtMissingHeader']();
                            const decoded = await verify(token[1], {issuer: openId, audience: 'ut-bus'});
                            const {
                                // standard
                                aud,
                                exp,
                                iss,
                                iat,
                                jti,
                                nbf,
                                sub: actorId,
                                // headers
                                typ,
                                cty,
                                alg,
                                // custom
                                sig: mlsk,
                                enc: mlek,
                                ses: sessionId,
                                per = '',
                                // arbitrary
                                ...rest
                            } = decoded.payload;
                            return h.authenticated({
                                credentials: {
                                    mlek,
                                    mlsk,
                                    permissionMap: Buffer.from(per, 'base64'),
                                    actorId,
                                    sessionId,
                                    ...rest
                                }
                            });
                        } catch (error) {
                            logger && logger.error && logger.error(error);
                            return h.unauthenticated(Boom.unauthorized(error.message));
                        }
                    }
                };
            }
            server.auth.scheme('jwt', jose);
            server.auth.strategy('openId', 'jwt');
            server.auth.strategy('preauthorized', 'jwt');
        },
        pkg: {
            ...pkg,
            name: 'ut-bus-jwt'
        },
        requirements: {
            hapi: '>=18'
        }
    }
};
