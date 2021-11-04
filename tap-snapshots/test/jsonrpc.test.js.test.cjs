/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/jsonrpc.test.js TAP Bus > client.modules 1`] = `
Object {
  "client": Object {
    "imported": Array [
      Array [
        Object {
          "a": Object {
            "b": Object {
              "c": true,
            },
          },
          "d": Array [
            true,
          ],
          "e": Object {},
        },
        undefined,
      ],
    ],
    "methods": Object {
      "a.b.c": true,
      "d": Array [
        true,
      ],
      "e": Object {},
    },
  },
  "ut-port": Object {
    "imported": Array [
      Array [
        Object {},
        undefined,
      ],
    ],
    "methods": Object {},
  },
}
`

exports[`test/jsonrpc.test.js TAP Bus > server.config 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus > server.errors 1`] = `
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

exports[`test/jsonrpc.test.js TAP Bus > server.performance after 1`] = `
Object {
  "prometheus": Function prometheus(),
}
`

exports[`test/jsonrpc.test.js TAP Bus > server.performance before 1`] = `
null
`

exports[`test/jsonrpc.test.js TAP Bus Client call new > notification success 1`] = `
local result new
`

exports[`test/jsonrpc.test.js TAP Bus Client notification > notification success 1`] = `
local result
`

exports[`test/jsonrpc.test.js TAP Bus Fill cache > call with object parameter 1`] = `
HELLO WORLD
`

exports[`test/jsonrpc.test.js TAP Bus Server attach handlers > validation handlers 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus Server call error > fallback 1`] = `
fallback
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > call with cache 1`] = `
local result
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > call with object parameter 1`] = `
HELLO WORLD
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > call with timeout 1`] = `
HELLO WORLD
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > call with timer 1`] = `
HELLO WORLD
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > calls 1`] = `
Array [
  "module.entity.action",
]
`

exports[`test/jsonrpc.test.js TAP Bus Server call success > dispatch() 1`] = `
Array [
  "HELLO WORLD",
  Object {
    "calls": Array [
      "module.entity.action",
    ],
  },
]
`

exports[`test/jsonrpc.test.js TAP Bus Server getOpcode > method with # 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus Server getOpcode > method with / 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus Server getOpcode > method with ? 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus Server getOpcode > method with [] 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus Server getPath > method with # 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus Server getPath > method with / 1`] = `
destination/module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus Server getPath > method with ? 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus Server getPath > method with [] 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus Server moved to different port > call with object parameter 1`] = `
HELLO WORLD
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() 1`] = `
notified module.entity.event
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() no meta 1`] = `
false
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() resample delay 1`] = `
notified module.entity.event
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() resample disabled 1`] = `
true
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() resample init 1`] = `
notified module.entity.event
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > dispatch() resample skip 1`] = `
true
`

exports[`test/jsonrpc.test.js TAP Bus Server notification > notification() 1`] = `
notified module.entity.event
`

exports[`test/jsonrpc.test.js TAP Bus routes > server.config 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus routes > server.errors 1`] = `
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

exports[`test/jsonrpc.test.js TAP Bus routes > server.performance after 1`] = `
Object {
  "prometheus": Function prometheus(),
}
`

exports[`test/jsonrpc.test.js TAP Bus routes > server.performance before 1`] = `
null
`

exports[`test/jsonrpc.test.js TAP Bus routes File > Return file 1`] = `
file content
`

exports[`test/jsonrpc.test.js TAP Bus routes Forbidden > Return 403 1`] = `
Object {
  "error": "Forbidden",
  "message": "Operation module.entity.empty is not allowed for this user",
  "statusCode": 403,
}
`

exports[`test/jsonrpc.test.js TAP Bus routes Forbidden > Return 404 1`] = `
Object {
  "error": "Not Found",
  "message": "Not Found",
  "statusCode": 404,
}
`

exports[`test/jsonrpc.test.js TAP Bus routes JSON RPC > Return JSON RPC response 1`] = `
Object {
  "id": 1,
  "jsonrpc": "2.0",
  "result": "JSON RPC 2.0",
}
`

exports[`test/jsonrpc.test.js TAP Bus routes Login > Return valid JWT 1`] = `
Object {
  "aud": "ut-bus",
  "enc": Object {
    "crv": "P-384",
    "kty": "EC",
    "use": "enc",
  },
  "iss": "ut-login",
  "per": "Dw==",
  "ses": "test",
  "sig": Object {
    "crv": "P-384",
    "kty": "EC",
    "use": "sig",
  },
  "typ": "Bearer",
}
`

exports[`test/jsonrpc.test.js TAP Bus routes Metrics > Return metrics 1`] = `
sample metrics
`

exports[`test/jsonrpc.test.js TAP Bus routes OIDC auth > Return entity 1`] = `
Object {
  "error": "Unauthorized",
  "message": "Invalid authentication (signature verification failed)",
  "statusCode": 401,
}
`

exports[`test/jsonrpc.test.js TAP Bus routes OIDC no auth > Return entity 1`] = `
Object {
  "error": "Unauthorized",
  "message": "Missing bearer authorization header",
  "statusCode": 401,
}
`

exports[`test/jsonrpc.test.js TAP Bus routes REST > Return entity 1`] = `
Entity 1
`

exports[`test/jsonrpc.test.js TAP Bus routes Server attach handlers > validation handlers 1`] = `
undefined
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getOpcode > method with # 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getOpcode > method with / 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getOpcode > method with ? 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getOpcode > method with [] 1`] = `
action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getPath > method with # 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getPath > method with / 1`] = `
destination/module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getPath > method with ? 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus routes Server getPath > method with [] 1`] = `
module.entity.action
`

exports[`test/jsonrpc.test.js TAP Bus routes Stream > Return stream 1`] = `
stream content
`
