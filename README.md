# UT Bus

## Caching

Ut-bus provides built-in caching mechanisms.
There are 2 preconditions which are needed in order for caching to be achieved.

1) There should be an instance of ut-port-cache defined on implementation level.
This is necessary because ut-bus doesn't do the caching itself
but relies on having a running isntance of ut-port-cache internally.

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
    * **object** - an object consisting of the followig properties.
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
