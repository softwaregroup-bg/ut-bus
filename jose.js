const jose = require('jose');

const isPlainObject = o => o?.constructor.name === 'Object' && o !== null;

async function importJWK(jwk, alg) {
    return isPlainObject(jwk) ? jose.importJWK(jwk, alg) : jwk;
}

async function exportJWK(key, priv = false) {
    const jwk = isPlainObject(key) ? key : await jose.exportJWK(key);
    if (priv) return jwk;
    const { d, p, q, dp, dq, qi, ...publicJwk } = jwk;
    return publicJwk;
}

async function sign(message, signaturePrivateKey) {
    return new jose.CompactSign(Buffer.from(JSON.stringify(message)))
        .setProtectedHeader({alg: 'ES384'})
        .sign(signaturePrivateKey);
}

function encrypt(jws, encryptionPublicKey, protectedHeader, unprotectedHeader) {
    return new jose.GeneralEncrypt(Buffer.from(jws))
        .setProtectedHeader({
            alg: 'ECDH-ES+A256KW',
            enc: 'A128CBC-HS256',
            ...protectedHeader
        })
        .setSharedUnprotectedHeader(unprotectedHeader)
        .addRecipient(encryptionPublicKey)
        .encrypt();
}

async function decrypt(encrypted, encryptionPrivateKey, options) {
    const { plaintext, protectedHeader } = encrypted.recipients
        ? await jose.generalDecrypt(encrypted, encryptionPrivateKey)
        : await jose.flattenedDecrypt(encrypted, encryptionPrivateKey);
    return options?.complete
        ? { plaintext, protectedHeader }
        : plaintext;
}

async function verify(plaintext, signaturePublicKey) {
    const { payload } = await jose.compactVerify(plaintext, signaturePublicKey);
    const decoded = new TextDecoder().decode(payload);
    return JSON.parse(decoded);
}

async function signEncrypt(message, signaturePrivateKey, encryptionPublicKey, protectedHeader, unprotectedHeader) {
    const jws = await sign(message, signaturePrivateKey);
    return encrypt(jws, encryptionPublicKey, protectedHeader, unprotectedHeader);
}

async function decryptVerify(message, signaturePublicKey, encryptionPrivateKey) {
    const plaintext = await decrypt(message, encryptionPrivateKey);
    return verify(plaintext, signaturePublicKey);
}

module.exports = async({sign, encrypt}) => {
    const mlsk = sign && await importJWK(sign, 'ES384');
    const mlek = encrypt && await importJWK(encrypt, 'ECDH-ES+A256KW');
    const result = {
        keys: {
            sign: sign && await exportJWK(sign),
            encrypt: encrypt && await exportJWK(encrypt)
        },
        signEncrypt: async(msg, key, protectedHeader) => mlsk ? signEncrypt(msg, mlsk, await importJWK(key, 'ECDH-ES+A256KW'), protectedHeader) : msg,
        decryptVerify: async(msg, key) => mlek ? decryptVerify(msg, await importJWK(key, 'ES384'), mlek) : msg,
        decrypt: (msg, options) => mlek ? decrypt(msg, mlek, options) : msg,
        verify: async(msg, key) => verify(msg, await importJWK(key, 'ES384'))
    };
    return result;
};
