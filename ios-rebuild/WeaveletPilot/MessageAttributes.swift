import Foundation

// Namespace rules and correspondence checks belong to the actual Web branch utilities.
enum MessageAttributes {
    private static func owner(_ value: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        .object(try value.object("owner").map { field in
            if field.key == "nodes", case .object(let nodes) = field.value {
                return .init(key: field.key, value: .object(nodes.map { .init(key: $0.key, value: .null) }))
            }
            if field.key == "messageAttributesV1", case .object(let fields) = field.value {
                let namespace = try fields.map { part -> JSONField in
                    guard part.key == "byNode", case .object(let nodes) = part.value else { return part }
                    let values = try nodes.map { node -> JSONField in
                        guard case .object(let attributes) = node.value else { return node }
                        return .init(key: node.key, value: .object(try attributes.map { .init(key: $0.key, value: try boundary.reference($0.value)) }))
                    }
                    return .init(key: part.key, value: .object(values))
                }
                return .init(key: field.key, value: .object(namespace))
            }
            return field
        })
    }
    private static func message(_ value: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        .object(try value.object("message").map { field in
            .init(key: field.key, value: field.key == "role" || field.key == "content" ? field.value : try boundary.reference(field.value))
        })
    }
    private static func restored(_ output: OrderedJSON, boundary: SharedWebProjection) throws -> OrderedJSON {
        try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: output)])]), to: .null, opaque: boundary.opaque)
    }
    static func document(_ source: OrderedJSON, exporting: Bool = false) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        var fields: [JSONField] = [
            .init(key: "chats", value: .array(try source.required("chats").array("chats").map { try boundary.chat($0) })),
            .init(key: "contentStore", value: try boundary.store(source.required("contentStore")))
        ]
        if let clipboard = source["branchClipboard"] {
            fields.append(.init(key: "branchClipboard", value: clipboard == .null ? .null : try owner(clipboard, boundary: &boundary)))
        }
        let input = OrderedJSON.object([.init(key: "operation", value: .string(exporting ? "exportDocument" : "captureDocument")), .init(key: "source", value: .object(fields))])
        return try OrderedJSONChanges.apply(SharedWebOperations.call("messageAttributesOperation", input), to: source, opaque: boundary.opaque)
    }
    static func read(_ value: OrderedJSON) throws -> OrderedJSON? {
        var boundary = SharedWebProjection()
        let output = try SharedWebOperations.call("messageAttributesOperation", .object([.init(key: "operation", value: .string("read")), .init(key: "owner", value: owner(value, boundary: &boundary))]))
        // Validation is shared; returning the original container preserves its raw field order.
        return output == .null ? nil : value["messageAttributesV1"]?["byNode"]
    }
    static func extras(_ value: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        return try restored(SharedWebOperations.call("messageAttributesOperation", .object([.init(key: "operation", value: .string("extras")), .init(key: "message", value: message(value, boundary: &boundary))])), boundary: boundary)
    }
    static func setting(_ value: OrderedJSON, nodeID: String, message: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let input = OrderedJSON.object([.init(key: "operation", value: .string("setting")), .init(key: "owner", value: try owner(value, boundary: &boundary)), .init(key: "nodeID", value: .string(nodeID)), .init(key: "message", value: try self.message(message, boundary: &boundary))])
        return try OrderedJSONChanges.apply(SharedWebOperations.call("messageAttributesOperation", input), to: value, opaque: boundary.opaque)
    }
    static func copying(from source: OrderedJSON, nodeID: String, to target: OrderedJSON, newID: String) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let input = OrderedJSON.object([.init(key: "operation", value: .string("copying")), .init(key: "source", value: try owner(source, boundary: &boundary)), .init(key: "nodeID", value: .string(nodeID)), .init(key: "target", value: try owner(target, boundary: &boundary)), .init(key: "newID", value: .string(newID))])
        return try OrderedJSONChanges.apply(SharedWebOperations.call("messageAttributesOperation", input), to: target, opaque: boundary.opaque)
    }
    static func capture(_ chat: OrderedJSON, store: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let input = OrderedJSON.object([.init(key: "operation", value: .string("capture")), .init(key: "chat", value: try boundary.chat(chat)), .init(key: "store", value: try boundary.store(store))])
        return try OrderedJSONChanges.apply(SharedWebOperations.call("messageAttributesOperation", input), to: chat, opaque: boundary.opaque)
    }
    static func projecting(_ message: OrderedJSON, owner value: OrderedJSON, nodeID: String) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let projectedParts = try boundary.parts(message.required("content"))
        let projectedMessage = message.replacing("content", with: projectedParts)
        let input = OrderedJSON.object([.init(key: "operation", value: .string("projecting")), .init(key: "message", value: projectedMessage), .init(key: "owner", value: try owner(value, boundary: &boundary)), .init(key: "nodeID", value: .string(nodeID))])
        return try restored(SharedWebOperations.call("messageAttributesOperation", input), boundary: boundary)
    }
}
