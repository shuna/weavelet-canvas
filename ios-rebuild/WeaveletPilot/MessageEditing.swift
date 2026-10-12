import Foundation

enum MessageSaveMode { case overwrite, branch, append }

struct MessageDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String?
    let path: [String]
    let originalParts: OrderedJSON
    let originalRole: String
    let isProtected: Bool
    var role: String
    var text: String

    var originalText: String { Self.firstText(originalParts) }
    var changed: Bool { role != originalRole || !text.utf8.elementsEqual(originalText.utf8) }
    var parts: OrderedJSON {
        guard !text.utf8.elementsEqual(originalText.utf8), case .array(var parts) = originalParts else { return originalParts }
        if let index = parts.firstIndex(where: { $0["type"] == .string("text") }) {
            parts[index] = parts[index].replacing("text", with: .string(text))
        } else {
            parts.insert(.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string(text))]), at: 0)
        }
        return .array(parts)
    }
    private static func firstText(_ parts: OrderedJSON) -> String {
        guard case .array(let values) = parts, let part = values.first(where: { $0["type"] == .string("text") }), case .string(let text) = part["text"] else { return "" }
        return text
    }
}

enum MessageEditing {
    static func save(in source: OrderedJSON, chatID: String, nodeID: String?, viewingPath: [String], role: String,
                     parts: OrderedJSON, mode: MessageSaveMode, newIDs: [String], now: Double) throws -> OrderedJSON {
        var chats = try source.required("chats").array("chats")
        guard let index = try chats.firstIndex(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        var boundary = SharedWebProjection()
        let projectedChat = try boundary.chat(chats[index])
        let projectedStore = try boundary.store(source.required("contentStore"))
        let projectedParts = try boundary.parts(parts)
        let input = OrderedJSON.object([
            .init(key: "chat", value: projectedChat), .init(key: "contentStore", value: projectedStore),
            .init(key: "viewingPath", value: .array(viewingPath.map(OrderedJSON.string))),
            .init(key: "nodeID", value: nodeID.map(OrderedJSON.string) ?? .null),
            .init(key: "role", value: .string(role)), .init(key: "parts", value: projectedParts),
            .init(key: "mode", value: .string(mode == .append ? "append" : mode == .branch ? "branch" : "overwrite")),
            .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))
        ])
        let changes = try SharedWebOperations.call("messageEdit", input)
        let original = OrderedJSON.object([.init(key: "chat", value: chats[index]), .init(key: "contentStore", value: try source.required("contentStore"))])
        let changed = try OrderedJSONChanges.apply(changes, to: original, opaque: boundary.opaque)
        chats[index] = try changed.required("chat")
        return source.replacing("chats", with: .array(chats)).replacing("contentStore", with: try changed.required("contentStore"))
    }
}

// Opaque attributes are references into the original native document. Only the
// fields the Web editing functions use are decoded by JavaScript.
struct SharedWebProjection {
    var opaque: [OrderedJSON] = []
    private var identities: [Data: Int] = [:]
    mutating func reference(_ value: OrderedJSON) throws -> OrderedJSON {
        if value == .null { return .null }
        let key = try value.encoded()
        let index: Int
        if let existing = identities[key] { index = existing }
        else { index = opaque.count; opaque.append(value); identities[key] = index }
        return .object([.init(key: "opaqueRef", value: .number(String(index)))])
    }
    mutating private func fields(_ value: OrderedJSON, known: [String]) throws -> OrderedJSON {
        var output: [JSONField] = []
        for field in try value.object("object") {
            output.append(.init(key: field.key, value: known.contains(field.key) ? field.value : try reference(field.value)))
        }
        return .object(output)
    }
    mutating func parts(_ value: OrderedJSON) throws -> OrderedJSON {
        var values: [OrderedJSON] = []
        for part in try value.array("content") {
            let type = try part.required("type").string("content.type")
            let known: [String]
            switch type {
            case "text", "reasoning": known = ["type", "text"]
            case "image_url": known = ["type", "image_url"]
            case "tool_call": known = ["type", "id", "name", "arguments"]
            case "tool_result": known = ["type", "tool_call_id", "content"]
            default: throw ExchangeError.invalid("content.type")
            }
            for key in known where key != "image_url" { _ = try part.required(key).string(key) }
            var projected = try fields(part, known: known)
            if type == "image_url" {
                let image = try part.required("image_url")
                _ = try image.required("url").string("image_url.url")
                _ = try image.required("detail").string("image_url.detail")
                projected = projected.replacing("image_url", with: try fields(image, known: ["url", "detail"]))
            }
            values.append(projected)
        }
        return .array(values)
    }
    mutating private func messages(_ value: OrderedJSON) throws -> OrderedJSON {
        var result: [OrderedJSON] = []
        for message in try value.array("messages") {
            var projected = try fields(message, known: ["role", "content"])
            projected = projected.replacing("content", with: try parts(message.required("content")))
            result.append(projected)
        }
        return .array(result)
    }
    mutating func folders(_ value: OrderedJSON) throws -> OrderedJSON {
        var result: [JSONField] = []
        for field in try value.object("folders") {
            var folder = try fields(field.value, known: ["id", "name", "order", "expanded", "color", "parentId"])
            // The current hierarchy validator tolerates future color values;
            // only strings are used by the native color UI.
            if let color = field.value["color"], case .string = color {} else if let color = field.value["color"] {
                folder = folder.replacing("color", with: try reference(color))
            }
            result.append(.init(key: field.key, value: folder))
        }
        return .object(result)
    }
    mutating func config(_ value: OrderedJSON) throws -> OrderedJSON {
        try fields(value, known: ["systemPrompt"])
    }
    mutating func chat(_ value: OrderedJSON) throws -> OrderedJSON {
        var result = try fields(value, known: ["id", "title", "titleSet", "imageDetail", "messages", "config", "branchTree", "collapsedNodes", "omittedNodes", "protectedNodes"])
        if let configuration = value["config"] { result = result.replacing("config", with: try config(configuration)) }
        if case .array = value["messages"] { result = result.replacing("messages", with: try messages(value.required("messages"))) }
        if let tree = value["branchTree"] {
            var projectedTree = try fields(tree, known: ["nodes", "rootId", "activePath", "messageAttributesV1"])
            var nodes: [JSONField] = []
            for node in try tree.required("nodes").object("nodes") { nodes.append(.init(key: node.key, value: try fields(node.value, known: ["id", "parentId", "role", "contentHash", "createdAt"]))) }
            projectedTree = projectedTree.replacing("nodes", with: .object(nodes))
            if let attributes = tree["messageAttributesV1"] {
                var byNode: [JSONField] = []
                for node in try attributes.required("byNode").object("byNode") { byNode.append(.init(key: node.key, value: try fields(node.value, known: []))) }
                projectedTree = projectedTree.replacing("messageAttributesV1", with: attributes.replacing("byNode", with: .object(byNode)))
            }
            result = result.replacing("branchTree", with: projectedTree)
        }
        return result
    }
    mutating func store(_ value: OrderedJSON, resolving hashes: [String]? = nil, strict: Bool = false) throws -> OrderedJSON {
        let resolved = try SharedWebOperations.call("documentOperation", .object([.init(key: "operation", value: .string("resolveStore")), .init(key: "store", value: value), .init(key: "strict", value: .bool(strict)), .init(key: "hashes", value: hashes.map { .array($0.map(OrderedJSON.string)) } ?? .null)]))
        var entries: [JSONField] = []
        for entry in try value.object("contentStore") {
            let original: OrderedJSON
            if let json = resolved[entry.key] {
                let content = try OrderedJSON.decode(Data(json.string("resolved delta").utf8))
                original = .object(try entry.value.object("entry").filter { $0.key != "delta" }.map { $0.key == "content" ? .init(key: "content", value: content) : $0 })
            } else { original = entry.value }
            var projected = try fields(original, known: ["content", "refCount"])
            projected = projected.replacing("content", with: try parts(original.required("content")))
            entries.append(.init(key: entry.key, value: projected))
        }
        return .object(entries)
    }
}
