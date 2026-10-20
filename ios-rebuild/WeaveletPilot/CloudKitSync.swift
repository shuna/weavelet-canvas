import CloudKit
import SwiftUI
import Combine
import UniformTypeIdentifiers

enum CloudKitSnapshotDecodeError: LocalizedError {
    case incompatibleVersion
    var errorDescription: String? { "CloudKitのデータ版が異なります。隔離データを書き出してWeb版で移行してください。端末の会話は変更していません。" }
}

// Web owns snapshot layout, upload guards and conflict policy; Swift retains raw JSON and performs OS I/O.
enum CloudKitSnapshots {
    static func operation(_ name: String, _ fields: [JSONField] = []) throws -> OrderedJSON {
        try SharedWebOperations.call("cloudKitOperation",.object([.init(key:"operation",value:.string(name))] + fields))
    }
    static func decode(_ payload: Data) throws -> OrderedJSON {
        let raw = try OrderedJSON.decode(Data(SyncCompression.decompressCloudKit(payload).utf8))
        let projection = OrderedJSON.object(try raw.object("CloudKit snapshot").map { field in
            let value: OrderedJSON
            if field.key == "version" { value = field.value }
            else if field.key == "state" {
                switch field.value { case .object: value = .object([]); case .array: value = .array([]); default: value = field.value }
            } else { value = .null }
            return .init(key:field.key,value:value)
        })
        let layout = try operation("layout",[.init(key:"value",value:projection)])
        let validation = try operation("receiveGuard",[.init(key:"snapshotJSON",value:.string(String(decoding:try raw.encoded(),as:UTF8.self)))])
        guard validation["compatibleVersion"] == .bool(true) else {
            throw CloudKitSnapshotDecodeError.incompatibleVersion
        }
        guard validation["validFolders"] == .bool(true) else { throw SyncSessionError.invalid("CloudKitのフォルダー階層が不正です。端末へ適用していません") }
        let state = layout["wrapped"] == .bool(true) ? (raw["state"] == .null ? .object([]) : try raw.required("state")) : raw
        if layout["wrapped"] == .bool(true) { return raw.replacing("version",with:try layout.required("version")) }
        return .object([.init(key:"version",value:try layout.required("version")),.init(key:"state",value:state)])
    }
    static func guardResult(_ snapshot: OrderedJSON, previous: OrderedJSON?) throws -> OrderedJSON {
        try operation("uploadGuard",[.init(key:"snapshotJSON",value:.string(String(decoding:try snapshot.encoded(),as:UTF8.self))),.init(key:"previousMetrics",value:previous ?? .null)])
    }
}

@MainActor final class CloudKitSyncConnection: ObservableObject, Identifiable {
    let id = UUID()
    let state: ChatState
    private var transport: (any CloudKitTransporting)?
    private let syncStore: CloudKitSyncStore
    private var baselineDigest: String?
    private var startupError: Error?
    private var observation: AnyCancellable?
    private var automaticQueue: CloudKitAutoSync?
    private var automaticActive = false
    private var automaticBlockedByLegacy = false
    private var operationInFlight = false
    private var diagnosticSucceeded = false
    private var backgroundID: UIBackgroundTaskIdentifier = .invalid
    private var backgroundWork: Task<Void,Never>?
    @Published private(set) var automaticEnabled = false
    @Published private(set) var legacyRemotes: [CloudKitSyncStore.LegacyRemoteArchive] = []
    private let deviceID: String
    private let clock: () -> Int64
    private var record: CloudKitSnapshotRecord?
    private var metrics: OrderedJSON?
    private var session = UUID()
    private var task: Task<Void,Never>?
    @Published private(set) var working = false
    @Published private(set) var status = "未接続"
    @Published var errorMessage: String?

    init(state: ChatState, transport: (any CloudKitTransporting)? = nil, syncStore: CloudKitSyncStore = .applicationStore, deviceID: String? = nil, clock: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.state = state; self.clock = clock; self.syncStore = syncStore; self.transport = transport
        if let deviceID { self.deviceID = deviceID }
        else {
            let key = "cloudKitDeviceID"
            let value = UserDefaults.standard.string(forKey:key) ?? UUID().uuidString.lowercased()
            UserDefaults.standard.set(value,forKey:key); self.deviceID = value
        }
        do {
            let saved = try syncStore.load()
            automaticEnabled = saved.enabled; baselineDigest = saved.baselineDigest; legacyRemotes = saved.legacyRemotes
            let idle = try CloudKitSnapshots.operation("constants").required("idleMs").number("idleMs")
            automaticQueue = CloudKitAutoSync(delayNanoseconds:UInt64(idle) * 1_000_000,send:{ [weak self] in
                guard let self, self.automaticActive else { return }
                if try self.currentDigest() != self.baselineDigest { try await self.upload() }
            },onError:{ [weak self] error in self?.errorMessage = error.localizedDescription })
            observation = state.$document.dropFirst().sink { [weak self] _ in
                guard let self, self.automaticActive else { return }; self.automaticQueue?.enqueue()
            }
        } catch { startupError = error; errorMessage = error.localizedDescription }
    }
    private func requireTransport() throws -> any CloudKitTransporting {
        if let startupError { throw startupError }
        if let transport { return transport }
        let created = try CloudKitTransport(); transport = created; return created
    }
    private func check(_ token: UUID) throws {
        try Task.checkCancellation()
        guard token == session else { throw SyncSessionError.invalid("CloudKitの接続が変更されています") }
    }
    private func names() throws -> (String,String,Int64) {
        let value = try CloudKitSnapshots.operation("constants")
        let version = Int64(try value.required("version").number("version"))
        return (try value.required("recordName").string("record name"),try value.required("recordType").string("record type"),version)
    }
    func connect() async throws {
        try beginOperation(); defer { endOperation() }
        let token = session
        let account = try await requireTransport().accountStatus()
        try check(token)
        guard account == .available else { throw SyncSessionError.invalid("iCloudアカウントを利用できません（状態: \(account.rawValue)）") }
        status = "接続済み"
        diagnosticSucceeded = true
    }
    func download() async throws {
        try beginOperation(); defer { endOperation() }
        automaticActive = false; var succeeded = false
        defer { automaticActive = automaticEnabled && succeeded && !automaticBlockedByLegacy }
        let baseline = try state.syncInputSnapshot(), token = session, (name,type,_) = try names()
        guard let remote = try await requireTransport().read(recordName:name,recordType:type) else { throw SyncSessionError.invalid("CloudKitに同期データがありません") }
        try check(token)
        let snapshot = try decodeRemote(remote)
        let nextMetrics = try CloudKitSnapshots.guardResult(snapshot,previous:nil).required("metrics")
        try state.applyCloudKitSnapshot(snapshot,expected:baseline)
        try checkpoint(state.publicationSnapshot())
        record = remote; metrics = nextMetrics; status = "CloudKitから受信しました"; succeeded = true
        diagnosticSucceeded = true
    }
    func prepareLegacyIOSImport() async throws -> ChatImportPreview {
        try beginOperation(); defer { endOperation() }
        let token = session, source = try ChatImport.call("legacyCloudKitSource")
        let name = try source.required("recordName").string("legacy record name")
        let type = try source.required("recordType").string("legacy record type")
        guard let remote = try await requireTransport().read(recordName: name, recordType: type) else {
            throw SyncSessionError.invalid("旧iOSのCloudKitデータがありません")
        }
        try check(token)
        guard remote.recordName == name, remote.recordType == type else { throw CloudKitTransportError.invalidRecord }
        // Preserve the original payload before interpreting its version or contents.
        try syncStore.archiveLegacyRemote(remote)
        legacyRemotes = try syncStore.load().legacyRemotes
        guard remote.snapshotVersion == Int64(try source.required("snapshotVersion").number("legacy snapshot version")) else {
            throw SyncSessionError.invalid("旧iOSデータの版に対応していません。隔離した原本を書き出せます")
        }
        let preview = try await state.prepareImport(data: remote.payload, filename: "weavelet-ios-snapshot")
        try check(token)
        diagnosticSucceeded = true
        return preview
    }
    func upload() async throws {
        try beginOperation(); defer { endOperation() }
        let baseline = try state.syncInputSnapshot(), token = session, (name,type,version) = try names()
        let guardResult = try CloudKitSnapshots.guardResult(baseline,previous:metrics)
        if let message = guardResult["message"], message != .null { throw SyncSessionError.invalid(try message.string("guard message")) }
        let payload = try SyncCompression.compressCloudKit(String(decoding:try baseline.encoded(),as:UTF8.self))
        let updatedAt = clock(), transport = try requireTransport()
        let saved: CloudKitSnapshotRecord
        do {
            saved = try await transport.save(recordName:name,recordType:type,payload:payload,snapshotVersion:version,updatedAt:updatedAt,deviceId:deviceID,expected:record)
        } catch is CloudKitSnapshotConflictError {
            try check(token)
            let server = try await transport.read(recordName:name,recordType:type)
            try check(token)
            let serverSnapshot = try server.map { try decodeRemote($0) }
            if let server, let snapshot = serverSnapshot, try CloudKitSnapshots.operation("localWins",[.init(key:"localUpdatedAt",value:.number(String(updatedAt))),.init(key:"serverUpdatedAt",value:.number(String(server.updatedAt)))]) != .bool(true) {
                let nextMetrics = try CloudKitSnapshots.guardResult(snapshot,previous:nil).required("metrics")
                try state.applyCloudKitSnapshot(snapshot,expected:baseline)
                try checkpoint(state.publicationSnapshot())
                record = server; metrics = nextMetrics; status = "新しいCloudKitの内容を採用しました"
                diagnosticSucceeded = true
                return
            }
            if metrics == nil, let snapshot = serverSnapshot {
                // A cold dirty restart has no in-memory metrics; use the existing remote baseline before retrying.
                let remoteMetrics = try CloudKitSnapshots.guardResult(snapshot,previous:nil).required("metrics")
                let retryGuard = try CloudKitSnapshots.guardResult(baseline,previous:remoteMetrics)
                if let message = retryGuard["message"], message != .null { throw SyncSessionError.invalid(try message.string("guard message")) }
            }
            // Retry once with the exact fetched system fields, following the Web provider.
            saved = try await transport.save(recordName:name,recordType:type,payload:payload,snapshotVersion:version,updatedAt:updatedAt,deviceId:deviceID,expected:server)
        }
        try check(token)
        try checkpoint(baseline)
        record = saved; metrics = try guardResult.required("metrics")
        status = try state.syncInputSnapshot() == baseline ? "CloudKitへ保存しました" : "送信した内容を保存しました。端末には未送信の変更があります"
        diagnosticSucceeded = true
    }
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard task == nil else { return }
        working = true; errorMessage = nil
        task = Task {
            defer { working = false; task = nil }
            do { try await work() } catch { errorMessage = error.localizedDescription }
        }
    }
    private func beginOperation() throws {
        if let startupError { throw startupError }
        guard !operationInFlight else { throw SyncSessionError.invalid("CloudKitの処理が進行中です") }
        operationInFlight = true; working = true
        diagnosticSucceeded = false
        state.diagnostics.report(id:"sync-cloudkit",label:"CloudKit同期",status:"active",detail:"処理中")
    }
    private func endOperation() {
        operationInFlight = false; working = task != nil
        state.diagnostics.report(id:"sync-cloudkit",label:"CloudKit同期",status:diagnosticSucceeded ? "done" : "error",detail:diagnosticSucceeded ? "操作完了" : "操作中断・失敗")
    }
    private func currentDigest() throws -> String { SyncRecords.digest(String(decoding:try state.syncInputSnapshot().encoded(),as:UTF8.self)) }
    private func checkpoint(_ snapshot: OrderedJSON) throws {
        let digest = SyncRecords.digest(String(decoding:try snapshot.encoded(),as:UTF8.self))
        try syncStore.saveBaselineDigest(digest); baselineDigest = digest
    }
    private func decodeRemote(_ remote: CloudKitSnapshotRecord) throws -> OrderedJSON {
        do { let value = try CloudKitSnapshots.decode(remote.payload); automaticBlockedByLegacy = false; return value }
        catch CloudKitSnapshotDecodeError.incompatibleVersion {
            automaticBlockedByLegacy = true; automaticActive = false; automaticQueue?.cancel()
            try syncStore.archiveLegacyRemote(remote)
            legacyRemotes = try syncStore.load().legacyRemotes
            automaticActive = false; automaticQueue?.cancel()
            throw CloudKitSnapshotDecodeError.incompatibleVersion
        }
    }
    var canEnableAutomaticSync: Bool { baselineDigest != nil && startupError == nil }
    func setAutomaticSync(_ enabled: Bool) async throws {
        if enabled && !canEnableAutomaticSync { throw SyncSessionError.invalid("先に受信または送信で同期データを確認してください") }
        try syncStore.saveEnabled(enabled); automaticEnabled = enabled
        automaticActive = false; automaticQueue?.cancel()
        if enabled { try await restoreAutomaticSync() }
    }
    func restoreAutomaticSync() async throws {
        guard automaticEnabled, !automaticActive, !automaticBlockedByLegacy else { return }
        try await connect()
        if try currentDigest() == baselineDigest { try await download() }
        else { try await upload() }
        automaticActive = true
        if try currentDigest() != baselineDigest { automaticQueue?.enqueue() }
    }
    func resumeOnForeground() {
        guard automaticEnabled, !working, !automaticBlockedByLegacy else { return }
        run { if self.automaticActive { try await self.flushAutomaticSync() } else { try await self.restoreAutomaticSync() } }
    }
    func flushAutomaticSync() async throws { if automaticActive { try await automaticQueue?.flush() } }
    func flushInBackground() {
        guard automaticActive, backgroundID == .invalid else { return }
        backgroundID = UIApplication.shared.beginBackgroundTask(withName:"CloudKit sync") { [weak self] in
            self?.backgroundWork?.cancel(); self?.endBackgroundSync()
        }
        guard backgroundID != .invalid else { return }
        backgroundWork = Task { [weak self] in
            guard let self else { return }
            defer { self.endBackgroundSync(); self.backgroundWork = nil }
            do { try await self.flushAutomaticSync() } catch { self.errorMessage = error.localizedDescription }
        }
    }
    private func endBackgroundSync() {
        guard backgroundID != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundID); backgroundID = .invalid
    }
    func archivedJSON(_ id: String) throws -> Data {
        guard let archive = try syncStore.load().legacyRemotes.first(where:{$0.id == id}) else { throw SyncSessionError.invalid("隔離データがありません") }
        return Data(try SyncCompression.decompressCloudKit(archive.payload).utf8)
    }
    func archivedFile(_ id: String) throws -> ChatExport.Artifact {
        guard let archive = try syncStore.load().legacyRemotes.first(where: { $0.id == id }) else { throw SyncSessionError.invalid("隔離データがありません") }
        let source = try ChatImport.call("legacyCloudKitSource")
        if archive.recordName == (try source.required("recordName").string("legacy record name")) {
            let json = (try? OrderedJSON.decode(archive.payload)) != nil
            return .init(data: archive.payload, filename: "weavelet-ios-snapshot-\(id.prefix(8)).\(json ? "json" : "wvlt")", contentType: json ? .json : .data)
        }
        return .init(data: try archivedJSON(id), filename: "weavelet-cloudkit-legacy-snapshot.json", contentType: .json)
    }
    func disconnect() throws {
        automaticEnabled = false; automaticActive = false
        automaticQueue?.cancel(); session = UUID(); task?.cancel(); record = nil; metrics = nil; status = "未接続"
        try syncStore.saveEnabled(false)
        state.diagnostics.report(id:"sync-cloudkit",label:"CloudKit同期",status:"idle",detail:"未接続")
    }
}

struct CloudKitSyncSettingsView: View {
    @ObservedObject var connection: CloudKitSyncConnection
    @Environment(\.dismiss) private var dismiss
    @State private var receiving = false
    @State private var sending = false
    @State private var exportDocument: WebJSONDocument?
    @State private var exporting = false
    @State private var exportType = UTType.json
    @State private var exportName = "weavelet-cloudkit-legacy-snapshot"
    @State private var importPreview: ChatImportPreview?
    var body: some View {
        NavigationStack {
            Form {
                Section("CloudKit同期") {
                    Text("Web版と同じCloudKitコンテナーのスナップショットを読み書きします。フォルダー同期とは別の同期先です。")
                    Text(connection.status)
                    Button("iCloud接続を確認") { connection.run { try await connection.connect() } }.disabled(connection.working)
                    Button("CloudKitから受信") { receiving = true }.disabled(connection.working)
                    Button("この端末から送信") { sending = true }.disabled(connection.working)
                    Toggle("自動同期",isOn:Binding(get:{connection.automaticEnabled},set:{ enabled in connection.run { try await connection.setAutomaticSync(enabled) } }))
                        .disabled(connection.working || (!connection.automaticEnabled && !connection.canEnableAutomaticSync))
                    Text("受信または送信を確認してから有効にできます。端末への保存後、操作が落ち着いてから自動送信します。バックグラウンド中の完了は保証されません。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("接続を解除") { do { try connection.disconnect() } catch { connection.errorMessage = error.localizedDescription } }
                    Button("旧iOSのCloudKitデータを確認") {
                        connection.run { importPreview = try await connection.prepareLegacyIOSImport() }
                    }.disabled(connection.working)
                    Text("旧iOSの同期データを読み取り、選択して取り込みます。旧データは変更しません。")
                        .font(.footnote).foregroundStyle(.secondary)
                    ForEach(connection.legacyRemotes,id:\.id) { archive in
                        Button("隔離した旧版データを書き出す（\(archive.id.prefix(8))）") {
                            do {
                                let file = try connection.archivedFile(archive.id)
                                exportDocument = WebJSONDocument(data: file.data); exportType = file.contentType; exportName = file.filename; exporting = true
                            }
                            catch { connection.errorMessage = error.localizedDescription }
                        }
                    }
                    if let error = connection.errorMessage { Text(error).foregroundStyle(.red) }
                }
            }
            .confirmationDialog("この端末のデータをCloudKitの内容で置き換えます",isPresented:$receiving,titleVisibility:.visible) {
                Button("CloudKitから受信",role:.destructive) { connection.run { try await connection.download() } }
            }
            .confirmationDialog("この端末のデータをCloudKitへ送信します",isPresented:$sending,titleVisibility:.visible) {
                Button("送信",role:.destructive) { connection.run { try await connection.upload() } }
            } message: { Text("競合時はWeb版と同じ更新時刻の判定で採用する内容を決めます。") }
            .sheet(item: $importPreview) { preview in FileImportView(state: connection.state, preview: preview) }
            .fileExporter(isPresented:$exporting,document:exportDocument,contentType:exportType,defaultFilename:exportName) { result in
                if case .failure(let error) = result { connection.errorMessage = error.localizedDescription }
            }
            .nativeNavigationTitle("CloudKit同期")
            .toolbar { ToolbarItem(placement:.confirmationAction) { Button("完了") { dismiss() }.disabled(connection.working) } }
            .interactiveDismissDisabled(connection.working)
        }
    }
}
