import Foundation

// Opaque message attributes belong to the saved document, never the generation request.
enum MessageAttributes {
    static func read(_ owner: OrderedJSON) throws -> OrderedJSON? {
        guard let value = owner["messageAttributesV1"] else { return nil }
        let fields = try value.object("message attributes namespace")
        guard fields.allSatisfy({ ["version", "byNode"].contains($0.key) }),
              try value.required("version").number("message attributes version") == 1 else {
            throw ExchangeError.invalid("未対応のmessage属性形式です")
        }
        let byNode = try value.required("byNode")
        let nodes = try owner.required("nodes")
        _ = try nodes.object("nodes")
        for field in try byNode.object("message attributes byNode") {
            guard nodes[field.key] != nil else { throw ExchangeError.invalid("message属性のnode参照がありません") }
            _ = try field.value.object("message attributes")
            guard field.value["role"] == nil, field.value["content"] == nil else {
                throw ExchangeError.invalid("message属性に本文または役割が含まれています")
            }
        }
        return byNode
    }

    static func extras(_ message: OrderedJSON) throws -> OrderedJSON {
        .object(try message.object("message").filter { $0.key != "role" && $0.key != "content" })
    }

    static func setting(_ owner: OrderedJSON, nodeID: String, message: OrderedJSON) throws -> OrderedJSON {
        let attributes = try extras(message)
        guard try !attributes.object("message attributes").isEmpty else { return owner }
        var byNode = try read(owner) ?? .object([])
        var merged = byNode[nodeID] ?? .object([])
        for field in try attributes.object("message attributes") {
            merged = merged.replacing(field.key, with: field.value)
        }
        byNode = byNode.replacing(nodeID, with: merged)
        return owner.replacing("messageAttributesV1", with: .object([
            JSONField(key: "version", value: .number("1")), JSONField(key: "byNode", value: byNode)
        ]))
    }

    static func copying(from source: OrderedJSON, nodeID: String, to target: OrderedJSON, newID: String) throws -> OrderedJSON {
        guard let attributes = try read(source)?[nodeID] else { return target }
        return try setting(target, nodeID: newID, message: attributes)
    }

    static func capture(_ chat: OrderedJSON, store: OrderedJSON) throws -> OrderedJSON {
        guard var tree = chat["branchTree"] else { return chat }
        let projection = chat["messages"] == .null ? OrderedJSON.array([]) : chat["messages"] ?? .array([])
        for (index, message) in try projection.array("messages").enumerated() {
            let attributes = try extras(message)
            guard try !attributes.object("message attributes").isEmpty else { continue }
            let path = try tree.required("activePath").array("activePath")
            let nodes = try tree.required("nodes")
            guard path.indices.contains(index) else { throw ExchangeError.invalid("message属性と表示分岐が一致しません") }
            let id = try path[index].string("node ID")
            let node = try nodes.required(id)
            let body = try SyncRecords.resolveProjectedContent(store, hash: node.required("contentHash").string("hash"))
            guard node["role"] == message["role"], try Data(SyncRecords.canonical(body).utf8) == Data(SyncRecords.canonical(message.required("content")).utf8) else {
                throw ExchangeError.invalid("message属性と表示分岐が一致しません")
            }
            if let existing = try read(tree)?[id] {
                for field in try attributes.object("message attributes") {
                    if let old = existing[field.key], try Data(SyncRecords.canonical(old).utf8) != Data(SyncRecords.canonical(field.value).utf8) {
                        throw ExchangeError.invalid("message属性が競合しています")
                    }
                }
            }
            tree = try setting(tree, nodeID: id, message: message)
        }
        return chat.replacing("branchTree", with: tree)
    }

    static func projecting(_ message: OrderedJSON, owner: OrderedJSON, nodeID: String) throws -> OrderedJSON {
        let attributes = try read(owner)?[nodeID] ?? .object([])
        return try attributes.replacing("role", with: message.required("role")).replacing("content", with: message.required("content"))
    }
}
