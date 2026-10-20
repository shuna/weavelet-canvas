import Foundation
import Combine
import CryptoKit

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

enum OpenRouterCreditsClient {
    static func fetch(_ request: URLRequest) async throws -> OrderedJSON {
        try await RemoteClient().completeJSON(request)
    }
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

enum ChatActiveView: String, CaseIterable, Identifiable {
    case chat, branchEditor = "branch-editor", splitHorizontal = "split-horizontal", splitVertical = "split-vertical"
    var id: Self { self }
    var title: String {
        switch self {
        case .chat: "チャット"
        case .branchEditor: "分岐エディター"
        case .splitHorizontal: "左右分割"
        case .splitVertical: "上下分割"
        }
    }
}

private struct NativeCatalogResumeStore {
    let fileURL: URL
    init(libraryURL: URL) { fileURL = libraryURL.deletingLastPathComponent().appendingPathComponent("catalog-download-resume.json") }
    func records() -> [(id: String, url: String, revision: String, data: Data)] {
        guard let root = try? OrderedJSON.decode(Data(contentsOf:fileURL)), root["version"] == .number("1"), let rows = try? root.required("records").array("records") else { return [] }
        return rows.compactMap { row in
            guard let id = try? row.required("id").string("id"), let url = try? row.required("url").string("url"),
                  let revision = try? row.required("revision").string("revision"), let text = try? row.required("data").string("data"), let data = Data(base64Encoded:text) else { return nil }
            return (id,url,revision,data)
        }
    }
    func save(_ records: [(id: String, url: String, revision: String, data: Data)]) throws {
        let value = OrderedJSON.object([.init(key:"version",value:.number("1")),.init(key:"records",value:.array(records.map {
            .object([.init(key:"id",value:.string($0.id)),.init(key:"url",value:.string($0.url)),.init(key:"revision",value:.string($0.revision)),.init(key:"data",value:.string($0.data.base64EncodedString()))])
        }))])
        try FileManager.default.createDirectory(at:fileURL.deletingLastPathComponent(),withIntermediateDirectories:true)
        try value.encoded().write(to:fileURL,options:.atomic)
    }
}

private final class CatalogDownloadSessionDelegate: NSObject, URLSessionDownloadDelegate {
    weak var owner: CatalogDownloadTransport?
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "https", components.user == nil, components.password == nil else {
            completionHandler(nil); return
        }
        completionHandler(request)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytes: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) { owner?.wrote(downloadTask,bytes:bytes,totalBytesWritten:totalBytesWritten,totalBytesExpectedToWrite:totalBytesExpectedToWrite) }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) { owner?.finished(downloadTask,location:location) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { owner?.completed(task,error:error) }
}

private final class CatalogDownloadTransport {
    private struct Request {
        let token: UUID
        let progress: @Sendable (Int64, Int64?) -> Void
        let finish: @Sendable (Result<URL, Error>) -> Void
    }
    private let lock = NSLock()
    private var requests: [Int: Request] = [:]
    private var tasks: [Int: URLSessionDownloadTask] = [:]
    private var session: URLSession?
    private let configuration: URLSessionConfiguration
    private let delegate: CatalogDownloadSessionDelegate
    init(configuration: URLSessionConfiguration? = nil) {
        self.configuration = configuration ?? .default
        self.delegate = CatalogDownloadSessionDelegate()
        self.delegate.owner = self
    }
    func start(_ url: URL, resumeData: Data?, token: UUID, progress: @escaping @Sendable (Int64, Int64?) -> Void, finish: @escaping @Sendable (Result<URL, Error>) -> Void) {
        let session = self.session ?? URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        self.session = session
        let task = resumeData.map { session.downloadTask(withResumeData:$0) } ?? session.downloadTask(with:url)
        lock.lock(); requests[task.taskIdentifier] = .init(token:token,progress:progress,finish:finish); tasks[task.taskIdentifier] = task; lock.unlock()
        task.resume()
    }
    func invalidateAndCancel() { session?.invalidateAndCancel() }
    func cancel(_ token: UUID, completion: @escaping @Sendable (Data?) -> Void) {
        lock.lock()
        let taskID = requests.first { $0.value.token == token }?.key
        let task = taskID.flatMap { tasks.removeValue(forKey:$0) }
        let request = taskID.flatMap { requests.removeValue(forKey:$0) }
        lock.unlock()
        request?.finish(.failure(CancellationError()))
        task?.cancel(byProducingResumeData:completion)
        if task == nil { completion(nil) }
    }
    fileprivate func wrote(_ downloadTask: URLSessionDownloadTask, bytes _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        lock.lock(); let request = requests[downloadTask.taskIdentifier]; lock.unlock()
        request?.progress(totalBytesWritten,totalBytesExpectedToWrite >= 0 ? totalBytesExpectedToWrite : nil)
    }
    fileprivate func finished(_ downloadTask: URLSessionDownloadTask, location: URL) {
        lock.lock(); let request = requests.removeValue(forKey:downloadTask.taskIdentifier); tasks.removeValue(forKey:downloadTask.taskIdentifier); lock.unlock()
        guard let request else { return }
        do {
            guard let http = downloadTask.response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw ExchangeError.invalid("モデルの取得に失敗しました")
            }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-catalog",isDirectory:true)
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            let copy = directory.appendingPathComponent(request.token.uuidString + ".gguf")
            try? FileManager.default.removeItem(at:copy)
            try FileManager.default.moveItem(at:location,to:copy)
            request.finish(.success(copy))
        } catch { request.finish(.failure(error)) }
    }
    fileprivate func completed(_ task: URLSessionTask, error: Error?) {
        guard let error else { return }
        lock.lock(); let request = requests.removeValue(forKey:task.taskIdentifier); tasks.removeValue(forKey:task.taskIdentifier); lock.unlock()
        request?.finish(.failure(error))
    }
}

struct CatalogDownloadJob: Equatable {
    let receivedBytes: Int64
    let expectedBytes: Int64?
    let running: Bool
    let partial: Bool
    let error: String?
    let canResume: Bool
    var installedModelID: String? = nil
}

struct NativeDiagnosticEntry: Identifiable, Equatable {
    let id: String
    var label: String
    var status: String
    var detail: String?
    var updatedAt: Double
}
struct NativeDiagnosticLog: Identifiable, Equatable {
    let id: String
    let timestamp: Double
    let source: String
    let level: String
    let message: String
}

final class NativeDiagnostics: ObservableObject {
    @Published private(set) var entries: [String: NativeDiagnosticEntry] = [:]
    @Published private(set) var logs: [NativeDiagnosticLog] = []
    @Published private(set) var displayedEntries: [NativeDiagnosticEntry] = []
    @Published private(set) var formattedLogs: [String] = []
    @Published private(set) var displayError: String?

    private var state = OrderedJSON.object([
        .init(key: "entries", value: .object([])),
        .init(key: "logs", value: .array([])),
    ])
    private var bridge: SharedWebOperations.Session?
    private var doneTTLms = 30_000.0
    private var doneExpiry: [String: DispatchWorkItem] = [:]

    private func call(_ input: OrderedJSON) throws -> OrderedJSON {
        if bridge == nil { bridge = try SharedWebOperations.Session() }
        return try bridge!.call("debugState", input)
    }

    private func entry(_ value: OrderedJSON) throws -> NativeDiagnosticEntry {
        let detail: String?
        if let raw = value["detail"], raw != .null { detail = try raw.string("diagnostic detail") }
        else { detail = nil }
        return try .init(id: value.required("id").string("diagnostic id"),
                         label: value.required("label").string("diagnostic label"),
                         status: value.required("status").string("diagnostic status"),
                         detail: detail,
                         updatedAt: try value.required("updatedAt").number("diagnostic time"))
    }

    private func log(_ value: OrderedJSON) throws -> NativeDiagnosticLog {
        try .init(id: value.required("id").string("diagnostic log id"),
                  timestamp: value.required("timestamp").number("diagnostic log time"),
                  source: value.required("source").string("diagnostic log source"),
                  level: value.required("level").string("diagnostic log level"),
                  message: value.required("message").string("diagnostic log message"))
    }

    private func publish(_ next: OrderedJSON) throws {
        let display = try call(.object([
            .init(key: "operation", value: .string("display")),
            .init(key: "state", value: next),
        ]))
        let rows = try display.required("entries").array("diagnostic entries").map(entry)
        let lines = try display.required("logs").array("diagnostic logs")
        let nextLogs = try lines.map(log)
        let nextFormatted = try lines.map { try $0.required("formatted").string("formatted diagnostic log") }
        if let ttl = try? display.required("doneTTLms").number("diagnostic done TTL"), ttl >= 0 { doneTTLms = ttl }
        state = next
        entries = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
        logs = nextLogs
        displayedEntries = rows
        formattedLogs = nextFormatted
        displayError = nil
    }

    private func reduce(_ action: OrderedJSON) {
        do {
            let next = try call(.object([
                .init(key: "operation", value: .string("reduce")),
                .init(key: "state", value: state),
                .init(key: "action", value: action),
            ]))
            try publish(next)
        } catch {
            displayError = "実行状況を更新できませんでした"
        }
    }

    private func scheduleDoneExpiry(for id: String, status: String) {
        doneExpiry.removeValue(forKey: id)?.cancel()
        guard status == "done" else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.entries[id]?.status == "done" else { return }
            self.remove(id)
        }
        doneExpiry[id] = work
        DispatchQueue.main.asyncAfter(deadline: .now() + doneTTLms / 1000, execute: work)
    }

    func report(id: String, label: String, status: String, detail: String? = nil) {
        let previous = entries[id]
        let storedDetail = detail ?? ""
        let changed = previous == nil || previous?.label != label || previous?.status != status || previous?.detail != storedDetail
        reduce(.object([
            .init(key: "type", value: .string("update")),
            .init(key: "id", value: .string(id)),
            .init(key: "patch", value: .object([
                .init(key: "label", value: .string(label)),
                .init(key: "status", value: .string(status)),
                .init(key: "detail", value: .string(storedDetail)),
            ])),
            .init(key: "updatedAt", value: .number(String(Date().timeIntervalSince1970 * 1000))),
        ]))
        scheduleDoneExpiry(for: id, status: status)
        guard changed else { return }
        reduce(.object([
            .init(key: "type", value: .string("appendLog")),
            .init(key: "line", value: .object([
                .init(key: "id", value: .string(UUID().uuidString.lowercased())),
                .init(key: "timestamp", value: .number(String(Date().timeIntervalSince1970 * 1000))),
                .init(key: "source", value: .string("runtime")),
                .init(key: "level", value: .string(status == "error" ? "error" : "info")),
                .init(key: "message", value: .string(label + " " + status)),
            ])),
        ]))
    }

    func clear() {
        for entry in entries.values where entry.status == "done" { doneExpiry.removeValue(forKey: entry.id)?.cancel() }
        reduce(.object([.init(key: "type", value: .string("clear"))]))
    }

    func remove(_ id: String) {
        doneExpiry.removeValue(forKey: id)?.cancel()
        reduce(.object([
            .init(key: "type", value: .string("remove")),
            .init(key: "id", value: .string(id)),
        ]))
    }
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
    var failed = false
    var usesRemoteTransport = true
    var titleAfterAppend = false
    var tokenCounts: OrderedJSON?
}

private struct FailedGenerationRetry {
    let chatID: String
    let chat: OrderedJSON
    let plan: OrderedJSON
    let titleAfterAppend: Bool
}

struct NavigationFocus: Equatable {
    let nodeID: String
    let token = UUID()
}

struct ChatScrollRestoration: Equatable {
    let id = UUID()
    let chatID: String
    let anchor: OrderedJSON
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.chatID.utf8.elementsEqual(rhs.chatID.utf8)
            && (try? lhs.anchor.encoded()) == (try? rhs.anchor.encoded())
    }
}

struct BranchEditorFocus: Equatable {
    let chatID: String
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
    @Published var multiViewChatIndices: [Int] = []
    @Published private(set) var exchange: WebExchange?
    @Published private(set) var document: SyncDocument?
    @Published var persistenceError: String?
    @Published private(set) var generations: [Data: ActiveGeneration] = [:]
    let diagnostics = NativeDiagnostics()
    @Published private var catalogDownloads: [Data: CatalogDownloadJob] = [:]
    private var catalogDownloadTasks: [Data: UUID] = [:]
    private var catalogDownloadEpochs: [Data: UUID] = [:]
    private var catalogShardCaches: Set<Data> = []
    private var catalogResumeData: [Data: Data] = [:]
    private var catalogResumePlans: [Data: (url: String, revision: String)] = [:]
    private var catalogInstallations: Set<Data> = []
    private let catalogTransport: CatalogDownloadTransport
    private var branchPreviewCache: [UUID: (parts: OrderedJSON, preview: String)] = [:]
    @Published private(set) var remoteSettings = RemoteSettings()
    @Published var openRouterVerificationError: String?
    private var openRouterVerificationTasks: [Data:Task<Void,Never>] = [:]
    private var openRouterVerificationTimer: Task<Void,Never>?
    @Published private(set) var openRouterCreditDisplay: String?
    @Published private(set) var openRouterCreditsFetching = false
    @Published private(set) var openRouterCreditsError: String?
    private var openRouterCreditsFetchedAt: Double?
    private var lastOpenRouterCreditFetch = 0.0
    private var openRouterCreditRequestID: UUID?
    private var openRouterCreditCredential: RemoteCredentialRecord?
    private var openRouterCreditProviderSnapshot: OrderedJSON?
    @Published private var generationErrors: [Data:String] = [:]
    @Published var streamRecoveryError: String?
    @Published private(set) var isRecoveringStream = false
    @Published private(set) var isDiscardingProxyRecovery = false
    private var streamRecoveryTask: Task<Void,Never>?
    @Published private var failedGenerationRetries: [Data:FailedGenerationRetry] = [:]
    @Published var automaticEvaluationError: String?
    private var automaticEvaluationTasks: [UUID: [UUID:Task<Void,Never>]] = [:]
    private var automaticEvaluationContexts: [UUID: (chatID: String, nodeID: String, requestPath: [String], userContent: OrderedJSON, record: RemoteCredentialRecord?, client: RemoteClient, read: ProviderModels.CredentialReader)] = [:]
    @Published private(set) var inputRole = "user"
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
    private var pendingTitleContexts: [UUID:(legacy:RemoteCredentialRecord,client:RemoteClient,read:ProviderModels.CredentialReader)] = [:]
    private var generationTasks: [UUID: Task<Void, Never>] = [:]
    private var streamStatusBridge: SharedWebOperations.Session?
    private var generationBridge: SharedWebOperations.Session?
    private let store: LocalStateStore?
    private let localGenerate: LocalLlama.Generator
    private let localEvaluationGenerate: LocalLlama.Generator?
    private let tokenCounting: NativeTokenCounting
    private var liveUsageTasks: [UUID: Task<Void,Never>] = [:]
    private var liveUsageVersions: [UUID: Int] = [:]
    @Published private var liveTokenCounts: [UUID: (source: OrderedJSON, parts: OrderedJSON, counts: OrderedJSON)] = [:]
    private let localModerationClassify: NativeLocalModeration.Classifier?
    private var initialLoadFailed = false
    @Published private(set) var navigationFocus: NavigationFocus?
    @Published private(set) var chatScrollRestoration: ChatScrollRestoration?
    @Published var branchEditorSyncEnabled = true
    @Published private(set) var branchEditorFocus: BranchEditorFocus?
    @Published private(set) var canNavigateBack = false
    @Published private(set) var canNavigateForward = false
    private var navigationHistory: OrderedJSON?
    private var chatScrollAnchors: [Data: OrderedJSON] = [:]
    private var branchCandidates: [BranchNavigation.ChatCandidates] = []
    @Published private var editingHistory: MessageEditing.HistoryState?
    var generation: ActiveGeneration? { generations[Data(selectedID.utf8)] }
    var generationError: String? {
        get { generationErrors[Data(selectedID.utf8)] }
        set { generationErrors[Data(selectedID.utf8)] = newValue }
    }
    private func setGenerationError(_ error: String?, chatID: String) { generationErrors[Data(chatID.utf8)] = error }
    private var failedGenerationRetry: FailedGenerationRetry? {
        get { failedGenerationRetries[Data(selectedID.utf8)] }
        set {
            if let newValue { failedGenerationRetries[Data(newValue.chatID.utf8)] = newValue }
            else { failedGenerationRetries.removeValue(forKey:Data(selectedID.utf8)) }
        }
    }
    func generation(for chatID: String) -> ActiveGeneration? { generations[Data(chatID.utf8)] }
    func generation(for chatID: String, nodeID: String) -> ActiveGeneration? {
        guard let current = generation(for: chatID),
              current.chatID.utf8.elementsEqual(chatID.utf8),
              case .string(let target) = current.plan?["targetNodeId"],
              target.utf8.elementsEqual(nodeID.utf8),
              (try? generationTargetIsCurrent(current)) == true else { return nil }
        return current
    }
    func branchPreview(for current: ActiveGeneration) -> String? {
        if let cached = branchPreviewCache[current.id], cached.parts == current.output.parts { return cached.preview }
        do {
            if generationBridge == nil { generationBridge = try SharedWebOperations.Session() }
            let result = try generationBridge!.call("branchLayout", .object([
                .init(key:"operation",value:.string("preview")), .init(key:"content",value:current.output.parts)]))
            let preview = try result.required("preview").string("branch preview")
            branchPreviewCache[current.id] = (current.output.parts, preview)
            return preview
        } catch { return nil }
    }
    var hasGenerations: Bool { !generations.isEmpty }
    var hasRunningLocalGeneration: Bool { generations.values.contains { $0.running && !$0.usesRemoteTransport } }
    var canUndoMessageEdit: Bool { !hasGenerations && (editingHistory?.canUndo ?? false) }
    var canRedoMessageEdit: Bool { !hasGenerations && (editingHistory?.canRedo ?? false) }

    private func generation(_ id: UUID) -> ActiveGeneration? {
        generations.values.first { $0.id == id }
    }
    private func setGeneration(_ value: ActiveGeneration?) {
        guard let value else { return }
        generations[Data(value.chatID.utf8)] = value
    }
    private func removeGeneration(id: UUID) {
        guard let current = generation(id) else { return }
        generations.removeValue(forKey: Data(current.chatID.utf8))
        branchPreviewCache.removeValue(forKey: id)
        pendingTitleContexts.removeValue(forKey: id)
        liveUsageTasks.removeValue(forKey: id)?.cancel()
        liveUsageVersions.removeValue(forKey: id)
        liveTokenCounts.removeValue(forKey: id)
    }
    private func generationTargetIsCurrent(_ current: ActiveGeneration, in source: OrderedJSON? = nil) throws -> Bool {
        let source = source ?? exchange?.source
        guard let plan = current.plan, let source,
              let before = try current.baseSource.required("chats").array("chats").first(where: { $0["id"] == .string(current.chatID) }),
              let latest = try source.required("chats").array("chats").first(where: { $0["id"] == .string(current.chatID) }),
              let nodeID = try plan["targetNodeId"]?.string("target node") else { return false }
        let dependencies = try plan["requestPath"]?.array("request path").map { try $0.string("node ID") }.filter { !$0.utf8.elementsEqual(nodeID.utf8) } ?? []
        var boundary = SharedWebProjection()
        let ticket = OrderedJSON.object([
            .init(key:"kind",value:.string("generation")), .init(key:"chatId",value:.string(current.chatID)),
            .init(key:"nodeId",value:.string(nodeID)), .init(key:"dependencyIds",value:.array(dependencies.map(OrderedJSON.string)))])
        if generationBridge == nil { generationBridge = try SharedWebOperations.Session() }
        let result = try generationBridge!.call("aiTaskTarget", .object([
            .init(key:"ticket",value:ticket),
            .init(key:"before",value:.object([.init(key:"chats",value:.array([try boundary.chat(before)]))])),
            .init(key:"current",value:.object([.init(key:"chats",value:.array([try boundary.chat(latest)]))]))]))
        guard result == .bool(true) else { return false }
        return latest["branchTree"]?["nodes"]?[nodeID]?["streamState"]?["requestId"] == .string(current.id.uuidString.lowercased())
    }

    init(store: LocalStateStore? = nil, localGenerate: LocalLlama.Generator? = nil, localClassify: NativeLocalModeration.Classifier? = nil, tokenCounting: NativeTokenCounting? = nil,
         catalogDownloadConfiguration: URLSessionConfiguration? = nil) {
        self.store = store
        self.tokenCounting = tokenCounting ?? NativeTokenCounting()
        self.catalogTransport = CatalogDownloadTransport(configuration:catalogDownloadConfiguration)
        self.localGenerate = localGenerate ?? { url, request, onText in
            try await LocalLlama.generate(modelURL:url,request:request,onText:onText)
        }
        self.localEvaluationGenerate = localGenerate
        self.localModerationClassify = localClassify
        for record in NativeCatalogResumeStore(libraryURL:(store ?? LocalStateStore.applicationStore).fileURL).records() {
            let key = Data(record.id.utf8)
            catalogResumeData[key] = record.data
            catalogResumePlans[key] = (record.url,record.revision)
        }
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
    var chatActiveView: ChatActiveView {
        let raw = document?.snapshot["state"]?["chatActiveView"]
        return raw.flatMap { try? $0.string("chatActiveView") }.flatMap(ChatActiveView.init(rawValue:)) ?? .chat
    }
    func setChatActiveView(_ view: ChatActiveView) throws {
        guard chatActiveView != view else { return }
        guard let exchange, let conversation else {
            try saveLayoutSetting("chatActiveView", value:.string(view.rawValue))
            return
        }
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let next = try BranchNavigation.history(current.history, action:.viewSwitch, in:exchange.source,
                                                chatID:conversation.id, view:view.rawValue)
        try applyLibrary(exchange.source, selectedID:selectedID, navigation:next, activeView:view)
    }
    func saveLayoutSetting(_ key: String, value: OrderedJSON) throws {
        guard !initialLoadFailed, let document, let exchange else { throw ExchangeError.invalid("表示を切り替えられません") }
        guard document.snapshot["state"]?[key] != value else { return }
        let candidate = try SyncDocument(snapshot: document.snapshot.replacing("state", with: document.snapshot.required("state").replacing(key, with: value)), v3Sidecar: document.v3Sidecar, v3RootOrder: document.v3RootOrder)
        let changed = try WebExchange(source: candidate.uiProjection())
        try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: conversations, selectedConversationID: selectedID, style: displayStyle))
        self.document = candidate
        self.exchange = changed
        persistenceError = nil
    }
    func ensureBranchTreeForEditor(chatID: String? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard let exchange, !initialLoadFailed else { throw ExchangeError.invalid("分岐を開けません") }
        var chats = try exchange.source.required("chats").array("chats")
        let targetID = chatID ?? selectedID
        guard let index = try chats.firstIndex(where: { try $0.required("id").string("chat ID").utf8.elementsEqual(targetID.utf8) }) else { throw ExchangeError.invalid("会話がありません") }
        guard chats[index]["branchTree"] == nil else { return }
        guard generation(for: targetID) == nil else { throw ExchangeError.invalid("この会話の生成結果を保存してから分岐を開いてください") }
        let chat = chats[index], store = try exchange.source.required("contentStore")
        var boundary = SharedWebProjection()
        let projected = OrderedJSON.object([.init(key: "chat", value: try boundary.chat(chat)), .init(key: "contentStore", value: try boundary.store(store))])
        let count = try chat.required("messages").array("messages").count
        let input = projected.replacing("newIDs", with: .array((0..<count).map { _ in .string(UUID().uuidString.lowercased()) }))
            .replacing("now", with: .number(String(now)))
        let changes = try SharedWebOperations.call("branchEnsure", input)
        let restored = try OrderedJSONChanges.apply(changes, to: .object([.init(key: "chat", value: chat), .init(key: "contentStore", value: store)]), opaque: boundary.opaque)
        chats[index] = try restored.required("chat")
        let source = exchange.source.replacing("chats", with: .array(chats)).replacing("contentStore", with: try restored.required("contentStore"))
        try applyLibrary(source, selectedID: selectedID, resetViewFor: targetID, now: now)
    }
    var conversation: Conversation? { conversations.first { $0.id.utf8.elementsEqual(selectedID.utf8) } }

    func importWebData(_ data: Data) throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成中は取り込めません") }
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
        navigationHistory = nil; navigationFocus = nil; chatScrollAnchors = [:]; chatScrollRestoration = nil; canNavigateBack = false; canNavigateForward = false
        persistenceError = nil
    }

    func prepareImport(data: Data, filename: String, allowPartialImport: Bool = false) async throws -> ChatImportPreview {
        guard !hasGenerations else { throw ExchangeError.invalid("生成中は取り込めません") }
        let baseline = document?.snapshot
        let unpacked = try NativeGzip.isCompressed(data) ? NativeGzip.decompress(data) : data
        let raw = try OrderedJSON.decode(NativeLegacySnapshot.decode(unpacked))
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
            unavailable[try field.key.native("chat ID")] = try field.value.array("unavailable nodes").map { try $0.string("node ID") }
        }
        return ChatImportPreview(filename:filename,conversations:imported.conversations,folderRows:try ChatFolders.rows(in:imported.source),
            recoveredContentCount:Int(try source.required("recoveredContentCount").number("recovered count")),unavailableContent:unavailable,
            source:source,baselineSnapshot:baseline,baselineSidecar:document?.v3Sidecar,baselineRootOrder:document?.v3RootOrder)
    }
    func commitImport(_ preview: ChatImportPreview, mode: ChatImportMode, selectedChatIDs: [String], selectedFolderIDs: [String], includeSettings: Bool) async throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成中は取り込めません") }
        guard try document?.snapshot.encoded() == preview.baselineSnapshot?.encoded(),
              try document?.v3Sidecar.encoded() == preview.baselineSidecar?.encoded(),
              document?.v3RootOrder == preview.baselineRootOrder else { throw ExchangeError.invalid("取り込み準備後に保存データが変更されています") }
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
        return try BranchNavigation.history(history, action: .initialize, in: source, chatID: selectedID, view: chatActiveView.rawValue, viewingPath: conversation?.visibleMessages.map(\.id))
    }

    func captureChatScroll(chatID: String, anchor: OrderedJSON) {
        guard selectedID.utf8.elementsEqual(chatID.utf8), chatScrollRestoration == nil else { return }
        chatScrollAnchors[Data(chatID.utf8)] = anchor
    }

    func recordChatScrollNavigation(chatID: String, anchor: OrderedJSON) throws {
        guard selectedID.utf8.elementsEqual(chatID.utf8), chatScrollRestoration == nil,
              let exchange, let conversation else { return }
        captureChatScroll(chatID: chatID, anchor: anchor)
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let entry = OrderedJSON.object([
            .init(key:"chatId",value:.string(chatID)),
            .init(key:"activePath",value:.array(conversation.visibleMessages.map { .string($0.id) })),
            .init(key:"viewContext",value:.string(chatActiveView.rawValue)),
            .init(key:"source",value:.string(BranchNavigation.Source.scroll.rawValue)),
            .init(key:"scrollAnchor",value:anchor)
        ])
        publishNavigation(try BranchNavigation.history(current.history, action: .push, in: exchange.source, entry: entry), focus: nil)
    }

    func completeChatScrollRestoration(id: UUID) {
        if chatScrollRestoration?.id == id { chatScrollRestoration = nil }
    }

    private func captureNavigationScroll(_ current: BranchNavigation.HistoryResult, in source: OrderedJSON) throws -> BranchNavigation.HistoryResult {
        guard let anchor = chatScrollAnchors[Data(selectedID.utf8)], chatScrollRestoration == nil else { return current }
        return try BranchNavigation.history(current.history, action: .capture, in: source, scrollAnchor: anchor)
    }

    private func restoreChatScroll(chatID: String, anchor: OrderedJSON?, focus: String?) {
        guard focus == nil, let anchor else {
            chatScrollRestoration = nil
            navigationFocus = focus.map { NavigationFocus(nodeID: $0) }
            return
        }
        chatScrollRestoration = ChatScrollRestoration(chatID:chatID,anchor:anchor)
        navigationFocus = nil
    }

    func focusBranchEditor(nodeID: String) throws {
        guard generation == nil, branchEditorSyncEnabled,
              chatActiveView == .splitHorizontal || chatActiveView == .splitVertical,
              let exchange, let conversation,
              conversation.visibleMessages.contains(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }),
              let chat = try exchange.source.required("chats").array("chats").first(where: { $0["id"] == .string(conversation.id) }),
              let tree = chat["branchTree"], case .object = tree else { return }
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let entry = OrderedJSON.object([
            .init(key: "chatId", value: .string(conversation.id)),
            .init(key: "activePath", value: .array(conversation.visibleMessages.map { .string($0.id) })),
            .init(key: "focusedNodeId", value: .string(nodeID)),
            .init(key: "viewContext", value: .string(chatActiveView.rawValue)),
            .init(key: "source", value: .string(BranchNavigation.Source.chatClick.rawValue))
        ])
        let next = try BranchNavigation.history(current.history, action: .push, in: exchange.source, entry: entry)
        publishNavigation(next, focus: nil)
        branchEditorFocus = BranchEditorFocus(chatID: conversation.id, nodeID: nodeID)
    }

    func consumeBranchEditorFocus(_ token: UUID) {
        if branchEditorFocus?.token == token { branchEditorFocus = nil }
    }

    func offPathGenerationTarget() throws -> String? {
        guard let current = generation, current.running, let conversation,
              let target = current.plan?["targetNodeId"] else { return nil }
        // Native permits one generation per chat, so this list has no timestamp ties.
        let result = try SharedWebOperations.call("aiTaskTarget",.object([
            .init(key:"operation",value:.string("orphans")),
            .init(key:"chatId",value:.string(conversation.id)),
            .init(key:"activePath",value:.array(conversation.visibleMessages.map { .string($0.id) })),
            .init(key:"sessions",value:.array([.object([
                .init(key:"chatId",value:.string(current.chatID)),
                .init(key:"targetNodeId",value:target),
                .init(key:"startedAt",value:.number("0"))])]))]))
        return result["targetNodeId"] == .null ? nil : try result.required("targetNodeId").string("generation target")
    }

    func showOffPathGeneration(compact: Bool) throws {
        guard let target = try offPathGenerationTarget(), let exchange, let conversation,
              conversation.nodes.contains(where: { $0.id.utf8.elementsEqual(target.utf8) }) else {
            throw ExchangeError.invalid("表示経路外の生成先がありません")
        }
        let split = chatActiveView == .splitHorizontal || chatActiveView == .splitVertical
        let view: ChatActiveView = !compact && split ? chatActiveView : .branchEditor
        let current = try captureNavigationScroll(try currentNavigationHistory(in:exchange.source),in:exchange.source)
        let entry = OrderedJSON.object([
            .init(key:"chatId",value:.string(conversation.id)),
            .init(key:"activePath",value:.array(conversation.visibleMessages.map { .string($0.id) })),
            .init(key:"focusedNodeId",value:.string(target)),
            .init(key:"viewContext",value:.string(view.rawValue)),
            .init(key:"source",value:.string("branch-editor"))])
        let next = try BranchNavigation.history(current.history,action:.push,in:exchange.source,entry:entry)
        try applyLibrary(exchange.source,selectedID:selectedID,navigation:next,activeView:view)
        chatScrollRestoration = nil
        branchEditorFocus = BranchEditorFocus(chatID:conversation.id,nodeID:target)
    }

    func navigate(chatID: String, nodeID: String? = nil, source: BranchNavigation.Source) throws {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        let history = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let path = conversations.first { $0.id.utf8.elementsEqual(chatID.utf8) }?.visibleMessages.map(\.id)
        let target = try BranchNavigation.navigate(in: exchange.source, chatID: chatID, nodeID: nodeID, source: source, viewingPath: path)
        guard target.status == .reached else { throw ExchangeError.invalid("移動先の会話またはメッセージがありません") }
        let view = source == .chatSwitch ? chatActiveView.rawValue : "chat"
        let next = try BranchNavigation.history(history.history, action: .push, in: target.source, target: target, view: view, navigationSource: source)
        try applyLibrary(target.source, selectedID: chatID, resetViewFor: chatID, navigation: next)
        let focus = nodeID == nil ? nil : (target.focusedNodeID ?? target.path.last)
        let anchor = next.entry?["scrollAnchor"] ?? (nodeID == nil && source == .chatSwitch ? chatScrollAnchors[Data(chatID.utf8)] : nil)
        restoreChatScroll(chatID:chatID,anchor:anchor,focus:focus)
    }

    func navigateBranchSearch(_ result: ChatSearchResult) throws {
        guard let nodeID = result.nodeID else { throw ExchangeError.invalid("移動先のメッセージがありません") }
        try navigateBranchEditor(chatID: result.chatID, nodeID: nodeID, source: .search, focus: true)
    }

    func openBranchNodeDetail(chatID: String, nodeID: String) throws {
        try navigateBranchEditor(chatID: chatID, nodeID: nodeID, source: .branchEditor, focus: false)
    }

    private func navigateBranchEditor(chatID: String, nodeID: String, source: BranchNavigation.Source, focus: Bool) throws {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話がありません") }
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let target = try BranchNavigation.navigate(in: exchange.source, chatID: chatID, nodeID: nodeID, source: source)
        guard target.status == .reached else { throw ExchangeError.invalid("移動先の会話またはメッセージがありません") }
        let next = try BranchNavigation.history(current.history, action: .push, in: target.source, target: target,
                                                view: chatActiveView.rawValue, navigationSource: source)
        try applyLibrary(target.source, selectedID: selectedID, resetViewFor: chatID, navigation: next)
        chatScrollRestoration = nil
        branchEditorFocus = focus ? BranchEditorFocus(chatID: chatID, nodeID: nodeID) : nil
    }

    func moveNavigation(_ direction: BranchNavigation.HistoryAction) throws {
        guard let exchange, direction == .back || direction == .forward else { throw ExchangeError.invalid("現在は履歴を移動できません") }
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let next = try BranchNavigation.history(current.history, action: direction, in: exchange.source)
        guard next.history != current.history, let entry = next.entry else { return }
        let target = try BranchNavigation.restore(in: exchange.source, entry: entry)
        guard target.status == .reached, let chatID = target.chatID else { throw ExchangeError.invalid("移動先の会話がありません") }
        let restoredView = entry["viewContext"].flatMap { try? $0.string("view context") }.flatMap(ChatActiveView.init(rawValue:))
        try applyLibrary(target.source, selectedID: chatID, resetViewFor: chatID, navigation: next, activeView: restoredView)
        if let restoredView, restoredView != .chat, let nodeID = target.focusedNodeID { branchEditorFocus = BranchEditorFocus(chatID:chatID,nodeID:nodeID) }
        let anchor = next.entry?["scrollAnchor"]
        restoreChatScroll(chatID:chatID,anchor:anchor,focus:anchor == nil ? target.focusedNodeID ?? target.path.last : nil)
    }

    private func historySelecting(_ chatID: String, in source: OrderedJSON) throws -> BranchNavigation.HistoryResult? {
        guard !selectedID.utf8.elementsEqual(chatID.utf8), let exchange else { return nil }
        let current = try captureNavigationScroll(try currentNavigationHistory(in: exchange.source), in: exchange.source)
        let target = try BranchNavigation.navigate(in: source, chatID: chatID, source: .chatSwitch)
        guard target.status == .reached else { return nil }
        return try BranchNavigation.history(current.history, action: .push, in: source, target: target, view: chatActiveView.rawValue, navigationSource: .chatSwitch)
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
        guard !hasGenerations else { throw ExchangeError.invalid("生成結果を保存してから設定してください") }
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
        guard !hasGenerations, try syncInputSnapshot().encoded() == expectedSnapshot.encoded() else { throw ExchangeError.invalid("保存データが変更されています。モデル一覧を開き直してください") }
        let state = try expectedSnapshot.required("state")
        guard let provider = try ProviderModels.providers(in:state).first(where:{ $0.id.utf8.elementsEqual(providerID.utf8) }) else { throw ExchangeError.invalid("provider設定がありません") }
        let models = try await client.fetch(provider,readCredential:readCredential)
        try Task.checkCancellation()
        guard !hasGenerations, try syncInputSnapshot().encoded() == expectedSnapshot.encoded() else { throw ExchangeError.invalid("モデル取得中に保存データが変更されました。既存一覧を維持しています") }
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

    func nodeOptionsDraft(nodeID: String, chatID: String? = nil) throws -> NodeOptionsDraft {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        let targetChatID = chatID ?? conversation?.id
        guard let targetChatID,
              try exchange.source.required("chats").array("chats").contains(where: { try $0.required("id").string("id").utf8.elementsEqual(targetChatID.utf8) }),
              let targetConversation = conversations.first(where: { $0.id.utf8.elementsEqual(targetChatID.utf8) }),
              let node = targetConversation.nodes.first(where: { $0.id.utf8.elementsEqual(nodeID.utf8) }) else { throw ExchangeError.invalid("メッセージがありません") }
        return NodeOptionsDraft(chatID: targetConversation.id, nodeID: nodeID, source: exchange.source, original: node.options, value: node.options)
    }

    func saveNodeOptions(_ draft: NodeOptionsDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard generation(for: draft.chatID) == nil else { throw ExchangeError.invalid("生成結果を保存してから設定してください") }
        guard let exchange, exchange.source == draft.source else { throw ExchangeError.invalid("会話が変更されました。設定を開き直してください") }
        guard let sourceChat = try exchange.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let count = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count : 0
        let ids = newIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.saveOptions(in: exchange.source, chatID: draft.chatID, nodeID: draft.nodeID, value: draft.value, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        if source == exchange.source { return }
        try applyLibrary(source, selectedID: selectedID, resetViewFor: sourceChat["branchTree"] == nil ? draft.chatID : nil, editing: history, now: now)
    }

    func setAllMessagesCollapsed(_ value: Bool) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから設定してください") }
        guard let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        let source = try NodeOptions.setAllCollapsed(in:exchange.source,chatID:conversation.id,value:value)
        guard source != exchange.source else { return }
        try applyLibrary(source,selectedID:selectedID)
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

    func pruneHiddenDrafts(chatIDs: [String]) throws -> [NodeRemovalDraft] {
        guard let exchange else { throw ExchangeError.invalid("保存済み会話を選択してください") }
        var seen = Set<Data>(), entries: [JSONField] = [], paths: [Data:[String]] = [:]
        let chats = try exchange.source.required("chats").array("chats")
        for chatID in chatIDs {
            guard seen.insert(Data(chatID.utf8)).inserted,
                  generation(for:chatID) == nil,
                  let chat = try chats.first(where: { try $0.required("id").string("chat ID").utf8.elementsEqual(chatID.utf8) }),
                  let tree = chat["branchTree"] else { throw ExchangeError.invalid("分岐図の対象会話が変更されました") }
            paths[Data(chatID.utf8)] = try tree.required("activePath").array("active path").map { try $0.string("node ID") }
            entries.append(.init(key:"entry",value:.object([.init(key:"chatId",value:.string(chatID)),.init(key:"tree",value:tree)])))
        }
        let selected = try SharedWebOperations.call("branchLayout",.object([
            .init(key:"operation",value:.string("pruneTargets")),.init(key:"entries",value:.array(entries.map(\.value)))]
        )).array("prune targets").map { try $0.string("chat ID") }
        var targets = Set<Data>(), drafts: [NodeRemovalDraft] = []
        for chatID in selected {
            let key = Data(chatID.utf8)
            guard seen.contains(key), targets.insert(key).inserted, let path = paths[key] else { throw ExchangeError.invalid("分岐図の対象会話が変更されました") }
            drafts.append(NodeRemovalDraft(chatID:chatID,nodeID:nil,source:exchange.source,path:path,operation:.pruneHidden))
        }
        return drafts
    }

    func saveHiddenBranchPruning(_ drafts: [NodeRemovalDraft], now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard !drafts.isEmpty else { return }
        guard let exchange, drafts.allSatisfy({ $0.source == exchange.source && $0.operation == .pruneHidden && $0.nodeID == nil }) else {
            throw ExchangeError.invalid("会話が変更されました。整理操作を開き直してください")
        }
        var seen = Set<Data>()
        for draft in drafts {
            guard seen.insert(Data(draft.chatID.utf8)).inserted, generation(for:draft.chatID) == nil else {
                throw ExchangeError.invalid("生成結果を保存してから非表示の枝を整理してください")
            }
        }
        var source = exchange.source, history = editingHistory
        for draft in drafts {
            var next: MessageEditing.HistoryState?
            source = try MessageEditing.remove(in:source,chatID:draft.chatID,nodeID:nil,viewingPath:draft.path,operation:.pruneHidden,newIDs:[],now:now,history:history) { next = $0 }
            if let next { history = next }
        }
        guard source != exchange.source else { return }
        try applyLibrary(source,selectedID:selectedID,resetViewsFor:drafts.map(\.chatID),editing:history,now:now)
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
    func branchClipboardDraft(nodeID: String, operation: BranchClipboardOperation = .copy, throughLeaf: Bool = false) throws -> BranchClipboardDraft {
        guard let conversation else { throw ExchangeError.invalid("対象メッセージがありません") }
        guard throughLeaf, operation != .paste else {
            return try branchClipboardDraft(selectedNodes:[(conversation.id,nodeID)],operation:operation)
        }
        guard let exchange,
              let chat = try exchange.source.required("chats").array("chats").first(where: { try $0.required("id").string("chat ID").utf8.elementsEqual(conversation.id.utf8) }),
              let tree = chat["branchTree"] else { throw ExchangeError.invalid("分岐図の対象メッセージがありません") }
        let path = try SharedWebOperations.call("branchPath",.object([
            .init(key:"tree",value:tree),.init(key:"nodeId",value:.string(nodeID))])).array("branch path")
        guard let leaf = path.last else { throw ExchangeError.invalid("分岐図の対象メッセージがありません") }
        return try branchClipboardDraft(selectedNodes:[(conversation.id,nodeID),(conversation.id,try leaf.string("branch leaf"))],operation:operation)
    }
    func branchClipboardDraft(selectedNodes: [(chatID:String,nodeID:String)], operation: BranchClipboardOperation) throws -> BranchClipboardDraft {
        guard let exchange, !selectedNodes.isEmpty, selectedNodes.allSatisfy({ selected in
            conversations.contains { chat in chat.id.utf8.elementsEqual(selected.chatID.utf8) &&
                chat.nodes.contains { $0.id.utf8.elementsEqual(selected.nodeID.utf8) } }
        }) else { throw ExchangeError.invalid("対象メッセージがありません") }
        let targets = try SharedWebOperations.call("branchLayout",.object([
            .init(key:"operation",value:.string("selection")),
            .init(key:"selectedNodes",value:.array(selectedNodes.map { .object([
                .init(key:"chatId",value:.string($0.chatID)),.init(key:"nodeId",value:.string($0.nodeID))]) }))]))
        let target = try targets.required(operation == .paste ? "pasteTarget" : "range")
        guard target != .null else { throw ExchangeError.invalid("同じ会話の範囲を選んでください") }
        let chatID = try target.required("chatId").string("chatId")
        let from = try target.required(operation == .paste ? "afterNodeId" : "fromNodeId").string("fromNodeId")
        let to = try target.required(operation == .paste ? "afterNodeId" : "toNodeId").string("toNodeId")
        return try BranchClipboardDraft(source:exchange.source,snapshot:publicationSnapshot(),operation:operation,
            sourceChatID:chatID,fromNodeID:from,toNodeID:to,targetChatID:chatID,afterNodeID:to)
    }
    func branchDropDraft(sourceChatID: String, nodeID: String, targetChatID: String, afterNodeID: String) throws -> BranchClipboardDraft {
        guard !sourceChatID.utf8.elementsEqual(targetChatID.utf8), generation(for:sourceChatID) == nil, generation(for:targetChatID) == nil,
              let exchange, let document else { throw ExchangeError.invalid("生成結果を保存してから会話間の範囲を操作してください") }
        let chats = try exchange.source.required("chats").array("chats")
        guard let source = try chats.first(where:{ try $0.required("id").string("chat ID").utf8.elementsEqual(sourceChatID.utf8) }),
              let target = try chats.first(where:{ try $0.required("id").string("chat ID").utf8.elementsEqual(targetChatID.utf8) }),
              let sourceTree = source["branchTree"], let targetTree = target["branchTree"] else {
            throw ExchangeError.invalid("分岐図の対象メッセージが変更されました")
        }
        let sourceNodes = try sourceTree.required("nodes").object("nodes"), targetNodes = try targetTree.required("nodes").object("nodes")
        guard sourceNodes.contains(where: { $0.key.matches(nodeID) }),
              targetNodes.contains(where: { $0.key.matches(afterNodeID) }) else {
            throw ExchangeError.invalid("分岐図の対象メッセージが変更されました")
        }
        let path = try SharedWebOperations.call("branchPath",.object([
            .init(key:"tree",value:sourceTree),.init(key:"nodeId",value:.string(nodeID))])).array("branch path")
        guard let last = path.last else { throw ExchangeError.invalid("分岐図の対象メッセージがありません") }
        let leaf = try last.string("branch leaf")
        return BranchClipboardDraft(source:exchange.source,snapshot:document.snapshot,operation:.move,
            sourceChatID:sourceChatID,fromNodeID:nodeID,toNodeID:leaf,targetChatID:targetChatID,afterNodeID:afterNodeID)
    }
    func branchClipboardIsBusy(_ draft: BranchClipboardDraft) -> Bool {
        let affected = draft.operation == .paste ? [draft.targetChatID] : draft.operation == .move ? [draft.sourceChatID,draft.targetChatID] : [draft.sourceChatID]
        return affected.contains { generation(for:$0) != nil }
    }
    private func branchDropIsBusy(_ draft: BranchClipboardDraft) -> Bool {
        [draft.sourceChatID,draft.targetChatID].contains { generation(for:$0) != nil }
    }
    func saveBranchDrop(_ draft: BranchClipboardDraft, operation: BranchClipboardOperation, newIDs: [String]? = nil,
                        now: Double = Date().timeIntervalSince1970 * 1000) throws -> BranchClipboardResult {
        guard operation == .copy || operation == .move else { throw ExchangeError.invalid("会話間の範囲操作が不正です") }
        guard !branchDropIsBusy(draft) else { throw ExchangeError.invalid("生成結果を保存してから会話間の範囲を操作してください") }
        guard let exchange, let document, exchange.source == draft.source, document.snapshot == draft.snapshot else {
            throw ExchangeError.invalid("会話または分岐図の対象が変更されました。操作を開き直してください")
        }
        if operation == .move {
            var moving = draft; moving.operation = .move
            return try saveBranchClipboard(moving,newIDs:newIDs,now:now)
        }
        var copying = draft; copying.operation = .copy
        let copied = try saveBranchClipboard(copying,newIDs:[],now:now)
        guard copied.status == "copied" else { return copied }
        guard !branchDropIsBusy(draft), let copiedExchange = self.exchange, let copiedDocument = self.document else {
            throw ExchangeError.invalid("生成結果を保存してから会話間の範囲を操作してください")
        }
        let paste = BranchClipboardDraft(source:copiedExchange.source,snapshot:copiedDocument.snapshot,operation:.paste,
            sourceChatID:draft.sourceChatID,fromNodeID:draft.fromNodeID,toNodeID:draft.toNodeID,
            targetChatID:draft.targetChatID,afterNodeID:draft.afterNodeID)
        return try saveBranchClipboard(paste,newIDs:newIDs,now:now)
    }
    func saveBranchClipboard(_ draft: BranchClipboardDraft, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws -> BranchClipboardResult {
        guard !branchClipboardIsBusy(draft) else { throw ExchangeError.invalid("生成結果を保存してから範囲を操作してください") }
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
                               parts: draft.parts, editedText: draft.text, removeCount: draft.removeCount, newIDs: newIDs, now: now)
    }
    func saveMessageForGeneration(_ draft: MessageDraft, now: Double = Date().timeIntervalSince1970 * 1000) throws -> MessageDraft {
        guard generation == nil, let exchange, exchange.source == draft.source,
              conversation?.id.utf8.elementsEqual(draft.chatID.utf8) == true else {
            throw ExchangeError.invalid("会話が変更されました。本文を開き直してください")
        }
        if draft.isInsertion {
            guard let chat = try draft.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
            let count = try chat["branchTree"] == nil ? chat.required("messages").array("messages").count + 1 : 1
            var history: MessageEditing.HistoryState?
            let changed = try MessageEditing.insertionForGeneration(in: draft.source, draft: draft,
                newIDs: (0..<count).map { _ in UUID().uuidString.lowercased() }, now: now, history: editingHistory) { history = $0 }
            try applyLibrary(changed.source, selectedID: draft.chatID, resetViewFor: draft.chatID, editing: history, now: now)
            return try messageDraft(nodeID: changed.nodeID)
        }
        if let nodeID = draft.nodeID {
            guard let chat = try draft.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(draft.chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
            let count = try chat["branchTree"] == nil ? chat.required("messages").array("messages").count : 0
            var history: MessageEditing.HistoryState?
            let changed = try MessageEditing.transform(in: draft.source, chatID: draft.chatID, nodeID: nodeID, viewingPath: draft.path,
                operation: "replaceAndPrune", role: draft.role, parts: draft.parts, editedText: draft.text,
                removeCount: draft.followingCount, newIDs: (0..<count).map { _ in UUID().uuidString.lowercased() }, now: now,
                history: editingHistory) { history = $0 }
            if let explanation = changed.result.explanation { throw ExchangeError.invalid(explanation) }
            guard changed.result.pruneBlockedBy.isEmpty else { throw ExchangeError.invalid("保護された後続があるため、本文と後続を変更できません") }
            if changed.result.status == "updated" {
                try applyLibrary(changed.source, selectedID: draft.chatID, resetViewFor: draft.chatID, editing: history, now: now)
            }
        } else { try saveMessage(draft, mode: .append, now: now) }
        guard let nodeID = conversation?.visibleMessages.last?.id else { throw ExchangeError.invalid("生成するメッセージがありません") }
        return try messageDraft(nodeID: nodeID)
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
                                             parts: draft.parts, editedText: draft.text, mode: mode, newIDs: ids, now: now, history: editingHistory) { history = $0 }
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
        _ = try record.proxy?.validated()
        try write(record)
        remoteSettings = record.settings
    }

    func invalidateOpenRouterCredits() {
        openRouterCreditRequestID = nil
        openRouterCreditDisplay = nil
        openRouterCreditsFetching = false
        openRouterCreditsError = nil
        openRouterCreditsFetchedAt = nil
        lastOpenRouterCreditFetch = 0
        openRouterCreditCredential = nil
        openRouterCreditProviderSnapshot = nil
    }

    @MainActor func refreshOpenRouterCredits(reason: String,
        readCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:),
        fetch: @escaping (URLRequest) async throws -> OrderedJSON = OpenRouterCreditsClient.fetch,
        now: Double = Date().timeIntervalSince1970 * 1000) async {
        guard ["open","completed","manual"].contains(reason),
              let source = exchange?.source,
              let chats = try? source.required("chats").array("chats"),
              let chat = chats.first(where: { $0["id"] == .string(selectedID) }),
              chat["config"]?["modelSource"] != .string("local"),
              chat["config"]?["providerId"] == .string("openrouter") else { return }
        let record: RemoteCredentialRecord
        let providerSnapshot: OrderedJSON
        do {
            let roots = try publicationSnapshot().required("state")
            guard let provider = try ProviderModels.providers(in:roots).first(where: { $0.id == "openrouter" }) else { throw ExchangeError.invalid("OpenRouterのprovider設定がありません") }
            record = try ProviderModels.credential(provider,read:readCredential)
            guard !record.key.isEmpty else { throw ExchangeError.invalid("OpenRouterのAPI keyがありません") }
            providerSnapshot = roots["providers"]?["openrouter"] ?? .null
            if openRouterCreditCredential != record || openRouterCreditProviderSnapshot != providerSnapshot { invalidateOpenRouterCredits() }
            openRouterCreditCredential = record
            openRouterCreditProviderSnapshot = providerSnapshot
        } catch {
            invalidateOpenRouterCredits()
            openRouterCreditsError = "残高を取得できませんでした"
            return
        }
        var startedRequestID: UUID?
        defer {
            if let startedRequestID, openRouterCreditRequestID == startedRequestID {
                lastOpenRouterCreditFetch = now
                openRouterCreditRequestID = nil
                openRouterCreditsFetching = false
            }
        }
        do {
            var policyFields: [JSONField] = [
                .init(key:"operation",value:.string("policy")),.init(key:"reason",value:.string(reason)),
                .init(key:"now",value:.number(String(now))),.init(key:"lastFetch",value:.number(String(lastOpenRouterCreditFetch))),
                .init(key:"inFlight",value:.bool(openRouterCreditsFetching))]
            if let openRouterCreditsFetchedAt { policyFields.append(.init(key:"fetchedAt",value:.number(String(openRouterCreditsFetchedAt)))) }
            let policy = try SharedWebOperations.call("openRouterCredits",.object(policyFields))
            guard try policy.required("fetch").boolean("fetch credits") else { return }
            let envelope = try SharedWebOperations.call("openRouterCredits",.object([.init(key:"operation",value:.string("request"))]))
            let destination = try RemoteSettings(endpoint:envelope.required("endpoint").string("credits endpoint")).validatedURL()
            let origin = try record.settings.validatedURL()
            guard ProviderModels.sameOrigin(destination,origin),
                  envelope["authentication"]?["header"] == .string("Authorization"),
                  envelope["authentication"]?["scheme"] == .string("Bearer"),
                  !record.key.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw ExchangeError.invalid("OpenRouter credits要求を検証できませんでした") }
            var request = URLRequest(url:destination)
            request.httpMethod = "GET"
            request.setValue("Bearer " + record.key,forHTTPHeaderField:"Authorization")
            let requestID = UUID()
            startedRequestID = requestID
            openRouterCreditRequestID = requestID
            openRouterCreditsFetching = true
            let payload = try await fetch(request)
            guard openRouterCreditRequestID == requestID else { return }
            guard let latest = try readCredential("openrouter"), latest == record,
                  try (publicationSnapshot().required("state")["providers"]?["openrouter"] ?? .null) == providerSnapshot else {
                invalidateOpenRouterCredits(); return
            }
            let parsed = try SharedWebOperations.call("openRouterCredits",.object([.init(key:"operation",value:.string("parse")),.init(key:"payload",value:payload)]))
            guard parsed != .null, let balance = parsed["balance"] else { throw ExchangeError.invalid("OpenRouter credits応答が不正です") }
            let display = try SharedWebOperations.call("openRouterCredits",.object([.init(key:"operation",value:.string("display")),.init(key:"balance",value:balance)]))
            openRouterCreditDisplay = try display.required("display").string("credit balance")
            openRouterCreditsFetchedAt = now
            openRouterCreditsError = nil
        } catch {
            guard startedRequestID == nil || openRouterCreditRequestID == startedRequestID else { return }
            openRouterCreditsError = "残高を取得できませんでした"
        }
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

    func setInputRole(_ role: String) throws {
        guard generation == nil else { throw ExchangeError.invalid("生成結果を保存してから入力の役割を変更してください") }
        guard role == "user" || role == "assistant" else { throw ExchangeError.invalid("入力の役割が正しくありません") }
        inputRole = role
    }
    func composerDraft(chatID: String) -> ComposerDraft { composerDrafts[Data(chatID.utf8)] ?? .empty }
    func composerImageDetail(chatID: String) throws -> String {
        guard let chat = try exchange?.source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("入力先の会話がありません") }
        return try chat["imageDetail"]?.string("imageDetail") ?? ChatDefaults.webInitial().imageDetail
    }
    func setComposerPrompt(_ applied: ComposerDraft, chatID: String, expected: ComposerDraft) throws {
        let current = composerDraft(chatID: chatID)
        guard generation == nil, selectedConversationID.utf8.elementsEqual(chatID.utf8),
              current.text.utf8.elementsEqual(expected.text.utf8), try current.parts.encoded() == expected.parts.encoded() else {
            throw ExchangeError.invalid("入力または会話が変更されました。プロンプトを選び直してください")
        }
        composerDrafts[Data(chatID.utf8)] = applied
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
        try startGeneration(prepared:prepared,role:inputRole,record:record,client:client,nodeIDs:nodeIDs,readProviderCredential:readProviderCredential)
        composerDrafts.removeValue(forKey:identity)
    }
    var canRetryFailedGeneration: Bool {
        guard generation == nil, !isRecoveringStream, let retry = failedGenerationRetry,
              selectedConversationID.utf8.elementsEqual(retry.chatID.utf8),
              let chats = try? exchange?.source.required("chats").array("chats") else { return false }
        return chats.first { $0["id"] == .string(retry.chatID) } == retry.chat
    }

    func retryFailedGeneration(record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil,
                               readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard canRetryFailedGeneration, let retry = failedGenerationRetry, let exchange, let conversation else {
            throw ExchangeError.invalid("再試行する会話が変更されています。保存状態と対象を確認してください")
        }
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        let prepared = try MessageEditing.generation(in:exchange.source,chatID:retry.chatID,operation:"prepare",action:.retry,
            viewingPath:conversation.visibleMessages.map(\.id),plan:retry.plan,newIDs:nodeIDs,now:now,history:editingHistory) { history = $0 }
        guard prepared.output["status"] == .string("updated") else { throw ExchangeError.invalid("再試行する生成先が変更されているか、保護されています") }
        let plan = try prepared.output.required("plan")
        let path = try plan.required("requestPath").array("requestPath").map { try $0.string("node ID") }
        try beginGeneration(source:prepared.source,chatID:retry.chatID,path:path,history:history,plan:plan,regenerate:false,
            record:record,client:client,readProviderCredential:readProviderCredential,now:now,titleAfterAppend:retry.titleAfterAppend)
    }

    func messageGenerationDraft(nodeID: String, operation: MessageGenerationOperation) throws -> MessageGenerationDraft {
        guard generation == nil, let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択し、生成の終了を待ってください") }
        return MessageGenerationDraft(chatID:conversation.id,nodeID:nodeID,operation:operation,source:exchange.source,path:conversation.visibleMessages.map(\.id))
    }

    func startGeneration(_ draft: MessageGenerationDraft, record: RemoteCredentialRecord? = nil, client: RemoteClient = RemoteClient(), nodeIDs: [String]? = nil,
                         readProviderCredential: @escaping ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws {
        guard generation(for:draft.chatID) == nil, !isRecoveringStream, let exchange else { throw ExchangeError.invalid("この会話の生成結果の保存・復旧が終わってから操作してください") }
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
    private func startGeneration(prepared: ComposerDraft, role: String = "user", record: RemoteCredentialRecord? = nil, client: RemoteClient, nodeIDs: [String]?, readProviderCredential: @escaping ProviderModels.CredentialReader) throws {
        guard generation(for:selectedID) == nil, !isRecoveringStream, let exchange, let conversation else { throw ExchangeError.invalid("保存済み会話を選択し、この会話の生成・復旧の終了を待ってください") }
        guard prepared.hasMeaningfulContent else { throw ExchangeError.invalid("本文または画像を入力してください") }
        let sourceChat = try exchange.source.required("chats").array("chats").first { try $0.required("id").string("ID").utf8.elementsEqual(conversation.id.utf8) }!
        let count = try sourceChat["branchTree"] == nil ? sourceChat.required("messages").array("messages").count + 1 : 1
        let ids = nodeIDs ?? (0..<count).map { _ in UUID().uuidString.lowercased() }
        let body = prepared.parts
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        let source = try MessageEditing.save(in: exchange.source, chatID: conversation.id, nodeID: nil, viewingPath: conversation.visibleMessages.map(\.id), role: role, parts: body, mode: .append, newIDs: ids, now: now, history: editingHistory) { history = $0 }
        let changed = try WebExchange(source: source)
        let path = changed.conversations.first { $0.identity == conversation.identity }!.visibleMessages.map(\.id)
        let appended = try MessageEditing.generation(in:source,chatID:conversation.id,operation:"prepare",action:.append,
            viewingPath:path,newIDs:[UUID().uuidString.lowercased()],now:now,history:history) { history = $0 }
        guard appended.output["status"] == .string("updated") else { throw ExchangeError.invalid("生成先を準備できませんでした") }
        let plan = try appended.output.required("plan")
        let requestPath = try plan.required("requestPath").array("requestPath").map { try $0.string("node ID") }
        try beginGeneration(source:appended.source,chatID:conversation.id,path:requestPath,history:history,plan:plan,regenerate:false,
            record:record,client:client,readProviderCredential:readProviderCredential,now:now,titleAfterAppend:true)
    }

    private func beginGeneration(source: OrderedJSON, chatID: String, path: [String], history: MessageEditing.HistoryState?, plan: OrderedJSON?, regenerate: Bool,
                                 record: RemoteCredentialRecord? = nil, client: RemoteClient, readProviderCredential: @escaping ProviderModels.CredentialReader, now: Double,
                                 titleAfterAppend: Bool = false) throws {
        guard !hasRunningLocalGeneration else { throw ExchangeError.invalid("ローカル生成の終了を待ってください") }
        let sourceChat = try source.required("chats").array("chats").first { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }!
        let savedState = try publicationSnapshot().required("state")
        let modelState = ChatConfig.modelState(in:savedState)
        if sourceChat["config"]?["modelSource"] == .string("local") {
            guard !hasGenerations else { throw ExchangeError.invalid("ローカル生成は他の生成の終了後に開始してください") }
            try beginLocalGeneration(source:source,chat:sourceChat,chatID:chatID,path:path,history:history,plan:plan,now:now,titleAfterAppend:titleAfterAppend)
            return
        }
        guard generation(for:chatID) == nil else { throw ExchangeError.invalid("この会話ではすでに生成中です") }
        let legacy = try record ?? RemoteCredentials.load()
        let proxy = try legacy.proxy?.validated()
        let credential = try ProviderModels.generationCredential(config:sourceChat["config"] ?? .object([]),state:savedState,legacy:legacy,read:readProviderCredential)
        let apiVersion: String?
        if case .string(let value) = savedState["apiVersion"] { apiVersion = value }
        else if savedState["apiVersion"] == nil || savedState["apiVersion"] == .null { apiVersion = nil }
        else { throw ExchangeError.invalid("API versionの形式が不正です") }
        let config = try RemoteRequest.configuration(chat:sourceChat,settings:credential.settings)
        let contextMessages = try RemoteRequest.tokenContext(source:source,chat:sourceChat,config:config,path:path)
        try ConversationEvaluation.enforcePreSendSafety(settings:ConversationEvaluation.autoSettings(savedState),chat:sourceChat)
        let id = UUID()
        guard let plan else { throw ExchangeError.invalid("生成先がありません") }
        let started = try startingStreamState(source:source,chatID:chatID,plan:plan,id:id,proxy:proxy != nil,now:now)
        try applyLibrary(started, selectedID: chatID, resetViewFor: chatID, editing: history, now: now)
        setGeneration(ActiveGeneration(id: id, chatID: chatID, baseSource: try publishedSource(), path: path, plan: plan, titleAfterAppend: titleAfterAppend))
        diagnostics.report(id: "generation-" + id.uuidString.lowercased(), label: "生成", status: "active")
        generationError = nil
        automaticEvaluationError = nil
        pendingTitleContexts[id] = (legacy,client,readProviderCredential)
        startLiveTokenCounting(generationID:id)
        generationTasks[id] = Task { @MainActor [weak self] in
            guard let self else { return }
            @MainActor func check() throws {
                try Task.checkCancellation()
                guard let current = self.generation(id), current.running,
                      try self.generationTargetIsCurrent(current),
                      try ChatConfig.modelState(in:self.publicationSnapshot().required("state")) == modelState,
                      try self.publicationSnapshot().required("state")["providers"] == savedState["providers"],
                      try self.publicationSnapshot().required("state")["apiVersion"] == savedState["apiVersion"] else { throw CancellationError() }
            }
            do {
                try check()
                let budget = try SharedWebOperations.call("tokenBudgetOperation",.object([
                    .init(key:"config",value:config),.init(key:"modelState",value:modelState)]))
                let messages = try await self.tokenCounting.limit(messages:contextMessages,model:config.required("model").string("model"),limit:budget.required("promptBudget").nativeTokenInteger("prompt budget"))
                try check()
                guard try !messages.array("limited messages").isEmpty else { throw ExchangeError.invalid("送信本文がtoken上限を超えています") }
                let promptTokens = try await self.tokenCounting.count(messages:messages,model:config.required("model").string("model"))
                try check()
                let checked = try SharedWebOperations.call("tokenBudgetOperation",.object([
                    .init(key:"config",value:config),.init(key:"modelState",value:modelState),.init(key:"promptTokens",value:.number(String(promptTokens)))]))
                guard checked["fits"] == .bool(true) else { throw ExchangeError.invalid("送信本文がtoken上限を超えています") }
                let request = try RemoteRequest.make(source:source,chatID:chatID,path:path,settings:credential.settings,key:credential.key,
                    modelState:modelState,apiVersion:apiVersion,regenerate:regenerate,tokenMessages:messages,viaProxy:proxy != nil)
                let streaming = try RemoteRequest.streaming(request)
                let userContent = try ConversationEvaluation.transmittedUserContent(messages)
                if let userContent {
                    let nodeID = try plan.required("targetNodeId").string("target node")
                    self.automaticEvaluationContexts[id] = (chatID,nodeID,path,userContent,legacy,client,readProviderCredential)
                    self.startAutomaticEvaluation(phase:"pre-send",generationID:id)
                }
                var savedCursor: OrderedJSON?
                var savedComplete: Bool?
                try await client.complete(request, streaming: streaming, proxy:proxy, providerID:sourceChat["config"]?["providerId"].flatMap { try? $0.string("provider ID") }, proxySessionID:chatID + ":" + id.uuidString.lowercased(),onProxyCheckpoint:{ [weak self] output in
                    guard let self, let current = self.generation(id), current.running,
                          try self.generationTargetIsCurrent(current) else { throw CancellationError() }
                    let cursor = output.proxyReceipt?.decoder?["lastEventId"] ?? .number("0")
                    let complete = output.proxyReceipt?.complete == true
                    guard cursor != savedCursor || complete != savedComplete else { return }
                    try self.proxyRecoveryStore.upsert(self.makeProxyRecoveryRecord(current,output:output))
                    savedCursor = cursor; savedComplete = complete
                }) { [weak self] output in
                    guard let self, var current = self.generation(id), current.running,
                          (try? self.generationTargetIsCurrent(current)) == true else { return }
                    current.output = output; self.setGeneration(current)
                }
                try await self.prepareGenerationTokenCounts(id:id)
                self.finishGeneration(id:id,error:nil)
            } catch {
                self.finishGeneration(id:id,error:error)
            }
        }
    }

    deinit { catalogTransport.invalidateAndCancel() }

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
    func localModelCatalog() throws -> [OrderedJSON] {
        try SharedWebOperations.call("localModelImport",.object([.init(key:"operation",value:.string("catalog"))])).array("catalog")
    }
    func catalogDownload(id: String) -> CatalogDownloadJob? {
        let key = Data(id.utf8)
        return catalogDownloads[key] ?? (catalogResumeData[key]?.isEmpty == false ? .init(receivedBytes:0,expectedBytes:nil,running:false,partial:true,error:nil,canResume:true) : nil)
    }
    func cancelCatalogDownload(id: String) {
        let key = Data(id.utf8)
        guard let token = catalogDownloadTasks.removeValue(forKey:key) else { return }
        let expected = catalogDownloads[key]?.expectedBytes
        let plan = catalogResumePlans[key]
        catalogDownloads[key] = .init(receivedBytes:0,expectedBytes:expected,running:false,partial:true,error:nil,canResume:false)
        diagnostics.report(id: "model-" + id, label: "モデル取得", status: "done", detail: "取消")
        catalogTransport.cancel(token) { [weak self] data in
            Task { @MainActor in
                guard let self, self.catalogDownloadEpochs[key] == token, self.catalogDownloadTasks[key] == nil else { return }
                if let data, !data.isEmpty, let plan {
                    self.catalogResumeData[key] = data; self.catalogResumePlans[key] = plan
                    try? self.catalogResumeStore.save(self.catalogResumeRecords())
                }
                self.catalogDownloads[key] = .init(receivedBytes:0,expectedBytes:expected,running:false,partial:true,error:nil,canResume:data?.isEmpty == false || self.catalogShardCaches.contains(key))
            }
        }
    }
    func startCatalogDownload(id: String) throws {
        let plan = try SharedWebOperations.call("localModelImport",.object([.init(key:"operation",value:.string("catalogPlan")),.init(key:"id",value:.string(id))]))
        try startModelDownload(plan:plan)
    }
    @discardableResult func startHfModelDownload(result: OrderedJSON, variant: OrderedJSON) throws -> String {
        let definitionRequest = OrderedJSON.object([
            .init(key:"operation",value:.string("downloadPlan")),.init(key:"result",value:result),.init(key:"variant",value:variant)
        ])
        let plan = try SharedWebOperations.call("hfSearchOperation",definitionRequest)
        let existing = try SharedWebOperations.call("hfSearchOperation",.object([
            .init(key:"operation",value:.string("existingModel")),.init(key:"repoID",value:try result.required("repoId")),
            .init(key:"fileName",value:try variant.required("fileName")),.init(key:"models",value:.array(try localModelDefinitions()))
        ]))
        if existing != .null {
            let id = try existing.string("existing model ID")
            if let model = try localModelDefinitions().first(where: { $0["id"] == .string(id) }),
               (try? localModelFiles.installed(model:model)) != nil { return id }
        }
        try startModelDownload(plan:plan,definitionRequest:definitionRequest)
        return try plan.required("model").required("id").string("model ID")
    }
    private func startModelDownload(plan: OrderedJSON, definitionRequest: OrderedJSON? = nil) throws {
        guard !hasGenerations, !evaluationJobs.values.contains(where: { $0.busy }) else {
            throw ExchangeError.invalid("生成・評価の終了後にモデルを取得してください")
        }
        let id = try plan.required("model").required("id").string("model ID")
        let key = Data(id.utf8)
        guard catalogDownloadTasks[key] == nil, !catalogInstallations.contains(key) else { throw ExchangeError.invalid("このモデルの取得・取消処理が終了してから再試行してください") }
        let roots = try syncInputSnapshot().required("state")
        let model = try plan.required("model")
        let modelID = try model.required("id").string("catalog model ID")
        if model["engine"] == .string("wllama"), model["manifest"]?["kind"] == .string("gguf-sharded"), let definitionRequest {
            try startShardedDownload(plan:plan,definitionRequest:definitionRequest,roots:roots)
            return
        }
        guard modelID.utf8.elementsEqual(id.utf8), model["engine"] == .string("wllama"), model["manifest"]?["kind"] == .string("single-file") else {
            throw ExchangeError.invalid("取得できないカタログモデルです")
        }
        let files = try plan.required("files").array("catalog files")
        guard files.count == 1, let urlText = try files[0]["url"]?.string("catalog URL"), let url = URL(string:urlText),
              let components = URLComponents(url:url,resolvingAgainstBaseURL:false), components.scheme == "https",
              components.host?.lowercased() == "huggingface.co", components.port == nil || components.port == 443,
              components.user == nil, components.password == nil, components.fragment == nil else {
            throw ExchangeError.invalid("カタログの取得先が不正です")
        }
        let expectedText = try model["expectedDownloadSize"]?.number("expected download size")
        let expected = expectedText.flatMap(Int64.init)
        let revision = try model.required("revision").string("catalog revision")
        let resumeData: Data?
        if let plan = catalogResumePlans[key], plan.url == urlText, plan.revision == revision { resumeData = catalogResumeData[key] }
        else { catalogResumeData.removeValue(forKey:key); catalogResumePlans.removeValue(forKey:key); try? catalogResumeStore.save(catalogResumeRecords()); resumeData = nil }
        catalogResumePlans[key] = (urlText,revision)
        catalogDownloads[key] = .init(receivedBytes:0,expectedBytes:expected,running:true,partial:false,error:nil,canResume:false)
        diagnostics.report(id:"model-" + id,label:"モデル取得",status:"active")
        let token = UUID()
        catalogDownloadEpochs[key] = token
        catalogDownloadTasks[key] = token
        catalogTransport.start(url,resumeData:resumeData,token:token,progress: { [weak self] received, total in
            Task { @MainActor in
                guard let self, self.catalogDownloadTasks[key] == token else { return }
                self.catalogDownloads[key] = .init(receivedBytes:received,expectedBytes:total ?? expected,running:true,partial:false,error:nil,canResume:false)
            }
        },finish: { [weak self] result in
            Task { @MainActor in
                guard let self, self.catalogDownloadTasks[key] == token else {
                    if case .success(let temporary) = result { try? FileManager.default.removeItem(at:temporary) }
                    return
                }
                switch result {
                case .success(let temporary):
                    defer { try? FileManager.default.removeItem(at:temporary) }
                    do {
                        let inspected = try await Task.detached { try self.localModelFiles.inspect(temporary) }.value
                        try Task.checkCancellation()
                        try await self.finishCatalogDownload(id:id,key:key,token:token,roots:roots,model:model,file:files[0],definitionRequest:definitionRequest,temporary:temporary,inspected:inspected)
                    } catch is CancellationError {
                        self.finishCatalogDownloadFailure(key:key,token:token,expected:expected,error:nil)
                    } catch { self.finishCatalogDownloadFailure(key:key,token:token,expected:expected,error:error) }
                case .failure(let error): self.finishCatalogDownloadFailure(key:key,token:token,expected:expected,error:error)
                }
            }
        })
    }
    private func startShardedDownload(plan: OrderedJSON, definitionRequest: OrderedJSON, roots: OrderedJSON) throws {
        let model = try plan.required("model"), id = try model.required("id").string("model ID"), key = Data(id.utf8)
        let revision = try model.required("revision").string("revision")
        let files = try plan.required("files").array("shard files")
        let paths = try files.map { try $0.required("path").string("shard path") }
        let declaration = try SharedWebOperations.call("localModelFiles",.object([
            .init(key:"model",value:model),.init(key:"files",value:.array(paths.map(OrderedJSON.string)))
        ]))
        guard paths.count > 1, try declaration.required("requiredFiles").array("required files") == paths.map(OrderedJSON.string) else {
            throw ExchangeError.invalid("分割GGUFのファイル一覧が不正です")
        }
        let urls = try files.map { file -> URL in
            let text = try file.required("url").string("shard URL")
            guard let url = URL(string:text), let components = URLComponents(url:url,resolvingAgainstBaseURL:false),
                  components.scheme == "https", components.host?.lowercased() == "huggingface.co",
                  components.port == nil || components.port == 443, components.user == nil, components.password == nil,
                  components.fragment == nil else { throw ExchangeError.invalid("分割GGUFの取得先が不正です") }
            return url
        }
        let cacheName = SHA256.hash(data:try plan.encoded()).map { String(format:"%02x",$0) }.joined()
        let expectedNumber = try model["expectedDownloadSize"]?.number("expected bytes")
        let expected = expectedNumber.flatMap(Int64.init)
        let token = UUID()
        catalogDownloadEpochs[key] = token; catalogDownloadTasks[key] = token
        catalogDownloads[key] = .init(receivedBytes:0,expectedBytes:expected,running:true,partial:false,error:nil,canResume:false)
        diagnostics.report(id:"model-" + id,label:"モデル取得",status:"active")
        Task { @MainActor [weak self] in
            guard let self else { return }
            let storage = self.localModelFiles
            var total: Int64 = 0
            var hashes: [JSONField] = []
            @MainActor func check() throws {
                guard self.catalogDownloadTasks[key] == token else { throw CancellationError() }
            }
            do {
                let cache = try storage.openDownloadCache(name:cacheName)
                var verified = try cache.readHashes()
                for index in paths.indices {
                    try check()
                    let path = paths[index], url = urls[index]
                    let recorded = verified[path]
                    self.catalogInstallations.insert(key)
                    let cached = await Task.detached { () -> (name:String,hash:String,size:Int64)? in
                        guard let recorded else { return nil }
                        return try? cache.inspect(path:path,expectedHash:recorded)
                    }.value
                    self.catalogInstallations.remove(key)
                    try check()
                    let inspected: (name:String,hash:String,size:Int64)
                    if let cached { inspected = cached }
                    else {
                        let text = url.absoluteString
                        let resume = self.catalogResumePlans[key].flatMap { $0.url == text && $0.revision == revision ? self.catalogResumeData[key] : nil }
                        self.catalogResumePlans[key] = (text,revision)
                        let completed = total
                        let temporary: URL = try await withCheckedThrowingContinuation { continuation in
                            self.catalogTransport.start(url,resumeData:resume,token:token,progress:{ [weak self] bytes,_ in
                                Task { @MainActor in
                                    guard let self, self.catalogDownloadTasks[key] == token else { return }
                                    self.catalogDownloads[key] = .init(receivedBytes:completed + bytes,expectedBytes:expected,running:true,partial:false,error:nil,canResume:false)
                                }
                            },finish:{ continuation.resume(with:$0) })
                        }
                        defer { try? FileManager.default.removeItem(at:temporary) }
                        try check()
                        self.catalogInstallations.insert(key)
                        do {
                            inspected = try await Task.detached {
                                try cache.install(temporary,path:path)
                            }.value
                        } catch { self.catalogInstallations.remove(key); throw error }
                        self.catalogInstallations.remove(key)
                        try check()
                        verified = verified.replacing(path,with:.string(inspected.hash))
                        try cache.writeHashes(verified)
                        self.catalogResumeData.removeValue(forKey:key); self.catalogResumePlans.removeValue(forKey:key)
                        try? self.catalogResumeStore.save(self.catalogResumeRecords())
                    }
                    total += inspected.size
                    hashes.append(.init(key:path,value:.string(inspected.hash)))
                    self.catalogShardCaches.insert(key)
                    self.catalogDownloads[key] = .init(receivedBytes:total,expectedBytes:expected,running:true,partial:false,error:nil,canResume:false)
                }
                let definition = try SharedWebOperations.call("hfSearchOperation",definitionRequest.replacing("totalBytes",with:.number(String(total)))).required("definition")
                self.catalogInstallations.insert(key)
                defer { self.catalogInstallations.remove(key) }
                let expectedHashes = Dictionary(uniqueKeysWithValues:hashes.map { (Data($0.key.text.utf8),$0.value) })
                let staged = try await Task.detached { () -> LocalModelFiles.DirectoryStage in
                    let inspection = try storage.inspectDirectory(cache.url,model:definition)
                    let actualHashes = Dictionary(uniqueKeysWithValues:inspection.files.map { (Data($0.path.utf8),OrderedJSON.string($0.hash)) })
                    guard actualHashes == expectedHashes else { throw ExchangeError.invalid("取得後にモデルのファイルが変更されました") }
                    if try storage.directoryIsPresent(modelID:id) {
                        let existing = try storage.inspectDirectory(storage.directoryURL(modelID:id),model:definition)
                        let before = Dictionary(uniqueKeysWithValues:existing.files.map { (Data($0.path.utf8),$0.hash) })
                        let after = Dictionary(uniqueKeysWithValues:inspection.files.map { (Data($0.path.utf8),$0.hash) })
                        guard before == after else { throw ExchangeError.invalid("同じモデルIDの別ファイルがこの端末にあります") }
                    }
                    return try storage.stageDirectory(cache.url,model:definition,inspection:inspection)
                }.value
                defer { staged.discard() }
                try check()
                let current = try self.syncInputSnapshot().required("state")
                guard !self.hasGenerations, !self.evaluationJobs.values.contains(where:{ $0.busy }),
                      try (current["localModels"] ?? .array([])).encoded() == (roots["localModels"] ?? .array([])).encoded(),
                      try (current["activeLocalModels"] ?? .object([])).encoded() == (roots["activeLocalModels"] ?? .object([])).encoded() else {
                    throw ExchangeError.invalid("モデル設定または実行状態が変更されました。もう一度取得してください")
                }
                if let existing = try current["localModels"]?.array("models").first(where:{ $0["id"] == .string(id) }) {
                    let oldPlan = try SharedWebOperations.call("localModelFiles",.object([.init(key:"model",value:existing)]))
                    let newPlan = try SharedWebOperations.call("localModelFiles",.object([.init(key:"model",value:definition)]))
                    guard oldPlan == newPlan else { throw ExchangeError.invalid("同じモデルIDの別の定義が登録されています") }
                }
                try storage.publishDirectory(staged,model:definition)
                do { try self.commitCatalogModel(definition,current:current,storedFiles:paths,fileHashes:hashes,bytes:total,revision:revision) }
                catch {
                    try storage.rollbackDirectory(staged,model:definition)
                    throw error
                }
                self.catalogDownloadTasks.removeValue(forKey:key)
                self.catalogResumeData.removeValue(forKey:key); self.catalogResumePlans.removeValue(forKey:key)
                try? self.catalogResumeStore.save(self.catalogResumeRecords())
                await Task.detached { cache.discard() }.value
                self.catalogShardCaches.remove(key)
                self.catalogDownloads[key] = .init(receivedBytes:total,expectedBytes:total,running:false,partial:false,error:nil,canResume:false,installedModelID:id)
                self.diagnostics.report(id:"model-" + id,label:"モデル取得",status:"done")
            } catch {
                self.finishCatalogDownloadFailure(key:key,token:token,expected:expected,error:error is CancellationError ? nil : error)
            }
        }
    }

    private func finishCatalogDownloadFailure(key: Data, token: UUID, expected: Int64?, error: Error?) {
        guard catalogDownloadTasks[key] == token else { return }
        let received = catalogDownloads[key]?.receivedBytes ?? 0
        catalogResumeData.removeValue(forKey:key)
        if let data = (error as NSError?)?.userInfo[NSURLSessionDownloadTaskResumeData] as? Data, !data.isEmpty {
            catalogResumeData[key] = data
        } else { catalogResumePlans.removeValue(forKey:key) }
        try? catalogResumeStore.save(catalogResumeRecords())
        catalogDownloadTasks.removeValue(forKey:key)
        catalogDownloads[key] = .init(receivedBytes:received,expectedBytes:expected,running:false,partial:true,error:error?.localizedDescription,canResume:catalogResumeData[key]?.isEmpty == false || catalogShardCaches.contains(key))
        diagnostics.report(id:"model-" + String(data:key,encoding:.utf8)!,label:"モデル取得",status:"error",detail:"失敗")
    }

    @MainActor private func finishCatalogDownload(id: String, key: Data, token: UUID, roots: OrderedJSON, model: OrderedJSON, file: OrderedJSON, definitionRequest: OrderedJSON?,
                                       temporary: URL, inspected: (name:String,hash:String,size:Int64)) async throws {
        guard catalogDownloadTasks[key] == token else { throw CancellationError() }
        guard let fileName = try file["path"]?.string("catalog file path"), let revision = try model["revision"]?.string("catalog revision") else {
            throw ExchangeError.invalid("カタログのモデル情報が不正です")
        }
        var current = try syncInputSnapshot().required("state")
        var currentModels = try current["localModels"]?.array("local models") ?? []
        let files = localModelFiles
        let candidates: [(value: OrderedJSON, id: String, revision: LocalModelFiles.Revision)] = try await Task.detached {
            try currentModels.compactMap { model in
                guard let candidateID = try? model.required("id").string("model ID"), !candidateID.utf8.elementsEqual(id.utf8), model["engine"] == .string("wllama"),
                      model["manifest"]?["kind"] == .string("single-file"), let installed = try? files.installed(modelID:candidateID),
                      let revision = try? files.revision(installed), let fingerprint = try? files.inspect(installed),
                      (try? files.revision(installed)) == revision else { return nil }
                let value = OrderedJSON.object([.init(key:"model",value:.object([
                    .init(key:"id",value:.string(candidateID)),.init(key:"engine",value:.string("wllama")),
                    .init(key:"manifest",value:.object([.init(key:"kind",value:.string("single-file"))]))
                ])),.init(key:"hash",value:.string(fingerprint.hash)),.init(key:"size",value:.number(String(fingerprint.size)))])
                return (value,candidateID,revision)
            }
        }.value
        guard catalogDownloadTasks[key] == token else { throw CancellationError() }
        current = try syncInputSnapshot().required("state")
        guard !hasGenerations, !evaluationJobs.values.contains(where: { $0.busy }),
              try (current["localModels"] ?? .array([])).encoded() == (roots["localModels"] ?? .array([])).encoded(),
              try (current["activeLocalModels"] ?? .object([])).encoded() == (roots["activeLocalModels"] ?? .object([])).encoded() else {
            throw ExchangeError.invalid("モデル設定または実行状態が変更されました。もう一度取得してください")
        }
        currentModels = try current["localModels"]?.array("local models") ?? []
        let prepared = try SharedWebOperations.call("localModelImport",.object([
            .init(key:"operation",value:.string("prepare")),.init(key:"name",value:.string(inspected.name)),
            .init(key:"hash",value:.string(inspected.hash)),.init(key:"size",value:.number(String(inspected.size))),
            .init(key:"candidates",value:.array(candidates.map(\.value))),.init(key:"existingIDs",value:.array(try currentModels.map { .string(try $0.required("id").string("model ID")) }))
        ]))
        let duplicate = prepared["existing"] == .bool(true)
        let definition: OrderedJSON
        let duplicateRevision: LocalModelFiles.Revision?
        if duplicate {
            let duplicateID = try prepared.required("model").required("id").string("duplicate model ID")
            guard let stored = currentModels.first(where: { (try? $0.required("id").string("model ID"))?.utf8.elementsEqual(duplicateID.utf8) == true }),
                  let candidate = candidates.first(where: { $0.id.utf8.elementsEqual(duplicateID.utf8) }),
                  (try? files.revision(files.installed(modelID:duplicateID))) == candidate.revision else { throw ExchangeError.invalid("既存モデルのファイルが変更されました") }
            definition = .object([.init(key:"id",value:.string(duplicateID)),.init(key:"tasks",value:stored["tasks"] ?? .array([]))])
            duplicateRevision = candidate.revision
        } else {
            if let definitionRequest {
                definition = try SharedWebOperations.call("hfSearchOperation",definitionRequest.replacing("totalBytes",with:.number(String(inspected.size)))).required("definition")
            } else {
                definition = try SharedWebOperations.call("localModelImport",.object([
                    .init(key:"operation",value:.string("catalogDefinition")),.init(key:"id",value:.string(id)),.init(key:"totalBytes",value:.number(String(inspected.size)))
                ]))
            }
            duplicateRevision = nil
        }
        let modelID = try definition.required("id").string("catalog model ID")
        if !duplicate, !modelID.utf8.elementsEqual(id.utf8) { throw ExchangeError.invalid("カタログモデルが変更されました") }
        guard try (current["localModels"] ?? .array([])).encoded() == (roots["localModels"] ?? .array([])).encoded(),
              try (current["activeLocalModels"] ?? .object([])).encoded() == (roots["activeLocalModels"] ?? .object([])).encoded() else {
            throw ExchangeError.invalid("モデル設定が変更されました。もう一度取得してください")
        }
        let target = try localModelFiles.url(modelID:modelID)
        let existed = FileManager.default.fileExists(atPath:target.path)
        // Keep a cancelled install from deleting a file adopted by a newer job.
        catalogInstallations.insert(key)
        defer { catalogInstallations.remove(key) }
        let installedRevision: LocalModelFiles.Revision?
        if duplicate { installedRevision = nil }
        else {
            installedRevision = try await Task.detached {
                try files.installNew(temporary,modelID:modelID,hash:inspected.hash)
                return try files.revision(files.installed(modelID:modelID))
            }.value
        }
        do {
            guard catalogDownloadTasks[key] == token else { throw CancellationError() }
            current = try syncInputSnapshot().required("state")
            guard !hasGenerations, !evaluationJobs.values.contains(where: { $0.busy }),
                  try (current["localModels"] ?? .array([])).encoded() == (roots["localModels"] ?? .array([])).encoded(),
                  try (current["activeLocalModels"] ?? .object([])).encoded() == (roots["activeLocalModels"] ?? .object([])).encoded() else {
                throw ExchangeError.invalid("モデル設定または実行状態が変更されました。もう一度取得してください")
            }
            if let installedRevision { try files.checkRevision(target,expected:installedRevision) }
            if duplicate {
                var boundary = SharedWebProjection()
                let models = try current["localModels"]?.array("local models") ?? []
                let active = current["activeLocalModels"] ?? .object([])
                let projected = OrderedJSON.object([
                    .init(key:"localModels",value:.array(try models.map { try boundary.reference($0) })),
                    .init(key:"activeLocalModels",value:try OrderedJSON.object(try active.object("active models").map { field in
                        JSONField(key:field.key,value:field.value == .null || (try? field.value.string("model ID")) != nil ? field.value : try boundary.reference(field.value))
                    }))
                ])
                guard let duplicateRevision, try files.revision(files.installed(modelID:modelID)) == duplicateRevision else { throw ExchangeError.invalid("既存モデルのファイルが変更されました") }
                let favorites = current["favoriteLocalModelIds"] ?? .array([])
                let metadata = current["savedModelMeta"] ?? .object([])
                let duplicateState = OrderedJSON.object([
                    .init(key:"localModels",value:try projected.required("localModels")),.init(key:"activeLocalModels",value:try projected.required("activeLocalModels")),
                    .init(key:"favoriteLocalModelIds",value:.array(try favorites.array("favorites").map { value in (try? value.string("favorite")) != nil ? value : try boundary.reference(value) })),
                    .init(key:"savedModelMeta",value:try OrderedJSON.object(try metadata.object("saved metadata").map { JSONField(key:$0.key,value:try boundary.reference($0.value)) }))
                ])
                let result = try SharedWebOperations.call("localModelImport",.object([
                    .init(key:"operation",value:.string("catalogDuplicateCommit")),.init(key:"state",value:duplicateState),
                    .init(key:"localModelIDs",value:.array(try models.map { .string(try $0.required("id").string("model ID")) })),
                    .init(key:"downloadedID",value:.string(id)),.init(key:"duplicate",value:definition)
                ]))
                let updated = try OrderedJSONChanges.apply(result.required("changes"),to:current,opaque:boundary.opaque)
                try applyGlobalState(updated)
            } else {
                try commitCatalogModel(definition,current:current,storedFiles:[fileName],fileHashes:[.init(key:fileName,value:.string(inspected.hash))],bytes:inspected.size,revision:revision)
            }
        } catch {
            if !duplicate, !existed, let installedRevision, (try? files.revision(target)) == installedRevision { try? FileManager.default.removeItem(at:target) }
            throw error
        }
        guard catalogDownloadTasks[key] == token else { throw CancellationError() }
        catalogDownloadTasks.removeValue(forKey:key)
        catalogResumeData.removeValue(forKey:key)
        catalogResumePlans.removeValue(forKey:key)
        try? catalogResumeStore.save(catalogResumeRecords())
        catalogDownloads[key] = .init(receivedBytes:inspected.size,expectedBytes:inspected.size,running:false,partial:false,error:nil,canResume:false,installedModelID:modelID)
        diagnostics.report(id:"model-" + id,label:"モデル取得",status:"done")
    }

    private func commitCatalogModel(_ definition: OrderedJSON, current: OrderedJSON, storedFiles: [String], fileHashes: [JSONField], bytes: Int64, revision: String) throws {
        let modelID = try definition.required("id").string("model ID")
        let models = try current["localModels"]?.array("local models") ?? []
        let active = current["activeLocalModels"] ?? .object([])
        var boundary = SharedWebProjection()
        let projected = OrderedJSON.object([
            .init(key:"localModels",value:.array(try models.map { try boundary.reference($0) })),
            .init(key:"activeLocalModels",value:.object(try active.object("active models").map { field in
                JSONField(key:field.key,value:field.value == .null || (try? field.value.string("model ID")) != nil ? field.value : try boundary.reference(field.value))
            }))
        ])
        let result = try SharedWebOperations.call("localModelImport",.object([
            .init(key:"operation",value:.string("catalogCommit")),.init(key:"state",value:projected),.init(key:"model",value:definition),
            .init(key:"existingIDs",value:.array(try models.map { .string(try $0.required("id").string("model ID")) }))
        ]))
        var metadata = current["savedModelMeta"] ?? .object([])
        var entry = metadata[modelID] ?? .object([])
        entry = entry.replacing("storageState",with:.string("saved"))
            .replacing("storedBytes",with:.number(String(bytes)))
            .replacing("storedFiles",with:.array(storedFiles.map(OrderedJSON.string)))
            .replacing("fileHashes",with:.object(fileHashes))
            .replacing("lastVerifiedAt",with:.number(String(Int(Date().timeIntervalSince1970 * 1000))))
            .replacing("downloadRevision",with:.string(revision))
        metadata = metadata.replacing(modelID,with:entry)
        let updated = try OrderedJSONChanges.apply(result.required("changes"),to:current.replacing("localModels",with:current["localModels"] ?? .array([])).replacing("activeLocalModels",with:current["activeLocalModels"] ?? .object([])),opaque:boundary.opaque)
        try applyGlobalState(updated.replacing("savedModelMeta",with:metadata))
    }

    private var catalogResumeStore: NativeCatalogResumeStore { NativeCatalogResumeStore(libraryURL:(store ?? LocalStateStore.applicationStore).fileURL) }
    private func catalogResumeRecords() -> [(id: String, url: String, revision: String, data: Data)] {
        catalogResumeData.compactMap { key, data in
            guard let id = String(data:key,encoding:.utf8), let plan = catalogResumePlans[key] else { return nil }
            return (id,plan.url,plan.revision,data)
        }
    }

    func saveLocalModelRole(task: String? = nil, modelID: String? = nil, enabled: Bool? = nil) throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成結果を保存してからモデル設定を変更してください") }
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
        guard !hasGenerations else { throw ExchangeError.invalid("生成結果を保存してからモデルを登録してください") }
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

    private func beginLocalGeneration(source: OrderedJSON, chat: OrderedJSON, chatID: String, path: [String], history: MessageEditing.HistoryState?, plan: OrderedJSON?, now: Double,
                                      titleAfterAppend: Bool) throws {
        let config = try chat.required("config")
        let modelID = try config.required("model").string("model")
        let prefillKey = try plan?["prefillKey"]?.string("prefill key") ?? stickyPrefillKey
        let request = try LocalGenerationRequest.make(source:source,chat:chat,config:config,path:path,assistantPrefill:assistantPrefills[Data(prefillKey.utf8)])
        let userContent = try ConversationEvaluation.transmittedUserContent(request.input.required("messages"))
        try ConversationEvaluation.enforcePreSendSafety(settings:ConversationEvaluation.autoSettings(publicationSnapshot().required("state")),chat:chat)
        let prefix = request.input["assistantPrefix"]
        do {
            let definition = try localModelDefinitions().first { $0["id"] == .string(modelID) }
            let modelURL = try definition.map { try localModelFiles.installed(model:$0) } ?? localModelFiles.installed(modelID:modelID)
            var output = RemoteOutput()
            _ = try output.consumeLocal("",input:request.input)
            let id = UUID()
            guard let plan else { throw ExchangeError.invalid("生成先がありません") }
            let started = try startingStreamState(source:source,chatID:chatID,plan:plan,id:id,proxy:false,now:now)
            try applyLibrary(started,selectedID:chatID,resetViewFor:chatID,editing:history,now:now)
            setGeneration(ActiveGeneration(id:id,chatID:chatID,baseSource:try publishedSource(),path:path,plan:plan,output:output,usesRemoteTransport:false,titleAfterAppend:titleAfterAppend))
            diagnostics.report(id: "generation-" + id.uuidString.lowercased(), label: "生成", status: "active")
            generationError = nil
            automaticEvaluationError = nil
            if let userContent {
                let nodeID = try plan.required("targetNodeId").string("target node")
                automaticEvaluationContexts[id] = (chatID,nodeID,path,userContent,nil,RemoteClient(),RemoteCredentials.load(providerID:))
                startAutomaticEvaluation(phase:"pre-send",generationID:id)
            }
            generationTasks[id] = Task { @MainActor [weak self] in
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
        guard var current = generation(id), current.running, try generationTargetIsCurrent(current) else { return true }
        let finished = try current.output.consumeLocal(text,input:input)
        setGeneration(current)
        return finished
    }

    func stopGeneration() {
        stopGeneration(chatID:selectedID)
    }
    func stopGeneration(chatID: String) {
        guard let current = generation(for:chatID), current.running else { return }
        cancelAutomaticEvaluation(generationID:current.id)
        generationTasks[current.id]?.cancel()
        do {
            var output = current.output
            try output.flush()
            var updated = current; updated.output = output; setGeneration(updated)
            finishGeneration(id:current.id,error:nil,completed:false)
            if generation(current.id) == nil {
                diagnostics.report(id: "generation-" + current.id.uuidString.lowercased(), label: "生成", status: "done", detail: "取消")
            }
        } catch { finishGeneration(id:current.id,error:error) }
    }

    func saveGenerationResult() throws {
        guard let current = generation, !current.running else { throw ExchangeError.invalid("生成結果がありません") }
        do {
            try persistGeneration(current)
            diagnostics.report(id: "generation-" + current.id.uuidString.lowercased(), label: "生成", status: current.failed ? "error" : "done")
        } catch {
            cancelAutomaticEvaluation(generationID:current.id,clearContext:false)
            diagnostics.report(id: "generation-" + current.id.uuidString.lowercased(), label: "生成結果の保存", status: "error", detail: "失敗")
            throw error
        }
        generationError = nil
    }

    private func finishGeneration(id: UUID, error: Error?, completed: Bool = true) {
        liveUsageVersions[id, default: 0] += 1; liveUsageTasks[id] = nil; liveTokenCounts.removeValue(forKey:id)
        guard var current = generation(id), current.running, (try? generationTargetIsCurrent(current)) == true else { return }
        current.running = false
        current.completedSuccessfully = completed && error == nil
        current.failed = error != nil
        setGeneration(current)
        generationTasks[id] = nil
        if let error { setGenerationError("生成を完了できませんでした。\n" + error.localizedDescription, chatID:current.chatID) }
        do {
            try persistGeneration(current)
            diagnostics.report(id: "generation-" + id.uuidString.lowercased(), label: "生成", status: current.failed ? "error" : "done")
        } catch {
            cancelAutomaticEvaluation(generationID:id,clearContext:false)
            setGenerationError("生成結果を保存できませんでした。部分本文を保持しています。\n" + error.localizedDescription, chatID:current.chatID)
            diagnostics.report(id: "generation-" + id.uuidString.lowercased(), label: "生成結果の保存", status: "error", detail: "失敗")
        }
    }

    private func persistGeneration(_ current: ActiveGeneration) throws {
        let titleContext = pendingTitleContexts[current.id]
        guard let latest = exchange?.source, try generationTargetIsCurrent(current, in:latest) else { throw ExchangeError.invalid("生成先が変更されているため、結果を保存できません") }
        guard let plan = current.plan else { throw ExchangeError.invalid("生成先がありません") }
        var endFields: [JSONField] = [.init(key:"operation",value:.string("endReason")),
            .init(key:"failed",value:.bool(current.failed)),.init(key:"completed",value:.bool(current.completedSuccessfully))]
        if let finishReason = current.output.finishReason { endFields.append(.init(key:"finishReason",value:finishReason)) }
        let stream = try OrderedJSON.object([.init(key:"reason",value:SharedWebOperations.call("streamStatus",.object(endFields)))])
        if try current.output.isEmpty && current.output.observation.object("observation").isEmpty {
            cancelAutomaticEvaluation(generationID:current.id)
            let source = try MessageEditing.streamState(in:latest,chatID:current.chatID,plan:plan,stream:stream,now:Date().timeIntervalSince1970 * 1000)
            if current.output.proxyReceipt != nil {
                try proxyRecoveryStore.upsert(makeProxyRecoveryRecord(current,output:current.output))
            }
            try applyLibrary(source,selectedID:selectedID,resetViewFor:current.chatID,editing:editingHistory,openRouterStats:try queuedOpenRouterStats(current,now:Date().timeIntervalSince1970 * 1000))
            if current.output.proxyReceipt != nil && !current.failed {
                do { try proxyRecoveryStore.remove(current.id.uuidString.lowercased()) }
                catch { streamRecoveryError = "保存済み応答の復旧記録を整理できませんでした。\n" + error.localizedDescription }
            }
            rememberFailedGeneration(current)
            removeGeneration(id:current.id)
            return
        }
        let now = Date().timeIntervalSince1970 * 1000
        var history: MessageEditing.HistoryState?
        let finalized = try MessageEditing.generation(in:latest,chatID:current.chatID,operation:"finalize",viewingPath:current.path,plan:plan,
            parts:current.output.parts,stream:stream,now:now,history:editingHistory) { history = $0 }
        guard finalized.output["status"] == .string("updated") else { throw ExchangeError.invalid("生成先が変更されているため、結果を保存できません") }
        var source = finalized.source
        let accounting = try generationAccounting(source:source,current:current)
        source = accounting.source
        if current.output.proxyReceipt != nil {
            let chat = try source.required("chats").array("chats").first { $0["id"] == .string(current.chatID) }
            let target = try plan.required("targetNodeId").string("target")
            let hash = try chat?.required("branchTree").required("nodes").required(target).required("contentHash")
            try proxyRecoveryStore.upsert(makeProxyRecoveryRecord(current,output:current.output).replacing("appliedHash",with:hash ?? .null))
        }
        try applyLibrary(source, selectedID: selectedID, resetViewFor: current.chatID, tokenUsage:accounting.usage, editing: history, openRouterStats:try queuedOpenRouterStats(current,now:now), now: now)
        rememberFailedGeneration(current)
        removeGeneration(id:current.id)
        if let receipt = current.output.proxyReceipt, current.completedSuccessfully || !current.failed {
            do { try proxyRecoveryStore.remove(current.id.uuidString.lowercased()) }
            catch { streamRecoveryError = "保存済み応答の復旧記録を整理できませんでした。\n" + error.localizedDescription }
            if current.completedSuccessfully && receipt.complete {
                let control = titleContext?.client.auxiliaryClient() ?? RemoteClient()
                Task { await control.proxyControl(settings:receipt.settings,sessionID:receipt.sessionID,operation:"ack") }
            }
        }
        if current.completedSuccessfully, automaticEvaluationContexts[current.id] != nil {
            cancelledAutomaticEvaluationIDs.remove(current.id)
            startAutomaticEvaluation(phase:"post-receive",generationID:current.id)
        } else { cancelAutomaticEvaluation(generationID:current.id) }
        if current.completedSuccessfully && current.titleAfterAppend {
            let config = try current.baseSource.required("chats").array("chats").first { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(current.chatID.utf8) == true }?["config"]
            startAutomaticTitle(chatID:current.chatID,sourceConfig:config,legacy:titleContext?.legacy,client:titleContext?.client,readProviderCredential:titleContext?.read ?? RemoteCredentials.load(providerID:))
        }
    }

    private var proxyRecoveryStore: NativeProxyRecoveryStore {
        NativeProxyRecoveryStore(libraryURL:(store ?? LocalStateStore.applicationStore).fileURL)
    }
    private func startingStreamState(source: OrderedJSON, chatID: String, plan: OrderedJSON, id: UUID, proxy: Bool, now: Double) throws -> OrderedJSON {
        try MessageEditing.streamState(in:source,chatID:chatID,plan:plan,stream:.object([
            .init(key:"reason",value:.string("streaming")),.init(key:"request",value:.object([
                .init(key:"requestId",value:.string(id.uuidString.lowercased())),.init(key:"proxy",value:.bool(proxy)),
                .init(key:"createdAt",value:.number(String(Int(now))))]))]),now:now)
    }
    func streamStatus(chatID: String, nodeID: String, now: Double = Date().timeIntervalSince1970 * 1000) throws -> OrderedJSON? {
        guard let chat = try exchange?.source.required("chats").array("chats").first(where:{ $0["id"] == .string(chatID) }),
              let saved = chat["branchTree"]?["nodes"]?[nodeID]?["streamState"] else { return nil }
        if streamStatusBridge == nil { streamStatusBridge = try SharedWebOperations.Session() }
        let enabled = saved["proxy"] == .bool(true) && (try? RemoteCredentials.load().proxy?.validated()) != nil
        let result = try streamStatusBridge!.call("streamStatus",.object([.init(key:"operation",value:.string("describe")),
            .init(key:"saved",value:saved),.init(key:"proxyEnabled",value:.bool(enabled)),.init(key:"now",value:.number(String(now)))]))
        return result == .null ? nil : result
    }
    @MainActor func streamRecoveryRecord(chatID: String, nodeID: String, requestID: OrderedJSON?) throws -> OrderedJSON? {
        try proxyRecoveryStore.records().first { $0["chatId"] == .string(chatID) && $0["nodeId"] == .string(nodeID)
            && $0["requestId"] == requestID && canRecoverProxyRecord($0) }
    }
    @MainActor func proxyRecoveryRecords() throws -> [OrderedJSON] { try proxyRecoveryStore.records() }
    private func updatingProxyRecord(_ record: OrderedJSON, output: RemoteOutput) throws -> OrderedJSON {
        guard let receipt = output.proxyReceipt else { throw ExchangeError.invalid("プロキシの復旧情報がありません") }
        return record.replacing("checkpoint",with:output.proxyCheckpoint)
            .replacing("bufferedText",with:receipt.responseState?["text"] ?? .string(output.text))
            .replacing("bufferedReasoning",with:receipt.responseState?["reasoning"] ?? .string(output.reasoning))
            .replacing("proxyComplete",with:.bool(receipt.complete))
    }
    private func makeProxyRecoveryRecord(_ current: ActiveGeneration, output: RemoteOutput) throws -> OrderedJSON {
        guard let receipt = output.proxyReceipt, let plan = current.plan else { throw ExchangeError.invalid("プロキシの生成先がありません") }
        let nodeID = try plan.required("targetNodeId").string("target")
        let chat = try current.baseSource.required("chats").array("chats").first { $0["id"] == .string(current.chatID) }
        guard let node = chat?["branchTree"]?["nodes"]?[nodeID] else { throw ExchangeError.invalid("プロキシの生成先がありません") }
        let record = try OrderedJSON.object([
            .init(key:"requestId",value:.string(current.id.uuidString.lowercased())),.init(key:"chatId",value:.string(current.chatID)),
            .init(key:"nodeId",value:.string(nodeID)),.init(key:"checkpointRole",value:node.required("role")),
            .init(key:"checkpointHash",value:node.required("contentHash")),.init(key:"plan",value:plan),
            .init(key:"createdAt",value:node["streamState"]?["createdAt"] ?? .number(String(Int(Date().timeIntervalSince1970 * 1000)))),
            .init(key:"proxyEndpoint",value:.string(receipt.settings.endpoint)),.init(key:"proxySessionId",value:.string(receipt.sessionID)),
            .init(key:"stopped",value:.bool(!current.running && !current.completedSuccessfully && !current.failed))])
        return try updatingProxyRecord(record,output:output)
    }
    private func proxyRecoveryTarget(_ record: OrderedJSON) throws -> Bool {
        guard let source = exchange?.source, let chatID = try record["chatId"]?.string("chat ID"),
              let nodeID = try record["nodeId"]?.string("node ID"),
              let planTarget = try record["plan"]?["targetNodeId"]?.string("plan target"), nodeID.utf8.elementsEqual(planTarget.utf8),
              let chat = try source.required("chats").array("chats").first(where: { $0["id"] == .string(chatID) }) else { return false }
        var boundary = SharedWebProjection()
        let result = try SharedWebOperations.call("proxyRecoveryTarget",.object([
            .init(key:"chat",value:boundary.chat(chat)),.init(key:"contentStore",value:boundary.store(source.required("contentStore"))),.init(key:"record",value:record)]))
        return result["status"] == .string("ready")
    }
    @MainActor func canRecoverProxyRecord(_ record: OrderedJSON) -> Bool { (try? proxyRecoveryTarget(record)) == true }
    func runProxyRecovery() {
        guard streamRecoveryTask == nil, !isDiscardingProxyRecovery else { return }
        diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: "active")
        streamRecoveryTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await recoverProxyStreams()
                self.diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: self.streamRecoveryError == nil ? "done" : "error", detail: self.streamRecoveryError == nil ? nil : "未完了")
            } catch is CancellationError {
                self.diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: "done", detail: "取消")
            }
            catch {
                streamRecoveryError = "ストリームを復旧できませんでした。記録は保持しています。\n" + error.localizedDescription
                self.diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: "error", detail: "失敗")
            }
            streamRecoveryTask = nil
        }
    }
    func cancelProxyRecovery() {
        guard streamRecoveryTask != nil else { return }
        streamRecoveryTask?.cancel()
        diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: "done", detail: "取消")
    }

    @MainActor func discardPendingProxyRecoveryRecords() async throws {
        guard !hasGenerations, !isDiscardingProxyRecovery else { throw ExchangeError.invalid("生成中は復旧記録を破棄できません") }
        isDiscardingProxyRecovery = true
        defer { isDiscardingProxyRecovery = false }
        if let task = streamRecoveryTask {
            task.cancel()
            await task.value
        }
        guard !hasGenerations else { throw ExchangeError.invalid("生成中は復旧記録を破棄できません") }
        guard streamRecoveryTask == nil, !isRecoveringStream else {
            throw ExchangeError.invalid("復旧処理の終了を待ってから破棄してください")
        }
        let records = try proxyRecoveryStore.records()
        for record in records {
            try proxyRecoveryStore.remove(record.required("requestId").string("request ID"))
        }
        streamRecoveryError = nil
        diagnostics.report(id: "stream-recovery", label: "ストリーム復旧", status: "done")
    }

    @MainActor func recoverProxyStreams(record credential: RemoteCredentialRecord? = nil, client: RemoteClient? = nil, sessionID: String? = nil) async throws {
        guard !hasGenerations, !isRecoveringStream, !isDiscardingProxyRecovery, !initialLoadFailed, exchange != nil else { return }
        let records = try proxyRecoveryStore.records()
        streamRecoveryError = nil
        guard !records.isEmpty else { return }
        isRecoveringStream = true
        defer { isRecoveringStream = false }
        let trusted = try credential ?? RemoteCredentials.load()
        let settings = try trusted.proxy?.validated()
        var retained = 0
        for original in records {
            try Task.checkCancellation()
            if let sessionID, original["proxySessionId"] != .string(sessionID) { continue }
            guard try proxyRecoveryTarget(original) else { retained += 1; continue }
            let complete = original["proxyComplete"] == .bool(true), stopped = original["stopped"] == .bool(true)
            // Never send a token to an endpoint recovered from disk or imported data.
            let recordedEndpoint = try original.required("proxyEndpoint").string("proxy endpoint")
            let canFetch = settings?.endpoint.utf8.elementsEqual(recordedEndpoint.utf8) == true
            if settings != nil && !canFetch { retained += 1; continue }
            let reconstruction = settings ?? RemoteProxySettings(enabled:true,endpoint:recordedEndpoint)
            var output = try RemoteOutput(proxyCheckpoint:original.required("checkpoint"),settings:reconstruction,
                sessionID:original.required("proxySessionId").string("proxy session"),complete:complete)
            var latest = original
            let originalError = generationError
            let clearsSendError = failedGenerationRetry?.chatID == (try original.required("chatId").string("chat ID")) && failedGenerationRetry?.plan["targetNodeId"] == original["nodeId"]
            var networkError: Error?
            if !complete && !stopped && canFetch {
                var attempt = 0
                while true {
                    try Task.checkCancellation()
                    guard !hasGenerations, try proxyRecoveryTarget(latest) else { throw CancellationError() }
                    output = try RemoteOutput(proxyCheckpoint:output.proxyCheckpoint,settings:reconstruction,
                        sessionID:original.required("proxySessionId").string("proxy session"),complete:false)
                    do {
                        try await (client?.auxiliaryClient() ?? RemoteClient()).recoverProxy(output,onCheckpoint:{ [weak self] next in
                            guard let self, !self.hasGenerations, try self.proxyRecoveryTarget(latest) else { throw CancellationError() }
                            let previousCursor = latest["checkpoint"]?["decoder"]?["lastEventId"] ?? .number("0")
                            let previousComplete = latest["proxyComplete"] == .bool(true)
                            latest = try self.updatingProxyRecord(latest,output:next)
                            if next.proxyReceipt?.decoder?["lastEventId"] != previousCursor || next.proxyReceipt?.complete != previousComplete {
                                try self.proxyRecoveryStore.upsert(latest)
                            }
                        },onOutput:{ next in output = next })
                        networkError = nil
                        break
                    } catch is CancellationError { throw CancellationError() }
                    catch let failure as ProxyCheckpointFailure { throw failure.underlying }
                    catch {
                        networkError = error
                        let failure = error as? ProxyRecoveryFailure
                        var fields: [JSONField] = [.init(key:"attempt",value:.number(String(attempt))),
                            .init(key:"outcome",value:.string(failure?.outcome ?? "network")),.init(key:"retry",value:.bool(failure?.retry == true))]
                        if let value = failure?.retryAfter { fields.append(.init(key:"retryAfter",value:.string(value))) }
                        let policy = try SharedWebOperations.call("proxyRecoveryRetry",.object(fields))
                        guard policy["retry"] == .bool(true) else { break }
                        let delay = try policy.required("delayMs").number("retry delay")
                        try await Task.sleep(nanoseconds:UInt64(delay * 1_000_000))
                        attempt += 1
                    }
                }
            }
            try Task.checkCancellation()
            guard !hasGenerations, try proxyRecoveryTarget(latest), let source = exchange?.source else { retained += 1; continue }
            try output.flush()
            let chatID = try latest.required("chatId").string("chat ID")
            let plan = try latest.required("plan")
            let outcome = stopped ? "abort" : (networkError as? ProxyRecoveryFailure)?.outcome ?? (networkError == nil ? "partial" : "network")
            let recoveredReason = try SharedWebOperations.call("streamStatus",.object([
                .init(key:"operation",value:.string("recoveryReason")),.init(key:"proxyComplete",value:latest["proxyComplete"] ?? .bool(false)),
                .init(key:"proxyOutcome",value:.string(outcome)),.init(key:"effectiveStatus",value:.string(stopped ? "interrupted" : "streaming-with-proxy"))]))
            var recoveryRequest: [JSONField] = [.init(key:"requestId",value:try latest.required("requestId")),.init(key:"proxy",value:.bool(true))]
            if let createdAt = latest["createdAt"] { recoveryRequest.append(.init(key:"createdAt",value:createdAt)) }
            let stream = OrderedJSON.object([.init(key:"reason",value:recoveredReason),.init(key:"request",value:.object(recoveryRequest))])
            var history: MessageEditing.HistoryState?
            let finalized = try MessageEditing.generation(in:source,chatID:chatID,operation:"finalize",viewingPath:[],plan:plan,parts:output.parts,
                stream:stream,now:Date().timeIntervalSince1970 * 1000,history:editingHistory) { history = $0 }
            guard finalized.output["status"] == .string("updated") else { retained += 1; continue }
            let nodeID = try latest.required("nodeId").string("node ID")
            guard let requestID = UUID(uuidString:try latest.required("requestId").string("request ID")) else { throw ExchangeError.invalid("復旧用request IDが不正です") }
            // Recovery merges observed metadata, as Web does, without counting an already received response twice.
            let session = ActiveGeneration(id:requestID,chatID:chatID,baseSource:source,path:[],plan:plan,output:output,running:false)
            let accounted = try generationAccounting(source:finalized.source,current:session).source
            let chat = try accounted.required("chats").array("chats").first { $0["id"] == .string(chatID) }
            let beforeChat = try source.required("chats").array("chats").first { $0["id"] == .string(chatID) }
            latest = try updatingProxyRecord(latest,output:output)
                .replacing("checkpointHash",with:beforeChat!.required("branchTree").required("nodes").required(nodeID).required("contentHash"))
                .replacing("appliedHash",with:chat!.required("branchTree").required("nodes").required(nodeID).required("contentHash"))
            try proxyRecoveryStore.upsert(latest)
            var verificationSession = session
            verificationSession.failed = !stopped
            let verification = try queuedOpenRouterStats(verificationSession,now:Date().timeIntervalSince1970 * 1000)
            if try accounted.encoded() != source.encoded() || verification != nil {
                try applyLibrary(accounted,selectedID:selectedID,editing:history,openRouterStats:verification)
            }
            if stopped || latest["proxyComplete"] == .bool(true) {
                if !stopped && clearsSendError && generationError == originalError { generationError = nil }
                try proxyRecoveryStore.remove(latest.required("requestId").string("request ID"))
                if !stopped && canFetch, let settings {
                    await (client?.auxiliaryClient() ?? RemoteClient()).proxyControl(settings:settings,sessionID:try latest.required("proxySessionId").string("proxy session"),operation:"ack")
                }
            } else { retained += 1 }
            if let networkError { streamRecoveryError = "復旧途中の本文を保存しました。記録は保持しています。\n" + networkError.localizedDescription }
        }
        if retained > 0 && streamRecoveryError == nil { streamRecoveryError = "復旧が未完了の記録が\(retained)件あります。生成先やプロキシ設定を確認してください。記録は保持しています。" }
    }

    private func rememberFailedGeneration(_ current: ActiveGeneration) {
        guard current.failed, let plan = current.plan,
              let chats = try? exchange?.source.required("chats").array("chats"),
              let chat = chats.first(where: { $0["id"] == .string(current.chatID) }) else { return }
        failedGenerationRetry = FailedGenerationRetry(chatID:current.chatID,chat:chat,plan:plan,titleAfterAppend:current.titleAfterAppend)
    }

    @MainActor private func prepareGenerationTokenCounts(id: UUID) async throws {
        guard let current = generation(id), current.usesRemoteTransport, usageCountingEnabled else { return }
        let usagePlan = try generationTokenPlan(current)
        guard usagePlan != .null, usagePlan["kind"] == .string("estimated") else { return }
        let counts = try await tokenCounting.counts(plan:usagePlan)
        try Task.checkCancellation()
        guard var latest = generation(id), latest.output.parts == current.output.parts,
              try generationTargetIsCurrent(latest), try generationTokenPlan(latest) == usagePlan else { throw CancellationError() }
        latest.tokenCounts = counts; setGeneration(latest)
    }

    private func generationTokenPlan(_ current: ActiveGeneration) throws -> OrderedJSON {
        guard let plan = current.plan else { return .null }
        let finalized = try MessageEditing.generation(in:current.baseSource,chatID:current.chatID,operation:"finalize",viewingPath:current.path,plan:plan,
            parts:current.output.parts,now:Date().timeIntervalSince1970 * 1000,history:nil,onHistory:{ _ in })
        guard var chat = try finalized.source.required("chats").array("chats").first(where:{ $0["id"] == .string(current.chatID) }) else { return .null }
        let target = try plan.required("targetNodeId").string("target")
        if try !current.output.observation.object("observation").isEmpty {
            let observed = try SharedWebOperations.call("generationObservation",.object([.init(key:"chat",value:chat),.init(key:"targetNodeId",value:.string(target)),.init(key:"observation",value:current.output.observation)]))
            chat = try OrderedJSONChanges.apply(observed.required("changes"),to:chat)
        }
        return try SharedWebOperations.call("generationUsagePlan",.object([.init(key:"chat",value:chat),.init(key:"targetNodeId",value:.string(target))]))
    }

    private func startLiveTokenCounting(generationID: UUID) {
        liveUsageVersions[generationID, default:0] += 1; liveTokenCounts.removeValue(forKey:generationID)
        let version = liveUsageVersions[generationID]!
        guard usageCountingEnabled else { liveUsageTasks[generationID] = nil; return }
        liveUsageTasks[generationID] = Task { @MainActor [weak self] in
            guard let self else { return }
            var promptSource: OrderedJSON?
            var promptCount: Int?
            var promptModel: String?
            var encoderReady = self.tokenCounting.isReady
            while let current = self.generation(generationID), current.running, self.usageCountingEnabled, self.liveUsageVersions[generationID] == version {
                do {
                    guard let chat = try current.baseSource.required("chats").array("chats").first(where:{ $0["id"] == .string(current.chatID) }) else { throw CancellationError() }
                    var boundary = SharedWebProjection()
                    var fields = try SharedGenerationContext.fields(source:current.baseSource,chat:chat,config:chat["config"] ?? ChatDefaults.webInitial().config,path:current.path,boundary:&boundary)
                    fields.append(.init(key:"completionParts",value:current.output.parts))
                    let projected = try SharedWebOperations.call("generationLiveUsagePlan",.object(fields))
                    let plan = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:projected)])]),to:.null,opaque:boundary.opaque)
                    let model = try plan.required("model").string("token model")
                    let prompt = try plan.required("promptMessages")
                    if encoderReady != self.tokenCounting.isReady { promptCount = nil; encoderReady = self.tokenCounting.isReady }
                    if promptSource != prompt || promptModel != model { promptCount = nil; promptSource = prompt; promptModel = model }
                    if promptCount == nil { promptCount = try await self.tokenCounting.count(messages:prompt,model:model) }
                    let completion: Int
                    if let message = plan["completionMessage"], message != .null { completion = try await self.tokenCounting.count(messages:.array([message]),model:model) }
                    else { completion = 0 }
                    let counts = OrderedJSON.object([.init(key:"promptTokens",value:.number(String(promptCount!))),.init(key:"completionTokens",value:.number(String(completion)))])
                    try Task.checkCancellation()
                    guard self.liveUsageVersions[generationID] == version, let latest = self.generation(generationID), latest.running, self.usageCountingEnabled else { return }
                    if latest.baseSource == current.baseSource, latest.output.parts == current.output.parts {
                        self.liveTokenCounts[generationID] = (current.baseSource,current.output.parts,counts)
                    }
                    let delay = try SharedWebOperations.call("tokenizerOperation",.object([.init(key:"operation",value:.string("throttle"))])).number("live interval")
                    try await Task.sleep(nanoseconds:UInt64(delay * 1_000_000))
                } catch is CancellationError { return } catch { return }
            }
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
        var usageFields: [JSONField] = [.init(key:"chat",value:chat),.init(key:"targetNodeId",value:.string(target)),.init(key:"countTotalTokens",value:.bool(true)),.init(key:"totalTokenUsed",value:totals)]
        if let counts = current.tokenCounts { usageFields.append(.init(key:"counts",value:counts)) }
        let result = try SharedWebOperations.call("generationUsage",.object(usageFields))
        let next = try OrderedJSONChanges.apply(result.required("changes"),to:.object([.init(key:"totalTokenUsed",value:totals)]))
        try NativeUsage.validateCounters(result:result,before:totals,after:next["totalTokenUsed"] ?? .object([]))
        return (updated,next["totalTokenUsed"])
    }

    var usageCountingEnabled: Bool { (try? publicationSnapshot()["state"]?["countTotalTokens"]) == .bool(true) }
    func saveUsageCounting(_ enabled: Bool) throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを復旧してから設定してください") }
        guard usageCountingEnabled != enabled else { return }
        try applyLibrary(exchange?.source ?? ChatLibrary.emptySource,selectedID:selectedID,preserveGeneration:true,usageEnabled:enabled)
        for current in generations.values where current.running && current.usesRemoteTransport {
            startLiveTokenCounting(generationID:current.id)
        }
    }
    func resetUsageTotals() throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを復旧してから設定してください") }
        try applyLibrary(exchange?.source ?? ChatLibrary.emptySource,selectedID:selectedID,preserveGeneration:true,tokenUsage:.object([]))
    }
    func usageCostReport() throws -> OrderedJSON {
        let roots = try publicationSnapshot().required("state")
        var fields: [JSONField] = [.init(key:"state",value:ChatConfig.modelState(in:roots)),.init(key:"totalTokenUsed",value:roots["totalTokenUsed"] ?? .object([]))]
        var overlays: [OrderedJSON] = []
        for current in generations.values where current.running {
            guard let chat = try current.baseSource.required("chats").array("chats").first(where: { $0["id"].flatMap { try? $0.string("id") }?.utf8.elementsEqual(current.chatID.utf8) == true }) else { continue }
            var boundary = SharedWebProjection()
            let config = try chat["config"] ?? ChatDefaults.webInitial().config
            var input = try SharedGenerationContext.fields(source:current.baseSource,chat:chat,config:config,path:current.path,boundary:&boundary)
            input.append(.init(key:"completionParts",value:current.output.parts))
            if let live = liveTokenCounts[current.id], live.source == current.baseSource, live.parts == current.output.parts {
                input.append(.init(key:"counts",value:live.counts))
            }
            let overlay = try SharedWebOperations.call("generationLiveUsage",.object(input))
            overlays.append(overlay)
        }
        fields.append(.init(key:"liveTokenUsages",value:.array(overlays)))
        return try SharedWebOperations.call("usageCost",.object(fields))
    }

    private func invalidateGeneration() {
        failedGenerationRetries.removeAll()
        generationErrors.removeAll()
        for current in generations.values {
            liveUsageVersions[current.id, default:0] += 1; liveUsageTasks[current.id] = nil; liveTokenCounts.removeValue(forKey:current.id)
            if current.running {
                cancelAutomaticEvaluation(generationID:current.id)
                diagnostics.report(id: "generation-" + current.id.uuidString.lowercased(), label: "生成", status: "done", detail: "取消")
            }
            generationTasks[current.id]?.cancel()
        }
        pendingTitleContexts.removeAll()
        generationTasks.removeAll()
        generations.removeAll()
    }

    func createChat(defaults: ChatDefaults? = nil, id: String = UUID().uuidString.lowercased(), folder: String? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let source = exchange?.source ?? ChatLibrary.emptySource
        var created = try ChatLibrary.create(in: source, id: id, defaults: defaults ?? ChatDefaults.saved(in:(document?.snapshot ?? SyncDocument(v3:ChatLibrary.emptySource).snapshot).required("state")), folder: folder)
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
            if let previous = titleTasks[key] {
                previous.task.cancel()
                diagnostics.report(id: "title-" + previous.id.uuidString.lowercased(), label: "タイトル生成", status: "done", detail: "取消")
            }
            titleError = nil
            diagnostics.report(id: "title-" + id.uuidString.lowercased(), label: "タイトル生成", status: "active")
            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                defer { if self.titleTasks[key]?.id == id { self.titleTasks[key] = nil } }
                do {
                    let response = try await ConversationTitle.generate(prepared,client:titleClient)
                    try Task.checkCancellation()
                    guard self.titleTasks[key]?.id == id else { throw CancellationError() }
                    let counts: OrderedJSON?
                    if self.usageCountingEnabled {
                        let plan = try SharedWebOperations.call("titleOperation",.object([.init(key:"operation",value:.string("usagePlan")),
                            .init(key:"selection",value:prepared.selection),.init(key:"responseText",value:.string(response))]))
                        counts = try await self.tokenCounting.counts(plan:plan)
                    } else { counts = nil }
                    try Task.checkCancellation()
                    guard self.titleTasks[key]?.id == id else { throw CancellationError() }
                    try self.applyGeneratedTitle(response,prepared:prepared,language:language,fallbackEndpoint:credential.settings.endpoint,counts:counts)
                    self.diagnostics.report(id: "title-" + id.uuidString.lowercased(), label: "タイトル生成", status: "done")
                } catch is CancellationError {
                    if self.titleTasks[key]?.id == id {
                        self.diagnostics.report(id: "title-" + id.uuidString.lowercased(), label: "タイトル生成", status: "done", detail: "取消")
                    }
                } catch {
                    if self.titleTasks[key]?.id == id {
                        self.titleError = "タイトル生成に失敗しました。\n" + error.localizedDescription
                        self.diagnostics.report(id: "title-" + id.uuidString.lowercased(), label: "タイトル生成", status: "error", detail: "失敗")
                    }
                }
            }
            titleTasks[key] = (id,task)
        } catch { titleError = "タイトル生成に失敗しました。\n" + error.localizedDescription }
    }
    func applyGeneratedTitle(_ response: String, prepared: PreparedConversationTitle, language: String, fallbackEndpoint: String, counts: OrderedJSON? = nil) throws {
        guard let exchange, let updated = try ConversationTitle.apply(response,prepared:prepared,source:exchange.source,state:publicationSnapshot().required("state"),language:language,fallbackEndpoint:fallbackEndpoint,counts:counts) else { return }
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
    private func summaryGeneratingIDs(chatID: String) -> [String] {
        guard let target = generation(for:chatID)?.plan?["targetNodeId"], case .string(let id) = target else { return [] }
        return [id]
    }
    func summaryInfo(chatID: String, nodeID: String, mode: String? = nil) throws -> OrderedJSON? {
        guard let exchange else { return nil }
        return try ConversationSummary.describe(source:exchange.source,chatID:chatID,nodeID:nodeID,mode:mode,originNodeID:nodeID,
            chosenSummaryID:summaryChosen[.init(chatID:chatID,nodeID:nodeID)],generatingNodeIDs:summaryGeneratingIDs(chatID:chatID))
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
            format:format,summaryID:UUID().uuidString.lowercased(),now:Date().timeIntervalSince1970 * 1000,config:roots["bubbleSummaryConfig"],generatingNodeIDs:summaryGeneratingIDs(chatID:draft.chatID),busyJobs:busy,
            legacy:record ?? RemoteCredentials.load(),readProviderCredential:readProviderCredential,promptTokens:0) else { return }
        let key = SummaryIdentity(chatID:draft.chatID,nodeID:draft.nodeID), id = UUID()
        let replacedSummaryKeys = summaryJobs.compactMap { key, job in
            job.busy || !job.chatID.utf8.elementsEqual(draft.chatID.utf8) || !job.sourceNodeIDs.contains { previous in sourceNodeIDs.contains { $0.utf8.elementsEqual(previous.utf8) } } ? nil : key
        }
        for previousKey in replacedSummaryKeys {
            summaryTasks[previousKey]?.cancel()
            summaryTasks[previousKey] = nil
            if let previous = summaryJobs[previousKey] {
                diagnostics.report(id: "summary-" + previous.id.uuidString.lowercased(), label: "要約", status: "done", detail: "取消")
            }
            summaryJobs[previousKey] = nil
        }
        if let previous = summaryJobs[key] {
            summaryTasks[key]?.cancel()
            diagnostics.report(id: "summary-" + previous.id.uuidString.lowercased(), label: "要約", status: "done", detail: "取消")
        }
        summaryJobs[key] = SummaryJob(id:id,chatID:draft.chatID,originNodeID:draft.nodeID,sourceNodeIDs:sourceNodeIDs,busy:true)
        diagnostics.report(id: "summary-" + id.uuidString.lowercased(), label: "要約", status: "active")
        summaryTasks[key] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.summaryJobs[key]?.id == id { self.summaryTasks[key] = nil; self.summaryJobs[key]?.busy = false } }
            do {
                let prompt = try prepared.selection.required("promptMessage")
                let promptTokens = try await self.tokenCounting.count(messages:.array([prompt]),model:prepared.selection.required("model").string("summary model"))
                try Task.checkCancellation()
                guard self.summaryJobs[key]?.id == id,
                      try self.exchange?.source.required("chats").array("chats").first(where:{ $0["id"] == .string(draft.chatID) }) == prepared.originalChat,
                      try self.publicationSnapshot().required("state")["bubbleSummaryConfig"] == roots["bubbleSummaryConfig"],
                      try ChatConfig.modelState(in:self.publicationSnapshot().required("state")) == ChatConfig.modelState(in:roots),
                      try self.publicationSnapshot().required("state")["providers"] == roots["providers"] else { throw CancellationError() }
                let budget = try SharedWebOperations.call("tokenBudgetOperation",.object([.init(key:"config",value:prepared.selection.required("config")),
                    .init(key:"modelState",value:ChatConfig.modelState(in:roots)),.init(key:"promptTokens",value:.number(String(promptTokens)))]))
                guard budget["fits"] == .bool(true) else { throw ExchangeError.invalid("要約対象がモデルのコンテキスト上限を超えています") }
                let response = try await ConversationSummary.generate(prepared,client:client)
                let countPlan = try ConversationSummary.usagePlan(response.text,prepared:prepared,source:self.exchange?.source ?? ChatLibrary.emptySource)
                let counts = try await self.tokenCounting.counts(plan:countPlan)
                try Task.checkCancellation()
                guard self.summaryJobs[key]?.id == id, let source = self.exchange?.source else { return }
                guard let result = try ConversationSummary.apply(response,prepared:prepared,source:source,state:self.publicationSnapshot().required("state"),generatingNodeIDs:self.summaryGeneratingIDs(chatID:draft.chatID),counts:counts) else { throw ExchangeError.invalid("原文や設定が変更されました。生成し直してください") }
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
                self.diagnostics.report(id: "summary-" + id.uuidString.lowercased(), label: "要約", status: result.error == nil ? "done" : "error", detail: result.error == nil ? nil : "失敗")
            } catch is CancellationError {
                if self.summaryJobs[key]?.id == id {
                    self.diagnostics.report(id: "summary-" + id.uuidString.lowercased(), label: "要約", status: "done", detail: "取消")
                }
            } catch {
                if self.summaryJobs[key]?.id == id {
                    self.summaryJobs[key]?.error = error.localizedDescription
                    self.diagnostics.report(id: "summary-" + id.uuidString.lowercased(), label: "要約", status: "error", detail: "失敗")
                }
            }
        }
    }
    func stopSummary(chatID: String, nodeID: String) {
        let key = SummaryIdentity(chatID:chatID,nodeID:nodeID)
        summaryTasks[key]?.cancel(); summaryTasks[key] = nil
        if let job = summaryJobs.removeValue(forKey:key) {
            diagnostics.report(id: "summary-" + job.id.uuidString.lowercased(), label: "要約", status: "done", detail: "取消")
        }
    }
    private func cancelSummaries() {
        for (key, task) in summaryTasks { task.cancel(); if let job = summaryJobs[key] { diagnostics.report(id: "summary-" + job.id.uuidString.lowercased(), label: "要約", status: "done", detail: "取消") } }
        summaryTasks.removeAll(); summaryJobs.removeAll(); summaryChosen.removeAll()
    }

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
    func evaluationSettings() throws -> OrderedJSON {
        let roots = try publicationSnapshot().required("state")
        return try roots["evaluationSettings"] ?? SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
    }
    func evaluationThresholds(_ kind: String) throws -> [OrderedJSON] {
        let roots = try publicationSnapshot().required("state")
        var input = OrderedJSON.object([.init(key:"operation",value:.string("thresholdFields")),.init(key:"kind",value:.string(kind))])
        for key in ["safetyThresholds","qualityThresholds"] where roots[key] != nil {
            input = input.replacing(key,with:roots[key]!)
        }
        return try SharedWebOperations.call("evaluation",input).array("threshold fields")
    }
    func saveEvaluationThreshold(kind: String, key: String, field: String, percent: Double? = nil, text: String? = nil, reset: Bool = false) throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成終了後に評価設定を変更してください") }
        let roots = try publicationSnapshot().required("state")
        let rows = try evaluationThresholds(kind)
        guard let row = try rows.first(where: { try $0.required("key").string("threshold key").utf8.elementsEqual(key.utf8) }) else {
            throw ExchangeError.invalid("評価閾値")
        }
        let mapName = kind == "safety" ? "safetyThresholds" : "qualityThresholds"
        var map = roots[mapName] ?? .object([])
        _ = try map.object("threshold map")
        for entry in rows {
            let entryKey = try entry.required("key").string("threshold key")
            if map[entryKey] == nil { map = map.replacing(entryKey,with:try entry.required("value")) }
        }
        let current = try map[key] ?? row.required("value")
        _ = try current.object("threshold pair")
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("thresholdEdit")),.init(key:"kind",value:.string(kind)),
            .init(key:"key",value:.string(key)),.init(key:"field",value:.string(field)),.init(key:"current",value:current),
        ])
        if let percent { input = input.replacing("percent",with:.number(String(percent))) }
        if let text { input = input.replacing("text",with:.string(text)) }
        if reset { input = input.replacing("reset",with:.bool(true)) }
        let updated = try SharedWebOperations.call("evaluation",input)
        if updated == .null { return }
        let pair = current.replacing(field,with:try updated.required(field))
        try applyGlobalState(roots.replacing(mapName,with:map.replacing(key,with:pair)))
    }
    func saveEvaluationSetting(_ key: String, value: OrderedJSON) throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成終了後に評価設定を変更してください") }
        let action: OrderedJSON
        if ["safetyPreSend","safetyPostReceive","qualityPreSend","qualityPostReceive"].contains(key),
           value == .string("auto") || value == .string("manual") {
            action = .object([.init(key:"type",value:.string("setSetting")),.init(key:"key",value:.string(key)),.init(key:"value",value:value)])
        } else if key == "safetyEngine", [.string("remote"),.string("local"),.string("hybrid")].contains(value) {
            action = .object([.init(key:"type",value:.string("setSafetyEngine")),.init(key:"value",value:value)])
        } else if key == "hybridRemoteOnSafe", value == .bool(true) || value == .bool(false) {
            action = .object([.init(key:"type",value:.string("setHybridRemoteOnSafe")),.init(key:"value",value:value)])
        } else { throw ExchangeError.invalid("評価設定") }
        let roots = try publicationSnapshot().required("state")
        let settings = try evaluationSettings()
        let input = OrderedJSON.object([.init(key:"operation",value:.string("mutate")),
            .init(key:"state",value:.object([.init(key:"evaluationSettings",value:settings)])),.init(key:"action",value:action)])
        let changes = try SharedWebOperations.call("evaluation",input).required("changes")
        let updated = try OrderedJSONChanges.apply(changes,to:.object([.init(key:"evaluationSettings",value:settings)]))
        try applyGlobalState(roots.replacing("evaluationSettings",with:updated.required("evaluationSettings")))
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
        diagnostics.report(id: "evaluation-" + id.uuidString.lowercased(), label: "評価", status: "active")
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
                guard self.evaluationJobs[key]?.id == id, let latestSource = self.exchange?.source else { throw CancellationError() }
                let updated = try ConversationEvaluation.apply(result,prepared:prepared,source:latestSource,state:self.publicationSnapshot().required("state"))
                try self.applyLibrary(latestSource,selectedID:self.selectedID,preserveGeneration:true,evaluationResults:try updated.required("evaluationResults"))
                self.diagnostics.report(id: "evaluation-" + id.uuidString.lowercased(), label: "評価", status: "done")
            } catch is CancellationError {
                if self.evaluationJobs[key]?.id == id {
                    self.diagnostics.report(id: "evaluation-" + id.uuidString.lowercased(), label: "評価", status: "done", detail: "取消")
                }
            } catch {
                if self.evaluationJobs[key]?.id == id {
                    self.evaluationJobs[key]?.error = error.localizedDescription
                    self.diagnostics.report(id: "evaluation-" + id.uuidString.lowercased(), label: "評価", status: "error", detail: "失敗")
                }
            }
        }
    }
    func stopEvaluation(chatID: String, nodeID: String) {
        let key = SummaryIdentity(chatID:chatID,nodeID:nodeID)
        evaluationTasks[key]?.cancel(); evaluationTasks[key] = nil
        if let job = evaluationJobs.removeValue(forKey:key) {
            diagnostics.report(id: "evaluation-" + job.id.uuidString.lowercased(), label: "評価", status: "done", detail: "取消")
        }
    }
    private var cancelledAutomaticEvaluationIDs: Set<UUID> = []

    private func cancelAutomaticEvaluation(generationID: UUID, clearContext: Bool = true) {
        cancelledAutomaticEvaluationIDs.insert(generationID)
        if let tasks = automaticEvaluationTasks[generationID], !tasks.isEmpty {
            for task in tasks.values { task.cancel() }
        } else { cancelledAutomaticEvaluationIDs.remove(generationID) }
        if clearContext { automaticEvaluationContexts.removeValue(forKey:generationID) }
    }

    private func startAutomaticEvaluation(phase: String, generationID: UUID) {
        guard let context = automaticEvaluationContexts[generationID],
              let source = exchange?.source, let state = try? publicationSnapshot().required("state") else { return }
        defer { if phase == "post-receive" { automaticEvaluationContexts.removeValue(forKey:generationID) } }
        do {
            let assistantContent = phase == "post-receive" ? try ConversationEvaluation.savedAssistantContent(source:source,chatID:context.chatID,nodeID:context.nodeID) : nil
            let prepared = try ConversationEvaluation.prepareAuto(source:source,state:state,chatID:context.chatID,nodeID:context.nodeID,
                phase:phase,userContent:context.userContent,assistantContent:assistantContent,requestPath:context.requestPath,
                language:Locale.preferredLanguages.first ?? "en",legacy:context.record ?? RemoteCredentialRecord(),
                files:localModelFiles,readProviderCredential:context.read)
            guard let prepared else { return }
            let preparationErrors = [prepared.safetyError,prepared.qualityError].compactMap { $0 }
            if !preparationErrors.isEmpty { automaticEvaluationError = preparationErrors.joined(separator:"\n") }
            for item in [("safety",prepared.safety),("quality",prepared.quality)] {
                guard item.1 != nil || (item.0 == "safety" && prepared.localSafetyText != nil) else { continue }
                let jobID = UUID()
                let task = Task { @MainActor [weak self] in
                    guard let self else { return }
                    defer {
                        self.automaticEvaluationTasks[generationID]?[jobID] = nil
                        if self.automaticEvaluationTasks[generationID]?.isEmpty == true {
                            self.automaticEvaluationTasks[generationID] = nil
                            self.cancelledAutomaticEvaluationIDs.remove(generationID)
                        }
                    }
                    do {
                        let isCurrent: @MainActor @Sendable () -> Bool = { [weak self] in
                            guard let self, !self.cancelledAutomaticEvaluationIDs.contains(generationID),
                                  let source = self.exchange?.source,
                                  let state = try? self.publicationSnapshot().required("state") else { return false }
                            return (try? ConversationEvaluation.autoIsCurrent(prepared,source:source,state:state)) == true
                        }
                        @MainActor func publish(_ dimension: String, _ result: OrderedJSON) throws {
                            try Task.checkCancellation()
                            guard isCurrent(), let source = self.exchange?.source else { throw CancellationError() }
                            let updated = try ConversationEvaluation.autoApply(result,dimension:dimension,prepared:prepared,source:source,state:self.publicationSnapshot().required("state"))
                            try self.applyLibrary(source,selectedID:self.selectedID,preserveGeneration:true,evaluationResults:try updated.required("evaluationResults"))
                        }
                        if item.0 == "safety" {
                            try await ConversationEvaluation.runAutoSafety(prepared,state:state,files:self.localModelFiles,
                                client:context.client,readProviderCredential:context.read,classifier:self.localModerationClassify,
                                isCurrent:isCurrent,onResult:publish)
                        } else if let request = item.1 {
                            let result = try await ConversationEvaluation.run(request,client:context.client,localGenerator:self.localEvaluationGenerate,isCurrent:isCurrent)
                            try publish("quality",result)
                        }
                    } catch is CancellationError {} catch { self.automaticEvaluationError = error.localizedDescription }
                }
                automaticEvaluationTasks[generationID,default:[:]][jobID] = task
            }
        } catch { automaticEvaluationError = error.localizedDescription }
    }

    private func cancelEvaluations() {
        for (key, task) in evaluationTasks {
            task.cancel()
            if let job = evaluationJobs[key] { diagnostics.report(id: "evaluation-" + job.id.uuidString.lowercased(), label: "評価", status: "done", detail: "取消") }
        }
        evaluationTasks.removeAll(); evaluationJobs.removeAll()
        for id in automaticEvaluationTasks.keys { cancelAutomaticEvaluation(generationID:id) }
    }

    private func cancelTitles() {
        for value in titleTasks.values {
            value.task.cancel()
            diagnostics.report(id: "title-" + value.id.uuidString.lowercased(), label: "タイトル生成", status: "done", detail: "取消")
        }
        titleTasks.removeAll()
    }

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
        let source = try ChatLibrary.delete(in: exchange.source, ids: ids, replacementID: replacementID, defaults: defaults ?? ChatDefaults.saved(in:(document?.snapshot ?? SyncDocument(v3:ChatLibrary.emptySource).snapshot).required("state")))
        let first = try source.required("chats").array("chats")[0].required("id").string("id")
        try applyLibrary(source, selectedID: first, now: now)
    }

    func clearConversations(replacementID: String = UUID().uuidString.lowercased(), now: Double = Date().timeIntervalSince1970 * 1000) throws {
        guard !hasGenerations else { throw ExchangeError.invalid("生成結果を保存してから会話を消去してください") }
        guard let exchange else { throw ExchangeError.invalid("保存済みの会話がありません") }
        let defaults = try ChatDefaults.saved(in: (document ?? SyncDocument(v3:exchange.source)).snapshot.required("state"))
        let source = try ChatLibrary.clear(in:exchange.source,replacementID:replacementID,defaults:defaults)
        try applyLibrary(source,selectedID:replacementID,now:now)
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

    private func applyLibrary(_ source: OrderedJSON, selectedID: String, resetViewFor: String? = nil, resetViewsFor: [String] = [], preserveGeneration: Bool = false, tokenUsage: OrderedJSON? = nil, usageEnabled: Bool? = nil, evaluationResults: OrderedJSON? = nil, navigation: BranchNavigation.HistoryResult? = nil, editing: MessageEditing.HistoryState? = nil, clipboard: OrderedJSON? = nil, openRouterStats: OrderedJSON? = nil, activeView: ChatActiveView? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws {
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
        if let openRouterStats {
            var roots = try candidate.snapshot.required("state")
            for field in try openRouterStats.object("OpenRouter stats") { roots = roots.replacing(field.key,with:field.value) }
            candidate = try SyncDocument(snapshot:candidate.snapshot.replacing("state",with:roots),v3Sidecar:candidate.v3Sidecar,v3RootOrder:candidate.v3RootOrder)
        }
        if let activeView {
            candidate = try SyncDocument(snapshot:candidate.snapshot.replacing("state",with:candidate.snapshot.required("state").replacing("chatActiveView",with:.string(activeView.rawValue))),v3Sidecar:candidate.v3Sidecar,v3RootOrder:candidate.v3RootOrder)
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
        do { try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selectedID, style: displayStyle)) }
        catch {
            diagnostics.report(id: "local-save", label: "ローカル保存", status: "error", detail: "失敗")
            throw error
        }
        // A generation owns only its target chat.  Applying a result for another
        // chat must not cancel it, while an edited target is still rejected.
        let invalidGenerations = generations.values.filter { (try? generationTargetIsCurrent($0, in:changed.source)) != true }
        for current in invalidGenerations {
            generationTasks[current.id]?.cancel()
            cancelAutomaticEvaluation(generationID:current.id)
            if current.running {
                var retained = current
                retained.running = false; retained.failed = true
                setGeneration(retained)
                setGenerationError("生成先が変更されたため、結果は自動保存していません。", chatID:current.chatID)
                diagnostics.report(id: "generation-" + current.id.uuidString.lowercased(), label: "生成", status: "error", detail: "生成先変更")
            }
        }
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
        guard !hasGenerations else { throw ExchangeError.invalid("生成結果を保存してから書き出してください") }
        let v3 = try OrderedJSON.decode(exportWebData())
        return try ChatExport.make(v3:v3,format:format,scope:scope,chatID:conversation?.id,visiblePath:scope == .all ? nil : conversation?.visibleMessages.map(\.id),compressed:compressed)
    }
    @MainActor func exportChatImage(dark: Bool) async throws -> ChatExport.Artifact {
        guard !hasGenerations, let conversation else { throw ExchangeError.invalid("会話の生成結果を保存してから書き出してください") }
        let snapshot = try publicationSnapshot(), path = conversation.visibleMessages.map(\.identity)
        func summaries(_ chat: Conversation) throws -> [Data: OrderedJSON] {
            var values: [Data: OrderedJSON] = [:]
            for node in chat.visibleMessages { values[node.identity] = try summaryInfo(chatID: chat.id, nodeID: node.id) }
            return values
        }
        let presentation = try summaries(conversation)
        let artifact = try await ChatImageExport.make(messages: conversation.visibleMessages, title: conversation.title,
            settings: snapshot.required("state"), dark: dark, summaries: presentation)
        try Task.checkCancellation()
        guard !hasGenerations, let current = self.conversation,
              current.id.utf8.elementsEqual(conversation.id.utf8), current.visibleMessages.map(\.identity) == path,
              try publicationSnapshot() == snapshot, try summaries(current) == presentation else { throw ExchangeError.invalid("会話または設定が変更されました。書出しをやり直してください") }
        return artifact
    }
    func recoveryExport(exportedAt: Date = Date()) async throws -> Data {
        let snapshot = document?.snapshot
        let fileURL = store?.fileURL
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let timestamp = formatter.string(from:exportedAt)
        // Recovery must remain available when normal loading/validation has failed.
        return try await Task.detached(priority:.userInitiated) {
            try NativeRecoveryExport.make(liveSnapshot:snapshot,fileURL:fileURL,exportedAt:timestamp)
        }.value
    }

    func applySnapshot(_ snapshot: OrderedJSON) throws {
        guard !initialLoadFailed else { throw ExchangeError.invalid("保存ファイルを読めなかったため更新できません。明示的な置換が必要です") }
        guard !hasGenerations else { throw ExchangeError.invalid("生成中は保存データを置き換えられません") }
        let base = try document ?? SyncDocument(v3: exchange?.source ?? ChatLibrary.emptySource)
        let candidate = try base.mergingSnapshot(snapshot)
        try applyDocument(candidate)
    }
    func syncInputSnapshot() throws -> OrderedJSON {
        guard !initialLoadFailed else { throw SyncSessionError.invalid("The saved local file could not be loaded; it was not replaced") }
        guard !hasGenerations else { throw SyncSessionError.invalid("Wait for active generations before applying Google sync") }
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
        do { try store?.save(SavedChatState(exchange: changed, document: candidate, conversations: views, selectedConversationID: selected, style: displayStyle)) }
        catch {
            diagnostics.report(id: "local-save", label: "ローカル保存", status: "error", detail: "失敗")
            throw error
        }
        invalidateGeneration(); cancelTitles(); cancelSummaries(); cancelEvaluations()
        chatScrollAnchors = [:]; chatScrollRestoration = nil
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

private enum NativeOpenRouterStats {
    static func roots(_ snapshot: OrderedJSON) throws -> OrderedJSON {
        let state = try snapshot.required("state")
        return .object([.init(key:"verifiedStats",value:state["verifiedStats"] ?? .object([])),
                        .init(key:"pendingVerifications",value:state["pendingVerifications"] ?? .object([]))])
    }
    static func call(_ operation: String, roots: OrderedJSON, fields: [JSONField] = [], now: Double) throws -> OrderedJSON {
        var projection = SharedWebProjection(), projected: [JSONField] = []
        for root in try roots.object("stats roots") {
            var entries: [JSONField] = []
            for entry in try root.value.object("stats entries") {
                let known = root.key == "verifiedStats" ? ["fetchedAt"] : ["generationId","chatId","targetNodeId","requestedAt","nextAttemptAt","attemptCount","status","lastAttemptAt","lastError"]
                entries.append(.init(key:entry.key,value:.object(try entry.value.object("stats entry").map { field in
                    .init(key:field.key,value:known.contains(where:field.key.matches) ? field.value : try projection.reference(field.value))
                })))
            }
            projected.append(.init(key:root.key,value:.object(entries)))
        }
        let result = try SharedWebOperations.call("openRouterStats",.object([
            .init(key:"operation",value:.string(operation)),.init(key:"state",value:.object(projected)),
            .init(key:"now",value:.number(String(now)))] + fields))
        if let changes = result["changes"] { return try OrderedJSONChanges.apply(changes,to:roots,opaque:projection.opaque) }
        return result
    }
    static func key(chatID: String, nodeID: String) throws -> String {
        try SharedWebOperations.call("openRouterStats",.object([.init(key:"operation",value:.string("key")),
            .init(key:"chatId",value:.string(chatID)),.init(key:"targetNodeId",value:.string(nodeID))])).required("key").string("stats key")
    }
}

extension ChatState {
    private func queuedOpenRouterStats(_ current: ActiveGeneration, now: Double) throws -> OrderedJSON? {
        guard current.usesRemoteTransport, current.completedSuccessfully || current.failed,
              let generationID = current.output.generationID,
              let chat = try current.baseSource.required("chats").array("chats").first(where:{ $0["id"] == .string(current.chatID) }),
              chat["config"]?["providerId"] == .string("openrouter"),
              let target = try current.plan?["targetNodeId"]?.string("node ID") else { return nil }
        let key = try NativeOpenRouterStats.key(chatID:current.chatID,nodeID:target)
        let action = OrderedJSON.object([.init(key:"type",value:.string("queue")),.init(key:"key",value:.string(key)),
            .init(key:"verification",value:.object([.init(key:"generationId",value:.string(generationID)),
                .init(key:"chatId",value:.string(current.chatID)),.init(key:"targetNodeId",value:.string(target))]))])
        return try NativeOpenRouterStats.call("transition",roots:NativeOpenRouterStats.roots(publicationSnapshot()),fields:[.init(key:"action",value:action)],now:now)
    }
    private func saveOpenRouterStats(_ roots: OrderedJSON) throws {
        try applyLibrary(exchange?.source ?? ChatLibrary.emptySource,selectedID:selectedID,preserveGeneration:true,openRouterStats:roots)
    }
    private func changeOpenRouterVerification(_ action: OrderedJSON, now: Double) throws {
        let before = try NativeOpenRouterStats.roots(publicationSnapshot())
        let after = try NativeOpenRouterStats.call("transition",roots:before,fields:[.init(key:"action",value:action)],now:now)
        if before != after { try saveOpenRouterStats(after) }
    }
    func isVerifyingOpenRouter(_ key: String) -> Bool { openRouterVerificationTasks[Data(key.utf8)] != nil }
    func retryOpenRouterVerification(_ key: String, now: Double = Date().timeIntervalSince1970 * 1000) throws {
        try changeOpenRouterVerification(.object([.init(key:"type",value:.string("retry")),.init(key:"key",value:.string(key))]),now:now)
    }
    func recoverOpenRouterVerifications(now: Double = Date().timeIntervalSince1970 * 1000) throws {
        let roots = try NativeOpenRouterStats.roots(publicationSnapshot())
        let next = try NativeOpenRouterStats.call("recover",roots:roots,now:now)
        if next != roots { try saveOpenRouterStats(next) }
    }
    @MainActor func verifyOpenRouterGeneration(_ key: String,
        readCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:),
        fetch: (URLRequest) async throws -> OrderedJSON = OpenRouterCreditsClient.fetch,
        now: Double = Date().timeIntervalSince1970 * 1000) async throws {
        let roots = try publicationSnapshot().required("state")
        guard let pending = roots["pendingVerifications"]?[key] else { return }
        let chatID = try pending.required("chatId").string("chat ID"), nodeID = try pending.required("targetNodeId").string("node ID")
        guard try NativeOpenRouterStats.key(chatID:chatID,nodeID:nodeID).utf8.elementsEqual(key.utf8) else { throw ExchangeError.invalid("使用量確認の識別子が一致しません") }
        let generationID = try pending.required("generationId").string("generation ID")
        func node() throws -> OrderedJSON? {
            try exchange?.source.required("chats").array("chats").first(where:{ $0["id"] == .string(chatID) })?["branchTree"]?["nodes"]?[nodeID]
        }
        let originalNode = try node()
        let action: [JSONField] = [.init(key:"key",value:.string(key))]
        func failed() throws {
            try changeOpenRouterVerification(.object(action + [.init(key:"type",value:.string("failed")),
                .init(key:"error",value:.string("OpenRouterの使用量を確認できませんでした。再確認できます。")),
                .init(key:"nextAttemptAt",value:.number("9007199254740991"))]),now:now)
        }
        let record: RemoteCredentialRecord, providerSnapshot = roots["providers"]?["openrouter"] ?? .null
        let request: URLRequest
        do {
            guard originalNode?["role"] == .string("assistant"),
                  let provider = try ProviderModels.providers(in:roots).first(where:{ $0.id == "openrouter" }) else { throw ExchangeError.invalid("使用量の対象がありません") }
            record = try ProviderModels.credential(provider,read:readCredential)
            let envelope = try SharedWebOperations.call("openRouterStats",.object([.init(key:"operation",value:.string("request")),.init(key:"generationId",value:.string(generationID))]))
            guard envelope["authentication"]?["header"] == .string("Authorization"), envelope["authentication"]?["scheme"] == .string("Bearer") else { throw ExchangeError.invalid("使用量API認証が不正です") }
            let bound = OrderedJSON.object([.init(key:"endpoint",value:try envelope.required("endpoint")),.init(key:"headers",value:.object([])),
                .init(key:"authentication",value:.array([.object([.init(key:"name",value:.string("Authorization")),.init(key:"prefix",value:.string("Bearer "))])]))])
            var prepared = try RemoteRequest.bindEnvelope(bound,body:.null,originalURL:record.settings.validatedURL(),key:record.key)
            prepared.httpMethod = "GET"; prepared.httpBody = nil; prepared.timeoutInterval = 60
            request = prepared
        } catch { try failed(); return }
        try changeOpenRouterVerification(.object(action + [.init(key:"type",value:.string("fetching"))]),now:now)
        let expected = try publicationSnapshot().required("state")["pendingVerifications"]?[key]
        let payload: OrderedJSON
        do { payload = try await fetch(request); try Task.checkCancellation() }
        catch is CancellationError { throw CancellationError() }
        catch {
            if try publicationSnapshot().required("state")["pendingVerifications"]?[key] == expected { try failed() }
            return
        }
        guard try publicationSnapshot().required("state")["pendingVerifications"]?[key] == expected else { return }
        guard try readCredential("openrouter") == record,
              try (publicationSnapshot().required("state")["providers"]?["openrouter"] ?? .null) == providerSnapshot,
              try node() == originalNode else { try failed(); return }
        let parsed = try SharedWebOperations.call("openRouterStats",.object([.init(key:"operation",value:.string("parse")),
            .init(key:"payload",value:payload),.init(key:"generationId",value:.string(generationID)),.init(key:"now",value:.number(String(now)))]))
        guard let stats = parsed["stats"] else { try failed(); return }
        try changeOpenRouterVerification(.object([.init(key:"type",value:.string("verified")),.init(key:"key",value:.string(key)),.init(key:"stats",value:stats)]),now:now)
    }
    @MainActor func runOpenRouterVerifications() {
        openRouterVerificationTimer?.cancel(); openRouterVerificationTimer = nil
        do {
            let schedule = try NativeOpenRouterStats.call("schedule",roots:NativeOpenRouterStats.roots(publicationSnapshot()),now:Date().timeIntervalSince1970 * 1000)
            for raw in try schedule.required("dueKeys").array("due keys") {
                let key = try raw.string("stats key"), identity = Data(key.utf8)
                guard openRouterVerificationTasks[identity] == nil else { continue }
                openRouterVerificationTasks[identity] = Task { @MainActor [weak self] in
                    guard let self else { return }
                    do {
                        try await self.verifyOpenRouterGeneration(key)
                        self.openRouterVerificationTasks.removeValue(forKey:identity)
                        self.openRouterVerificationError = nil
                        self.runOpenRouterVerifications()
                    } catch {
                        self.openRouterVerificationTasks.removeValue(forKey:identity)
                        self.openRouterVerificationError = "使用量の確認状態を保存できませんでした。保存データを保持しています。"
                    }
                }
            }
            if let next = schedule["nextAt"], next != .null {
                let delay = max(0,try next.number("next verification") - Date().timeIntervalSince1970 * 1000)
                openRouterVerificationTimer = Task { @MainActor [weak self] in
                    do { try await Task.sleep(nanoseconds:UInt64(min(delay,86_400_000) * 1_000_000)); self?.runOpenRouterVerifications() }
                    catch { return }
                }
            }
        } catch { openRouterVerificationError = "使用量の確認予定を読み取れませんでした。保存データを保持しています。" }
    }
}
