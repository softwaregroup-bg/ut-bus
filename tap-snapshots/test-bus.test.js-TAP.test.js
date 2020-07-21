/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/bus.test.js TAP bus > m3 1`] = `
Object {
  "result": "b",
}
`

exports[`test/bus.test.js TAP bus Call errors > error.interpolation error 1`] = `
error.interpolation: interpolation test {
  "message": "interpolation test",
  "params": Object {
    "placeholder": "test",
  },
  "type": "error.interpolation",
}
`

exports[`test/bus.test.js TAP bus Call errors > error.interpolation error handler properties 1`] = `
Object {
  "properties": Array [
    Array [
      "type",
      "error.interpolation",
    ],
    Array [
      "message",
      "interpolation {placeholder}",
    ],
  ],
}
`

exports[`test/bus.test.js TAP bus Call errors > error.simple error 1`] = `
error.simple: simple error text {
  "message": "simple error text",
  "type": "error.simple",
}
`

exports[`test/bus.test.js TAP bus Call errors > error.simple error handler properties 1`] = `
Object {
  "properties": Array [
    Array [
      "type",
      "error.simple",
    ],
    Array [
      "message",
      "simple error text",
    ],
  ],
}
`

exports[`test/bus.test.js TAP bus Call errors > interpolated error 1`] = `
error.interpolation: interpolation test {
  "message": "interpolation test",
  "params": Object {
    "placeholder": "test",
  },
  "type": "error.interpolation",
}
`

exports[`test/bus.test.js TAP bus Call errors > register errors 1`] = `
Array [
  "remotes registered in broker",
]
`

exports[`test/bus.test.js TAP bus Call errors > simple error 1`] = `
error.simple: simple error text {
  "message": "simple error text",
  "type": "error.simple",
}
`

exports[`test/bus.test.js TAP bus Call methods > bus1 register 1`] = `
Array [
  "remotes registered in broker",
]
`

exports[`test/bus.test.js TAP bus Call methods > bus2 register 1`] = `
Array [
  "remotes registered in broker",
]
`

exports[`test/bus.test.js TAP bus Call methods > m1 1`] = `
Object {
  "result": Array [
    "test.m1 invoked with params",
    Object {
      "x": "bus1",
    },
    Object {
      "method": "bus2.test.m1",
      "mtid": "request",
      "opcode": "m1",
    },
  ],
}
`

exports[`test/bus.test.js TAP bus Call methods > m2 1`] = `
Object {
  "result": Array [
    "m2 invoked with params",
    "bus1",
    Object {
      "method": "bus2.m2",
      "mtid": "request",
      "opcode": "m2",
    },
  ],
}
`

exports[`test/bus.test.js TAP bus Call methods > m3 1`] = `
Object {
  "result": Array [
    "m3 invoked with params",
    "bus2",
    Object {
      "method": "bus1.m3",
      "mtid": "request",
      "opcode": "m3",
    },
  ],
}
`
