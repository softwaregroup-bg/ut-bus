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

async function importKey(jwk, alg) {
    return {
        key: isKey(jwk) ? jwk : await jose.importJWK(jwk, alg),
        alg: jwk.alg || alg
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
    return new jose.CompactSign(Buffer.from(JSON.stringify(message)))
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

async function decrypt(encrypted, {key}, options) {
    const { plaintext, protectedHeader } = encrypted.recipients
        ? await jose.generalDecrypt(encrypted, key)
        : await jose.flattenedDecrypt(encrypted, key);
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

module.exports = async({sign, encrypt, defaultSigAlg = 'ES384', defaultEncAlg = 'ECDH-ES+A256KW'}) => {
    const mlsk = sign && await importKey(sign, defaultSigAlg);
    const mlek = encrypt && await importKey(encrypt, defaultEncAlg);
    const result = {
        keys: {
            sign: sign && await exportJWK(sign),
            encrypt: encrypt && await exportJWK(encrypt)
        },
        signEncrypt: async(msg, key, protectedHeader) => mlsk ? signEncrypt(msg, mlsk, await importKey(key, defaultEncAlg), protectedHeader) : msg,
        decryptVerify: async(msg, key) => mlek ? decryptVerify(msg, await importKey(key, defaultSigAlg), mlek) : msg,
        decrypt: (msg, options) => mlek ? decrypt(msg, mlek, options) : msg,
        verify: async(msg, key) => verify(msg, await importKey(key, defaultSigAlg))
    };
    return result;
};
