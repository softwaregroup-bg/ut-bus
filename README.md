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
                    'https://accounts.google.com'
                ],
                ui: {
                    clientId: 'someClientId'
                    clientSecret: 'someClientSecret'
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
