# UT Bus

## Transports

ut-bus supports the following transports:

* [hemera](###hemera)
* [jsonrpc](###jsonrpc)
* [rabbot](###rabbot)
* [moleculer](###moleculer)
* [utRpc](###utRpc)

### hemera

[Hemera repo](https://github.com/hemerajs/hemera)

#### configuration options

Check [hemera config schema](https://github.com/hemerajs/hemera/blob/master/packages/hemera/lib/configScheme.js)
for all options.

In addition to all the options you can also pass a `nats` property which will
be used for the nats connection.
Check the [Nats connect options](https://github.com/nats-io/nats.js?utm_source=recordnotfound.com#connect-options)

Configuration example:

```js
{
    utBus: {
        serviceBus: {
            hemera: {
                ...hemeraOptions,
                nats: {
                    ...natsConnectOptions
                }
            }
        }
    }
}
```

### jsonrpc

http transport over json-rpc 2.0 protocol.

#### jsonrpc configuration options

* `port` (number) [optional] - tcp port. If omitted then a random port will be used.
* `openId` (array) [optional] - a list of openId providers.
* `maxBytes` (number) [optional] - maximum size of the request body
  (the default is 1MB coming from hapi).
* `api` (object) [optional] - swagger configuration.
  * `ui` (boolean | object) [optional]
    * `base` (string) [optional] - ui path prefix (default '/api')
    * `initOAuth` (object) [optional] - swagger ui OAuth credentials
      * `clientId` (string) - pre-populated in swagger ui auth interface
      * `clientSecret` (string) - pre-populated in swagger ui auth interface
* `domain` (string | boolean) [optional] - Enables dns discovery and uses this
  property as a top-level domain to use for records. (both regular or multi-cast
  discovery mechanisms are supported).
  If set to `true` then machine's hostname will be used as a top-level domain
* `consul` (object) [optional] - used for configuring a [consul client](https://github.com/silas/node-consul)
  in case [`Consul`](https://www.consul.io/) service discovery is required.
  For reference check [consul client options](https://github.com/silas/node-consul#consuloptions)
* `prefix` (string) [optional] - prefix to be used in conjunction
  with the namespace to construct a `host` when resolving
  service locations. (e.g. host will become `prefix + namespace`)
* `suffix` (string) [optional] - suffix to be used in conjunction
  with the namespace to construct a `host` when resolving
  service locations. (e.g. host will become `namespace + suffix`)
* `capture` (string) [optional] - enable capturing of requests and responses in
  individual `<capture>/*.http` files for debugging purposes.
  Note that this is not suitable for use in production and the folder
  specified in this setting must exist. Also due to hapi API constraints,
  some validations are turned off when capture is activated.
* `gateway` (object) [optional] - call remote methods from bus running within different
  security context. This is an easy way to integrate two separate implementations
  where the gateway calls the other side with dedicated credentials for server to
  server calls.
  * `<prefix>` (object) - configuration to apply for calls with this prefix, i.e.
  calls like `utMethod('prefix/x.x.x')(...params)`
    * `url` - specifies the base URL of the remote bus. This is alternative to
    specifying the individual configuration options below, as all of them can
    form an URL `https://username:passsword@example.com`
    * `protocol` - remote bus protocol
    * `host`  - remote bus host
    * `port`  - remote bus port
    * `username` - specifies a username to use for authentication against
    the remote bus
    * `password` - specifies a password to use for authentication against
    the remote bus
* `tls` (object) [optional] - can be used to enable TLS. Accepts any of the options
  passed to node.js [https.createServer](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener)
  Specifically, the following options, are interpreted as filesystem paths:
  * `cert` - Server certificate
  * `key` - Server private key
  * `ca` - Trusted root certificate for mutual TSL with self signed
  (client) certificates. To enable mutual TLS, use this option
  together with setting `tls.requestCert` to `true`.
  * `crl` - certificate revocation lists

  For more information consult [tls.createSecureContext](https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options).
* `cors` (object | boolean) [optional] - Enables cors for all routes.
  Additional place where cors can be enabled or/and overwritten
  is in validations. For detailed configuration, see docs for hapi `route.options.cors`
* `security` (object | boolean) [optional] - Enables security headers on all routes.
  For detailed configuration, see docs for hapi `route.options.security`
* `client` (object) [optional] - HTTP/HTTPS client configuration options:
  * `client.tls` (object) [optional] - use this option to enable
  TLS or mutual TLS for bus to bus communication.
  These options are passed to the
  [request](https://www.npmjs.com/package/request)
  module, and the following ones are interpreted as file paths:
    * `cert` - Client certificate
    * `key` - Client private key
    * `ca` - Trusted root certificate for mutual TSL with self signed
    (server) certificates.

Configuration examples:

```js
{
    utBus: {
        serviceBus: {
            jsonrpc: {
                port: 9876,
                ui: true
            }
        }
    }
}
```

```js
{
    utBus: {
        serviceBus: {
            jsonrpc: {
                port: 9876,
                openId: [
                    'https://accounts.google.com/.well-known/openid-configuration'
                ],
                ui: {
                    initOAuth: {
                        clientId: 'someClientId'
                        clientSecret: 'someClientSecret'
                    }
                }
            }
        }
    }
}
```

### rabbot

[Rabbot repo](https://github.com/arobson/rabbot)

#### rabbot configuration options

* debug (Boolean) - if set to true then additional debug queue and binding will
  be created. Also the reply queue in debug mode will not be subscribed for
  batch acknowledgement and will get auto deleted upon disconnection.
* connection (Object) - see [connection options](https://github.com/arobson/rabbot/blob/master/docs/connections.md#rabbotaddconnection--options-)
  for more info.
* exchanges (Array) - exchanges to be auto created
  upon establishing a connection.

  if omitted then te following exchange will be created:

  ```js
  {
    name: bus.id,
    type: 'fanout',
    autoDelete: true
  }
  ```

* queues (Array) - queues to be auto created upon establishing a connection.

  if omitted then te following queue will be created:

  ```js
  {
    name: bus.id,
    subscribe: true,
    autoDelete: true
  }
  ```

  if omitted and `debug` is set to true, then the following
  queue will also be created:

  ```js
  {
    name: bus.id + '(debug)',
    subscribe: false,
    autoDelete: false
  }
  ```

* bindings (Array) - bindings to be auto created upon establishing a connection.
  if omitted then te following binding will be created:

  ```js
  {
    exchange: bus.id,
    target: bus.id,
    keys: []
  }
  ```

  if omitted and `debug` is set to true, then the following
  binding will also be created:

  ```js
  {
    exchange: bus.id,
    target: bus.id + '(debug)',
    keys: []
  }
  ```

Example:

```js
{
    utBus: {
        serviceBus: {
            rabbot: {
                debug: true,
                connection: {
                    ...connectionOptions
                },
                exchanges: [
                    ...exchanges
                ],
                queues: [
                    ...queues
                ],
                bindings: [
                    ...bindings
                ]
            }
        }
    }
}
```

### moleculer

[moleculer repo](https://github.com/moleculerjs/moleculer)
This transport uses moleculer's `ServiceBroker` internally.

#### moleculer configuration options

See [Moleculer Broker options](https://moleculer.services/docs/0.14/configuration.html#Broker-options)
for full list.

Example:

```js
{
    utBus: {
        serviceBus: {
            moleculer: {
                ...moleculerOptions
            }
        }
    }
}
```

If the `moleculer` property is set to a `string` instead of an `object` then it
will be used as a transporter. E.g.

```js
{
    utBus: {
        serviceBus: {
            moleculer: 'abc'
        }
    }
}
// is equivalent to
{
    utBus: {
        serviceBus: {
            moleculer: {
                transporter: 'abc'
            }
        }
    }
}
```

### utRpc

This is an transport which relies on [ut-rpc](https://github.com/softwaregroup-bg/ut-rpc)
for delivering messages over tcp streams.

#### utRpc configuration options

`utRpc` configuration property can be either a `string` or a `number`.
If set to a `string` then the messages will be sent over a
[`domain socket`](https://en.wikipedia.org/wiki/Unix_domain_socket) (on Linux)
or a [`named pipe`](https://en.wikipedia.org/wiki/Named_pipe) (on windows).

If set to a `number` that would mean the messages will be sent over the
respective tcp port.

Example:

```js
{
    utBus: {
        serviceBus: {
            utRpc: 9876 // tcp port
        }
    }
}
// or
{
    utBus: {
        serviceBus: {
            utRpc: 'abc'
            // (for windows) named pipe: \\.\pipe\ut5-abc
            // (for linux) domain socket: /tmp/ut5-abc.sock
        }
    }
}
```

## Caching

Ut-bus provides built-in caching mechanisms.
There are 2 preconditions which are needed in order for caching to be achieved.

1) There should be an instance of ut-port-cache defined on implementation level.
This is necessary because ut-bus doesn't do the caching itself
but relies on having a running instance of ut-port-cache internally.

    E.g:

    ```js
    module.exports = () => () => ({
        adapter: [
            function cache(...params) {
                return class cache extends require('ut-port-cache')(...params) {};
            }
        ]
    });
    ```

2) Cache configuration must be explicitly provided as part of the options
when importing a bus method.

    E.g:

    ```js
    const options = {
        cache: {
            // cache options
        }
    };
    return bus.importMethod('namespace.entity.action', options)(msg);
    ```

    Where options.cache allows the following configuration:

    * `key` - an **object** or a **function** describing the storage options.
        Can be either an object or a function returning an object.
    * **object** - an object consisting of the following properties.
        * `id` - a **string** to be used as a storage key
        * `params` - a **string** or an **object** used to define the segment
        by appending these params to the imported method name.
        (Not used if a `segment` is passed).
        ut-port-cache will use the params
        to build the segment in the form of a query string.
        * **string** - E.g. if `segment` then `namespace.entity.action?segment`
        * **object** - E.g. if `{x: 1, y: 2}` then `namespace.entity.action?x=1&y=2`
        * `segment` - a **string** to bypass the params and define the segment directly
    * **function** - a function returning an object
    with the same properties as described above.
    The function accepts. Using a function instead of a predefined object
    provides the convenience of defining dynamic id, params and segment
    depending on the incoming message. E.g.

        ```js
        function(msg) {
            return {
                id: msg.id,
                params: msg.params
            }
        }
        ```

    * `before` - **string** - cache operation before calling the method,
        can be one of 'get', 'set', 'drop', undefined
        This property is optional.
        The method names usually follow the following pattern: `namespace.entity.action`.
        If the "action" part of the method name matches one of the predefined bindings
        then the respected cache operation will be applied automatically:

        ```json
        {
            "get": "get",
            "fetch": "get",
            "add": false,
            "create": false,
            "edit": "drop",
            "update": "drop",
            "delete": "drop",
            "remove": "drop"
        }
        ```

    * `instead` - **string** - cache operation called instead of calling the method,
        can be one of 'get', 'set', 'drop', undefined
        This property is optional.

    * `after` - **string** - cache operation before calling the method,
        can be one of 'get', 'set', 'drop', undefined
        This property is optional.
        The method names usually follow the following pattern: `namespace.entity.action`.
        If the "action" part of the method name matches one of the predefined bindings
        then the respected cache operation will be applied automatically:

        ```json
        {
            "get": "set",
            "fetch": "set",
            "add": "set",
            "create": "set",
            "edit": "set",
            "update": "set",
            "delete": false,
            "remove": false
        }
        ```

    * `ttl` - **number** optional cache duration, default is set in cache port
    * `port` - **string** optional cache port namespace, default is `cache`
    * `optional` **boolean** optional - indicating whether caching itself is optional.
        I.e. no error will be thrown if caching doesn't succeed. default is `false`.

### Full example

```js
bus.importMethod('some.method', {
    cache: {
        key: msg => ({
            id: msg.id,
            params: 'op1',
            segment: 'my-segment',
        }),
        before: 'get',
        after: 'set',
        ttl: 5000
    }
})
```

## Message level encryption

ut-bus can be configured to support message level encryption (mle)
when receiving messages from outside and/or when communicating with
another instance of ut-bus.

### Message level encryption configuration

In order for that to be achieved the
following configuration is needed:

```js
{
    utBus: {
        serviceBus: {
            jsonrpc: {
                sign: serverMlsk,
                encrypt: serverMlek,
                client: {
                    sign: clientMlsk,
                    encrypt: clientMlek
                }
            }
        }
    }
}
```

where:

* `utBus.serviceBus.jsonrpc.sign` (serverMlsk) -
private key used for signing the response
* `utBus.serviceBus.jsonrpc.encrypt` (serverMlek) -
private key used for decrypting the request
* `utBus.serviceBus.jsonrpc.client.sign` (clientMlsk) -
private key used for signing the request
* `utBus.serviceBus.jsonrpc.client.encrypt` (clientMlek) -
private key used for decrypting the response

`serverMlsk` and `serverMlek` are used when the bus acts as a
server (when receiving requests from outside/another bus).

`clientMlsk` and `clientMlek` are used when the bus acts as a
gateway (i.e. as a client in bus-2-bus communication). For more info
check `gateway` in [jsonrpc configuration options](####jsonrpc-configuration-options)
If these keys are provided then the bus will try to authenticate
using `login.identity.exchange` method, otherwise the
authentication method will be `login.identity.check`

The keys provided in the configuration have to be in
[JSON web key](https://datatracker.ietf.org/doc/html/rfc7517#section-4) format.
They can be generated by a script, using some JSON Object Signing and Encryption
library.
For example [jose](https://github.com/panva/jose):

```js
    const {JWK} = require('jose');
    function getKeys() {
        const mlsk = JWK.generateSync('EC', 'P-384', {use: 'sig'});
        const mlek = JWK.generateSync('EC', 'P-384', {use: 'enc'});
        return {mlsk: JWK.asKey(mlsk), mlek: JWK.asKey(mlek)};
    }
```

or by using some online JSON Web Key generator like [mkjwk](https://mkjwk.org/)

Full configuration example:

```js
{
    utBus: {
        serviceBus: {
            jsonrpc: {
                sign: {
                    kty: 'EC',
                    d: 'BYfl8to6zRfjjm7jFYtY5i_BwR2jXspsv1HDN0OLIaz-tUiACKZBeRruaLzBrHXJ',
                    use: 'sig',
                    crv: 'P-384',
                    x: 'pM8gcPvgdKrKaxQmIC7Q67AvV7KteWqU5I4X83ErVinZnAgeT1KwfhCYssD3YNvK',
                    y: 'SVsvfEm3CVu2WjOho2frL7LnaXeOQHC1JT856bOH-Vp3E-4_1j2Kp9KHJJf7Qn1v',
                    alg: 'ES384'
                },
                encrypt: {
                    d: '3UScww8iqdRaBeTraC61WCFoO3fisO9A0p49P_GI6BuZO26-WUyElUWoKyhkcbeI',
                    kty: 'EC',
                    use: 'enc',
                    crv: 'P-384',
                    x: 's8uFX_D-Ow5Q6UoRs6tFDBDkpdpcsueSl7-oyPpBFdgY6Co9L2AZknuqA4vDSKe4',
                    y: 'IffoB24bdS2nk699nXMB4cVe7LgLdinCKNGgrgcPHlPXnqfdJ7T5DLucLLJP0DQA',
                    alg: 'ECDH-ES+A256KW'
                },
                client: {
                    sign: {
                        kty: 'EC',
                        d: 'jo8G0i1lhqRFN9x0Og3XRE-EC0u_ZAUbKcU7SEit6c6tRupqviQ_CmODGyfdDoHY',
                        use: 'sig',
                        crv: 'P-384',
                        x: 'avLDJ42674HZhDoh8--e9S3GDOLZ3l6lc3hRQtcjHQ3zPfeqyyyN2qYhX4TQBhOg',
                        y: 'duOXLY-NgzsraPWepv42Z5itp2WQNdmklcQMq-arrFXkJaqjNTZ29GJYehPwMTP_',
                        alg: 'ES384'
                    },
                    encrypt: {
                        crv: 'P-384',
                        x: 'cm3RKHV8rfSJSoJvpRZTUTYIYDnAcbVf6vjGspJfifyn7NNcmNX4WN7vs-robaBR',
                        y: 'iuReGVbQ1aUpnzeXahIFJyTpOXuMZkTKkn-SXCW7xM6DcKascabaKCHlQRVBMmQS',
                        d: 'hGbwEuoIBi60isZqHxivhCTE-KgJ59QY4KByRmzjLPxh_Di1eBThyx8l_DT6kARk',
                        kty: 'EC',
                        kid: 'MQ3uhovLo_AYLF3RQMMwiORwOY5o53_KLAXV4vKdsXc',
                        alg: 'ECDH-ES+A256KW',
                        use: 'enc'
                    }
                }
            }
        }
    }
}
```

### Message level encryption flow

![Message level encryption flow](./doc/mle_flow.svg "Message level encryption flow")

The message level encryption flow consists of 4 main parts:

1. **The client sends a request.**

    Here the payload gets signed with `clientPrivateMlsk` and
    encrypted with `serverPublicMlek`. Pseudo code:

    ```js
    encrypt(sign(msg, clientPrivateMlsk), serverPublicMlek);
    ```

    In case of `login.identity.exchange` or in other words
    (when the server doesn't know the client public keys) then
    the client must send its public mlsk ("sign") and mlek ("encrypt")
    keys as part of a [jwe protected header](https://datatracker.ietf.org/doc/html/rfc7516#page-45).

     ```js
    // protectedHeaders: {mlsk: clientPublicMlsk, mlek: clientPublicMlek}
    encrypt(sign(msg, clientPrivateMlsk), serverPublicMlek, protectedHeaders);
    ```

2. **The server receives the request.**

    Here the payload gets decrypted with `serverPrivateMlek` and
    verified with `clientPublicMlsk`. Pseudo code:

    ```js
    verify(decrypt(msg, serverPrivateMlek), clientPublicMlsk)
    ```

3. **The server sends the response.**

    Here the payload gets signed with `serverPrivateMlsk` and
    encrypted with `clientPublicMlek`. Pseudo code:

    ```js
    encrypt(sign(msg, serverPrivateMlsk), clientPublicMlek);
    ```

4. **The client receives the response.**

    Here the payload gets decrypted with `clientPrivateMlek` and
    verified with `serverPublicMlek`. Pseudo code:

    ```js
    verify(decrypt(msg, clientPrivateMlek), serverPublicMlek)
    ```
