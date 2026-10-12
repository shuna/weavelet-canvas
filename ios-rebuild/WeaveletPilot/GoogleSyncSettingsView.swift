import SwiftUI
import AuthenticationServices

@MainActor final class GoogleSyncConnection: ObservableObject, Identifiable {
    let id = UUID()
    let controller: GoogleSyncController
    let drive: DriveTransport
    private let authentication: AuthenticationProvider
    @Published var files: [OrderedJSON] = []
    @Published var errorMessage: String?
    @Published var working = false
    private var task: Task<Void, Never>?

    // Delay Keychain access until the user opens a Google connection.
    @MainActor private final class AuthenticationProvider {
        private var value: GoogleAuthentication?
        func get() throws -> GoogleAuthentication {
            if let value { return value }
            let created = try GoogleAuthentication(configuration: GoogleAuthenticationConfiguration.bundled())
            value = created; return created
        }
        func cancel() { value?.cancelSignIn() }
        func disconnect() throws { try value?.disconnect(); value = nil }
    }
    init(state: ChatState) {
        let authentication = AuthenticationProvider()
        self.authentication = authentication
        drive = DriveTransport { force in try await authentication.get().token(force: force) }
        controller = GoogleSyncController(chatState: state, drive: drive)
    }
    var isConfigured: Bool { (try? GoogleAuthenticationConfiguration.bundled()) != nil }
    func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard task == nil else { return }
        working = true; errorMessage = nil
        task = Task {
            defer { working = false; task = nil }
            do { try await operation() }
            catch { errorMessage = error.localizedDescription }
        }
    }
    func signIn(anchor: ASPresentationAnchor) async throws {
        try await authentication.get().signIn(presentationAnchor: anchor)
        try await list()
    }
    func list() async throws { files = try await drive.listDatasets().array("files") }
    func suggestedName() throws -> String {
        let names = try files.map { try $0.required("name") }
        return try SharedWebOperations.call("driveListing", .array(names)).required("suggestedName").string("name")
    }
    func cancel() { task?.cancel(); controller.cancel(); authentication.cancel() }
    func disconnectAccount() async throws {
        try await controller.disconnect()
        // Also load a saved credential when sign-out precedes this run's first request.
        if isConfigured { _ = try authentication.get() }
        try authentication.disconnect(); files = []
    }
}

struct GoogleSyncSettingsView: View {
    @ObservedObject var connection: GoogleSyncConnection
    @ObservedObject var controller: GoogleSyncController
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var folderName = ""
    @State private var anchor: UIWindow?
    @State private var receiveOnly = false
    @State private var confirmation: GoogleSyncController.Resolution?

    init(connection: GoogleSyncConnection) {
        self.connection = connection; controller = connection.controller
    }
    private var status: String {
        switch controller.status {
        case .disconnected: return "同期先未選択"
        case .locked: return "同期先のロック解除が必要です"
        case .ready: return "同期できます"
        case .syncing: return "処理中"
        case .conflict: return "変更が競合しています"
        case .recoveryRequired: return "保存処理の復旧が必要です"
        case .failed: return "処理を完了できませんでした"
        }
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Google接続") {
                    if !connection.isConfigured {
                        Text("このビルドにはGoogleのiOSクライアント設定がありません。").foregroundStyle(.secondary)
                    }
                    Button("Googleに接続・再認証") {
                        guard let anchor else { return }
                        connection.run { try await connection.signIn(anchor: anchor) }
                    }.disabled(!connection.isConfigured || anchor == nil || connection.working)
                    Button("同期先一覧を更新") { connection.run { try await connection.list() } }
                        .disabled(!connection.isConfigured || connection.working)
                    Text(status)
                    if let dataset = controller.dataset { Text(dataset).font(.caption).textSelection(.enabled) }
                }
                if controller.dataset == nil {
                    Section("同期先を選択") {
                        ForEach(Array(connection.files.enumerated()), id: \.offset) { _, file in
                            if file["mimeType"] == .string("application/vnd.google-apps.folder"),
                               let id = try? file.required("id").string("id"), let name = try? file.required("name").string("name") {
                                Button(name) {
                                    connection.run { try await controller.open(dataset: id); _ = try await controller.restoreKey() }
                                }.disabled(connection.working)
                            }
                        }
                    }
                    Section("同期先を新規作成") {
                        TextField("フォルダ名", text: $folderName).disabled(connection.working)
                        SecureField("暗号化パスワード", text: $password).disabled(connection.working)
                        Button("現在のデータで作成") {
                            let value = password; password = ""
                            connection.run {
                                try await connection.list()
                                let name = try folderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? connection.suggestedName() : folderName
                                try await controller.create(password: value, folderName: name)
                            }
                        }.disabled(!connection.isConfigured || connection.working || password.isEmpty)
                    }
                } else {
                    Section("同期") {
                        SecureField("暗号化パスワード", text: $password).disabled(connection.working)
                        Button("ロック解除") {
                            let value = password; password = ""
                            connection.run { try await controller.unlock(password: value) }
                        }.disabled(connection.working || password.isEmpty)
                        Button("保存済みの鍵でロック解除") { connection.run { _ = try await controller.restoreKey() } }
                            .disabled(connection.working)
                        Button("今すぐ同期") { connection.run { try await controller.synchronize() } }
                            .disabled(connection.working || !controller.isUnlocked)
                        Button("クラウドから受信") { receiveOnly = true; confirmation = .cloud }
                            .disabled(connection.working || !controller.isUnlocked)
                        if controller.status == .recoveryRequired {
                            Button("保存処理を復旧") { connection.run { try await controller.recover() } }.disabled(connection.working || !controller.isUnlocked)
                        }
                        if controller.status == .conflict || controller.status == .recoveryRequired {
                            Text("ローカルとクラウドの変更を確認し、解決方法を選択してください。")
                            Button("両方の変更を統合") { connection.run { try await controller.resolve(.merge) } }.disabled(connection.working || !controller.isUnlocked)
                            Button("ローカルを採用") { receiveOnly = false; confirmation = .local }.disabled(connection.working || !controller.isUnlocked)
                            Button("クラウドを採用") { receiveOnly = false; confirmation = .cloud }.disabled(connection.working || !controller.isUnlocked)
                        }
                        Button("同期先との接続を解除", role: .destructive) { connection.run { try await controller.disconnect() } }
                            .disabled(connection.working)
                    }
                }
                Section {
                    Button("Googleからログアウト", role: .destructive) { connection.run { try await connection.disconnectAccount() } }
                        .disabled(connection.working || !connection.isConfigured)
                    if connection.working { Button("処理を中止") { connection.cancel() } }
                    if let message = connection.errorMessage ?? controller.errorMessage { Text(message).foregroundStyle(.red) }
                }
            }
            .background(GoogleAuthenticationWindow(window: $anchor).frame(width: 0, height: 0))
            .navigationTitle("Google同期")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完了") { dismiss() }.disabled(connection.working) } }
            .interactiveDismissDisabled(connection.working)
            .confirmationDialog("採用するデータを確認", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible) {
                Button(confirmation == .local ? "ローカルの内容を採用" : "クラウドの内容を採用", role: .destructive) {
                    guard let mode = confirmation else { return }; confirmation = nil
                    connection.run {
                        if receiveOnly { try await controller.download() }
                        else { try await controller.resolve(mode) }
                    }
                }
            } message: { Text("反対側の変更を置き換えます。未保存の編集がないことを確認してください。") }
        }
    }
}

private struct GoogleAuthenticationWindow: UIViewRepresentable {
    @Binding var window: UIWindow?
    func makeUIView(context: Context) -> UIView { AnchorView { window = $0 } }
    func updateUIView(_ uiView: UIView, context: Context) {}
    private final class AnchorView: UIView {
        let changed: (UIWindow?) -> Void
        init(changed: @escaping (UIWindow?) -> Void) { self.changed = changed; super.init(frame: .zero) }
        required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
        override func didMoveToWindow() { super.didMoveToWindow(); let value = window; DispatchQueue.main.async { self.changed(value) } }
    }
}
