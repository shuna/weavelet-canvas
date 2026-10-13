import Foundation
import Combine

struct MessageNode: Decodable, Identifiable, Equatable {
    let id: String
    let parentId: String?
    let createdAt: Double
    var role: String = "assistant"
    var content: String = ""
    var parts: [MessagePart] = []
    var options: NodeOptions.Value = .init()

    var identity: Data { Data(id.utf8) }

    enum CodingKeys: String, CodingKey { case id, parentId, createdAt }
}

// Samples and fixture callers use the same Web sibling ordering as imported documents.
func siblingSource(_ conversations: [Conversation]) -> OrderedJSON {
    .object([.init(key: "chats", value: .array(conversations.map { chat in
        .object([.init(key: "id", value: .string(chat.id)), .init(key: "branchTree", value: .object([
            .init(key: "activePath", value: .array(chat.visibleMessages.map { .string($0.id) })),
            .init(key: "nodes", value: .object(chat.nodes.map { node in
                .init(key: node.id, value: .object([.init(key: "id", value: .string(node.id)), .init(key: "parentId", value: node.parentId.map(OrderedJSON.string) ?? .null)]))
            }))
        ]))])
    }))])
}
func siblings(of nodeID: String, in nodes: [MessageNode]) throws -> [MessageNode] {
    let chat = Conversation(id: "sample", title: "", nodes: nodes, selectedLeafID: "")
    let ids = try BranchNavigation.candidates(in: siblingSource([chat])).first?.candidates(for: nodeID)?.siblingIDs ?? []
    return ids.compactMap { id in nodes.first { $0.id.utf8.elementsEqual(id.utf8) } }
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
    var plan: OrderedJSON? = nil
    var output = RemoteOutput()
    var running = true
    var completedSuccessfully = false
    var usesRemoteTransport = true
}

struct NavigationFocus: Equatable {
    let nodeID: String
    let token = UUID()
}

struct ComposerDraft {
    let parts: OrderedJSON
    var text: String
    let hasMeaningfulContent: Bool
    static let empty = ComposerDraft(parts:.array([]),text:"",hasMeaningfulContent:false)
}
enum ComposerContent {
    static func prepare(_ parts: OrderedJSON, text: String? = nil, images: [(url:String,detail:String)] = []) throws -> ComposerDraft {
        var boundary = SharedWebProjection()
        var fields: [JSONField] = [.init(key:"operation",value:.string("prepare")),.init(key:"parts",value:try boundary.parts(parts))]
        if let text { fields.append(.init(key:"text",value:.string(text))) }
        if !images.isEmpty { fields.append(.init(key:"images",value:.array(images.map { .object([.init(key:"url",value:.string($0.url)),.init(key:"detail",value:.string($0.detail))]) }))) }
        let result = try SharedWebOperations.call("composerContent",.object(fields))
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:result.required("parts"))])]),to:.null,opaque:boundary.opaque)
        return try ComposerDraft(parts:restored,text:result.required("text").string("composer text"),hasMeaningfulContent:result.required("hasMeaningfulContent").boolean("composer content"))
    }
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
    @Published private var composerDrafts: [Data:ComposerDraft] = [:]
    @Published private var assistantPrefills: [Data:String] = [:]
    private(set) var stickyPrefillKey = ""
    @Published private(set) var summaryJobs: [SummaryIdentity: SummaryJob] = [:]
    @Published private var summaryChosen: [SummaryIdentity:String] = [:]
    private var summaryTasks: [SummaryIdentity:Task<Void,Never>] = [:]
    @Published private(set) var evaluationJobs: [SummaryIdentity:EvaluationJob] = [:]
    private var evaluationTasks: [SummaryIdentity:Task<Void,Never>] = [:]
    @Published var titleError: String?
    private var titleTasks: [Data:(id:UUID,task:Task<Void,Never>)] = [:]
    private var pendingTitleContext: (id:UUID,legacy:RemoteCredentialRecord,client:RemoteClient,read:ProviderModels.CredentialReader)?
    private var generationTask: Task<Void, Never>?
    private let store: LocalStateStore?
    private let localGenerate: LocalLlama.Generator
    private let localEvaluationGenerate: LocalLlama.Generator?
    private var initialLoadFailed = false
    @Published private(set) var navigationFocus: NavigationFocus?
    @Published private(set) var canNavigateBack = false
    @Published private(set) var canNavigateForward = false
    private var navigationHistory: OrderedJSON?
    private var branchCandidates: [BranchNavigation.ChatCandidates] = []
    @Published private var editingHistory: MessageEditing.HistoryState?
    var canUndoMessageEdit: Bool { generation == nil && (editingHistory?.canUndo ?? false) }
    var canRedoMessageEdit: Bool { generation == nil && (editingHistory?.canRedo ?? false) }

    init(store: LocalStateStore? = nil, localGenerate: LocalLlama.Generator? = nil) {
        self.store = store
        self.localGenerate = localGenerate ?? { url, request, onText in
            try await LocalLlama.generate(modelURL:url,request:request,onText:onText)
        }
        self.localEvaluationGenerate = localGenerate
        do {
            stickyPrefillKey = try SharedWebOperations.call("assistantPrefill",.object([.init(key:"operation",value:.string("resolve")),.init(key:"mode",value:.string("append")),.init(key:"insertIndex",value:.null)])).required("key").string("prefill key")
            branchCandidates = try BranchNavigation.candidates(in: siblingSource(conversations))
            if let saved = try store?.load() {
                let candidates = try BranchNavigation.candidates(in: saved.exchange.source)
                conversations = saved.conversations
                selectedID = saved.selectedConversationID
                displayStyle = saved.style
                exchange = saved.exchange
                document = saved.document
                branchCandidates = candidates
            }
        } catch { initialLoadFailed = true; persistenceError = "保存した会話を復元できませんでした。保存ファイルは変更していません。\n" + error.localizedDescription }
    }

    var selectedConversationID: String {
        get { selectedID }
        set {
            guard conversations.contains(where: { $0.id.utf8.elementsEqual(newValue.utf8) }) else { return }
            if exchange != nil {
                do { try navigate(chatID: newValue, source: .chatSwitch) }
                catch { persistenceError = error.localizedDescription }
            } else { update(conversations: conversations, selectedID: newValue, style: displayStyle) }
        }
    }
    var style: ChatStyle {
        get { displayStyle }
        set { update(conversations: conversations, selectedID: selectedID, style: newValue) }
    }
    var conversation: Conversation? { conversations.first { $0.id.utf8.elementsEqual(selectedID.utf8) } }

    func importWebData(_ data: Data) throws {
        let rawV3 = try OrderedJSON.decode(NativeGzip.isCompressed(data) ? NativeGzip.decompress(data) : data)
        let candidate = try document.map { try $0.importingV3(rawV3) } ?? SyncDocument(v3: rawV3)
        let imported = try WebExchange(source: candidate.uiProjection())
        let selected = imported.conversations.first?.id ?? ""
        let candidates = try BranchNavigation.candidates(in: imported.source)
        let nextEditing = try exchange.map { try MessageEditing.invalidatingHistory(editingHistory, before: $0.source, after: imported.source) } ?? nil
        try store?.save(SavedChatState(exchange: imported, document: candidate, conversations: imported.conversations, selectedConversationID: selected, style: displayStyle))
        invalidateGeneration(); cancelTitles(); cancelSummaries(); cancelEvaluations()
        conversations = imported.conversations
        selectedID = selected
        exchange = imported
        editingHistory = nextEditing
        document = candidate
        initialLoadFailed = false
        branchCandidates = candidates
        navigationHistory = nil; navigationFocus = nil; canNavigateBack = false; canNavigateForward = false
        persistenceError = nil
    }

    func prepareImport(data: Data, filename: String, allowPartialImport: Bool = false) async throws -> ChatImportPreview {
        guard generation == nil else { throw ExchangeError.invalid("生成中は取り込めません") }
        let baseline = document?.snapshot
        let raw = try OrderedJSON.decode(NativeGzip.isCompressed(data) ? NativeGzip.decompress(data) : data)
        var boundary = SharedWebProjection()
        let projected = try ChatImport.project(raw, kind: "data", boundary: &boundary)
        let defaults = try ChatImport.call("defaults")
        let prepared = try ChatImport.call("prepare", fields: [
            .init(key:"data",value:projected),.init(key:"defaults",value:defaults),
            .init(key:"allowEmpty",value:.bool(true)),
            .init(key:"decisions",value:.object(allowPartialImport ? [.init(key:"allowPartialImport",value:.bool(true))] : []))])
        let status = try prepared.required("status").string("import status")
        if status == "decision-required" {
            let decision = try prepared.required("decision")
            let kind = try decision.required("kind").string("decision kind")
            let message = try decision.required("message").string("decision message")
            if kind == "partial-import", !allowPartialImport { throw ChatImportDecisionRequired(kind:kind,message:message) }
            throw ExchangeError.invalid(message)
        }
        guard status == "ready" else { throw ExchangeError.invalid(try prepared["result"]?["message"]?.string("import error") ?? "取り込みに失敗しました") }
        let source = try ChatImport.restore(prepared.required("source"),boundary:boundary)
        let previewV3 = try ChatImport.restore(prepared.required("previewV3"),boundary:boundary)
        let imported = try WebExchange(source:previewV3)
        var unavailable: [String:[String]] = [:]
        for field in try source.required("unavailableContent").object("unavailable content") {
            unavailable[field.key] = try field.value.array("unavailable nodes").map { try $0.string("node ID") }
        }
        return ChatImportPreview(filename:filename,conversations:imported.conversations,folderRows:try ChatFolders.rows(in:imported.source),
            recoveredContentCount:Int(try source.required("recoveredContentCount").number("recovered count")),unavailableContent:unavailable,
            source:source,baselineSnapshot:baseline,baselineSidecar:document?.v3Sidecar,baselineRootOrder:document?.v3RootOrder)
    }
    func commitImport(_ preview: ChatImportPreview, mode: ChatImportMode, selectedChatIDs: [String], selectedFolderIDs: [String], includeSettings: Bool) async throws {
        guard generation == nil else { throw ExchangeError.invalid("生成中は取り込めません") }
        guard try document?.snapshot.encoded() == preview.baselineSnapshot?.encoded(),
              try document?.v3Sidecar.encoded() == preview.baselineSidecar?.encoded(),
              document?.v3RootOrder.map({ Data($0.utf8) }) == preview.baselineRootOrder?.map({ Data($0.utf8) }) else { throw ExchangeError.invalid("取り込み準備後に保存データが変更されています") }
        guard !initialLoadFailed || mode == .replace else { throw ExchangeError.invalid("保存ファイルを読めなかったため追加できません。明示的な置換が必要です") }
        let base = try document ?? SyncDocument(v3:ChatLibrary.emptySource)
        var boundary = SharedWebProjection()
        let projectedBase = try ChatImport.project(base.snapshot.required("state"),kind:"state",boundary:&boundary)
        let projectedSource = try ChatImport.project(preview.source,kind:"source",boundary:&boundary)
        var extensions: [JSONField] = []
        for field in try base.v3Sidecar.object("sidecar") { extensions.append(.init(key:field.key,value:try boundary.reference(field.value))) }
        let planned = try ChatImport.call("plan",fields:[.init(key:"base",value:projectedBase),.init(key:"source",value:projectedSource),
            .init(key:"baseExtensions",value:.object(extensions)),.init(key:"defaults",value:try ChatImport.call("defaults")),
            .init(key:"mode",value:.string(mode.rawValue)),.init(key:"selectedChatIds",value:.array(selectedChatIDs.map(OrderedJSON.string))),
            .init(key:"selectedFolderIds",value:.array(selectedFolderIDs.map(OrderedJSON.string))),.init(key:"includeSettings",value:.bool(includeSettings)),
            .init(key:"fileName",value:.string(preview.filename)),.init(key:"currentChatId",value:.string(selectedID))])
        let state = try OrderedJSONChanges.apply(planned.required("changes"),to:base.snapshot.required("state"),opaque:boundary.opaque)
        let sidecar = try OrderedJSONChanges.apply(planned.required("extensionChanges"),to:base.v3Sidecar,opaque:boundary.opaque)
        let candidate = try SyncDocument(snapshot:base.snapshot.replacing("state",with:state),v3Sidecar:sidecar,v3RootOrder:base.v3RootOrder)
        let chats = try state.required("chats").array("chats")
        let index = Int(try planned.required("currentChatIndex").number("current chat index"))
        let selected = chats.indices.contains(index) ? try chats[index].required("id").string("chat ID") : ""
        try applyDocument(candidate, selectedID:selected, resetViews:true)
        initialLoadFailed = false
    }

    func siblings(for nodeID: String) -> [MessageNode] {
        guard let conversation else { return [] }
        let ids = branchCandidates.first { $0.chatID.utf8.elementsEqual(conversation.id.utf8) }?.candidates(for: nodeID)?.siblingIDs ?? []
        return ids.compactMap { id in conversation.nodes.first { $0.id.utf8.elementsEqual(id.utf8) } }
    }

    func selectSibling(_ nodeID: String, of currentID: String) {
        guard generation == nil, !nodeID.utf8.elementsEqual(currentID.utf8),
              let index = conversations.firstIndex(where: { $0.id.utf8.elementsEqual(selectedID.utf8) }),
              siblings(for: currentID).contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { return }
        if exchange != nil {
            do { try navigate(chatID: selectedID, nodeID: nodeID, source: .branchSwitch) }
            catch { persistenceError = error.localizedDescription }
        } else {
            var changed = conversations
            changed[index].selectedLeafID = nodeID
            changed[index].displayedPathIDs = nil
            update(conversations: changed, selectedID: selectedID, style: displayStyle)
        }
    }

    private func currentNavigationHistory(in source: OrderedJSON) throws -> BranchNavigation.HistoryResult {
        let history = try navigationHistory ?? BranchNavigation.emptyHistory()
        return try BranchNavigation.history(history, action: .initialize, in: source, chatID: selectedID, view: "chat", viewingPath: conversation?.visibleMessages.map(\.id))
    }

    func navigate(chatID: String, nodeID: String? = nil, source: BranchNavigation.Source) throws {
        guard generation == nil, let exchange else { throw ExchangeError.invalid("生成結果を保存してから会話を移動してください") }
        let history = try currentNavigationHistory(in: exchange.source)
        let path = conversations.first { $0.id.utf8.elementsEqual(chatID.utf8) }?.visibleMessages.map(\.id)
        let target = try BranchNavigation.navigate(in: exchange.source, chatID: chatID, nodeID: nodeID, source: source, viewingPath: path)
        guard target.status == .reached else { throw ExchangeError.invalid("移動先の会話またはメッセージがありません") }
        let next = try BranchNavigation.history(history.history, action: .push, in: target.source, target: target, view: "chat", navigationSource: source)
        try applyLibrary(target.source, selectedID: chatID, resetViewFor: chatID, navigation: next)
        navigationFocus = (target.focusedNodeID ?? target.path.last).map { NavigationFocus(nodeID: $0) }
    }

    func moveNavigation(_ direction: BranchNavigation.HistoryAction) throws {
        guard generation == nil, let exchange, direction == .back || direction == .forward else { throw ExchangeError.invalid("現在は履歴を移動できません") }
        let current = try currentNavigationHistory(in: exchange.source)
        let next = try BranchNavigation.history(current.history, action: direction, in: exchange.source)
        guard next.history != current.history, let entry = next.entry else { return }
        let target = try BranchNavigation.restore(in: exchange.source, entry: entry)
        guard target.status == .reached, let chatID = target.chatID else { throw ExchangeError.invalid("移動先の会話がありません") }
        try applyLibrary(target.source, selectedID: chatID, resetViewFor: chatID, navigation: next)
        navigationFocus = (target.focusedNodeID ?? target.path.last).map { NavigationFocus(nodeID: $0) }
    }

    private func historySelecting(_ chatID: String, in source: OrderedJSON) throws -> BranchNavigation.HistoryResult? {
        guard !selectedID.utf8.elementsEqual(chatID.utf8), let exchange else { return nil }
        let current = try currentNavigationHistory(in: exchange.source)
        let target = try BranchNavigation.navigate(in: source, chatID: chatID, source: .chatSwitch)
        guard target.status == .reached else { return nil }
        return try BranchNavigation.history(current.history, action: .push, in: source, target: target, view: "chat", navigationSource: .chatSwitch)
    }

    private func publishNavigation(_ next: BranchNavigation.HistoryResult, focus: String?) {
        navigationHistory = next.history
        canNavigateBack = next.canBack
        canNavigateForward = next.canForward
        navigationFocus = focus.map { NavigationFocus(nodeID: $0) }
    }

    func chatConfigDraft() throws -> ChatConfigDraft {
        guard let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        guard let chat = try exchange.source.required("chats").array("chats").first(where:{ try $0.required("id").string("id").utf8.elementsEqual(conversation.id.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let snapshot = try publicationSnapshot()
        return try ChatConfigDraft(chatID:conversation.id,source:exchange.source,snapshot:snapshot,modelState:ChatConfig.modelState(in:snapshot.required("state")),config:chat["config"] ?? ChatDefaults.webInitial().config)
    }
    func defaultChatConfigDraft() throws -> ChatConfigDraft {
        let snapshot = try syncInputSnapshot(), roots = try snapshot.required("state")
        let settings = try ChatDefaults.resolved(in:roots).required("settings")
        return try ChatConfigDraft(chatID:"",source:exchange?.source ?? ChatLibrary.emptySource,snapshot:snapshot,
            modelState:ChatConfig.modelState(in:roots),config:settings.required("defaultChatConfig"),
            defaultSettings:(settings.required("defaultSystemMessage").string("system message"),settings.required("defaultImageDetail").string("image detail")))
    }
    func saveDefaultChatConfig(_ draft: ChatConfigDraft) throws {
        guard let settings = draft.defaultSettings else { throw ExchangeError.invalid("新規会話の設定ではありません") }
        guard try syncInputSnapshot().encoded() == draft.snapshot.encoded() else { throw ExchangeError.invalid("保存データが変更されています。設定を開き直してください") }
        let roots = OrderedJSON.object([
            .init(key:"defaultChatConfig",value:try ChatConfig.normalizedDefaults(draft.config,modelState:draft.modelState)),
            .init(key:"defaultSystemMessage",value:.string(settings.systemMessage)),
            .init(key:"defaultImageDetail",value:.string(settings.imageDetail))])
        try applySnapshot(.object([.init(key:"version",value:draft.snapshot.required("version")),.init(key:"state",value:roots)]))
    }
    func saveChatConfig(_ draft: ChatConfigDraft, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから設定してください") }
        guard let exchange, try exchange.source.encoded() == draft.source.encoded(), try publicationSnapshot().encoded() == draft.snapshot.encoded() else { throw ExchangeError.invalid("会話または設定が変更されました。設定を開き直してください") }
        var chats = try exchange.source.required("chats").array("chats")
        guard let index = try chats.firstIndex(where:{ try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        if try chats[index]["config"]?.encoded() == draft.config.encoded() { return }
        chats[index] = chats[index].replacing("config",with:draft.config)
        try applyLibrary(exchange.source.replacing("chats",with:.array(chats)),selectedID:selectedID,now:now)
    }

    @MainActor func refreshProviderModels(providerID: String, expectedSnapshot: OrderedJSON, client: ProviderModelClient = ProviderModelClient(), readCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) async throws {
        guard generation == nil, try syncInputSnapshot().encoded() == expectedSnapshot.encoded() else { throw ExchangeError.invalid("保存データが変更されています。モデル一覧を開き直してください") }
        let state = try expectedSnapshot.required("state")
        guard let provider = try ProviderModels.providers(in:state).first(where:{ $0.id.utf8.elementsEqual(providerID.utf8) }) else { throw ExchangeError.invalid("provider設定がありません") }
        let models = try await client.fetch(provider,readCredential:readCredential)
        try Task.checkCancellation()
        guard generation == nil, try syncInputSnapshot().encoded() == expectedSnapshot.encoded() else { throw ExchangeError.invalid("モデル取得中に保存データが変更されました。既存一覧を維持しています") }
        let roots = try ProviderModels.cacheChanges(state:state,providerID:providerID,models:models)
        try applySnapshot(.object([.init(key:"version",value:expectedSnapshot.required("version")),.init(key:"state",value:roots)]))
    }
    @MainActor func refreshModelsForConfig(_ draft: ChatConfigDraft, providerID: String, client: ProviderModelClient = ProviderModelClient(), readCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) async throws -> ChatConfigDraft {
        guard try draft.defaultSettings != nil || exchange?.source.encoded() == draft.source.encoded() else { throw ExchangeError.invalid("会話が変更されました。設定を開き直してください") }
        try await refreshProviderModels(providerID:providerID,expectedSnapshot:draft.snapshot,client:client,readCredential:readCredential)
        guard let source = self.exchange?.source, try draft.defaultSettings != nil || source.encoded() == draft.source.encoded() else { throw ExchangeError.invalid("会話が変更されました。設定を開き直してください") }
        let snapshot = try publicationSnapshot()
        return try ChatConfigDraft(chatID:draft.chatID,source:source,snapshot:snapshot,modelState:ChatConfig.modelState(in:snapshot.required("state")),config:draft.config,defaultSettings:draft.defaultSettings)
    }

    func nodeOptionsDraft(nodeID: String) throws -> NodeOptionsDraft {
        guard let exchange, let conversation,
              let node = conversation.nodes.first(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("メッセージがありません") }
        return NodeOptionsDraft(chatID: conversation.id, nodeID: nodeID, source: exchange.source, original: node.options, value: node.options)
    }

    func saveNodeOptions(_ draft: NodeOptionsDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから設定してください") }
        guard let exchange, exchange.source == draft.source else { throw ExchangeError.invalid("会話が変更されました。設定を開き直してください") }
        guard let sourceChat = try exchange.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let count = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count : 0
        let ids = newIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.saveOptions(in: exchange.source, chatID: draft.chatID, nodeID: draft.nodeID, value: draft.value, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        if source == exchange.source { return }
        try applyLibrary(source, selectedID: selectedID, resetViewFor: sourceChat["branchTree"] == nil ? draft.chatID : nil, editing: history, now: now)
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
        var draft = try MessageDraft(chatID: conversation.id, nodeID: nodeID, path: conversation.visibleMessages.map(\.id), source: exchange.source, originalParts: parts, originalRole: role, isProtected: protected, role: role, text: "")
        draft.text = draft.originalText
        return draft
    }

    func messageInsertionDraft(beforeNodeID: String) throws -> MessageDraft {
        guard let exchange, let conversation, conversation.nodes.contains(where: { $0.id.utf8.elementsEqual(beforeNodeID.utf8) }) else { throw ExchangeError.invalid("挿入先のメッセージがありません") }
        let parts = OrderedJSON.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string(""))])])
        return try MessageDraft(chatID:conversation.id,nodeID:beforeNodeID,path:conversation.visibleMessages.map(\.id),source:exchange.source,isInsertion:true,originalParts:parts,originalRole:"user",isProtected:false,role:"user",text:"")
    }

    func nodeRemovalDraft(nodeID: String) throws -> NodeRemovalDraft {
        guard let exchange, let conversation, conversation.visibleMessages.contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("削除するメッセージがありません") }
        return NodeRemovalDraft(chatID: conversation.id, nodeID: nodeID, source: exchange.source, path: conversation.visibleMessages.map(\.id), operation: .remove)
    }

    func pruneHiddenDraft() throws -> NodeRemovalDraft {
        guard let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        return NodeRemovalDraft(chatID: conversation.id, nodeID: nil, source: exchange.source, path: conversation.visibleMessages.map(\.id), operation: .pruneHidden)
    }

    func saveNodeRemoval(_ draft: NodeRemovalDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してからメッセージを削除してください") }
        guard let exchange, exchange.source == draft.source else { throw ExchangeError.invalid("会話が変更されました。削除操作を開き直してください") }
        guard let chat = try exchange.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let count = try chat["branchTree"] == nil && draft.operation == .remove ? chat.required("messages").array("messages").count : 0
        let ids = newIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.remove(in: exchange.source, chatID: draft.chatID, nodeID: draft.nodeID, viewingPath: draft.path, operation: draft.operation, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        if source == exchange.source { return }
        try applyLibrary(source, selectedID: draft.chatID, resetViewFor: draft.chatID, editing: history, now: now)
    }

    var hasBranchClipboard: Bool {
        guard let clipboard = document?.snapshot["state"]?["branchClipboard"], case .array(let ids) = clipboard["nodeIds"] else { return false }
        return !ids.isEmpty
    }
    func branchClipboardDraft(nodeID: String, operation: BranchClipboardOperation = .copy) throws -> BranchClipboardDraft {
        guard let exchange, let conversation, conversation.nodes.contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("対象メッセージがありません") }
        return try BranchClipboardDraft(source: exchange.source, snapshot: publicationSnapshot(), operation: operation, sourceChatID: conversation.id,
            fromNodeID: nodeID, toNodeID: nodeID, targetChatID: conversation.id, afterNodeID: nodeID)
    }
    func saveBranchClipboard(_ draft: BranchClipboardDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws -> BranchClipboardResult {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから範囲を操作してください") }
        guard let exchange, let document, exchange.source == draft.source, document.snapshot == draft.snapshot else { throw ExchangeError.invalid("会話またはコピーした範囲が変更されました。操作を開き直してください") }
        let clipboard = try document.snapshot.required("state")["branchClipboard"] ?? .null
        // Native allocates an upper-bound UUID pool, never reconstructing the selected tree range.
        let selected = try exchange.source.required("chats").array("chats").filter { chat in
            let id = try chat.required("id").string("id")
            return id.utf8.elementsEqual(draft.sourceChatID.utf8) || id.utf8.elementsEqual(draft.targetChatID.utf8)
        }
        let flatCount = try selected.reduce(0) { total,chat in total + (chat["branchTree"] == nil ? try chat.required("messages").array("messages").count : 0) }
        let sourceCount = conversations.first { $0.id.utf8.elementsEqual(draft.sourceChatID.utf8) }?.nodes.count ?? 0
        let additional = draft.operation == .move ? sourceCount : draft.operation == .paste ? (try clipboard["nodeIds"]?.array("nodeIds").count ?? 0) : 0
        let ids = newIDs ?? (0..<(flatCount + additional)).map { _ in UUID().uuidString.lowercased() }
        let changed = try MessageEditing.clipboard(in: exchange.source, clipboard: clipboard, draft: draft, newIDs: ids, now: now, history: editingHistory)
        if changed.result.explanation == nil {
            try applyLibrary(changed.source, selectedID: selectedID, resetViewsFor: changed.affectedChatIDs, editing: changed.history, clipboard: changed.clipboard, now: now)
        }
        return changed.result
    }

    func nodeMoveDraft(nodeID: String, direction: NodeMoveDirection) throws -> NodeTransformDraft {
        try nodeTransformDraft(nodeID: nodeID, operation: .move, direction: direction)
    }
    func branchDeletionDraft(nodeID: String) throws -> NodeTransformDraft {
        try nodeTransformDraft(nodeID: nodeID, operation: .deleteBranch, direction: nil)
    }
    private func nodeTransformDraft(nodeID: String, operation: NodeTransformOperation, direction: NodeMoveDirection?) throws -> NodeTransformDraft {
        guard let exchange, let conversation, conversation.nodes.contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("対象メッセージがありません") }
        return NodeTransformDraft(chatID: conversation.id, nodeID: nodeID, source: exchange.source, path: conversation.visibleMessages.map(\.id), operation: operation, direction: direction)
    }
    func messageReplacementDraft(nodeID: String) throws -> MessageDraft {
        var draft = try messageDraft(nodeID: nodeID)
        draft.isReplacingAndPruning = true; draft.removeCount = draft.followingCount
        return draft
    }
    func saveNodeTransform(_ draft: NodeTransformDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws -> NodeTransformResult {
        try saveTreeEdit(source: draft.source, chatID: draft.chatID, nodeID: draft.nodeID, path: draft.path, operation: draft.operation.rawValue,
                         direction: draft.direction, newIDs: newIDs, now: now)
    }
    func saveMessageReplacingAndPruning(_ draft: MessageDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws -> NodeTransformResult {
        guard let nodeID = draft.nodeID else { throw ExchangeError.invalid("対象メッセージがありません") }
        return try saveTreeEdit(source: draft.source, chatID: draft.chatID, nodeID: nodeID, path: draft.path, operation: "replaceAndPrune", role: draft.role,
                               parts: draft.originalParts, editedText: draft.text, removeCount: draft.removeCount, newIDs: newIDs, now: now)
    }
    private func saveTreeEdit(source: OrderedJSON, chatID: String, nodeID: String, path: [String], operation: String,
                              direction: NodeMoveDirection? = nil, role: String? = nil, parts: OrderedJSON? = nil, editedText: String? = nil,
                              removeCount: Int? = nil, newIDs: [String]?, now: Double) throws -> NodeTransformResult {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してからメッセージを操作してください") }
        guard let exchange, exchange.source == source else { throw ExchangeError.invalid("会話が変更されました。操作を開き直してください") }
        guard let chat = try source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let count = try chat["branchTree"] == nil ? chat.required("messages").array("messages").count : 0
        let ids = newIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        var history: MessageEditing.HistoryState?
        let changed = try MessageEditing.transform(in: source, chatID: chatID, nodeID: nodeID, viewingPath: path, operation: operation, direction: direction,
            role: role, parts: parts, editedText: editedText, removeCount: removeCount, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        if changed.result.status == "updated" {
            try applyLibrary(changed.source, selectedID: selectedID, resetViewFor: chatID, editing: history, now: now)
        }
        return changed.result
    }

    func saveMessage(_ draft: MessageDraft, mode: MessageSaveMode, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから本文を編集してください") }
        guard let exchange, exchange.source == draft.source else { throw ExchangeError.invalid("会話が変更されました。本文を開き直してください") }
        let sourceChat = try exchange.source.required("chats").array("chats").first { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }
        guard let sourceChat else { throw ExchangeError.invalid("chat ID") }
        let needed = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count + 1 : 1
        let ids = newIDs ?? (0..<needed).map { _ in UUID().uuidString.lowercased() }
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.save(in: exchange.source, chatID: draft.chatID, nodeID: draft.nodeID, viewingPath: draft.path, role: draft.role,
                                             parts: draft.originalParts, editedText: draft.text, mode: mode, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        try applyLibrary(source, selectedID: draft.chatID, resetViewFor: draft.chatID, editing: history, now: now)
    }

    func undoMessageEdit(now: Double = Date().timeIntervalSince1970 * 1000) throws { try moveMessageHistory("undo", now: now) }
    func redoMessageEdit(now: Double = Date().timeIntervalSince1970 * 1000) throws { try moveMessageHistory("redo", now: now) }
    private func moveMessageHistory(_ operation: String, now: Double) throws {
        guard generation == nil, let exchange else { throw ExchangeError.invalid("生成結果を保存してから編集履歴を移動してください") }
        let result = try MessageEditing.moveHistory(operation, in: exchange.source, history: editingHistory, now: now)
        guard result.updated else { return }
        try applyLibrary(result.source, selectedID: selectedID,
                         resetViewsFor: result.affectedChatIDs, editing: result.history, now: now)
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

    var isLocalConversation: Bool {
        guard let chats = try? exchange?.source.required("chats").array("chats") else { return false }
        return chats.first { $0["id"] == .string(selectedID) }?["config"]?["modelSource"] == .string("local")
    }
    func assistantPrefill(key: String) -> String { assistantPrefills[Data(key.utf8)] ?? "" }
    func setAssistantPrefill(key: String, text: String) { assistantPrefills[Data(key.utf8)] = text }
    func assistantPrefillKey(nodeID: String) -> String {
        if let chats = try? exchange?.source.required("chats").array("chats"),
           chats.first(where: { $0["id"] == .string(selectedID) })?["branchTree"] == nil,
           nodeID.hasPrefix("message-") { return String(nodeID.dropFirst(8)) }
        return nodeID
    }
    private func consumeAssistantPrefill(key: String, prefix: OrderedJSON?) {
        do {
            var fields: [JSONField] = [.init(key:"operation",value:.string("consume")),.init(key:"modelSource",value:.string("local"))]
            if let draft = assistantPrefills[Data(key.utf8)] { fields.append(.init(key:"draft",value:.string(draft))) }
            if let prefix { fields.append(.init(key:"prefix",value:prefix)) }
            if try SharedWebOperations.call("assistantPrefill",.object(fields)).required("consumed").boolean("consumed prefill") {
                assistantPrefills.removeValue(forKey:Data(key.utf8))
            }
        } catch { generationError = "先頭文の入力状態を更新できませんでした。入力は保持しています。\n" + error.localizedDescription }
    }

    func composerDraft(chatID: String) -> ComposerDraft { composerDrafts[Data(chatID.utf8)] ?? .empty }
    func composerImageDetail(chatID: String) throws -> String {
        guard let chat = try exchange?.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("入力先の会話がありません") }
        return try chat["imageDetail"]?.string("imageDetail") ?? ChatDefaults.webInitial().imageDetail
    }
    func setComposerText(chatID: String, text: String) {
        var draft = composerDraft(chatID:chatID)
        draft.text = text
        composerDrafts[Data(chatID.utf8)] = draft
    }
    func addComposerImages(chatID: String, urls: [String], detail: String) throws {
        guard conversations.contains(where: { $0.id.utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("画像の入力先の会話がありません") }
        let before = composerDraft(chatID:chatID)
        var prepared = try ComposerContent.prepare(before.parts,images:urls.map { ($0,detail) })
        prepared.text = before.text
        composerDrafts[Data(chatID.utf8)] = prepared
    }
    func removeComposerPart(chatID: String, index: Int) throws {
        let before = composerDraft(chatID:chatID)
        var parts = try before.parts.array("composer parts")
        guard parts.indices.contains(index) else { throw ExchangeError.invalid("入力画像がありません") }
        parts.remove(at:index)
        composerDrafts[Data(chatID.utf8)] = ComposerDraft(parts:.array(parts),text:before.text,hasMeaningfulContent:false)
    }
    func sendComposer(record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil, readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard let conversation else { throw ExchangeError.invalid("送信先の会話がありません") }
        let identity = conversation.identity
        let draft = composerDraft(chatID:conversation.id)
        let prepared = try ComposerContent.prepare(draft.parts,text:draft.text)
        try startGeneration(prepared:prepared,record:record,client:client,nodeIDs:nodeIDs,readProviderCredential:readProviderCredential)
        composerDrafts.removeValue(forKey:identity)
    }
    func messageGenerationDraft(nodeID: String, operation: MessageGenerationOperation) throws -> MessageGenerationDraft {
        guard generation == nil, let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択し、生成の終了を待ってください") }
        return MessageGenerationDraft(chatID:conversation.id,nodeID:nodeID,operation:operation,source:exchange.source,path:conversation.visibleMessages.map(\.id))
    }

    func startGeneration(_ draft: MessageGenerationDraft, record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil,
                         readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard generation == nil, let exchange else { throw ExchangeError.invalid("生成結果を保存してから操作してください") }
        guard try draft.source.encoded() == exchange.source.encoded() else { throw ExchangeError.invalid("会話が変更されています。操作を開き直してください") }
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        let prepared = try MessageEditing.generation(in:exchange.source,chatID:draft.chatID,operation:"prepare",action:draft.operation,nodeID:draft.nodeID,
            viewingPath:draft.path,newIDs:nodeIDs,now:now,history:editingHistory) { history = $0 }
        guard prepared.output["status"] == .string("updated") else {
            if prepared.output["status"] == .string("protected") { throw ExchangeError.invalid("保護されたメッセージは置き換えられません") }
            throw ExchangeError.invalid("このメッセージからは生成できません。対象と表示経路を確認してください")
        }
        let plan = try prepared.output.required("plan")
        let requestPath = try plan.required("requestPath").array("requestPath").map { try $0.string("node ID") }
        try beginGeneration(source:prepared.source,chatID:draft.chatID,path:requestPath,history:history,plan:plan,regenerate:draft.operation == .regenerate,
            record:record,client:client,readProviderCredential:readProviderCredential,now:now)
    }

    func startGeneration(input: String, record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil, readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        try startGeneration(parts:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string(input))])]),record:record,client:client,nodeIDs:nodeIDs,readProviderCredential:readProviderCredential)
    }
    func startGeneration(parts: OrderedJSON, record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil, readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        try startGeneration(prepared:ComposerContent.prepare(parts),record:record,client:client,nodeIDs:nodeIDs,readProviderCredential:readProviderCredential)
    }
    private func startGeneration(prepared: ComposerDraft, record: RemoteCredentialRecord? = nil, client: RemoteClient, nodeIDs: [String]?, readProviderCredential: @escaping ProviderModels.CredentialReader) throws {
        guard generation == nil, let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択し、生成の終了を待ってください") }
        guard prepared.hasMeaningfulContent else { throw ExchangeError.invalid("本文または画像を入力してください") }
        let sourceChat = try exchange.source.required("chats").array("chats").first { try $0.required("id").string("ID").utf8.elementsEqual(conversation.id.utf8) }!
        let count = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count + 1 : 1
        let ids = nodeIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        let body = prepared.parts
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.save(in: exchange.source, chatID: conversation.id, nodeID: nil, viewingPath: conversation.visibleMessages.map(\.id), role: "user", parts: body, mode: .append, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        let changed = try WebExchange(source: source)
        let path = changed.conversations.first { $0.identity == conversation.identity }!.visibleMessages.map(\.id)
        try beginGeneration(source:source,chatID:conversation.id,path:path,history:history,plan:nil,regenerate:false,record:record,client:client,readProviderCredential:readProviderCredential,now:now)
    }

    private func beginGeneration(source: OrderedJSON, chatID: String, path: [String], history: MessageEditing.HistoryState?, plan: OrderedJSON?, regenerate: Bool,
                                 record: RemoteCredentialRecord? = nil, client: RemoteClient, readProviderCredential: @escaping ProviderModels.CredentialReader, now: Double) throws {
        let sourceChat = try source.required("chats").array("chats").first { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }!
        let savedState = try publicationSnapshot().required("state")
        let modelState = ChatConfig.modelState(in:savedState)
        if sourceChat["config"]?["modelSource"] == .string("local") {
            try beginLocalGeneration(source:source,chat:sourceChat,chatID:chatID,path:path,history:history,plan:plan,now:now)
            return
        }
        let legacy = try record ?? RemoteCredentials.load()
        let credential = try ProviderModels.generationCredential(config:sourceChat["config"] ?? .object([]),state:savedState,legacy:legacy,read:readProviderCredential)
        let apiVersion: String?
        if case .string(let value) = savedState["apiVersion"] { apiVersion = value }
        else if savedState["apiVersion"] == nil || savedState["apiVersion"] == .null { apiVersion = nil }
        else { throw ExchangeError.invalid("API versionの形式が不正です") }
        let request = try RemoteRequest.make(source: source, chatID: chatID, path: path, settings: credential.settings, key: credential.key, modelState:modelState,apiVersion:apiVersion,regenerate:regenerate)
        let streaming = try RemoteRequest.streaming(request)
        try applyLibrary(source, selectedID: chatID, resetViewFor: chatID, editing: history, now: now)
        let id = UUID()
        generation = ActiveGeneration(id: id, chatID: chatID, baseSource: try publishedSource(), path: path, plan: plan)
        pendingTitleContext = (id,legacy,client,readProviderCredential)
        generationError = nil
        generationTask = Task { @MainActor [weak self] in
            do {
                try await client.complete(request, streaming: streaming) { [weak self] output in
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

    var localModelFiles: LocalModelFiles {
        LocalModelFiles(directory:(store ?? LocalStateStore.applicationStore).fileURL.deletingLastPathComponent().appendingPathComponent("models",isDirectory:true))
    }

    var localModelsEnabled: Bool { (try? publicationSnapshot()["state"]?["localModelEnabled"]) == .bool(true) }
    func localModelDefinitions() throws -> [OrderedJSON] {
        try publicationSnapshot().required("state")["localModels"]?.array("local models") ?? []
    }
    func activeLocalModel(_ task: String) -> String? {
        try? publicationSnapshot()["state"]?["activeLocalModels"]?[task]?.string("model ID")
    }
    func saveLocalModelRole(task: String? = nil, modelID: String? = nil, enabled: Bool? = nil) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してからモデル設定を変更してください") }
        let roots = try syncInputSnapshot().required("state")
        let projected = OrderedJSON.object(["localModelEnabled","activeLocalModels"].compactMap { key in roots[key].map { .init(key:key,value:$0) } })
        var fields: [JSONField] = [.init(key:"state",value:projected)]
        if let enabled {
            fields += [.init(key:"operation",value:.string("enable")),.init(key:"enabled",value:.bool(enabled))]
        } else if let task, ["generation","analysis"].contains(task) {
            fields += [.init(key:"operation",value:.string("assign")),.init(key:"task",value:.string(task)),.init(key:"modelId",value:modelID.map(OrderedJSON.string) ?? .null)]
        } else { throw ExchangeError.invalid("モデルの役割が不正です") }
        let result = try SharedWebOperations.call("localModelRole",.object(fields))
        try applyGlobalState(OrderedJSONChanges.apply(result.required("changes"),to:roots))
    }

    @MainActor func importSingleGGUF(_ source: URL) async throws -> String {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してからモデルを登録してください") }
        let roots = try syncInputSnapshot().required("state")
        let models = try roots["localModels"]?.array("local models") ?? []
        let active = roots["activeLocalModels"] ?? .object([])
        let files = localModelFiles
        let inspected = try await Task.detached { try files.inspect(source) }.value
        try Task.checkCancellation()
        let candidates: [(id:String, value:OrderedJSON, revision:LocalModelFiles.Revision)] = await Task.detached {
            models.compactMap { model in
                guard let id = try? model.required("id").string("id"),
                      model["engine"] == .string("wllama"), model["manifest"]?["kind"] == .string("single-file"),
                      let installed = try? files.installed(modelID:id), let revision = try? files.revision(installed),
                      let fingerprint = try? files.inspect(installed), (try? files.revision(installed)) == revision else { return nil }
                let projectedModel = OrderedJSON.object([
                    .init(key:"id",value:.string(id)),.init(key:"engine",value:.string("wllama")),
                    .init(key:"manifest",value:.object([.init(key:"kind",value:.string("single-file"))]))
                ])
                return (id,.object([.init(key:"model",value:projectedModel),
                    .init(key:"hash",value:.string(fingerprint.hash)),.init(key:"size",value:.number(String(fingerprint.size)))]),revision)
            }
        }.value
        try Task.checkCancellation()
        let ids = try models.map { try $0.required("id").string("id") }
        let prepared = try SharedWebOperations.call("localModelImport",.object([
            .init(key:"operation",value:.string("prepare")),.init(key:"name",value:.string(inspected.name)),
            .init(key:"hash",value:.string(inspected.hash)),.init(key:"size",value:.number(String(inspected.size))),
            .init(key:"candidates",value:.array(candidates.map(\.value))),.init(key:"existingIDs",value:.array(ids.map(OrderedJSON.string))) ]))
        let proposed = try prepared.required("model")
        let modelID = try proposed.required("id").string("model ID")
        let existing = prepared["existing"] == .bool(true)
        let selected = candidates.first { $0.id.utf8.elementsEqual(modelID.utf8) }
        let model: OrderedJSON
        if existing {
            guard let matching = models.first(where:{ ($0["id"].flatMap { try? $0.string("id") })?.utf8.elementsEqual(modelID.utf8) == true }) else {
                throw ExchangeError.invalid("登録済みモデルが見つかりません")
            }
            model = matching
        } else { model = proposed }
        try Task.checkCancellation()
        if !existing { try await Task.detached { try files.installNew(source,modelID:modelID,hash:inspected.hash) }.value }
        try Task.checkCancellation()
        let current = try syncInputSnapshot().required("state")
        guard try (current["localModels"] ?? .array([])).encoded() == (roots["localModels"] ?? .array([])).encoded(),
                  try (current["activeLocalModels"] ?? .object([])).encoded() == active.encoded() else {
            throw ExchangeError.invalid("モデル設定が変更されました。もう一度登録してください")
        }
        var boundary = SharedWebProjection()
        let opaqueModels = try models.map { try boundary.reference($0) }
        let projectedActive = try OrderedJSON.object(try active.object("active models").map { field in
            JSONField(key:field.key,value:field.value == .null || (try? field.value.string("model ID")) != nil ? field.value : try boundary.reference(field.value))
        })
        let projected = OrderedJSON.object([.init(key:"localModels",value:.array(opaqueModels)),.init(key:"activeLocalModels",value:projectedActive)])
        let commitModel = existing ? OrderedJSON.object([
            .init(key:"id",value:.string(modelID)),.init(key:"tasks",value:model["tasks"] ?? .array([]))
        ]) : model
        let result = try SharedWebOperations.call("localModelImport",.object([
            .init(key:"operation",value:.string("commit")),.init(key:"state",value:projected),
            .init(key:"model",value:commitModel),.init(key:"existingIDs",value:.array(ids.map(OrderedJSON.string))) ]))
        try Task.checkCancellation()
        if existing {
            guard let selected else { throw ExchangeError.invalid("登録済みモデルのファイルを確認できません") }
            try files.checkRevision(files.installed(modelID:selected.id),expected:selected.revision)
        }
        try applyGlobalState(OrderedJSONChanges.apply(result.required("changes"),to:current.replacing("localModels",with:current["localModels"] ?? .array([])).replacing("activeLocalModels",with:current["activeLocalModels"] ?? .object([])),opaque:boundary.opaque))
        return modelID
    }

    private func beginLocalGeneration(source: OrderedJSON, chat: OrderedJSON, chatID: String, path: [String], history: MessageEditing.HistoryState?, plan: OrderedJSON?, now: Double) throws {
        let config = try chat.required("config")
        let modelID = try config.required("model").string("model")
        let prefillKey = try plan?["prefillKey"]?.string("prefill key") ?? stickyPrefillKey
        let request = try LocalGenerationRequest.make(source:source,chat:chat,config:config,path:path,assistantPrefill:assistantPrefills[Data(prefillKey.utf8)])
        let prefix = request.input["assistantPrefix"]
        do {
            let modelURL = try localModelFiles.installed(modelID:modelID)
            var output = RemoteOutput()
            _ = try output.consumeLocal("",input:request.input)
            try applyLibrary(source,selectedID:chatID,resetViewFor:chatID,editing:history,now:now)
            let id = UUID()
            generation = ActiveGeneration(id:id,chatID:chatID,baseSource:try publishedSource(),path:path,plan:plan,output:output,usesRemoteTransport:false)
            generationError = nil
            generationTask = Task { @MainActor [weak self] in
                guard let self else { return }
                defer { self.consumeAssistantPrefill(key:prefillKey,prefix:prefix) }
                do {
                    try await self.localGenerate(modelURL,request.engine) { [weak self] text in
                        try await self?.receiveLocalOutput(text,id:id,input:request.input) ?? true
                    }
                    self.finishGeneration(id:id,error:nil)
                } catch { self.finishGeneration(id:id,error:error) }
            }
        } catch {
            consumeAssistantPrefill(key:prefillKey,prefix:prefix)
            throw error
        }
    }

    @MainActor private func receiveLocalOutput(_ text: String, id: UUID, input: OrderedJSON) throws -> Bool {
        guard generation?.id == id, generation?.running == true, exchange?.source == generation?.baseSource else { return true }
        return try generation!.output.consumeLocal(text,input:input)
    }

    func stopGeneration() {
        guard let generation, generation.running else { return }
        generationTask?.cancel()
        do {
            var output = generation.output
            try output.flush()
            self.generation?.output = output
            finishGeneration(id:generation.id,error:nil,completed:false)
        } catch { finishGeneration(id:generation.id,error:error) }
    }

    func saveGenerationResult() throws {
        guard let generation, !generation.running else { throw ExchangeError.invalid("生成結果がありません") }
        try persistGeneration(generation)
        generationError = nil
    }

    private func finishGeneration(id: UUID, error: Error?, completed: Bool = true) {
        guard var current = generation, current.id == id, current.running, exchange?.source == current.baseSource else { return }
        current.running = false
        current.completedSuccessfully = completed && error == nil
        generation = current
        generationTask = nil
        if let error { generationError = "生成を完了できませんでした。\n" + error.localizedDescription }
        do { try persistGeneration(current) }
        catch { generationError = "生成結果を保存できませんでした。部分本文を保持しています。\n" + error.localizedDescription }
    }

    private func persistGeneration(_ current: ActiveGeneration) throws {
        let titleContext = pendingTitleContext?.id == current.id ? pendingTitleContext : nil
        guard exchange?.source == current.baseSource else { throw ExchangeError.invalid("生成開始後に会話が変更されています") }
        if try current.output.isEmpty && current.plan == nil && current.output.observation.object("observation").isEmpty { generation = nil; return }
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        var source: OrderedJSON
        if let plan = current.plan {
            let finalized = try MessageEditing.generation(in:current.baseSource,chatID:current.chatID,operation:"finalize",viewingPath:current.path,plan:plan,
                parts:current.output.parts,now:now,history:editingHistory) { history = $0 }
            guard finalized.output["status"] == .string("updated") else { throw ExchangeError.invalid("生成先が変更されているため、結果を保存できません") }
            source = finalized.source
        } else {
            source = try MessageEditing.save(in: current.baseSource, chatID: current.chatID, nodeID: nil, viewingPath: current.path, role: "assistant", parts: current.output.parts, mode: .append, newIDs: [UUID().uuidString.lowercased()], now: now, history: editingHistory) { history = $0 }
        }
        let accounting = try generationAccounting(source:source,current:current)
        source = accounting.source
        try applyLibrary(source, selectedID: current.chatID, resetViewFor: current.chatID, tokenUsage:accounting.usage, editing: history, now: now)
        generation = nil
        if current.completedSuccessfully && current.plan == nil {
            let config = try current.baseSource.required("chats").array("chats").first { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(current.chatID.utf8) == true }?["config"]
            startAutomaticTitle(chatID:current.chatID,sourceConfig:config,legacy:titleContext?.legacy,client:titleContext?.client,readProviderCredential:titleContext?.read ?? RemoteCredentials.load(providerID:))
        }
    }

    private func generationAccounting(source: OrderedJSON, current: ActiveGeneration) throws -> (source: OrderedJSON, usage: OrderedJSON?) {
        guard current.usesRemoteTransport else { return (source,nil) }
        var chats = try source.required("chats").array("chats")
        guard let index = chats.firstIndex(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(current.chatID.utf8) == true }) else { return (source,nil) }
        var chat = chats[index]
        guard let targetValue = try current.plan?["targetNodeId"] ?? chat.required("branchTree").required("activePath").array("path").last else { throw ExchangeError.invalid("利用量の生成先がありません") }
        let target = try targetValue.string("target")
        if try !current.output.observation.object("observation").isEmpty {
            let result = try SharedWebOperations.call("generationObservation",.object([.init(key:"chat",value:chat),.init(key:"targetNodeId",value:.string(target)),.init(key:"observation",value:current.output.observation)]))
            chat = try OrderedJSONChanges.apply(result.required("changes"),to:chat)
            chats[index] = chat
        }
        let updated = source.replacing("chats",with:.array(chats))
        let roots = try publicationSnapshot().required("state")
        guard current.completedSuccessfully, roots["countTotalTokens"] == .bool(true) else { return (updated,nil) }
        let totals = roots["totalTokenUsed"] ?? .object([])
        let result = try SharedWebOperations.call("generationUsage",.object([.init(key:"chat",value:chat),.init(key:"targetNodeId",value:.string(target)),.init(key:"countTotalTokens",value:.bool(true)),.init(key:"totalTokenUsed",value:totals)]))
        let next = try OrderedJSONChanges.apply(result.required("changes"),to:.object([.init(key:"totalTokenUsed",value:totals)]))
        try NativeUsage.validateCounters(result:result,before:totals,after:next["totalTokenUsed"] ?? .object([]))
        return (updated,next["totalTokenUsed"])
    }

    var usageCountingEnabled: Bool { (try? publicationSnapshot()["state"]?["countTotalTokens"]) == .bool(true) }
    func saveUsageCounting(_ enabled: Bool) throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを復旧してから設定してください") }
        guard usageCountingEnabled != enabled else { return }
        try applyLibrary(exchange?.source ?? ChatLibrary.emptySource,selectedID:selectedID,preserveGeneration:true,usageEnabled:enabled)
    }
    func resetUsageTotals() throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを復旧してから設定してください") }
        try applyLibrary(exchange?.source ?? ChatLibrary.emptySource,selectedID:selectedID,preserveGeneration:true,tokenUsage:.object([]))
    }
    func usageCostReport() throws -> OrderedJSON {
        let roots = try publicationSnapshot().required("state")
        var fields: [JSONField] = [.init(key:"state",value:ChatConfig.modelState(in:roots)),.init(key:"totalTokenUsed",value:roots["totalTokenUsed"] ?? .object([]))]
        if let current = generation, current.running,
           let chat = try current.baseSource.required("chats").array("chats").first(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(current.chatID.utf8) == true }) {
            var boundary = SharedWebProjection()
            let config = try chat["config"] ?? ChatDefaults.webInitial().config
            var input = try SharedGenerationContext.fields(source:current.baseSource,chat:chat,config:config,path:current.path,boundary:&boundary)
            input.append(.init(key:"completionParts",value:current.output.parts))
            let overlay = try SharedWebOperations.call("generationLiveUsage",.object(input))
            fields.append(.init(key:"liveTokenUsed",value:overlay))
        }
        return try SharedWebOperations.call("usageCost",.object(fields))
    }

    private func invalidateGeneration() {
        pendingTitleContext = nil
        generationTask?.cancel()
        generationTask = nil
        generation = nil
    }

    func createChat(defaults: ChatDefaults? = nil, id: String = UUID().uuidString.lowercased(), folder: String? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let source = exchange?.source ?? ChatLibrary.emptySource
        var created = try ChatLibrary.create(in: source, id: id, defaults: defaults ?? ChatDefaults.saved(in:syncInputSnapshot().required("state")), folder: folder)
        if let folder { created = try ChatFolders.apply(in: created, operation: .move(chatIDs: [id], folderID: folder)) }
        try applyLibrary(created, selectedID: id, now: now)
    }

    func startAutomaticTitle(chatID: String, sourceConfig: OrderedJSON? = nil, legacy: RemoteCredentialRecord? = nil,
                                       client: RemoteClient? = nil, readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:),
                                       language: String = Locale.current.language.languageCode?.identifier ?? "en") {
        do {
            let snapshot = try publicationSnapshot(), roots = try snapshot.required("state")
            let settings = try SharedWebOperations.call("titleOperation",.object([.init(key:"operation",value:.string("settings")),.init(key:"state",value:titleSettingRoots(roots))]))
            guard settings["autoTitle"] == .bool(true), let exchange else { return }
            let credential = try legacy ?? RemoteCredentials.load()
            guard let prepared = try ConversationTitle.prepare(source:exchange.source,state:roots,chatID:chatID,language:language,sourceConfig:sourceConfig,legacy:credential,readProviderCredential:readProviderCredential) else { return }
            let titleClient = client?.auxiliaryClient() ?? RemoteClient()
            let key = Data(chatID.utf8), id = UUID()
            titleTasks[key]?.task.cancel(); titleError = nil
            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                defer { if self.titleTasks[key]?.id == id { self.titleTasks[key] = nil } }
                do {
                    let response = try await ConversationTitle.generate(prepared,client:titleClient)
                    try Task.checkCancellation()
                    guard self.titleTasks[key]?.id == id else { return }
                    try self.applyGeneratedTitle(response,prepared:prepared,language:language,fallbackEndpoint:credential.settings.endpoint)
                } catch is CancellationError {} catch { if self.titleTasks[key]?.id == id { self.titleError = "タイトル生成に失敗しました。\n" + error.localizedDescription } }
            }
            titleTasks[key] = (id,task)
        } catch { titleError = "タイトル生成に失敗しました。\n" + error.localizedDescription }
    }
    func applyGeneratedTitle(_ response: String, prepared: PreparedConversationTitle, language: String, fallbackEndpoint: String) throws {
        guard let exchange, let updated = try ConversationTitle.apply(response,prepared:prepared,source:exchange.source,state:publicationSnapshot().required("state"),language:language,fallbackEndpoint:fallbackEndpoint) else { return }
        try applyLibrary(updated.source,selectedID:selectedID,preserveGeneration:true,tokenUsage:updated.tokenUsage)
    }
    private func titleSettingRoots(_ roots: OrderedJSON) -> OrderedJSON { .object(["autoTitle","titleModel","titleProviderId"].compactMap { key in roots[key].map { .init(key:key,value:$0) } }) }
    func titleSettingsDraft() throws -> ConversationTitleSettingsDraft {
        var catalog = try defaultChatConfigDraft()
        let original = titleSettingRoots(try catalog.snapshot.required("state"))
        let value = try SharedWebOperations.call("titleOperation",.object([.init(key:"operation",value:.string("settings")),.init(key:"state",value:original)]))
        catalog.config = catalog.config.replacing("model",with:try value.required("titleModel")).replacing("modelSource",with:.string("remote"))
        if let provider = value["titleProviderId"] { catalog.config = catalog.config.replacing("providerId",with:provider) }
        else { catalog.config = .object(try catalog.config.object("config").filter { $0.key != "providerId" }) }
        return .init(original:original,value:value,catalog:catalog)
    }
    func saveTitleSettings(_ draft: ConversationTitleSettingsDraft, value: OrderedJSON) throws {
        let snapshot = try syncInputSnapshot(), roots = try snapshot.required("state")
        guard try titleSettingRoots(roots).encoded() == draft.original.encoded() else { throw ExchangeError.invalid("タイトル設定が変更されています。設定を開き直してください") }
        let result = try SharedWebOperations.call("titleOperation",.object([.init(key:"operation",value:.string("saveSettings")),.init(key:"state",value:titleSettingRoots(roots)),.init(key:"value",value:value)]))
        let updated = try OrderedJSONChanges.apply(result.required("changes"),to:roots)
        try applyGlobalState(updated)
    }
    private func applyGlobalState(_ roots: OrderedJSON) throws {
        let base = try document ?? SyncDocument(v3:exchange?.source ?? ChatLibrary.emptySource)
        try applyDocument(SyncDocument(snapshot:base.snapshot.replacing("state",with:roots),v3Sidecar:base.v3Sidecar,v3RootOrder:base.v3RootOrder))
    }
    private var summaryGeneratingIDs: [String] {
        guard let target = generation?.plan?["targetNodeId"], case .string(let id) = target else { return [] }
        return [id]
    }
    func summaryInfo(chatID: String, nodeID: String, mode: String? = nil) throws -> OrderedJSON? {
        guard let exchange else { return nil }
        return try ConversationSummary.describe(source:exchange.source,chatID:chatID,nodeID:nodeID,mode:mode,originNodeID:nodeID,
            chosenSummaryID:summaryChosen[.init(chatID:chatID,nodeID:nodeID)],generatingNodeIDs:summaryGeneratingIDs)
    }
    func summaryDraft(nodeID: String) throws -> ConversationSummaryDraft {
        guard let conversation, let info = try summaryInfo(chatID:conversation.id,nodeID:nodeID) else { throw ExchangeError.invalid("要約する会話がありません") }
        return .init(chatID:conversation.id,nodeID:nodeID,info:info)
    }
    func mutateSummary(chatID: String, action: String, summaryID: String? = nil, nodeID: String? = nil, use: Bool? = nil) throws {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        let source = try ConversationSummary.mutate(source:exchange.source,chatID:chatID,action:action,summaryID:summaryID,nodeID:nodeID,use:use)
        try applyLibrary(source,selectedID:selectedID,preserveGeneration:true)
        if action == "use", let summaryID, let chat = try source.required("chats").array("chats").first(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(chatID.utf8) == true }),
           let summary = try chat["summaries"]?.array("summaries").first(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(summaryID.utf8) == true }) {
            for nodeID in try ConversationSummary.sourceDisplayIDs(summary,source:source,chatID:chatID) { summaryChosen[.init(chatID:chatID,nodeID:nodeID)] = summaryID }
        }
    }
    func summaryConfigDraft(chatID: String) throws -> ChatConfigDraft {
        guard let exchange, let chat = try exchange.source.required("chats").array("chats").first(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(chatID.utf8) == true }) else { throw ExchangeError.invalid("会話がありません") }
        let snapshot = try publicationSnapshot(), roots = try snapshot.required("state")
        let sourceConfig = try chat["config"] ?? ChatDefaults.webInitial().config
        let config = try roots["bubbleSummaryConfig"] ?? (sourceConfig["modelSource"] == .string("local") ? ChatDefaults.webInitial().config : sourceConfig)
        return .init(chatID:chatID,source:exchange.source,snapshot:snapshot,modelState:ChatConfig.modelState(in:roots),config:config)
    }
    func saveSummaryConfig(_ config: OrderedJSON?, expected: OrderedJSON?) throws {
        let roots = try syncInputSnapshot().required("state")
        guard try roots["bubbleSummaryConfig"]?.encoded() == expected?.encoded() else { throw ExchangeError.invalid("要約設定が変更されました。開き直してください") }
        var next = OrderedJSON.object(try roots.object("state").filter { $0.key != "bubbleSummaryConfig" })
        if let config { next = next.replacing("bubbleSummaryConfig",with:config) }
        try applyGlobalState(next)
    }
    func summaryJob(chatID: String, nodeID: String) -> SummaryJob? {
        let matches = summaryJobs.values.filter { $0.chatID.utf8.elementsEqual(chatID.utf8) && ($0.originNodeID.utf8.elementsEqual(nodeID.utf8) || $0.sourceNodeIDs.contains { $0.utf8.elementsEqual(nodeID.utf8) }) }
        return matches.first(where: { $0.busy }) ?? matches.first
    }
    func startSummary(_ draft: ConversationSummaryDraft, sourceNodeIDs: [String], mode: String, format: String?,
                      record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), readProviderCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        let roots = try publicationSnapshot().required("state")
        let busy = summaryJobs.values.filter { $0.busy && $0.chatID.utf8.elementsEqual(draft.chatID.utf8) }.map { ($0.originNodeID,$0.sourceNodeIDs) }
        guard let prepared = try ConversationSummary.prepare(source:exchange.source,state:roots,chatID:draft.chatID,sourceNodeIDs:sourceNodeIDs,mode:mode,originNodeID:draft.nodeID,
            format:format,summaryID:UUID().uuidString.lowercased(),now:Date().timeIntervalSince1970 * 1000,config:roots["bubbleSummaryConfig"],generatingNodeIDs:summaryGeneratingIDs,busyJobs:busy,
            legacy:record ?? RemoteCredentials.load(),readProviderCredential:readProviderCredential) else { return }
        let key = SummaryIdentity(chatID:draft.chatID,nodeID:draft.nodeID), id = UUID()
        summaryJobs = summaryJobs.filter { _, job in
            job.busy || !job.chatID.utf8.elementsEqual(draft.chatID.utf8) || !job.sourceNodeIDs.contains { previous in sourceNodeIDs.contains { $0.utf8.elementsEqual(previous.utf8) } }
        }
        summaryJobs[key] = SummaryJob(id:id,chatID:draft.chatID,originNodeID:draft.nodeID,sourceNodeIDs:sourceNodeIDs,busy:true)
        summaryTasks[key] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.summaryJobs[key]?.id == id { self.summaryTasks[key] = nil; self.summaryJobs[key]?.busy = false } }
            do {
                let response = try await ConversationSummary.generate(prepared,client:client)
                try Task.checkCancellation()
                guard self.summaryJobs[key]?.id == id, let source = self.exchange?.source else { return }
                guard let result = try ConversationSummary.apply(response,prepared:prepared,source:source,state:self.publicationSnapshot().required("state"),generatingNodeIDs:self.summaryGeneratingIDs) else { throw ExchangeError.invalid("原文や設定が変更されました。生成し直してください") }
                var updated = result.source
                if let summary = result.summary, let summaryID = try summary["id"]?.string("summary") {
                    updated = try ConversationSummary.mutate(source:updated,chatID:draft.chatID,action:"use",summaryID:summaryID,use:result.savesTokens ?? true)
                }
                try self.applyLibrary(updated,selectedID:self.selectedID,preserveGeneration:true,tokenUsage:result.tokenUsage)
                if let summary = result.summary, let summaryID = try summary["id"]?.string("summary") {
                    for nodeID in try ConversationSummary.sourceDisplayIDs(summary,source:result.source,chatID:draft.chatID) { self.summaryChosen[.init(chatID:draft.chatID,nodeID:nodeID)] = summaryID }
                }
                self.summaryJobs[key]?.warning = result.warning
                self.summaryJobs[key]?.error = result.error
            } catch is CancellationError {} catch { if self.summaryJobs[key]?.id == id { self.summaryJobs[key]?.error = error.localizedDescription } }
        }
    }
    func stopSummary(chatID: String, nodeID: String) {
        let key = SummaryIdentity(chatID:chatID,nodeID:nodeID)
        summaryTasks[key]?.cancel(); summaryTasks[key] = nil; summaryJobs[key] = nil
    }
    private func cancelSummaries() { for task in summaryTasks.values { task.cancel() }; summaryTasks.removeAll(); summaryJobs.removeAll(); summaryChosen.removeAll() }

    func evaluationDraft(nodeID: String) throws -> ConversationEvaluationDraft {
        guard let conversation else { throw ExchangeError.invalid("評価する会話がありません") }
        return .init(chatID:conversation.id,nodeID:nodeID)
    }
    func evaluationResult(chatID: String, nodeID: String) throws -> OrderedJSON? {
        guard let source = exchange?.source, let key = try ConversationEvaluation.resultKey(source:source,chatID:chatID,nodeID:nodeID) else { return nil }
        return try publicationSnapshot().required("state")["evaluationResults"]?[key]
    }
    func evaluationReport(chatID: String, nodeID: String) throws -> OrderedJSON? {
        guard let result = try evaluationResult(chatID:chatID,nodeID:nodeID) else { return nil }
        let roots = try publicationSnapshot().required("state")
        var input = OrderedJSON.object([.init(key:"operation",value:.string("display")),.init(key:"result",value:result)])
        for key in ["safetyThresholds", "qualityThresholds"] { if let value = roots[key] { input = input.replacing(key,with:value) } }
        return try SharedWebOperations.call("evaluation",input)
    }
    func startEvaluation(_ draft: ConversationEvaluationDraft, dimension: String, scope: String, omittedMode: String,
                         record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), readProviderCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard let source = exchange?.source else { throw ExchangeError.invalid("保存済み会話がありません") }
        let key = SummaryIdentity(chatID:draft.chatID,nodeID:draft.nodeID)
        guard evaluationJobs[key]?.busy != true else { return }
        let roots = try publicationSnapshot().required("state")
        let prepared = try ConversationEvaluation.prepare(source:source,state:roots,chatID:draft.chatID,nodeID:draft.nodeID,dimension:dimension,scope:scope,omittedMode:omittedMode,language:Locale.preferredLanguages.first ?? "en",legacy:record ?? RemoteCredentials.load(),files:localModelFiles,readProviderCredential:readProviderCredential)
        let id = UUID()
        evaluationJobs[key] = EvaluationJob(id:id,busy:true)
        evaluationTasks[key] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.evaluationJobs[key]?.id == id { self.evaluationTasks[key] = nil; self.evaluationJobs[key]?.busy = false } }
            do {
                let result = try await ConversationEvaluation.run(prepared,client:client,localGenerator:self.localEvaluationGenerate,isCurrent:{ [weak self] in
                    guard let self, self.evaluationJobs[key]?.id == id, let source = self.exchange?.source,
                          let roots = try? self.publicationSnapshot().required("state") else { return false }
                    return (try? ConversationEvaluation.isCurrent(prepared,source:source,state:roots)) == true
                },onProgress:{ [weak self] update in
                    guard let self, self.evaluationJobs[key]?.id == id else { return }
                    for field in (try? update.object("axis progress")) ?? [] { self.evaluationJobs[key]?.progress = self.evaluationJobs[key]?.progress.replacing(field.key,with:field.value) ?? .object([field]) }
                })
                try Task.checkCancellation()
                guard self.evaluationJobs[key]?.id == id, let latestSource = self.exchange?.source else { return }
                let updated = try ConversationEvaluation.apply(result,prepared:prepared,source:latestSource,state:self.publicationSnapshot().required("state"))
                try self.applyLibrary(latestSource,selectedID:self.selectedID,preserveGeneration:true,evaluationResults:try updated.required("evaluationResults"))
            } catch is CancellationError {} catch { if self.evaluationJobs[key]?.id == id { self.evaluationJobs[key]?.error = error.localizedDescription } }
        }
    }
    func stopEvaluation(chatID: String, nodeID: String) {
        let key = SummaryIdentity(chatID:chatID,nodeID:nodeID)
        evaluationTasks[key]?.cancel(); evaluationTasks[key] = nil; evaluationJobs[key] = nil
    }
    private func cancelEvaluations() {
        for task in evaluationTasks.values { task.cancel() }
        evaluationTasks.removeAll(); evaluationJobs.removeAll()
    }

    private func cancelTitles() { for value in titleTasks.values { value.task.cancel() }; titleTasks.removeAll() }

    func renameChat(id: String, title: String, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は変更できません") }
        try applyLibrary(ChatLibrary.rename(in: exchange.source, id: id, title: title), selectedID: selectedID, now: now)
    }

    func duplicateChat(id: String, newID: String = UUID().uuidString.lowercased(), now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は複製できません") }
        try applyLibrary(ChatLibrary.duplicate(in: exchange.source, id: id, newID: newID), selectedID: newID, now: now)
    }

    func deleteChats(ids: [String], defaults: ChatDefaults? = nil, replacementID: String = UUID().uuidString.lowercased(), now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange else { throw ExchangeError.invalid("サンプル会話は削除できません") }
        let source = try ChatLibrary.delete(in: exchange.source, ids: ids, replacementID: replacementID, defaults: defaults ?? ChatDefaults.saved(in:syncInputSnapshot().required("state")))
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

    private func applyLibrary(_ source: OrderedJSON, selectedID: String, resetViewFor: String? = nil, resetViewsFor: [String] = [], preserveGeneration: Bool = false, tokenUsage: OrderedJSON? = nil, usageEnabled: Bool? = nil, evaluationResults: OrderedJSON? = nil, navigation: BranchNavigation.HistoryResult? = nil, editing: MessageEditing.HistoryState? = nil, clipboard: OrderedJSON? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを読めなかったため更新できません。明示的な置換が必要です") }
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        let before = try exchange?.source ?? base.uiProjection()
        var candidate = try base.applyingV3Edits(source, comparedTo: before, now: now)
        if let clipboard {
            candidate = try candidate.mergingSnapshot(.object([.init(key:"version",value:candidate.snapshot.required("version")),
                .init(key:"state",value:.object([.init(key:"branchClipboard",value:clipboard)]))]))
        }
        if let tokenUsage { candidate = try candidate.mergingSnapshot(candidate.snapshot.replacing("state",with:candidate.snapshot.required("state").replacing("totalTokenUsed",with:tokenUsage))) }
        if let usageEnabled { candidate = try candidate.mergingSnapshot(candidate.snapshot.replacing("state",with:candidate.snapshot.required("state").replacing("countTotalTokens",with:.bool(usageEnabled)))) }
        if let evaluationResults {
            candidate = try SyncDocument(snapshot:candidate.snapshot.replacing("state",with:candidate.snapshot.required("state").replacing("evaluationResults",with:evaluationResults)),v3Sidecar:candidate.v3Sidecar,v3RootOrder:candidate.v3RootOrder)
        }
        let changed = try WebExchange(source: candidate.uiProjection())
        let candidates = try BranchNavigation.candidates(in: changed.source)
        var views = changed.conversations
        for index in views.indices {
            if exchange != nil, resetViewFor.map({ !views[index].id.utf8.elementsEqual($0.utf8) }) ?? true,
               !resetViewsFor.contains(where: { views[index].id.utf8.elementsEqual($0.utf8) }), let previous = conversations.first(where: { $0.identity == views[index].identity }) {
                views[index].selectedLeafID = previous.selectedLeafID
                views[index].displayedPathIDs = previous.displayedPathIDs
            }
        }
        let nextNavigation = try navigation ?? historySelecting(selectedID, in: changed.source)
        let nextEditing = try editing ?? (navigation != nil ? editingHistory : MessageEditing.invalidatingHistory(editingHistory, before: before, after: changed.source))
        try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selectedID, style: displayStyle))
        if preserveGeneration, let current = generation {
            generation = ActiveGeneration(id: current.id, chatID: current.chatID, baseSource: changed.source, path: current.path, plan: current.plan, output: current.output, running: current.running, completedSuccessfully:current.completedSuccessfully, usesRemoteTransport:current.usesRemoteTransport)
        } else { invalidateGeneration() }
        branchCandidates = candidates
        conversations = views
        self.selectedID = selectedID
        if let nextNavigation { publishNavigation(nextNavigation, focus: nil) }
        exchange = changed
        editingHistory = nextEditing
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
    func exportWebData(format: ChatExport.Format, scope: ChatExport.Scope, compressed: Bool = false) throws -> ChatExport.Artifact {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから書き出してください") }
        let v3 = try OrderedJSON.decode(exportWebData())
        return try ChatExport.make(v3:v3,format:format,scope:scope,chatID:conversation?.id,visiblePath:scope == .all ? nil : conversation?.visibleMessages.map(\.id),compressed:compressed)
    }
    func applySnapshot(_ snapshot: OrderedJSON) throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを読めなかったため更新できません。明示的な置換が必要です") }
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
    func applyCloudKitSnapshot(_ snapshot: OrderedJSON, expected: OrderedJSON) throws {
        guard try syncInputSnapshot() == expected else { throw SyncSessionError.invalid("Local data changed during CloudKit sync") }
        // CloudKit uses full Web persistence, unlike encrypted record sync which excludes browser settings.
        try applySnapshot(snapshot)
    }
    func applySynchronizedSnapshot(_ snapshot: OrderedJSON, expected: OrderedJSON) throws {
        guard try syncInputSnapshot() == expected else { throw SyncSessionError.invalid("Local data changed during sync") }
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        try applyDocument(base.synchronizingSnapshot(snapshot))
    }
    private func applyDocument(_ candidate: SyncDocument, selectedID requestedSelection: String? = nil, resetViews: Bool = false) throws {
        let changed = try WebExchange(source: candidate.uiProjection())
        let candidates = try BranchNavigation.candidates(in: changed.source)
        var views = changed.conversations
        for index in views.indices {
            if !resetViews, let previous = conversations.first(where: { $0.identity == views[index].identity }),
               previous.visibleMessages.allSatisfy({ node in views[index].nodes.contains { $0.identity == node.identity } }) {
                views[index].selectedLeafID = previous.selectedLeafID
                views[index].displayedPathIDs = previous.displayedPathIDs
            }
        }
        let desired = requestedSelection ?? selectedID
        let selected = views.contains { $0.id.utf8.elementsEqual(desired.utf8) } ? desired : views.first?.id ?? ""
        let nextNavigation = try historySelecting(selected, in: changed.source)
        let nextEditing = try exchange.map { try MessageEditing.invalidatingHistory(editingHistory, before: $0.source, after: changed.source) } ?? nil
        try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selected, style: displayStyle))
        invalidateGeneration(); cancelTitles(); cancelSummaries(); cancelEvaluations()
        branchCandidates = candidates
        if let nextNavigation { publishNavigation(nextNavigation, focus: nil) }
        editingHistory = nextEditing
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
