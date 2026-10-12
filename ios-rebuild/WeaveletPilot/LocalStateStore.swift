import Foundation

struct SavedChatState {
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
        return try OrderedJSON.object([
            JSONField(key: "version", value: .number("1")),
            JSONField(key: "source", value: .string(String(decoding: try exchange.encoded(), as: UTF8.self))),
            JSONField(key: "style", value: .string(style.rawValue)),
            JSONField(key: "selectedChatID", value: .string(selectedConversationID)),
            JSONField(key: "views", value: .array(views))
        ]).encoded()
    }

    init(exchange: WebExchange, conversations: [Conversation], selectedConversationID: String, style: ChatStyle) {
        self.exchange = exchange
        self.conversations = conversations
        self.selectedConversationID = selectedConversationID
        self.style = style
    }

    init(data: Data) throws {
        let saved = try OrderedJSON.decode(data)
        guard try saved.required("version").number("version") == 1,
              let style = ChatStyle(rawValue: try saved.required("style").string("style")) else { throw ExchangeError.invalid("保存形式") }
        let source = try saved.required("source")
        let exchange: WebExchange
        // Keep the external V3 depth limit independent of the local envelope.
        if case .string(let json) = source {
            exchange = try WebExchange(data: Data(json.utf8))
        } else {
            exchange = try WebExchange(source: source)
        }
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
        self.init(exchange: exchange, conversations: conversations, selectedConversationID: selected, style: style)
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
