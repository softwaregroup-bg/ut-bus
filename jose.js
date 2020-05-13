const { JWS, JWE, JWK } = require('jose');

function signEncrypt(message, signaturePrivateKey, encryptionPublicKey, protectedHeader, unprotectedHeader) {
    const jwe = new JWE.Encrypt(JWS.sign(message, signaturePrivateKey), protectedHeader, unprotectedHeader);
    [].concat(encryptionPublicKey).forEach(key => jwe.recipient(...[].concat(key)));
    return jwe.encrypt('general');
}

function decryptVerify(message, signaturePublicKey, encryptionPrivateKey) {
    return JWS.verify(JWE.decrypt(message, encryptionPrivateKey).toString(), signaturePublicKey);
}

module.exports = ({sign, encrypt}) => {
    const encryptionPrivateKey = encrypt && JWK.asKey(encrypt);
    const signaturePrivateKey = sign && JWK.asKey(sign);
    return {
        encrypt: (message, key) => sign ? signEncrypt(message, signaturePrivateKey, JWK.asKey(key)) : message,
        decrypt: (message, key) => encrypt ? decryptVerify(message, JWK.asKey(key), encryptionPrivateKey) : message
    };
};
