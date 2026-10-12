import Foundation
import Combine

struct MessageNode: Decodable, Identifiable, Equatable {
    let id: String
    let parentId: String?
    let createdAt: Double
    var role: String = "assistant"
    var content: String = ""
    var parts: [MessagePart] = []

    var identity: Data { Data(id.utf8) }

    enum CodingKeys: String, CodingKey { case id, parentId, createdAt }
}

// Web object keys enumerate array indices first, then ordinary keys in insertion order.
func siblings(of nodeID: String, in nodes: [MessageNode]) -> [MessageNode] {
    guard let target = nodes.first(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { return [] }
    func index(_ id: String) -> UInt32? {
        guard let value = UInt32(id), value < UInt32.max, String(value) == id else { return nil }
        return value
    }
    let ordered = nodes.enumerated().sorted { lhs, rhs in
        switch (index(lhs.element.id), index(rhs.element.id)) {
        case let (left?, right?): return left < right
        case (_?, nil): return true
        case (nil, _?): return false
        case (nil, nil): return lhs.offset < rhs.offset
        }
    }
    return ordered.map(\.element).filter { $0.parentId.map { Data($0.utf8) } == target.parentId.map { Data($0.utf8) } }
}

struct Conversation: Identifiable {
    let id: String
    let title: String
    var identity: Data { Data(id.utf8) }
    let nodes: [MessageNode]
    var selectedLeafID: String
    var displayedPathIDs: [String]? = nil

    var visibleMessages: [MessageNode] {
        if let ids = displayedPathIDs {
            return ids.compactMap { id in nodes.first { $0.id.utf8.elementsEqual(id.utf8) } }
        }
        var visited = Set<Data>()
        var path: [MessageNode] = []
        var nodeID: String? = selectedLeafID
        while let id = nodeID, visited.insert(Data(id.utf8)).inserted, let node = nodes.first(where: { $0.id.utf8.elementsEqual(id.utf8) }) {
            path.append(node)
            nodeID = node.parentId
        }
        return path.reversed()
    }
}

enum ChatStyle: String, CaseIterable, Identifiable {
    case stream = "整列表示"
    case bubbles = "吹き出し表示"
    var id: Self { self }
}

struct ActiveGeneration {
    let id: UUID
    let chatID: String
    let baseSource: OrderedJSON
    let path: [String]
    var output = RemoteOutput()
    var running = true
}

final class ChatState: ObservableObject {
    @Published private(set) var conversations = Conversation.samples
    @Published private var selectedID = Conversation.samples[0].id
    @Published private var displayStyle: ChatStyle = .stream
    @Published private(set) var exchange: WebExchange?
    @Published private(set) var document: SyncDocument?
    @Published var persistenceError: String?
    @Published private(set) var generation: ActiveGeneration?
    @Published private(set) var remoteSettings = RemoteSettings()
    @Published var generationError: String?
    private var generationTask: Task<Void, Never>?
    private let store: LocalStateStore?
    private var initialLoadFailed = false

    init(store: LocalStateStore? = nil) {
        self.store = store
        guard let store else { return }
        do {
            if let saved = try store.load() {
                conversations = saved.conversations
                selectedID = saved.selectedConversationID
                displayStyle = saved.style
                exchange = saved.exchange
                document = saved.document
            }
        } catch { initialLoadFailed = true; persistenceError = "保存した会話を復元できませんでした。保存ファイルは変更していません。\n" + error.localizedDescription }
    }

    var selectedConversationID: String {
        get { selectedID }
        set {
            guard conversations.contains(where: { $0.id.utf8.elementsEqual(newValue.utf8) }) else { return }
            update(conversations: conversations, selectedID: newValue, style: displayStyle)
        }
    }
    var style: ChatStyle {
        get { displayStyle }
        set { update(conversations: conversations, selectedID: selectedID, style: newValue) }
    }
    var conversation: Conversation? { conversations.first { $0.id.utf8.elementsEqual(selectedID.utf8) } }

    func importWebData(_ data: Data) throws {
        let rawV3 = try OrderedJSON.decode(data)
        let candidate = try document.map { try $0.importingV3(rawV3) } ?? SyncDocument(v3: rawV3)
        let imported = try WebExchange(source: candidate.uiProjection())
        let selected = imported.conversations.first?.id ?? ""
        try store?.save(SavedChatState(exchange: imported, document: candidate, conversations: imported.conversations, selectedConversationID: selected, style: displayStyle))
        invalidateGeneration()
        conversations = imported.conversations
        selectedID = selected
        exchange = imported
        document = candidate
        initialLoadFailed = false
        persistenceError = nil
    }

    func selectSibling(_ nodeID: String, of currentID: String) {
        guard let index = conversations.firstIndex(where: { $0.id.utf8.elementsEqual(selectedID.utf8) }),
              conversations[index].selectedLeafID.utf8.elementsEqual(currentID.utf8),
              siblings(of: currentID, in: conversations[index].nodes).contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { return }
        var changed = conversations
        changed[index].selectedLeafID = nodeID
        changed[index].displayedPathIDs = nil
        update(conversations: changed, selectedID: selectedID, style: displayStyle)
    }

    func messageDraft(nodeID: String?) throws -> MessageDraft {
        guard let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        let sourceChat = try exchange.source.required("chats").array("chats").first { chat in
            try chat.required("id").string("id").utf8.elementsEqual(conversation.id.utf8)
        }
        guard let sourceChat else { throw ExchangeError.invalid("chat ID") }
        let node = nodeID.flatMap { id in conversation.nodes.first { $0.id.utf8.elementsEqual(id.utf8) } }
        let parts: OrderedJSON
        let role: String
        var protected = false
        if let node {
            role = node.role
            if let tree = sourceChat["branchTree"] {
                let hash = try tree.required("nodes").required(node.id).required("contentHash").string("contentHash")
                parts = try exchange.source.required("contentStore").required(hash).required("content")
                protected = sourceChat["protectedNodes"]?[node.id] == .bool(true)
            } else {
                guard let index = conversation.nodes.firstIndex(where: { $0.identity == node.identity }) else { throw ExchangeError.invalid("message index") }
                parts = try sourceChat.required("messages").array("messages")[index].required("content")
                protected = sourceChat["protectedNodes"]?[String(index)] == .bool(true)
            }
        } else if nodeID == nil {
            parts = .array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string(""))])])
            role = "user"
        } else { throw ExchangeError.invalid("node ID") }
        var draft = MessageDraft(chatID: conversation.id, nodeID: nodeID, path: conversation.visibleMessages.map(\.id), originalParts: parts, originalRole: role, isProtected: protected, role: role, text: "")
        draft.text = draft.originalText
        return draft
    }

    func saveMessage(_ draft: MessageDraft, mode: MessageSaveMode, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        if mode == .append {
            let meaningful = try draft.parts.array("parts").contains { part in
                if part["type"] == .string("image_url") { return true }
                if part["type"] == .string("text"), case .string(let text) = part["text"] { return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                return false
            }
            guard meaningful else { throw ExchangeError.invalid("本文を入力してください") }
        }
        let sourceChat = try exchange.source.required("chats").array("chats").first { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }
        guard let sourceChat else { throw ExchangeError.invalid("chat ID") }
        let needed = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count + 1 : 1
        let ids = newIDs ?? (0..<needed).map { _ in UUID().uuidString.lowercased() }
        let source = try MessageEditing.save(in: exchange.source, chatID: draft.chatID, nodeID: draft.nodeID, viewingPath: draft.path, role: draft.role,
                                             parts: draft.parts, mode: mode, newIDs: ids, now: now)
        try applyLibrary(source, selectedID: draft.chatID, resetViewFor: draft.chatID, now: now)
    }

    func loadRemoteSettings(read: () throws -> RemoteCredentialRecord = RemoteCredentials.load) throws {
        remoteSettings = try read().settings
    }

    func saveRemoteSettings(_ record: RemoteCredentialRecord, write: (RemoteCredentialRecord) throws -> Void = RemoteCredentials.save) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成を停止してから設定してください") }
        _ = try record.settings.validatedURL()
        try write(record)
        remoteSettings = record.settings
    }

    func startGeneration(input: String, record: RemoteCredentialRecord, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil) throws {
        guard generation == nil, let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択し、生成の終了を待ってください") }
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ExchangeError.invalid("本文を入力してください") }
        let sourceChat = try exchange.source.required("chats").array("chats").first { try $0.required("id").string("ID").utf8.elementsEqual(conversation.id.utf8) }!
        let count = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count + 1 : 1
        let ids = nodeIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        let body = OrderedJSON.array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string(input))])])
        let now = Date().timeIntervalSince1970 * 1000
        let source = try MessageEditing.save(in: exchange.source, chatID: conversation.id, nodeID: nil, viewingPath: conversation.visibleMessages.map(\.id), role: "user", parts: body, mode: .append, newIDs: ids, now: now)
        let changed = try WebExchange(source: source)
        let path = changed.conversations.first { $0.identity == conversation.identity }!.visibleMessages.map(\.id)
        let request = try RemoteRequest.make(source: source, chatID: conversation.id, path: path, settings: record.settings, key: record.key)
        try applyLibrary(source, selectedID: conversation.id, resetViewFor: conversation.id, now: now)
        let id = UUID()
        generation = ActiveGeneration(id: id, chatID: conversation.id, baseSource: try publishedSource(), path: path)
        generationError = nil
        generationTask = Task { @MainActor [weak self] in
            do {
                try await client.complete(request, streaming: record.settings.stream) { [weak self] output in
                    guard let self, self.generation?.id == id, self.generation?.running == true,
                          self.exchange?.source == self.generation?.baseSource else { return }
                    self.generation?.output = output
                }
                self?.finishGeneration(id: id, error: nil)
            } catch {
                self?.finishGeneration(id: id, error: error)
            }
        }
    }

    func stopGeneration() {
        guard let generation, generation.running else { return }
        generationTask?.cancel()
        finishGeneration(id: generation.id, error: nil)
    }

    func saveGenerationResult() throws {
        guard let generation, !generation.running else { throw ExchangeError.invalid("生成結果がありません") }
        try persistGeneration(generation)
        generationError = nil
    }

    private func finishGeneration(id: UUID, error: Error?) {
        guard var current = generation, current.id == id, current.running, exchange?.source == current.baseSource else { return }
        current.running = false
        generation = current
        generationTask = nil
        if let error { generationError = "生成を完了できませんでした。\n" + error.localizedDescription }
        do { try persistGeneration(current) }
        catch { generationError = "生成結果を保存できませんでした。部分本文を保持しています。\n" + error.localizedDescription }
    }

    private func persistGeneration(_ current: ActiveGeneration) throws {
        guard exchange?.source == current.baseSource else { throw ExchangeError.invalid("生成開始後に会話が変更されています") }
        if current.output.isEmpty { generation = nil; return }
        let now = Date().timeIntervalSince1970 * 1000
        let source = try MessageEditing.save(in: current.baseSource, chatID: current.chatID, nodeID: nil, viewingPath: current.path, role: "assistant", parts: current.output.parts, mode: .append, newIDs: [UUID().uuidString.lowercased()], now: now)
        try applyLibrary(source, selectedID: current.chatID, resetViewFor: current.chatID, now: now)
        generation = nil
    }

    private func invalidateGeneration() {
        generationTask?.cancel()
        generationTask = nil
        generation = nil
    }

    func createChat(defaults: ChatDefaults, id: String = UUID().uuidString.lowercased(), folder: String? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let source = exchange?.source ?? ChatLibrary.emptySource
        var created = try ChatLibrary.create(in: source, id: id, defaults: defaults, folder: folder)
        if let folder { created = try ChatFolders.apply(in: created, operation: .move(chatIDs: [id], folderID: folder)) }
        try applyLibrary(created, selectedID: id, now: now)
    }

    func renameChat(id: String, title: String, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は変更できません") }
        try applyLibrary(ChatLibrary.rename(in: exchange.source, id: id, title: title), selectedID: selectedID, now: now)
    }

    func duplicateChat(id: String, newID: String = UUID().uuidString.lowercased(), now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は複製できません") }
        try applyLibrary(ChatLibrary.duplicate(in: exchange.source, id: id, newID: newID), selectedID: newID, now: now)
    }

    func deleteChats(ids: [String], defaults: ChatDefaults, replacementID: String = UUID().uuidString.lowercased(), now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は削除できません") }
        let source = try ChatLibrary.delete(in: exchange.source, ids: ids, replacementID: replacementID, defaults: defaults)
        let first = try source.required("chats").array("chats")[0].required("id").string("id")
        try applyLibrary(source, selectedID: first, now: now)
    }

    func folderRows() throws -> [ChatFolderRow] {
        guard let exchange else { return [] }
        return try ChatFolders.rows(in: exchange.source)
    }
    func folderID(for chatID: String) -> String? {
        guard let source = exchange?.source, case .array(let chats) = source["chats"],
              let chat = chats.first(where: { if case .string(let id) = $0["id"] { return id.utf8.elementsEqual(chatID.utf8) }; return false }) else { return nil }
        return ChatFolders.membership(of: chat)
    }
    func applyFolder(_ operation: ChatFolderOperation, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let source = exchange?.source ?? ChatLibrary.emptySource
        try applyLibrary(ChatFolders.apply(in: source, operation: operation), selectedID: exchange == nil ? "" : selectedID, preserveGeneration: true, now: now)
    }

    private func applyLibrary(_ source: OrderedJSON, selectedID: String, resetViewFor: String? = nil, preserveGeneration: Bool = false, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        let before = try exchange?.source ?? base.uiProjection()
        let candidate = try base.applyingV3Edits(source, comparedTo: before, now: now)
        let changed = try WebExchange(source: candidate.uiProjection())
        var views = changed.conversations
        for index in views.indices {
            if exchange != nil, resetViewFor.map({ !views[index].id.utf8.elementsEqual($0.utf8) }) ?? true, let previous = conversations.first(where: { $0.identity == views[index].identity }) {
                views[index].selectedLeafID = previous.selectedLeafID
                views[index].displayedPathIDs = previous.displayedPathIDs
            }
        }
        try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selectedID, style: displayStyle))
        if preserveGeneration, let current = generation {
            generation = ActiveGeneration(id: current.id, chatID: current.chatID, baseSource: changed.source, path: current.path, output: current.output, running: current.running)
        } else { invalidateGeneration() }
        conversations = views
        self.selectedID = selectedID
        exchange = changed
        document = candidate
        persistenceError = nil
    }

    private func publishedSource() throws -> OrderedJSON {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        return exchange.source
    }
    func publicationSnapshot() throws -> OrderedJSON {
        guard let document else { throw ExchangeError.invalid("保存済み会話がありません") }
        return document.snapshot
    }
    func exportWebData() throws -> Data {
        guard let document else { throw ExchangeError.invalid("保存済み会話がありません") }
        return try document.exportData()
    }
    func applySnapshot(_ snapshot: OrderedJSON) throws {
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        let candidate = try base.mergingSnapshot(snapshot)
        try applyDocument(candidate)
    }
    func syncInputSnapshot() throws -> OrderedJSON {
        guard !initialLoadFailed else { throw SyncSessionError.invalid("The saved local file could not be loaded; it was not replaced") }
        guard generation == nil else { throw SyncSessionError.invalid("Wait for the active generation before applying Google sync") }
        if let document { return document.snapshot }
        return try SyncDocument(v3:ChatLibrary.emptySource).snapshot
    }
    func applySynchronizedSnapshot(_ snapshot: OrderedJSON, expected: OrderedJSON) throws {
        guard try syncInputSnapshot() == expected else { throw SyncSessionError.invalid("Local data changed during sync") }
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        try applyDocument(base.synchronizingSnapshot(snapshot))
    }
    private func applyDocument(_ candidate: SyncDocument) throws {
        let changed = try WebExchange(source: candidate.uiProjection())
        var views = changed.conversations
        for index in views.indices {
            if let previous = conversations.first(where: { $0.identity == views[index].identity }),
               previous.visibleMessages.allSatisfy({ node in views[index].nodes.contains { $0.identity == node.identity } }) {
                views[index].selectedLeafID = previous.selectedLeafID
                views[index].displayedPathIDs = previous.displayedPathIDs
            }
        }
        let selected = views.contains { $0.id.utf8.elementsEqual(selectedID.utf8) } ? selectedID : views.first?.id ?? ""
        try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selected, style: displayStyle))
        invalidateGeneration()
        document = candidate; exchange = changed; conversations = views; selectedID = selected; persistenceError = nil
    }

    private func update(conversations: [Conversation], selectedID: String, style: ChatStyle) {
        do {
            if let exchange, let document {
                try store?.save(SavedChatState(exchange: exchange, document: document, conversations: conversations, selectedConversationID: selectedID, style: style))
            }
            self.conversations = conversations
            self.selectedID = selectedID
            displayStyle = style
            persistenceError = nil
        } catch { persistenceError = "変更を保存できませんでした。表示と保存データは変更していません。\n" + error.localizedDescription }
    }
}
