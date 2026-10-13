import Foundation

enum MessageSaveMode: String { case overwrite, branch, append, insert }

enum NodeRemovalOperation: String { case remove, pruneHidden }

struct NodeRemovalDraft {
    let chatID: String
    let nodeID: String?
    let source: OrderedJSON
    let path: [String]
    let operation: NodeRemovalOperation
}

struct MessageDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String?
    let path: [String]
    let source: OrderedJSON
    let isInsertion: Bool
    var beforeNodeID: String? { isInsertion ? nodeID : nil }
    let originalParts: OrderedJSON
    let originalRole: String
    let isProtected: Bool
    var role: String
    var text: String

    let originalText: String
    var changed: Bool { role != originalRole || !text.utf8.elementsEqual(originalText.utf8) }
    init(chatID: String, nodeID: String?, path: [String], source: OrderedJSON, isInsertion: Bool = false, originalParts: OrderedJSON, originalRole: String,
         isProtected: Bool, role: String, text: String) throws {
        self.chatID = chatID; self.nodeID = nodeID; self.path = path; self.source = source; self.isInsertion = isInsertion; self.originalParts = originalParts
        self.originalRole = originalRole; self.isProtected = isProtected; self.role = role; self.text = text
        originalText = try MessageEditing.textValue(of: originalParts)
    }

}

enum MessageEditing {
    struct HistoryState {
        let raw: OrderedJSON
        let canUndo: Bool
        let canRedo: Bool
    }
    struct HistoryMove {
        let source: OrderedJSON
        let history: HistoryState
        let affectedChatIDs: [String]
        let updated: Bool
    }

    private static func historyState(_ result: OrderedJSON) throws -> HistoryState {
        let can = try result.required("can")
        return try HistoryState(raw: result.required("history"), canUndo: can.required("undo").boolean("undo"), canRedo: can.required("redo").boolean("redo"))
    }
    private static func perform(in source: OrderedJSON, chatID: String, kind: String, history: HistoryState?,
                                onHistory: ((HistoryState) -> Void)?, fields: (inout SharedWebProjection) throws -> [JSONField]) throws -> OrderedJSON {
        var chats = try source.required("chats").array("chats")
        guard let index = try chats.firstIndex(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        var boundary = SharedWebProjection()
        let chat = try boundary.editingChat(chats[index])
        let store = try boundary.store(source.required("contentStore"))
        let input = try OrderedJSON.object([.init(key: "chat", value: chat), .init(key: "contentStore", value: store)] + fields(&boundary))
        let changes: OrderedJSON
        var next: HistoryState?
        if onHistory != nil {
            let payload = try OrderedJSON.object([.init(key: "operation", value: .string("edit")), .init(key: "kind", value: .string(kind)),
                .init(key: "input", value: input), .init(key: "history", value: boundary.history(history?.raw))])
            let output = try SharedWebOperations.call("branchHistory", payload)
            changes = try output.required("changes")
            next = try historyState(output)
        } else {
            let output = try SharedWebOperations.call(kind, input)
            if kind == "nodeOptions" {
                guard output["status"] == .string("updated") || output["status"] == .string("unchanged") else { throw ExchangeError.invalid("メッセージがありません") }
                changes = try output.required("changes")
            } else { changes = output }
        }
        let original = OrderedJSON.object([.init(key: "chat", value: chats[index]), .init(key: "contentStore", value: try source.required("contentStore"))])
        let changed = try OrderedJSONChanges.apply(changes, to: original, opaque: boundary.opaque)
        chats[index] = try changed.required("chat")
        let result = source.replacing("chats", with: .array(chats)).replacing("contentStore", with: try changed.required("contentStore"))
        if let next {
            let raw = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: next.raw)])]), to: .null, opaque: boundary.opaque)
            onHistory?(HistoryState(raw: raw, canUndo: next.canUndo, canRedo: next.canRedo))
        }
        return result
    }

    static func remove(in source: OrderedJSON, chatID: String, nodeID: String?, viewingPath: [String],
                       operation: NodeRemovalOperation, newIDs: [String], now: Double,
                       history: HistoryState? = nil, onHistory: ((HistoryState) -> Void)? = nil) throws -> OrderedJSON {
        try perform(in: source, chatID: chatID, kind: "nodeRemoval", history: history, onHistory: onHistory) { _ in [
            .init(key: "nodeID", value: nodeID.map(OrderedJSON.string) ?? .null),
            .init(key: "viewingPath", value: .array(viewingPath.map(OrderedJSON.string))), .init(key: "operation", value: .string(operation.rawValue)),
            .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))] }
    }
    static func textValue(of parts: OrderedJSON) throws -> String {
        var boundary = SharedWebProjection()
        return try SharedWebOperations.call("messageEdit", .object([.init(key: "operation", value: .string("textValue")),
            .init(key: "parts", value: boundary.parts(parts))])).string("textValue")
    }
    static func save(in source: OrderedJSON, chatID: String, nodeID: String?, viewingPath: [String], role: String,
                     parts: OrderedJSON, editedText: String? = nil, mode: MessageSaveMode, newIDs: [String], now: Double,
                     history: HistoryState? = nil, onHistory: ((HistoryState) -> Void)? = nil) throws -> OrderedJSON {
        try perform(in: source, chatID: chatID, kind: "messageEdit", history: history, onHistory: onHistory) { boundary in
            var fields: [JSONField] = [.init(key: "viewingPath", value: .array(viewingPath.map(OrderedJSON.string))),
                .init(key: "nodeID", value: nodeID.map(OrderedJSON.string) ?? .null), .init(key: "role", value: .string(role)),
                .init(key: "parts", value: try boundary.parts(parts)), .init(key: "mode", value: .string(mode.rawValue)),
                .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))]
            if let editedText { fields.append(.init(key: "editedText", value: .string(editedText))) }
            return fields
        }
    }
    static func saveOptions(in source: OrderedJSON, chatID: String, nodeID: String, value: NodeOptions.Value, newIDs: [String], now: Double,
                            history: HistoryState?, onHistory: @escaping (HistoryState) -> Void) throws -> OrderedJSON {
        _ = try NodeOptions.read(in: source, chatID: chatID, nodeID: nodeID)
        guard let chat = try source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let target = chat["branchTree"] == nil ? String(nodeID.dropFirst(8)) : nodeID
        return try perform(in: source, chatID: chatID, kind: "nodeOptions", history: history, onHistory: onHistory) { _ in [
            .init(key: "operation", value: .string("save")), .init(key: "nodeId", value: .string(target)),
            .init(key: "value", value: .object([.init(key: "label", value: .string(value.label)), .init(key: "starred", value: .bool(value.starred)),
                .init(key: "pinned", value: .bool(value.pinned)), .init(key: "collapsed", value: .bool(value.collapsed)),
                .init(key: "omitted", value: .bool(value.omitted)), .init(key: "protected", value: .bool(value.protected))])),
            .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))] }
    }

    static func moveHistory(_ operation: String, in source: OrderedJSON, history: HistoryState?, now: Double) throws -> HistoryMove {
        var boundary = SharedWebProjection()
        let chats = try source.required("chats").array("chats").map { try boundary.editingChat($0) }
        let store = try boundary.store(source.required("contentStore"))
        let input = try OrderedJSON.object([.init(key: "operation", value: .string(operation)), .init(key: "history", value: boundary.history(history?.raw)),
            .init(key: "chats", value: .array(chats)), .init(key: "contentStore", value: store), .init(key: "busyChatIds", value: .array([])), .init(key: "now", value: .number(String(now)))])
        let output = try SharedWebOperations.call("branchHistory", input)
        let changed = try OrderedJSONChanges.apply(output.required("changes"), to: source, opaque: boundary.opaque)
        let state = try historyState(output)
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: state.raw)])]), to: .null, opaque: boundary.opaque)
        return try HistoryMove(source: changed, history: HistoryState(raw: restored, canUndo: state.canUndo, canRedo: state.canRedo),
            affectedChatIDs: output.required("affectedChatIds").array("affectedChatIds").map { try $0.string("chat ID") }, updated: output["status"] == .string("updated"))
    }
    static func invalidatingHistory(_ history: HistoryState?, before: OrderedJSON, after: OrderedJSON) throws -> HistoryState? {
        guard let history else { return nil }
        var boundary = SharedWebProjection()
        let previous = try before.required("chats").array("chats").map { try boundary.editingChat($0) }
        let next = try after.required("chats").array("chats").map { try boundary.editingChat($0) }
        let output = try SharedWebOperations.call("branchHistory", .object([.init(key: "operation", value: .string("invalidate")),
            .init(key: "history", value: boundary.history(history.raw)), .init(key: "before", value: .array(previous)), .init(key: "after", value: .array(next))]))
        let state = try historyState(output)
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: state.raw)])]), to: .null, opaque: boundary.opaque)
        return HistoryState(raw: restored, canUndo: state.canUndo, canRedo: state.canRedo)
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
    mutating func requestConfig(_ value: OrderedJSON) throws -> OrderedJSON {
        try fields(value, known: ["model", "stream", "max_tokens", "providerId", "reasoning_effort", "reasoning_budget_tokens", "verbosity", "force_reasoning", "systemPrompt", "modelSource", "modelSettings", "openRouter"])
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
    mutating func editingChat(_ value: OrderedJSON) throws -> OrderedJSON {
        var result = try chat(value)
        if let tree = value["branchTree"] {
            let projectedTree = try result.required("branchTree"), projectedNodes = try projectedTree.required("nodes")
            let nodes = try tree.required("nodes").object("nodes").map { field -> JSONField in
                var node = try projectedNodes.required(field.key)
                for key in ["label", "starred", "pinned"] { if let value = field.value[key] { node = node.replacing(key, with: value) } }
                return .init(key: field.key, value: node)
            }
            result = result.replacing("branchTree", with: projectedTree.replacing("nodes", with: .object(nodes)))
        }
        return result
    }
    mutating func history(_ value: OrderedJSON?) throws -> OrderedJSON {
        guard let value else { return .null }
        var result = value
        for key in ["past", "future"] {
            let snapshots = try value.required(key).array(key).map { snapshot -> OrderedJSON in
                let chats = try snapshot.required("chats").array("chats").map { chat -> OrderedJSON in
                    var projected = try editingChat(chat)
                    for field in ["expectedActivePath", "systemPrompt"] { if let value = chat[field] { projected = projected.replacing(field, with: value) } }
                    return projected
                }
                return try snapshot.replacing("chats", with: .array(chats)).replacing("contentStore", with: store(snapshot.required("contentStore")))
            }
            result = result.replacing(key, with: .array(snapshots))
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
