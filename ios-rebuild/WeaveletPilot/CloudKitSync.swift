import CloudKit
import SwiftUI

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
            throw SyncSessionError.invalid("CloudKitのデータ版が異なります。端末へ適用せず、CloudKitの元データを維持しています。Web版で書き出し・取込みしてください")
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
    private let transport: (any CloudKitTransporting)?
    private let deviceID: String
    private let clock: () -> Int64
    private var record: CloudKitSnapshotRecord?
    private var metrics: OrderedJSON?
    private var session = UUID()
    private var task: Task<Void,Never>?
    @Published private(set) var working = false
    @Published private(set) var status = "未接続"
    @Published var errorMessage: String?

    init(state: ChatState, transport: (any CloudKitTransporting)? = nil, deviceID: String? = nil, clock: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.state = state; self.clock = clock
        if let deviceID { self.deviceID = deviceID }
        else {
            let key = "cloudKitDeviceID"
            let value = UserDefaults.standard.string(forKey:key) ?? UUID().uuidString.lowercased()
            UserDefaults.standard.set(value,forKey:key); self.deviceID = value
        }
        do { self.transport = try transport ?? CloudKitTransport() }
        catch { self.transport = nil; errorMessage = error.localizedDescription }
    }
    private func requireTransport() throws -> any CloudKitTransporting {
        guard let transport else { throw CloudKitTransportError.missingContainerIdentifier }
        return transport
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
        let token = session
        let account = try await requireTransport().accountStatus()
        try check(token)
        guard account == .available else { throw SyncSessionError.invalid("iCloudアカウントを利用できません（状態: \(account.rawValue)）") }
        status = "接続済み"
    }
    func download() async throws {
        let baseline = try state.syncInputSnapshot(), token = session, (name,type,_) = try names()
        guard let remote = try await requireTransport().read(recordName:name,recordType:type) else { throw SyncSessionError.invalid("CloudKitに同期データがありません") }
        try check(token)
        let snapshot = try CloudKitSnapshots.decode(remote.payload)
        let nextMetrics = try CloudKitSnapshots.guardResult(snapshot,previous:nil).required("metrics")
        try state.applyCloudKitSnapshot(snapshot,expected:baseline)
        record = remote; metrics = nextMetrics; status = "CloudKitから受信しました"
    }
    func upload() async throws {
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
            if let server, try CloudKitSnapshots.operation("localWins",[.init(key:"localUpdatedAt",value:.number(String(updatedAt))),.init(key:"serverUpdatedAt",value:.number(String(server.updatedAt)))]) != .bool(true) {
                let snapshot = try CloudKitSnapshots.decode(server.payload)
                let nextMetrics = try CloudKitSnapshots.guardResult(snapshot,previous:nil).required("metrics")
                try state.applyCloudKitSnapshot(snapshot,expected:baseline)
                record = server; metrics = nextMetrics; status = "新しいCloudKitの内容を採用しました"
                return
            }
            // Retry once with the exact fetched system fields, following the Web provider.
            saved = try await transport.save(recordName:name,recordType:type,payload:payload,snapshotVersion:version,updatedAt:updatedAt,deviceId:deviceID,expected:server)
        }
        try check(token)
        record = saved; metrics = try guardResult.required("metrics")
        status = try state.syncInputSnapshot() == baseline ? "CloudKitへ保存しました" : "送信した内容を保存しました。端末には未送信の変更があります"
    }
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard task == nil else { return }
        working = true; errorMessage = nil
        task = Task {
            defer { working = false; task = nil }
            do { try await work() } catch { errorMessage = error.localizedDescription }
        }
    }
    func disconnect() { session = UUID(); task?.cancel(); record = nil; metrics = nil; status = "未接続" }
}

struct CloudKitSyncSettingsView: View {
    @ObservedObject var connection: CloudKitSyncConnection
    @Environment(\.dismiss) private var dismiss
    @State private var receiving = false
    @State private var sending = false
    var body: some View {
        NavigationStack {
            Form {
                Section("CloudKit同期") {
                    Text("Web版と同じCloudKitコンテナーのスナップショットを読み書きします。フォルダー同期とは別の同期先です。")
                    Text(connection.status)
                    Button("iCloud接続を確認") { connection.run { try await connection.connect() } }.disabled(connection.working)
                    Button("CloudKitから受信") { receiving = true }.disabled(connection.working)
                    Button("この端末から送信") { sending = true }.disabled(connection.working)
                    Button("接続を解除") { connection.disconnect() }
                    if let error = connection.errorMessage { Text(error).foregroundStyle(.red) }
                }
            }
            .confirmationDialog("この端末のデータをCloudKitの内容で置き換えます",isPresented:$receiving,titleVisibility:.visible) {
                Button("CloudKitから受信",role:.destructive) { connection.run { try await connection.download() } }
            }
            .confirmationDialog("この端末のデータをCloudKitへ送信します",isPresented:$sending,titleVisibility:.visible) {
                Button("送信",role:.destructive) { connection.run { try await connection.upload() } }
            } message: { Text("競合時はWeb版と同じ更新時刻の判定で採用する内容を決めます。") }
            .navigationTitle("CloudKit同期")
            .toolbar { ToolbarItem(placement:.confirmationAction) { Button("完了") { dismiss() }.disabled(connection.working) } }
            .interactiveDismissDisabled(connection.working)
        }
    }
}
