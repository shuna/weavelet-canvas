import SwiftUI
import UniformTypeIdentifiers

// The Web transport owns the file protocol; this adapter supplies native file I/O.
actor FolderSyncTransport: SyncDrive {
    let files: FolderSyncFiles
    let store: SyncStateStore
    init(files: FolderSyncFiles, store: SyncStateStore) { self.files = files; self.store = store }
    func call(_ method: String, args: [OrderedJSON]) async throws -> OrderedJSON {
        switch method {
        case "fs.list":
            return .array(try await files.list().map { .object([.init(key:"name",value:.string($0.name)),.init(key:"kind",value:.string($0.isDirectory ? "directory" : "file"))]) })
        case "fs.read": return .syncBytes(try await files.read(name:args[0].string("filename")))
        case "fs.write":
            try await files.write(name:args[0].string("filename"),bytes:args[1].syncData(),expectedExistingData:args[2] == .null ? nil : args[2].syncData())
            return .null
        case "fs.target":
            switch try args[0].string("target operation") {
            case "get": return try store.fileSystemTarget() ?? .null
            case "set": try store.saveFileSystemTarget(args[1]); return .null
            case "clear": try store.saveFileSystemTarget(nil); return .null
            default: throw SyncSessionError.invalid("Unknown folder target operation")
            }
        default: throw SyncSessionError.invalid("Unknown native folder operation")
        }
    }
}

@MainActor final class FolderSyncConnection: ObservableObject, Identifiable {
    let id = UUID()
    let state: ChatState
    let store: SyncStateStore
    let keys: any SyncKeyStore
    @Published private(set) var controller: GoogleSyncController?
    @Published private(set) var folderName: String?
    @Published var errorMessage: String?
    @Published private(set) var working = false
    private var transport: FolderSyncTransport?
    private var task: Task<Void,Never>?
    init(state: ChatState, store: SyncStateStore = .folderStore, keys: any SyncKeyStore = KeychainSyncKeyStore()) {
        self.state = state; self.store = store; self.keys = keys
        do {
            if let bookmark = try store.folderBookmark() {
                let files = try FolderSyncFiles(restoringBookmark:bookmark)
                install(files)
                folderName = "保存済みフォルダー"
            }
        } catch { errorMessage = error.localizedDescription }
    }
    private func install(_ files: FolderSyncFiles) {
        let transport = FolderSyncTransport(files:files,store:store)
        self.transport = transport
        controller = GoogleSyncController(chatState:state,drive:transport,store:store,keyStore:keys,transportMode:.filesystem)
    }
    func select(_ url: URL) async throws {
        guard controller?.dataset == nil else { throw SyncSessionError.invalid("現在の同期接続を解除してから選択してください") }
        let files = try FolderSyncFiles(selectedFolderURL:url)
        let bookmark = try await files.bookmarkData()
        try store.selectFolder(bookmark:bookmark)
        install(files); folderName = url.lastPathComponent
    }
    func run(_ work: @escaping @MainActor () async throws -> Void) {
        guard task == nil else { return }
        working = true; errorMessage = nil
        task = Task {
            defer { working = false; task = nil }
            do { try await work() } catch { errorMessage = error.localizedDescription }
        }
    }
    func open() async throws {
        guard let transport, let controller else { throw SyncSessionError.invalid("同期フォルダーを選択してください") }
        let inspector = try SyncSession(drive:transport,store:store,keyStore:keys,transportMode:.filesystem)
        let inspected = try await inspector.inspectFolder()
        let manifest = inspected["manifest"]
        let target = try store.fileSystemTarget()
        guard let dataset = try (manifest == .null || manifest == nil ? target : manifest)?.required("dataset").string("dataset") else { throw SyncSessionError.invalid("このフォルダーに同期データがありません") }
        try await controller.open(dataset:dataset)
        _ = try await controller.restoreKey()
    }
    func initialize() async throws {
        guard let controller else { throw SyncSessionError.invalid("同期フォルダーを選択してください") }
        try await controller.initializeFolder()
    }
    var canInitialize: Bool {
        guard let target = try? store.fileSystemTarget() else { return false }
        return target["initialized"] != .bool(true)
    }
    func cancel() { task?.cancel(); controller?.cancel() }
    func disconnect() async throws {
        try await controller?.disconnect()
        try store.selectFolder(bookmark:nil)
        controller = nil; transport = nil; folderName = nil
    }
}

struct FolderSyncSettingsView: View {
    @ObservedObject var connection: FolderSyncConnection
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var password = ""
    @State private var passwordConfirmation = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("同期フォルダー") {
                    Text("端末内またはiCloud Driveの専用フォルダーを選択してください。内容はパスフレーズで暗号化して保存します。")
                    Text("iCloud Driveの他端末への配信はOSが行います。フォルダーへ保存できても、他端末へ到着するまで時間がかかる場合があります。履歴は自動削除しません。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let name = connection.folderName { Text(name).textSelection(.enabled) }
                    Button("フォルダーを選択") { picking = true }.disabled(connection.working || connection.controller?.dataset != nil)
                }
                if let controller = connection.controller {
                    FolderSyncOperations(connection:connection,controller:controller,password:$password,confirmation:$passwordConfirmation)
                }
                if let error = connection.errorMessage { Text(error).foregroundStyle(.red) }
                if connection.working { Button("処理を中止") { connection.cancel() } }
            }
            .sheet(isPresented:$picking) { FolderPicker { url in
                picking = false
                if let url { connection.run { try await connection.select(url) } }
            } }
            .navigationTitle("フォルダー同期")
            .toolbar { ToolbarItem(placement:.confirmationAction) { Button("完了") { dismiss() }.disabled(connection.working) } }
            .interactiveDismissDisabled(connection.working)
        }
    }
}

private struct FolderSyncOperations: View {
    @ObservedObject var connection: FolderSyncConnection
    @ObservedObject var controller: GoogleSyncController
    @Binding var password: String
    @Binding var confirmation: String
    @State private var resolution: GoogleSyncController.Resolution?
    @State private var receiving = false
    private var statusText: String {
        switch controller.status {
        case .disconnected: return "同期先未接続"
        case .locked: return "フォルダーのロック解除が必要です"
        case .ready: return "同期できます"
        case .syncing: return "フォルダーを読み書きしています"
        case .conflict: return "変更が競合しています"
        case .recoveryRequired: return "保存処理の復旧が必要です"
        case .failed: return "処理を完了できませんでした"
        }
    }
    var body: some View {
        Section("同期") {
            Text(statusText)
                .font(controller.status == .conflict || controller.status == .recoveryRequired ||
                      controller.status == .failed || controller.status == .locked ? .body : .footnote)
            if let dataset = controller.dataset { Text(dataset).font(.footnote).textSelection(.enabled) }
            if controller.dataset == nil {
                SecureField("パスフレーズ（12文字以上）",text:$password)
                SecureField("パスフレーズを確認",text:$confirmation)
                Button("空のフォルダーに現在のデータで作成") {
                    let value = password; password = ""; confirmation = ""
                    connection.run { try await controller.create(password:value) }
                }.disabled(connection.working || password.count < 12 || password != confirmation)
                Button("既存の同期フォルダーへ接続・再開") { connection.run { try await connection.open() } }.disabled(connection.working)
            } else {
                SecureField("パスフレーズ",text:$password)
                Button("ロック解除") {
                    let value = password; password = ""
                    connection.run { try await controller.unlock(password:value) }
                }.disabled(connection.working || password.isEmpty)
                Button("保存済みの鍵でロック解除・再開") { connection.run { _ = try await controller.restoreKey() } }.disabled(connection.working)
                Button("今すぐ同期") { connection.run { try await controller.synchronize() } }.disabled(connection.working || !controller.isUnlocked)
                Button("フォルダーから受信") { receiving = true; resolution = .cloud }.disabled(connection.working || !controller.isUnlocked)
                if connection.canInitialize {
                    Button("初回の保存を再開") { connection.run { try await connection.initialize() } }.disabled(connection.working || !controller.isUnlocked)
                }
                if controller.status == .recoveryRequired {
                    Button("保存処理を復旧") { connection.run { try await controller.recover() } }.disabled(connection.working || !controller.isUnlocked)
                }
                if controller.status == .conflict || controller.status == .recoveryRequired {
                    Button("両方の変更を統合") { connection.run { try await controller.resolve(.merge) } }.disabled(connection.working || !controller.isUnlocked)
                    Button("この端末を採用") { receiving = false; resolution = .local }.disabled(connection.working || !controller.isUnlocked)
                    Button("フォルダーを採用") { receiving = false; resolution = .cloud }.disabled(connection.working || !controller.isUnlocked)
                }
                if let error = controller.errorMessage { Text(error).foregroundStyle(.red) }
            }
            Button("フォルダー同期を解除") { connection.run { try await connection.disconnect() } }.disabled(connection.working)
            Text("解除してもフォルダーのファイルと、この端末の会話は残ります。").font(.footnote).foregroundStyle(.secondary)
        }
        .confirmationDialog("採用するデータを確認",isPresented:Binding(get:{resolution != nil},set:{if !$0 {resolution = nil}}),titleVisibility:.visible) {
            Button(resolution == .local ? "この端末の内容を採用" : "フォルダーの内容を採用",role:.destructive) {
                guard let mode = resolution else { return }; resolution = nil
                connection.run { if receiving { try await controller.download() } else { try await controller.resolve(mode) } }
            }
        } message: { Text("採用する側の内容で、この端末またはフォルダーの変更を置き換えます。") }
    }
}

private struct FolderPicker: UIViewControllerRepresentable {
    let selected: (URL?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(selected) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes:[.folder],asCopy:false)
        picker.delegate = context.coordinator; picker.allowsMultipleSelection = false
        return picker
    }
    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let selected: (URL?) -> Void
        init(_ selected: @escaping (URL?) -> Void) { self.selected = selected }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            if let url = urls.first { selected(url) }
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { selected(nil) }
    }
}
