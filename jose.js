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
    oct: 'PBES2-HS256+A128KW',
    EC: 'ECDH-ES',
    RSA: 'RSA-OAEP',
    OKP: 'ECDH-ES'
};

async function importKey(jwk) {
    const alg = jwk.alg || defaultAlgByKty[jwk.kty];
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

async function sign(message, {key, alg}) {
    const payload = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
    return new jose.CompactSign(payload)
        .setProtectedHeader({alg})
        .sign(key);
}

function encrypt(jws, {key, alg}, protectedHeader, unprotectedHeader) {
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

async function signEncrypt(message, mlsk, mlekPub, protectedHeader, unprotectedHeader) {
    const jws = await sign(message, mlsk);
    return encrypt(jws, mlekPub, protectedHeader, unprotectedHeader);
}

async function decryptVerify(message, mlskPub, mlek) {
    const plaintext = await decrypt(message, mlek);
    return verify(plaintext, mlskPub);
}

module.exports = async({sign, encrypt}) => {
    const mlsk = sign && await importKey(sign);
    const mlek = encrypt && await importKey(encrypt);
    const result = {
        keys: {
            sign: sign && await exportJWK(sign),
            encrypt: encrypt && await exportJWK(encrypt)
        },
        signEncrypt: async(msg, key, protectedHeader) => mlsk ? signEncrypt(msg, mlsk, await importKey(key), protectedHeader) : msg,
        decryptVerify: async(msg, key) => mlek ? decryptVerify(msg, await importKey(key), mlek) : msg,
        decrypt: (msg, options) => mlek ? decrypt(msg, mlek, options) : msg,
        verify: async(msg, key) => verify(msg, await importKey(key))
    };
    return result;
};
