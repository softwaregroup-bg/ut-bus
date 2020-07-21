/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/utError.test.js TAP utError > Create child error 1`] = `
parent.child: Child error {
  "message": "Child error",
  "type": "parent.child",
}
`

exports[`test/utError.test.js TAP utError > Create interpolated error 1`] = `
parent.interpolated: Error interpolated {
  "message": "Error interpolated",
  "params": Object {
    "name": "interpolated",
  },
  "type": "parent.interpolated",
}
`

exports[`test/utError.test.js TAP utError > Create interpolated error without params 1`] = `
parent.interpolated: Error ?name? {
  "message": "Error ?name?",
  "type": "parent.interpolated",
}
`

exports[`test/utError.test.js TAP utError > Create parent error 1`] = `
parent: Parent error {
  "message": "Parent error",
  "type": "parent",
}
`

exports[`test/utError.test.js TAP utError > Fetch child errors 1`] = `
Array [
  "root.child",
  "root.child.grandchild",
]
`

exports[`test/utError.test.js TAP utError > Fetch root errors 1`] = `
Array [
  "root",
  "root.child",
  "root.child.grandchild",
]
`

exports[`test/utError.test.js TAP utError > Get all errors 1`] = `
Array [
  "parent",
  "parent.child",
  "parent.interpolated",
  "root",
  "root.child",
  "root.child.grandchild",
]
`

exports[`test/utError.test.js TAP utError > Get root error 1`] = `
root: Root error {
  "message": "Root error",
  "type": "root",
}
`

exports[`test/utError.test.js TAP utError > No warning for error type 1`] = `
Array [
  "1a",
]
`

exports[`test/utError.test.js TAP utError > Registered errors 1`] = `
Array [
  "root",
  "root.child",
  "root.child.grandchild",
]
`

exports[`test/utError.test.js TAP utError > Registered matching errors 1`] = `
Array [
  "parent.child",
]
`
