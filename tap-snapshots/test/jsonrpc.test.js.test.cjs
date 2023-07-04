/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/jsonrpc.test.js TAP Bus errors > server.config 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus errors > server.errors 1`] = `
Object {
  "errors": Array [
    "bus",
    "bus.actionEmpty",
    "bus.actionHttp",
    "bus.authenticationFailed",
    "bus.basicAuthEmpty",
    "bus.basicAuthHttp",
    "bus.basicAuthMissingHeader",
    "bus.bindingFailed",
    "bus.cacheFailed",
    "bus.cacheOperationMissing",
    "bus.consulServiceNotFound",
    "bus.customAuthHttp",
    "bus.destinationNotFound",
    "bus.jsonRpcEmpty",
    "bus.jsonRpcHttp",
    "bus.jwtInvalid",
    "bus.jwtInvalidKey",
    "bus.jwtMissingAssetCookie",
    "bus.jwtMissingHeader",
    "bus.mdnsResolver",
    "bus.methodNotFound",
    "bus.missingMethod",
    "bus.mleDecrypt",
    "bus.mleEncrypt",
    "bus.noMeta",
    "bus.notInitialized",
    "bus.oidcBadIssuer",
    "bus.oidcEmpty",
    "bus.oidcHttp",
    "bus.oidcNoIssuer",
    "bus.oidcNoKid",
    "bus.remoteMethodNotFound",
    "bus.requestValidation",
    "bus.responseValidation",
    "bus.securityDefinitions",
    "bus.securitySchemes",
    "bus.timeout",
    "bus.unauthorized",
    "bus.unhandledError",
    "defineError",
    "fetchErrors",
    "getError",
  ],
}
`

exports[`test/jsonrpc.test.js TAP Bus errors > server.performance after 1`] = `
Object {
  "prometheus": Function prometheus(),
}
`

exports[`test/jsonrpc.test.js TAP Bus errors > server.performance before 1`] = `
null
`

exports[`test/jsonrpc.test.js TAP Bus errors Custom error fields > Return error with custom fields configured 1`] = `
Object {
  "error": Object {
    "cause": Object {
      "message": "error cause preserved",
    },
    "message": "Invalid parameter",
    "type": "module.invalidParameter",
    "x": 1,
  },
  "id": 1,
  "jsonrpc": "2.0",
}
`

exports[`test/jsonrpc.test.js TAP Bus errors Server attach handlers > validation handlers 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getOpcode > method with # 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getOpcode > method with / 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getOpcode > method with ? 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getOpcode > method with [] 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getPath > method with # 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getPath > method with / 1`] = `
destination/module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getPath > method with ? 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus errors Server getPath > method with [] 1`] = `
module.entity.action
`
