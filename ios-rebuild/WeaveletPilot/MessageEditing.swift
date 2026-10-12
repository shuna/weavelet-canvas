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
        guard ["user", "assistant", "system"].contains(role) else { throw ExchangeError.invalid("role") }
        _ = try parts.array("content")
        var chats = try source.required("chats").array("chats")
        guard let chatIndex = try chats.firstIndex(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        var store = try source.required("contentStore")
        var chat = try MessageAttributes.capture(chats[chatIndex], store: store)
        var availableIDs = newIDs[...]
        func nextID() throws -> String {
            guard let id = availableIDs.first, !id.isEmpty else { throw ExchangeError.invalid("new node ID") }
            availableIDs = availableIDs.dropFirst()
            return id
        }
        func add(_ content: OrderedJSON) throws -> String {
            let encoded = try SyncRecords.canonical(content)
            for field in try store.object("contentStore") {
                if Data(try SyncRecords.canonical(SyncRecords.resolveContent(store, hash: field.key)).utf8) == Data(encoded.utf8) {
                    let count = try field.value.required("refCount").number("refCount")
                    store = store.replacing(field.key, with: field.value.replacing("refCount", with: .number(String(format: "%.0f", count + 1))))
                    return field.key
                }
            }
            let hash = SyncRecords.digest(encoded)
            guard store[hash] == nil else { throw ExchangeError.invalid("content hash collision") }
            store = store.replacing(hash, with: .object([JSONField(key: "content", value: content), JSONField(key: "refCount", value: .number("1"))]))
            return hash
        }
        var tree: OrderedJSON
        var path: [String]
        var nodes: OrderedJSON
        if let existing = chat["branchTree"] {
            tree = existing
            _ = try MessageAttributes.read(tree)
            nodes = try tree.required("nodes")
            path = viewingPath
            guard path.allSatisfy({ nodes[$0] != nil }) else { throw ExchangeError.invalid("view path") }
        } else {
            nodes = .object([])
            path = []
            let messages = try chat.required("messages").array("messages")
            for (index, message) in messages.enumerated() {
                let id = try nextID()
                guard nodes[id] == nil else { throw ExchangeError.invalid("node ID collision") }
                let hash = try add(message.required("content"))
                let parent = path.last.map(OrderedJSON.string) ?? .null
                nodes = nodes.replacing(id, with: node(id: id, parent: parent, role: try message.required("role").string("role"), hash: hash, now: now - Double(messages.count - index) * 1000))
                path.append(id)
            }
            for key in ["collapsedNodes", "omittedNodes", "protectedNodes"] {
                if let flags = chat[key] {
                    let remapped = try flags.object(key).map { field -> JSONField in
                        if let index = Int(field.key), String(index) == field.key, path.indices.contains(index) {
                            return JSONField(key: path[index], value: field.value)
                        }
                        return field
                    }
                    guard Set(remapped.map { Data($0.key.utf8) }).count == remapped.count else { throw ExchangeError.invalid("node flag ID collision") }
                    chat = chat.replacing(key, with: .object(remapped))
                }
            }
            tree = .object([JSONField(key: "nodes", value: nodes), JSONField(key: "rootId", value: .string(path.first ?? "")), JSONField(key: "activePath", value: .array(path.map(OrderedJSON.string)))])
            for (index, message) in messages.enumerated() { tree = try MessageAttributes.setting(tree, nodeID: path[index], message: message) }
        }
        let targetIndex: Int?
        if mode == .append { targetIndex = nil }
        else if chat["branchTree"] == nil {
            guard let nodeID, nodeID.hasPrefix("message-"), let index = Int(nodeID.dropFirst(8)), path.indices.contains(index) else { throw ExchangeError.invalid("flat message ID") }
            targetIndex = index
        } else {
            guard let nodeID, let index = path.firstIndex(where: { $0.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("message node ID") }
            targetIndex = index
        }
        let oldNode = targetIndex.map { nodes[path[$0]]! }
        let oldRole = try oldNode?["role"]?.string("role")
        if mode == .overwrite, let index = targetIndex {
            let originalKey = path[index]
            guard chat["protectedNodes"]?[originalKey] != .bool(true) else { throw ExchangeError.invalid("保護された本文は変更できません") }
            let old = oldNode!
            let oldHash = try old.required("contentHash").string("contentHash")
            let oldParts = try SyncRecords.resolveContent(store, hash: oldHash)
            if try oldRole == role && Data(SyncRecords.canonical(oldParts).utf8) == Data(SyncRecords.canonical(parts).utf8), chat["branchTree"] != nil {
                if chat == chats[chatIndex] { return source }
                chats[chatIndex] = chat
                return source.replacing("chats", with: .array(chats))
            }
            var updated = old.replacing("role", with: .string(role))
            if Data(try SyncRecords.canonical(oldParts).utf8) != Data(try SyncRecords.canonical(parts).utf8) {
                let hash = try add(parts)
                let entry = try store.required(oldHash)
                let count = try entry.required("refCount").number("refCount")
                guard count >= 1 else { throw ExchangeError.invalid("本文参照数不足") }
                store = store.replacing(oldHash, with: entry.replacing("refCount", with: .number(String(format: "%.0f", count - 1))))
                updated = updated.replacing("contentHash", with: .string(hash))
            }
            nodes = nodes.replacing(path[index], with: updated)
            tree = tree.replacing("rootId", with: .string(path.first ?? ""))
        } else {
            let id = try nextID()
            guard nodes[id] == nil else { throw ExchangeError.invalid("node ID collision") }
            let hash = try add(parts)
            let parent: OrderedJSON
            if mode == .branch, let index = targetIndex {
                parent = try oldNode!.required("parentId")
                path = Array(path.prefix(index)) + [id]
            } else {
                parent = path.last.map(OrderedJSON.string) ?? .null
                path.append(id)
                tree = tree.replacing("rootId", with: .string(path.first ?? ""))
            }
            nodes = nodes.replacing(id, with: node(id: id, parent: parent, role: role, hash: hash, now: now))
            if mode == .branch, let oldID = oldNode?["id"] {
                tree = try MessageAttributes.copying(from: tree, nodeID: oldID.string("node ID"), to: tree.replacing("nodes", with: nodes), newID: id)
            }
        }
        tree = tree.replacing("nodes", with: nodes).replacing("activePath", with: .array(path.map(OrderedJSON.string)))
        chat = chat.replacing("branchTree", with: tree)
        let affectsTop = targetIndex == 0
        if affectsTop && (role == "system" || oldRole == "system") {
            var config = chat["config"] ?? .object([])
            if role == "system" {
                let text = try parts.array("parts").compactMap { part -> String? in
                    guard part["type"] == .string("text") else { return nil }
                    let text = try part.required("text").string("text")
                    return text.isEmpty ? nil : text
                }.joined(separator: "\n")
                if text.isEmpty { config = removing("systemPrompt", from: config) }
                else { config = config.replacing("systemPrompt", with: .string(text)) }
            } else if oldRole == "system" { config = removing("systemPrompt", from: config) }
            chat = chat.replacing("config", with: config)
        }
        let messages = try path.map { id -> OrderedJSON in
            let current = try nodes.required(id)
            let content = try SyncRecords.resolveContent(store, hash: current.required("contentHash").string("contentHash"))
            let message = OrderedJSON.object([JSONField(key: "role", value: try current.required("role")), JSONField(key: "content", value: content)])
            return try MessageAttributes.projecting(message, owner: tree, nodeID: id)
        }
        chat = chat.replacing("messages", with: .array(messages))
        chats[chatIndex] = chat
        return source.replacing("chats", with: .array(chats)).replacing("contentStore", with: store)
    }
    private static func node(id: String, parent: OrderedJSON, role: String, hash: String, now: Double) -> OrderedJSON {
        .object([JSONField(key: "id", value: .string(id)), JSONField(key: "parentId", value: parent), JSONField(key: "role", value: .string(role)),
                 JSONField(key: "contentHash", value: .string(hash)), JSONField(key: "createdAt", value: .number(String(format: "%.0f", now)))])
    }
    private static func removing(_ key: String, from value: OrderedJSON) -> OrderedJSON {
        guard case .object(let fields) = value else { return value }
        return .object(fields.filter { !$0.key.utf8.elementsEqual(key.utf8) })
    }
}
