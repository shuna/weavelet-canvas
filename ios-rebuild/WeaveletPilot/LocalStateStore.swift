import Foundation

struct SavedChatState {
    let document: SyncDocument
    let exchange: WebExchange
    let conversations: [Conversation]
    let selectedConversationID: String
    let style: ChatStyle

    func encoded() throws -> Data {
        let views = conversations.map { conversation in
            OrderedJSON.object([
                JSONField(key: "chatID", value: .string(conversation.id)),
                JSONField(key: "selectedLeafID", value: .string(conversation.selectedLeafID)),
                JSONField(key: "displayedPathIDs", value: conversation.displayedPathIDs.map { .array($0.map(OrderedJSON.string)) } ?? .null)
            ])
        }
        // The state has the same depth budget as the external V3 root. Keep the
        // snapshot wrapper separate so persistence does not consume one extra level.
        let stateJSON = String(decoding: try document.snapshot.required("state").encoded(), as: UTF8.self)
        let storedSnapshot = document.snapshot.replacing("state", with: .string(stateJSON))
        return try OrderedJSON.object([
            JSONField(key: "version", value: .number("2")),
            JSONField(key: "snapshot", value: .string(String(decoding: try storedSnapshot.encoded(), as: UTF8.self))),
            JSONField(key: "v3Sidecar", value: .string(String(decoding: try document.v3Sidecar.encoded(), as: UTF8.self))),
            JSONField(key: "v3RootOrder", value: .array(document.v3RootOrder.map(OrderedJSON.string))),
            JSONField(key: "style", value: .string(style.rawValue)),
            JSONField(key: "selectedChatID", value: .string(selectedConversationID)),
            JSONField(key: "views", value: .array(views))
        ]).encoded()
    }

    init(exchange: WebExchange, document: SyncDocument, conversations: [Conversation], selectedConversationID: String, style: ChatStyle) {
        self.document = document
        self.exchange = exchange
        self.conversations = conversations
        self.selectedConversationID = selectedConversationID
        self.style = style
    }

    init(data: Data) throws {
        let saved = try OrderedJSON.decode(data)
        let version = try saved.required("version").number("version")
        guard version == 1 || version == 2,
              let style = ChatStyle(rawValue: try saved.required("style").string("style")) else { throw ExchangeError.invalid("保存形式") }
        let document: SyncDocument
        if version == 1 {
            let source = try saved.required("source")
            let exchange: WebExchange
            // Keep the external V3 depth limit independent of the local envelope.
            if case .string(let json) = source { exchange = try WebExchange(data: Data(json.utf8)) }
            else { exchange = try WebExchange(source: source) }
            document = try SyncDocument(v3: exchange.source)
        } else {
            let storedSnapshot = try OrderedJSON.decode(Data(saved.required("snapshot").string("snapshot").utf8))
            let state = try storedSnapshot.required("state")
            let snapshot: OrderedJSON
            if case .string(let json) = state {
                snapshot = storedSnapshot.replacing("state", with: try OrderedJSON.decode(Data(json.utf8)))
            } else {
                // Read the earlier v2 representation as well as the original v1 save.
                snapshot = storedSnapshot
            }
            let sidecar = try OrderedJSON.decode(Data(saved.required("v3Sidecar").string("sidecar").utf8))
            let order = try saved.required("v3RootOrder").array("root order").map { try $0.string("root") }
            guard Set(order.map { Data($0.utf8) }).count == order.count else { throw ExchangeError.invalid("V3 root order") }
            document = try SyncDocument(snapshot: snapshot, v3Sidecar: sidecar, v3RootOrder: order)
        }
        let exchange = try WebExchange(source: document.uiProjection())
        var conversations = exchange.conversations
        let selected = try saved.required("selectedChatID").string("selectedChatID")
        guard (conversations.isEmpty && selected.isEmpty) || conversations.contains(where: { $0.id.utf8.elementsEqual(selected.utf8) }) else {
            throw ExchangeError.invalid("保存した会話の選択")
        }
        let views = try saved.required("views").array("views")
        var seen = Set<Data>()
        guard views.count == conversations.count else { throw ExchangeError.invalid("保存した閲覧状態") }
        for view in views {
            let chatID = try view.required("chatID").string("chatID")
            guard seen.insert(Data(chatID.utf8)).inserted,
                  let index = conversations.firstIndex(where: { $0.id.utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("保存した会話ID") }
            let leaf = try view.required("selectedLeafID").string("selectedLeafID")
            guard leaf.isEmpty || conversations[index].nodes.contains(where: { $0.id.utf8.elementsEqual(leaf.utf8) }) else { throw ExchangeError.invalid("保存した分岐") }
            let pathValue = try view.required("displayedPathIDs")
            var path: [String]?
            if pathValue != .null {
                path = try pathValue.array("displayedPathIDs").map { try $0.string("path ID") }
                guard path!.allSatisfy({ id in conversations[index].nodes.contains { $0.id.utf8.elementsEqual(id.utf8) } }),
                      (path!.last ?? "").utf8.elementsEqual(leaf.utf8) else { throw ExchangeError.invalid("保存した表示path") }
            }
            conversations[index].selectedLeafID = leaf
            conversations[index].displayedPathIDs = path
        }
        self.init(exchange: exchange, document: document, conversations: conversations, selectedConversationID: selected, style: style)
    }
}

struct LocalStateStore {
    let fileURL: URL

    static var applicationStore: LocalStateStore {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return LocalStateStore(fileURL: support.appendingPathComponent("com.weavelet.nativepilot", isDirectory: true).appendingPathComponent("local-state.json"))
    }

    func load() throws -> SavedChatState? {
        do { return try SavedChatState(data: Data(contentsOf: fileURL)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }

    func save(_ state: SavedChatState) throws {
        let data = try state.encoded()
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: fileURL, options: .atomic)
    }
}
