const jose = require('jose');
const isKey = (isBrowser => {
    if (isBrowser) {
        return o => {
            return typeof o === 'object' &&
                typeof o.extractable === 'boolean' &&
                typeof o.algorithm?.name === 'string' &&
                typeof o.type === 'string';
        };
    } else {
        const {types: {isKeyObject, isCryptoKey}} = require('util');
        const {KeyObject} = require('crypto');
        return isKeyObject
            ? o => isKeyObject(o)
            : KeyObject
                ? o => o instanceof KeyObject
                : isCryptoKey
                    ? o => isCryptoKey(o)
                    : o => typeof o === 'object' && o.constructor !== Object && typeof o.type === 'string';
    }
})(global.window || process.type === 'renderer');

// idea borrowed from jose 2: https://github.com/panva/jose/blob/v2.x/lib/jwe/encrypt.js#L92
const defaultAlgByKty = {
    oct: {
        sig: 'HS384',
        enc: 'A256KW'
    },
    EC: {
        sig: 'ES384',
        enc: 'ECDH-ES+A256KW'
    },
    RSA: {
        sig: 'RS384',
        enc: 'RSA-OAEP'
    },
    OKP: {
        sig: 'EdDSA',
        enc: 'ECDH-ES+A256KW'
    }
};

async function importKey(jwk, defaultUse = 'enc') {
    const {
        kty,
        use = defaultUse,
        alg = defaultAlgByKty[kty]?.[use]
    } = isKey(jwk) ? await exportJWK(jwk) : jwk;

    return {
        key: isKey(jwk) ? jwk : await jose.importJWK(jwk, alg),
        alg
    };
}

async function exportJWK(key, priv = false) {
    const jwk = isKey(key) ? await jose.exportJWK(key) : key;
    if (!jwk.kid) jwk.kid = await jose.calculateJwkThumbprint(jwk);
    if (priv) return jwk;
    const { d, p, q, dp, dq, qi, ...publicJwk } = jwk;
    return publicJwk;
}

async function sign(message, {key, alg}, options) {
    const payload = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    switch (options?.serialization) {
        case 'general':
            return new jose.GeneralSign(payload)
                .addSignature(key)
                .setProtectedHeader({alg})
                .sign();
        case 'flattened':
            return new jose.FlattenedSign(payload)
                .setProtectedHeader({alg})
                .sign(key);
        default:
            return new jose.CompactSign(payload)
                .setProtectedHeader({alg})
                .sign(key);
    }
}

function encrypt(jws, {key, alg}, protectedHeader, unprotectedHeader, options) {
    switch (options?.serialization) {
        case 'compact':
            return new jose.CompactEncrypt(Buffer.from(jws))
                .setProtectedHeader({
                    alg,
                    enc: 'A128CBC-HS256',
                    ...protectedHeader
                })
                .encrypt(key);
        case 'flattened':
            return new jose.FlattenedEncrypt(Buffer.from(jws))
                .setProtectedHeader({
                    alg,
                    enc: 'A128CBC-HS256',
                    ...protectedHeader
                })
                .encrypt(key);
        default:
            return new jose.GeneralEncrypt(Buffer.from(jws))
                .setProtectedHeader({
                    alg,
                    enc: 'A128CBC-HS256',
                    ...protectedHeader
                })
                .setSharedUnprotectedHeader(unprotectedHeader)
                .addRecipient(key)
                .encrypt();
    }
}

async function decrypt(jwe, {key}, options) {
    const { plaintext, protectedHeader } = typeof jwe === 'string'
        ? await jose.compactDecrypt(jwe, key)
        : jwe.recipients
            ? await jose.generalDecrypt(jwe, key)
            : await jose.flattenedDecrypt(jwe, key);
    return options?.complete
        ? { plaintext, protectedHeader }
        : plaintext;
}

async function verify(plaintext, {key}) {
    const { payload } = await jose.compactVerify(plaintext, key);
    const decoded = new TextDecoder().decode(payload);
    return JSON.parse(decoded);
}

async function signEncrypt(message, mlsk, mlekPub, protectedHeader, unprotectedHeader, options) {
    const jws = await sign(message, mlsk, options?.sign);
    return encrypt(jws, mlekPub, protectedHeader, unprotectedHeader, options?.encrypt);
}

async function decryptVerify(message, mlskPub, mlek) {
    const plaintext = await decrypt(message, mlek);
    return verify(plaintext, mlskPub);
}

module.exports = async({sign, encrypt}) => {
    const mlsk = sign && await importKey(sign, 'sig');
    const mlek = encrypt && await importKey(encrypt, 'enc');
    const result = {
        keys: {
            sign: sign && await exportJWK(sign),
            encrypt: encrypt && await exportJWK(encrypt)
        },
        signEncrypt: async(msg, key, protectedHeader, unprotectedHeader, options) => mlsk
            ? signEncrypt(msg, mlsk, await importKey(key, 'enc'), protectedHeader, unprotectedHeader, options)
            : msg,
        decryptVerify: async(msg, key) => mlek ? decryptVerify(msg, await importKey(key, 'sig'), mlek) : msg,
        decrypt: (msg, options) => mlek ? decrypt(msg, mlek, options) : msg,
        verify: async(msg, key) => verify(msg, await importKey(key, 'sig'))
    };
    return result;
};
