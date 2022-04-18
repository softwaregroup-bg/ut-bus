const tap = require('tap');
const {generateKeyPair, CompactSign, GeneralEncrypt, FlattenedEncrypt, CompactEncrypt} = require('jose');
const jose = require('../jose');
tap.test('jose', async test => {
    const {privateKey: serverMlsk} = await generateKeyPair('ES384', { crv: 'P-384'});
    const {privateKey: serverMlek, publicKey: serverMlekPub} = await generateKeyPair('ECDH-ES+A256KW', { crv: 'P-384'});
    const {privateKey: clientMlsk, publicKey: clientMlskPub} = await generateKeyPair('ES384', { crv: 'P-384'});
    const {decryptVerify} = await jose({sign: serverMlsk, encrypt: serverMlek});

    test.test('generalDecrypt', async t => {
        const payload = {test: 'compact'};
        const jws = await new CompactSign(Buffer.from(JSON.stringify(payload)))
            .setProtectedHeader({alg: 'ES384'})
            .sign(clientMlsk);
        const jwe = await new GeneralEncrypt(Buffer.from(jws))
            .setProtectedHeader({
                alg: 'ECDH-ES+A256KW',
                enc: 'A128CBC-HS256'
            })
            .addRecipient(serverMlekPub)
            .encrypt();
        t.same(await decryptVerify(jwe, clientMlskPub), payload);
    });

    test.test('flattenedDecrypt', async t => {
        const payload = {test: 'flattened'};
        const jws = await new CompactSign(Buffer.from(JSON.stringify(payload)))
            .setProtectedHeader({alg: 'ES384'})
            .sign(clientMlsk);
        const jwe = await new FlattenedEncrypt(Buffer.from(jws))
            .setProtectedHeader({
                alg: 'ECDH-ES+A256KW',
                enc: 'A128CBC-HS256'
            })
            .encrypt(serverMlekPub);
        t.same(await decryptVerify(jwe, clientMlskPub), payload);
    });

    test.test('compactDecrypt', async t => {
        const payload = {test: 'compact'};
        const jws = await new CompactSign(Buffer.from(JSON.stringify(payload)))
            .setProtectedHeader({alg: 'ES384'})
            .sign(clientMlsk);
        const jwe = await new CompactEncrypt(Buffer.from(jws))
            .setProtectedHeader({
                alg: 'ECDH-ES+A256KW',
                enc: 'A128CBC-HS256'
            })
            .encrypt(serverMlekPub);
        t.same(await decryptVerify(jwe, clientMlskPub), payload);
    });
});
