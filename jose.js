const { JWS, JWE, JWK } = require('jose');

function signEncrypt(message, signaturePrivateKey, encryptionPublicKey, protectedHeader, unprotectedHeader) {
    const jwe = new JWE.Encrypt(JWS.sign(Buffer.isBuffer(message) ? message : JSON.stringify(message), signaturePrivateKey), protectedHeader, unprotectedHeader);
    [].concat(encryptionPublicKey).forEach(key => jwe.recipient(...[].concat(key)));
    return jwe.encrypt('general');
}

function decrypt(message, encryptionPrivateKey, options) {
    return JWE.decrypt(message, encryptionPrivateKey, options);
}

function verify(decrypted, signaturePublicKey) {
    return JWS.verify(decrypted.toString(), signaturePublicKey);
}

function decryptVerify(message, signaturePublicKey, encryptionPrivateKey) {
    return verify(decrypt(message, encryptionPrivateKey), signaturePublicKey);
}

module.exports = ({sign, encrypt}) => {
    const encryptionPrivateKey = encrypt && JWK.asKey(encrypt);
    const signaturePrivateKey = sign && JWK.asKey(sign);
    return {
        keys: {
            sign: sign && signaturePrivateKey.toJWK(),
            encrypt: encrypt && encryptionPrivateKey.toJWK()
        },
        signEncrypt: (message, key) => sign ? signEncrypt(message, signaturePrivateKey, JWK.asKey(key)) : message,
        decryptVerify: (message, key) => encrypt ? decryptVerify(message, JWK.asKey(key), encryptionPrivateKey) : message,
        decrypt: (message, options) => encrypt ? decrypt(message, encryptionPrivateKey, options) : message,
        verify
    };
};
