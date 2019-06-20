# RabbitMQ

RabbitMQ is supported through the [rabbot](https://www.npmjs.com/package/rabbot)
module. To use RabbitMQ, the ServiceBus configuration should include `rabbot`
key. Before the value of this key is passed to rabbot, some default values are
set for subkeys `exchanges`, `queues` and `bindings`.

## Message format

[JSON RPC 2.0](https://www.jsonrpc.org/specification) is used for message body.

Here are some example messages:

Successful call, request:

```yaml
Exchange: 28f285e0-1566-45e6-a113-6282b9c6f4f4
Routing Key: ports.module.request
Properties:
    app_id: ut
    type: ports.module.request
    timestamp: 1561014982742
    message_id: 4edbb850-932b-11e9-9516-f9a716b526fc
    reply_to: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
    correlation_id:
    headers:
    content_encoding: utf8
    content_type: application/json
Payload: {
    "jsonrpc": "2.0",
    "method": "module.entity.action",
    "id": 1,
    "params": [{
        "text": "hello world"
    }, {
        "method": "module.entity.action",
        "opcode": "action",
        "mtid": "request"
    }]
}
```

Successful call, reply:

```yaml
Exchange: (AMQP default)
Routing Key: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
Properties:
    type: ports.module.request.reply
    timestamp: 1561014982750
    reply_to: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
    correlation_id: 4edbb850-932b-11e9-9516-f9a716b526fc
    headers:
    sequence_end: true
    content_encoding: utf8
    content_type: application/json
Payload: {
    "jsonrpc": "2.0",
    "id": 1,
    "result": [
        "HELLO WORLD"
    ]
}
```

Unsuccessful call, request:

```yaml
Exchange: 28f285e0-1566-45e6-a113-6282b9c6f4f4
Routing Key: ports.module.request
Properties:
    app_id: ut
    type: ports.module.request
    timestamp: 1561014983792
    message_id: 4f7ba1d0-932b-11e9-9516-f9a716b526fc
    reply_to: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
    correlation_id:
    headers:
    content_encoding: utf8
    content_type: application/json
Payload: {
    "jsonrpc": "2.0",
    "method": "module.entity.action",
    "id": 1,
    "params": [{
    }, {
        "method": "module.entity.action",
        "opcode": "action",
        "mtid": "request"
    }]
}
```

Unsuccessful call, reply:

```yaml
Exchange: (AMQP default)
Routing Key: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
Properties:
    type: ports.module.request.reply
    timestamp: 1561014983795
    reply_to: 81af945f-dfd0-45f9-af8e-15276cd9d7ed(reply)
    correlation_id: 4f7ba1d0-932b-11e9-9516-f9a716b526fc
    headers:
    sequence_end: true
    content_encoding: utf8
    content_type: application/json
Payload: {
    "jsonrpc": "2.0",
    "id": 1,
    "error": {
        "type": "module.invalidParameter",
        "message": "Invalid parameter"
    }
}
```
