import Foundation

// Projection is for viewing. The ordered source model remains the export authority.
struct WebExchange {
    let source: OrderedJSON
    let conversations: [Conversation]

    init(data: Data) throws { try self.init(source: OrderedJSON.decode(data)) }

    init(source: OrderedJSON) throws {
        _ = try source.object("export")
        guard try source.required("version").number("version") == 3 else { throw ExchangeError.invalid("versionは3のみ対応") }
        let store = try source.required("contentStore")
        var bodies: [Data: [MessagePart]] = [:]
        for field in try store.object("contentStore") {
            _ = try field.value.object("contentStore entry")
            guard field.value["delta"] == nil else { throw ExchangeError.invalid("deltaは展開済みV3へ書き出してください") }
            let refCount = try field.value.required("refCount").number("refCount")
            guard refCount >= 0, refCount.rounded() == refCount else { throw ExchangeError.invalid("refCount") }
            bodies[Data(field.key.utf8)] = try Self.parts(field.value.required("content"))
        }
        let folders = try source.required("folders")
        for field in try folders.object("folders") {
            _ = try field.value.required("id").string("folder.id")
            _ = try field.value.required("name").string("folder.name")
            _ = try field.value.required("order").number("folder.order")
            _ = try field.value.required("expanded").boolean("folder.expanded")
        }
        if let settings = source["evaluationSettings"] {
            _ = try settings.object("evaluationSettings")
            for key in ["safetyPreSend", "safetyPostReceive", "qualityPreSend", "qualityPostReceive"] {
                guard ["manual", "auto"].contains(try settings.required(key).string(key)) else { throw ExchangeError.invalid(key) }
            }
            if let engine = settings["safetyEngine"] {
                guard ["remote", "local", "hybrid"].contains(try engine.string("safetyEngine")) else { throw ExchangeError.invalid("safetyEngine") }
            }
            if let flag = settings["hybridRemoteOnSafe"] { _ = try flag.boolean("hybridRemoteOnSafe") }
        }
        if let results = source["evaluationResults"] {
            for field in try results.object("evaluationResults") {
                guard ["pre-send", "post-receive"].contains(try field.value.required("phase").string("evaluation.phase")) else {
                    throw ExchangeError.invalid("evaluation.phase")
                }
            }
        }
        var capturedChats: [OrderedJSON] = []
        var chats: [Conversation] = []
        var chatIDs = Set<Data>()
        for original in try source.required("chats").array("chats") {
            let chat = try MessageAttributes.capture(original, store: store)
            if let tree = chat["branchTree"] { _ = try MessageAttributes.read(tree) }
            capturedChats.append(chat)
            let id = try chat.required("id").string("chat.id")
            guard !id.isEmpty, chatIDs.insert(Data(id.utf8)).inserted else { throw ExchangeError.invalid("chat.id重複または空") }
            let title = try chat.required("title").string("chat.title")
            if let flag = chat["titleSet"] { _ = try flag.boolean("titleSet") }
            if let folder = chat["folder"] { _ = try folder.string("chat.folder") }
            if let detail = chat["imageDetail"] { try Self.imageDetail(detail) }
            if let config = chat["config"] { try Self.validateConfig(config) }
            let messageValue: OrderedJSON
            if let value = chat["messages"] { messageValue = value }
            else if chat["branchTree"] != nil { messageValue = .array([]) }
            else { messageValue = try chat.required("messages") }
            let messages = try messageValue.array("messages")
            var flat: [MessageNode] = []
            for (index, message) in messages.enumerated() {
                let parts = try Self.parts(message.required("content"))
                flat.append(MessageNode(id: "message-\(index)", parentId: index == 0 ? nil : "message-\(index - 1)", createdAt: 0, role: try Self.role(message.required("role")), parts: parts))
            }
            if let tree = chat["branchTree"] {
                _ = try tree.object("branchTree")
                _ = try tree.required("rootId").string("rootId")
                var nodes: [MessageNode] = []
                for field in try tree.required("nodes").object("nodes") {
                    let node = field.value
                    let nodeID = try node.required("id").string("node.id")
                    guard !nodeID.isEmpty, nodeID.utf8.elementsEqual(field.key.utf8) else { throw ExchangeError.invalid("node.id/key") }
                    let parent = try node.required("parentId")
                    let parentID: String?
                    if parent == .null { parentID = nil } else {
                        parentID = try parent.string("parentId")
                        guard parentID != "" else { throw ExchangeError.invalid("parentId空") }
                    }
                    let hash = try node.required("contentHash").string("contentHash")
                    guard let parts = bodies[Data(hash.utf8)] else { throw ExchangeError.invalid("contentHash参照欠損: \(hash)") }
                    if let label = node["label"] { _ = try label.string("label") }
                    for key in ["starred", "pinned"] { if let flag = node[key] { _ = try flag.boolean(key) } }
                    nodes.append(MessageNode(id: nodeID, parentId: parentID, createdAt: try node.required("createdAt").number("createdAt"), role: try Self.role(node.required("role")), parts: parts))
                }
                try Self.validateAcyclic(nodes)
                let path = try tree.required("activePath").array("activePath").map { try $0.string("activePath ID") }
                guard path.allSatisfy({ id in nodes.contains { $0.id.utf8.elementsEqual(id.utf8) } }) else { throw ExchangeError.invalid("activePath参照欠損") }
                for key in ["collapsedNodes", "omittedNodes", "protectedNodes"] {
                    if let record = chat[key] {
                        for field in try record.object(key) { _ = try field.value.boolean(key) }
                    }
                }
                chats.append(Conversation(id: id, title: title, nodes: nodes, selectedLeafID: path.last ?? "", displayedPathIDs: path))
            } else {
                chats.append(Conversation(id: id, title: title, nodes: flat, selectedLeafID: flat.last?.id ?? ""))
            }
        }
        if let clipboard = source["branchClipboard"], clipboard != .null { _ = try MessageAttributes.read(clipboard) }
        self.source = source.replacing("chats", with: .array(capturedChats))
        conversations = chats
    }

    func encoded() throws -> Data {
        let store = try source.required("contentStore")
        let chats = try source.required("chats").array("chats").map { chat -> OrderedJSON in
            guard let tree = chat["branchTree"], try MessageAttributes.read(tree) != nil else { return chat }
            let messages = try tree.required("activePath").array("activePath").map { id -> OrderedJSON in
                let nodeID = try id.string("node ID"), node = try tree.required("nodes").required(nodeID)
                let body = try SyncRecords.resolveContent(store, hash: node.required("contentHash").string("hash"))
                let message = OrderedJSON.object([JSONField(key: "role", value: try node.required("role")), JSONField(key: "content", value: body)])
                return try MessageAttributes.projecting(message, owner: tree, nodeID: nodeID)
            }
            return chat.replacing("messages", with: .array(messages))
        }
        return try source.replacing("chats", with: .array(chats)).encoded()
    }

    private static func role(_ value: OrderedJSON) throws -> String {
        let role = try value.string("role")
        guard ["system", "user", "assistant"].contains(role) else { throw ExchangeError.invalid("role") }
        return role
    }

    private static func imageDetail(_ value: OrderedJSON) throws {
        guard ["auto", "low", "high"].contains(try value.string("image detail")) else { throw ExchangeError.invalid("image detail") }
    }

    private static func parts(_ value: OrderedJSON) throws -> [MessagePart] {
        try value.array("content").map { part in
            let type = try part.required("type").string("content.type")
            switch type {
            case "text": return .text(try part.required("text").string("text"))
            case "reasoning": return .reasoning(try part.required("text").string("reasoning.text"))
            case "image_url":
                let image = try part.required("image_url")
                let url = try image.required("url").string("image_url.url")
                let detail = try image.required("detail")
                try imageDetail(detail)
                return .image(url: url, detail: try detail.string("image detail"))
            case "tool_call":
                return .toolCall(id: try part.required("id").string("tool_call.id"), name: try part.required("name").string("tool_call.name"), arguments: try part.required("arguments").string("tool_call.arguments"))
            case "tool_result":
                return .toolResult(callID: try part.required("tool_call_id").string("tool_result.tool_call_id"), content: try part.required("content").string("tool_result.content"))
            default: throw ExchangeError.invalid("未対応のcontent.type: \(type)")
            }
        }
    }

    private static func validateConfig(_ config: OrderedJSON) throws {
        _ = try config.object("config")
        for key in ["max_tokens", "temperature", "presence_penalty", "top_p", "frequency_penalty", "reasoning_budget_tokens"] {
            if let value = config[key] { _ = try value.number("config.\(key)") }
        }
        for key in ["model", "providerId", "systemPrompt", "reasoning_effort", "verbosity", "modelSource"] {
            if let value = config[key] { _ = try value.string("config.\(key)") }
        }
        for key in ["stream", "force_reasoning"] { if let value = config[key] { _ = try value.boolean("config.\(key)") } }
        if let settings = config["modelSettings"] {
            for field in try settings.object("modelSettings") { try validateConfig(field.value) }
        }
        if let router = config["openRouter"] { _ = try router.object("openRouter") }
    }

    private static func validateAcyclic(_ nodes: [MessageNode]) throws {
        let byID = Dictionary(uniqueKeysWithValues: nodes.map { (Data($0.id.utf8), $0) })
        var complete = Set<Data>()
        for node in nodes {
            var path = Set<Data>()
            var current: String? = node.id
            while let id = current, let next = byID[Data(id.utf8)], !complete.contains(Data(id.utf8)) {
                guard path.insert(Data(id.utf8)).inserted else { throw ExchangeError.invalid("branchTree循環") }
                current = next.parentId
            }
            complete.formUnion(path)
        }
    }
}

enum MessagePart: Equatable {
    case text(String), reasoning(String), image(url: String, detail: String)
    case toolCall(id: String, name: String, arguments: String), toolResult(callID: String, content: String)
}
