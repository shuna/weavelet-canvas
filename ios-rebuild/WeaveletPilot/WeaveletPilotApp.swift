import SwiftUI
import UniformTypeIdentifiers

@main
struct WeaveletPilotApp: App {
    @StateObject private var live = LiveApplicationState()
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-mockup") || Bundle.main.object(forInfoDictionaryKey: "WeaveletLaunchMode") as? String == "ui-mockup" {
                IOSLayoutMockupView()
            } else if ProcessInfo.processInfo.arguments.contains("--ui-connected-preview") || Bundle.main.object(forInfoDictionaryKey: "WeaveletLaunchMode") as? String == "ui-connected-preview" {
                ChatView(state:live.state)
                    .environment(\.horizontalSizeClass,.compact)
                    .preferredColorScheme(ProcessInfo.processInfo.arguments.contains("--ui-preview-light") ? .light : ProcessInfo.processInfo.arguments.contains("--ui-preview-dark") ? .dark : nil)
                    .frame(maxWidth:393,maxHeight:852)
                    .frame(maxWidth:.infinity,maxHeight:.infinity)
            } else {
                ChatView(state: live.state)
            }
            #else
            ChatView(state: live.state)
            #endif
        }
    }
}

// Keep the mock route outside ChatState initialization and all persisted services.
@MainActor private final class LiveApplicationState: ObservableObject {
    lazy var state = ChatState(store: Self.stateStore)
    private static var stateStore: LocalStateStore? {
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil { return nil }
        #if DEBUG
        if RemoteFixture.enabled { return LocalStateStore(fileURL: LocalStateStore.applicationStore.fileURL.deletingLastPathComponent().appendingPathComponent("debug-remote-fixture/local-state.json")) }
        #endif
        return .applicationStore
    }
}

struct ChatView: View {
    @ObservedObject var state: ChatState
    @State private var titleSettingsDraft: ConversationTitleSettingsDraft?
    @State private var defaultConfigDraft: ChatConfigDraft?
    @State private var settingsConfigDraft: ChatConfigDraft?
    @State private var showsSettings = false
    @State private var showsModelInspector = false
    @State private var isModelInspectorClosing = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var showsLibrary = false
    @State private var isLibraryClosing = false
    @State private var afterLibraryDismiss: (() -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var showsLibrarySearch = false
    @State private var showsBranchSearch = false
    @State private var showsRemoteSettings = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var cloudKitConnection: CloudKitSyncConnection?
    @State private var shownCloudKitConnection: CloudKitSyncConnection?
    @State private var folderConnection: FolderSyncConnection?
    @State private var shownFolderConnection: FolderSyncConnection?
    @State private var shownGoogleConnection: GoogleSyncConnection?
    @State private var googleConnection: GoogleSyncConnection?
    @State private var showsImporter = false
    @State private var importPreview: ChatImportPreview?
    @State private var isPreparingImport = false
    @State private var isPreparingRecovery = false
    @State private var pendingPartialImport: (data: Data, filename: String, message: String)?
    @State private var confirmsPartialImport = false
    @State private var showsExporter = false
    @State private var exportScope: ChatExport.Scope?
    @State private var pendingExport: ChatExport.Artifact?
    @State private var exportContentType: UTType = .json
    @State private var exportFilename = "weavelet-native-v3"
    @State private var exportDocument: WebJSONDocument?
    @State private var errorMessage: String?
    @State private var draft: MessageDraft?
    @State private var inlineDraft: MessageDraft?
    @State private var modelDraft: ChatConfigDraft?
    @State private var inlineFocused = false
    @State private var composerFocused = false
    @State private var minimumChatContentHeight: CGFloat?
    @State private var showsConversationSearch = false
    @StateObject private var conversationFind = ConversationFind()
    @GestureState private var splitDragPosition: CGFloat?
    @State private var configDraft: ChatConfigDraft?
    @State private var optionsDraft: NodeOptionsDraft?
    @State private var removalDraft: NodeRemovalDraft?
    @State private var showsRemoval = false
    @State private var branchDeletion: NodeTransformDraft?
    @State private var showsBranchDeletion = false
    @State private var clipboardDraft: BranchClipboardDraft?
    @State private var summaryDraft: ConversationSummaryDraft?
    @State private var evaluationDraft: ConversationEvaluationDraft?
    @State private var composerPromptRequest: PromptPickerRequest?

    private var librarySearchIsVisible: Bool {
        showsLibrarySearch && (horizontalSizeClass == .compact ? showsLibrary : columnVisibility != .detailOnly)
    }
    private var branchSearchIsVisible: Bool {
        showsBranchSearch && (state.chatActiveView == .branchEditor || horizontalSizeClass != .compact &&
            (state.chatActiveView == .splitHorizontal || state.chatActiveView == .splitVertical))
    }
    private var advancedMode: Bool { (try? state.displaySetting(.advancedMode)) != .bool(false) }
    private var openRouterCreditsIdentity: String {
        let chat = (try? state.exchange?.source["chats"]?.array("chats"))?.first { $0["id"] == .string(state.selectedConversationID) }
        let config = chat?["config"]
        let provider = (try? config?["providerId"]?.string("provider")) ?? ""
        let modelSource = (try? config?["modelSource"]?.string("model source")) ?? ""
        let endpoint = (try? state.document?.snapshot["state"]?["providers"]?["openrouter"]?["endpoint"]?.string("endpoint")) ?? ""
        return [state.selectedConversationID,provider,modelSource,endpoint].joined(separator:"\u{0}")
    }
    private var libraryPane: some View {
        ConversationLibraryView(state:state,onSelect:{
            if horizontalSizeClass == .compact { closeLibrary() }
        },onClose:{
            closeLibrary()
        },onExport:{
            presentAfterLibrary { exportScope = .chat }
        },showsSearch:$showsLibrarySearch,footer:{ libraryFooter })
        .navigationSplitViewColumnWidth(min:260,ideal:300,max:380)
    }
    private var detailPane: some View {
        NavigationStack {
            VStack(spacing: 0) {
                conversationBar
                CollapsibleSearchPanel(isPresented:showsConversationSearch && state.chatActiveView != .branchEditor) {
                    ChatSearchView(state:state,initialMode:.nodes,
                        initialScope:state.chatActiveView == .branchEditor ? .all : .activePath,
                        inline:true,close:{ showsConversationSearch = false },reportError:{ errorMessage = $0 },bodyFind:conversationFind) { result, _ in
                        try state.navigate(chatID:result.chatID,nodeID:result.nodeID,source:.search)
                    }
                }
                if let generation = state.generation, !generation.running {
                    Button("生成結果の保存を再試行") {
                        do { try state.saveGenerationResult() } catch { state.generationError = error.localizedDescription }
                    }.buttonStyle(.plain).font(.footnote).frame(minHeight:44)
                }
                activeContent
            }
            .environment(\.conversationFind,conversationFind)
            .task(id:FindInput(query:conversationFind.query,enabled:conversationFind.active,bodies:conversationFindBodies,running:state.generation?.running ?? false,starredOnly:conversationFind.starredOnly,highlightsNodes:conversationFind.highlightsNodes,nodeNavigation:conversationFind.nodeNavigation)) {
                if conversationFind.active && state.generation?.running == true { conversationFind.suspend() }
                else { await conversationFind.search(conversationFindBodies) }
            }
            .navigationTitle((state.conversation.flatMap { $0.title.isEmpty ? nil : $0.title } ?? "Weavelet Pilot") + (RemoteFixture.enabled ? " · FAKE" : ""))
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(horizontalSizeClass == .compact)
            .task {
                guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                do { try state.loadRemoteSettings() } catch { state.generationError = error.localizedDescription }
                Task { await state.refreshOpenRouterCredits(reason:"open") }
                do { try state.recoverOpenRouterVerifications(); state.runOpenRouterVerifications() }
                catch { state.openRouterVerificationError = "使用量の確認状態を復旧できませんでした。保存データを保持しています。" }
                state.runProxyRecovery()
                if cloudKitConnection == nil { cloudKitConnection = CloudKitSyncConnection(state:state) }
                cloudKitConnection?.run { try await cloudKitConnection?.restoreAutomaticSync() }
            }
            .onChange(of:scenePhase) { _, phase in
                if phase == .background { cloudKitConnection?.flushInBackground() }
                else if phase == .active {
                    cloudKitConnection?.resumeOnForeground()
                    if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil {
                        state.runProxyRecovery()
                        state.runOpenRouterVerifications()
                    }
                }
            }
            .onChange(of: openRouterCreditsIdentity) { _, _ in
                guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                Task { await state.refreshOpenRouterCredits(reason:"open") }
            }
            .onChange(of: state.document?.snapshot["state"]?["pendingVerifications"]) { _, _ in
                guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                state.runOpenRouterVerifications()
            }
            .onChange(of: state.generation?.running == true) { wasRunning, isRunning in
                guard wasRunning && !isRunning && ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                Task { await state.refreshOpenRouterCredits(reason:"completed") }
            }
            .toolbar {
                if !isLibraryClosing && (horizontalSizeClass == .compact || columnVisibility == .detailOnly) {
                    ToolbarItem(id:"show-library",placement:.topBarLeading) {
                        Button("会話一覧を表示", systemImage: "sidebar.left") {
                            if horizontalSizeClass == .compact { showsLibrary = true }
                            else { columnVisibility = .all }
                        }
                    }
                }
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button("新規会話", systemImage:"plus") {
                        do { try state.createChat() }
                        catch { errorMessage = error.localizedDescription }
                    }
                    if state.canNavigateBack || state.canNavigateForward {
                    Button("戻る", systemImage: "chevron.backward") {
                        do { try state.moveNavigation(.back) } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canNavigateBack)
                    Button("進む", systemImage: "chevron.forward") {
                        do { try state.moveNavigation(.forward) } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canNavigateForward)
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("検索", systemImage: "magnifyingglass") {
                        if state.chatActiveView == .branchEditor { showsBranchSearch.toggle() }
                        else { showsConversationSearch.toggle() }
                    }
                    .disabled(state.exchange == nil || state.generation != nil)
                    if !showsModelInspector && !isModelInspectorClosing {
                        Button("モデルのプロパティを表示",systemImage:"sidebar.right") {
                            showsModelInspector = true
                        }
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    if inlineDraft == nil && !showsConversationSearch && !librarySearchIsVisible && !branchSearchIsVisible, let conversation = state.conversation {
                        composerAccessories(conversation)
                    }
                    Spacer()
                    Button("キーボードを閉じる", systemImage: "keyboard.chevron.compact.down") {
                        inlineFocused = false
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }.labelStyle(.iconOnly)
                }
            }
            .toolbar(removing:.sidebarToggle)
            .confirmationDialog(removalDraft?.operation == .remove ? "メッセージを削除しますか？" : "非表示の枝を整理しますか？", isPresented: $showsRemoval, titleVisibility: .visible) {
                Button(removalDraft?.operation == .remove ? "削除" : "整理", role: .destructive) {
                    guard let removalDraft else { return }
                    do { try state.saveNodeRemoval(removalDraft); self.removalDraft = nil }
                    catch { errorMessage = error.localizedDescription }
                }
                Button("キャンセル", role: .cancel) { removalDraft = nil }
            } message: {
                Text(removalDraft?.operation == .remove
                     ? "このメッセージ1件を削除します。後続のメッセージは残ります。保護されたメッセージは削除できません。"
                     : "現在表示していない枝を整理します。ピン留めされたメッセージとその子孫、保護されたメッセージは残ります。")
            }
            .confirmationDialog("枝全体を削除しますか？", isPresented: $showsBranchDeletion, titleVisibility: .visible) {
                Button("枝全体を削除", role: .destructive) {
                    guard let branchDeletion else { return }
                    do {
                        let result = try state.saveNodeTransform(branchDeletion)
                        if let explanation = result.explanation { errorMessage = explanation }
                        else { self.branchDeletion = nil }
                    } catch { errorMessage = error.localizedDescription }
                }
                Button("キャンセル", role: .cancel) { branchDeletion = nil }
            } message: {
                Text("このメッセージとすべての子孫を、非表示の枝も含めて削除します。保護されたメッセージが含まれる場合は削除しません。ピン留めは削除を防ぎません。")
            }
            .sheet(item: $draft) { draft in MessageEditorView(state: state, draft: draft) }
            .sheet(item: $clipboardDraft) { draft in BranchClipboardView(state: state, draft: draft) }
            .sheet(item: $configDraft) { draft in ChatConfigView(state:state,draft:draft) }
            .sheet(item: $modelDraft) { initial in ConversationModelPicker(state:state,draft:initial) }
            .sheet(item: $summaryDraft) { draft in ConversationSummaryView(state:state,draft:draft) }
            .sheet(item: $evaluationDraft) { draft in ConversationEvaluationView(state:state,draft:draft) }
            .sheet(item: $optionsDraft) { draft in NodeOptionsView(state: state, draft: draft) }
        }
    }
    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                detailPane.sheet(isPresented:$showsLibrary,onDismiss:{
                    isLibraryClosing = false
                    let action = afterLibraryDismiss
                    afterLibraryDismiss = nil
                    action?()
                }) { libraryPane }
            } else {
                NavigationSplitView(columnVisibility:$columnVisibility) {
                    libraryPane
                } detail: {
                    detailPane
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
        .inspector(isPresented:$showsModelInspector) {
            ConversationModelInspector(state:state,close:closeModelInspector)
            .inspectorColumnWidth(min:240,ideal:300,max:380)
            .presentationDetents([.medium,.large])
            .presentationDragIndicator(.visible)
        }
        .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.json, .gzip, UTType(filenameExtension: "wvlt") ?? .data], allowsMultipleSelection: false) { result in
            do {
                guard let url = try result.get().first else { return }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                prepareImport(data, filename: url.lastPathComponent)
            } catch {
                if (error as? CocoaError)?.code != .userCancelled { errorMessage = error.localizedDescription }
            }
        }
        .fileExporter(isPresented: $showsExporter, document: exportDocument, contentType: exportContentType, defaultFilename: exportFilename) { result in
            if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
                errorMessage = error.localizedDescription
            }
        }
        .alert("データを処理できませんでした", isPresented: Binding(get: { errorMessage != nil || state.persistenceError != nil }, set: { if !$0 { errorMessage = nil; state.persistenceError = nil } })) {
            Button("閉じる", role: .cancel) { errorMessage = nil; state.persistenceError = nil }
        } message: { Text(errorMessage ?? state.persistenceError ?? "") }
        .sheet(item: $exportScope, onDismiss: {
            if let artifact = pendingExport {
                exportDocument = WebJSONDocument(data: artifact.data); exportContentType = artifact.contentType; exportFilename = artifact.filename
                pendingExport = nil; showsExporter = true
            }
        }) { scope in ChatExportView(state: state, initialScope: scope) { pendingExport = $0 } }
        .confirmationDialog("一部のデータを除いて取り込みますか？", isPresented: $confirmsPartialImport, titleVisibility: .visible) {
            Button("取り込める内容を確認する") {
                if let pending = pendingPartialImport {
                    pendingPartialImport = nil
                    prepareImport(pending.data, filename: pending.filename, allowPartialImport: true)
                }
            }
            Button("取消", role: .cancel) { pendingPartialImport = nil }
        } message: { Text(pendingPartialImport?.message ?? "") }
        .sheet(item: $importPreview) { preview in FileImportView(state: state, preview: preview) }
        .overlay { if isPreparingImport { ProgressView("取り込み内容を確認中").padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)) } }
        .sheet(item: $composerPromptRequest) { request in
            PromptPickerView(request: request) { result in
                guard case .command(let applied) = result, case .command(let parts, let text) = request.input else { throw ExchangeError.invalid("入力先がありません") }
                let current = state.composerDraft(chatID: request.chatID)
                try state.validatePromptPicker(request, input: .command(parts: current.parts, text: current.text))
                try state.setComposerPrompt(applied, chatID: request.chatID, expected: ComposerDraft(parts: parts, text: text, hasMeaningfulContent: false))
            }
        }
        .sheet(isPresented: $showsSettings) {
            NavigationStack {
                Form {
                    Section("一般") {
                        NavigationLink("外観と本文の表示") { DisplaySettingsView(state: state) }
                        Picker("チャット表示", selection: $state.style) {
                            ForEach(ChatStyle.allCases) { style in Text(style.rawValue).tag(style) }
                        }
                        .pickerStyle(.inline)
                        NavigationLink("利用量と費用") { UsageCostSettingsView(state:state) }
                        NavigationLink("プロンプトライブラリ") { PromptLibraryView(state:state) }
                    }
                    Section("会話設定") {
                        Button("現在の会話の生成設定") {
                            do { settingsConfigDraft = try state.chatConfigDraft() }
                            catch { state.generationError = error.localizedDescription }
                        }.frame(minHeight: 44).disabled(state.exchange == nil || state.generation != nil)
                        Button("タイトルの自動生成") {
                            do { titleSettingsDraft = try state.titleSettingsDraft() } catch { state.generationError = error.localizedDescription }
                        }.disabled(state.hasGenerations)
                        Button("新規会話の既定設定") {
                            do { defaultConfigDraft = try state.defaultChatConfigDraft() }
                            catch { state.generationError = error.localizedDescription }
                        }.disabled(state.hasGenerations)
                        Button("remote生成設定") { showsRemoteSettings = true }
                            .disabled(state.hasGenerations)
                    }
                    Section("同期・データ") {
                        syncButtons
                    }
                    Section("評価") {
                        NavigationLink("評価設定") { EvaluationSettingsView(state:state) }
                    }
                    Section("ローカルモデル") {
                        NavigationLink("ローカルモデル") { LocalModelSettingsView(state:state) }
                    }
                }
                .sheet(item: $shownGoogleConnection) { connection in
                    GoogleSyncSettingsView(connection: connection)
                }
                .sheet(item: $shownCloudKitConnection) { connection in CloudKitSyncSettingsView(connection:connection) }
                .sheet(item: $shownFolderConnection) { connection in FolderSyncSettingsView(connection:connection) }
                .sheet(item: $titleSettingsDraft) { draft in ConversationTitleSettingsView(state:state,draft:draft) }
                .sheet(item: $defaultConfigDraft) { draft in ChatConfigView(state:state,draft:draft) }
                .sheet(item: $settingsConfigDraft) { draft in ChatConfigView(state:state,draft:draft) }
                .sheet(isPresented: $showsRemoteSettings) { RemoteSettingsView(state: state) }
                .navigationTitle("設定")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完了") { showsSettings = false } } }
            }
        }
        .environment(\.markdownSettings, (try? state.publicationSnapshot().required("state")) ?? .object([]))
        .preferredColorScheme(displayColorScheme)
    }
    private var displayColorScheme: ColorScheme? {
        switch try? state.displaySetting(.theme) {
        case .string("light"): return .light
        case .string("dark"): return .dark
        default: return nil
        }
    }
    private func closeModelInspector() {
        isModelInspectorClosing = true
        withAnimation(completionCriteria:.logicallyComplete) {
            showsModelInspector = false
        } completion: {
            isModelInspectorClosing = false
        }
    }
    private func closeLibrary() {
        isLibraryClosing = true
        if horizontalSizeClass == .compact {
            showsLibrary = false
        } else {
            withAnimation(completionCriteria:.removed) {
                columnVisibility = .detailOnly
            } completion: {
                isLibraryClosing = false
            }
        }
    }
    private func presentAfterLibrary(_ action: @escaping () -> Void) {
        if horizontalSizeClass == .compact && showsLibrary {
            afterLibraryDismiss = action
            closeLibrary()
        } else { action() }
    }
    private var fileMenu: some View {
        Menu("ファイル", systemImage: "doc") {
            Button("ファイルを取り込む") { presentAfterLibrary { showsImporter = true } }
                .disabled(isPreparingImport)
            Button("読み込んだV3 JSONを書き出す") {
                presentAfterLibrary {
                do {
                    exportContentType = .json; exportFilename = "weavelet-native-v3"
                    exportDocument = WebJSONDocument(data: try state.exportWebData())
                    showsExporter = true
                } catch { errorMessage = error.localizedDescription }
                }
            }
            .disabled(state.exchange == nil)
            Button("形式・範囲を指定して書き出す") { presentAfterLibrary { exportScope = .all } }
                .disabled(state.exchange == nil)
            Button("中断した応答を復旧",systemImage:"arrow.clockwise") { state.runProxyRecovery() }
                .disabled(state.isRecoveringStream || state.exchange == nil)
            Button("保存ファイルを復旧用に書き出す",systemImage:"doc.badge.arrow.up") {
                presentAfterLibrary {
                guard !isPreparingRecovery else { return }
                isPreparingRecovery = true
                Task {
                    defer { isPreparingRecovery = false }
                    do {
                        let data = try await state.recoveryExport()
                        exportContentType = .json
                        exportFilename = "weavelet-native-recovery-export"
                        exportDocument = WebJSONDocument(data:data)
                        showsExporter = true
                    } catch { errorMessage = error.localizedDescription }
                }
                }
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .disabled(state.hasGenerations || isPreparingRecovery)
    }
    @ViewBuilder private var syncButtons: some View {
        Button("Google同期") {
            if googleConnection == nil { googleConnection = GoogleSyncConnection(state: state) }
            shownGoogleConnection = googleConnection
        }.disabled(state.hasGenerations)
        Button("CloudKit同期") {
            if cloudKitConnection == nil { cloudKitConnection = CloudKitSyncConnection(state:state) }
            shownCloudKitConnection = cloudKitConnection
        }.disabled(state.hasGenerations)
        Button("フォルダー同期・iCloud Drive") {
            if folderConnection == nil { folderConnection = FolderSyncConnection(state:state) }
            shownFolderConnection = folderConnection
        }.disabled(state.hasGenerations)
    }
    private var libraryFooter: some View {
        HStack {
            Menu("同期", systemImage: "arrow.triangle.2.circlepath") { syncButtons }
                .disabled(state.hasGenerations)
                .frame(minWidth: 44, minHeight: 44)
            Spacer()
            fileMenu
            Spacer()
            Button("設定", systemImage: "slider.horizontal.3") {
                presentAfterLibrary { showsSettings = true }
            }
            .frame(minWidth: 44, minHeight: 44)
        }
        .labelStyle(.iconOnly)
        .sheet(item: Binding(get: { showsSettings ? nil : shownGoogleConnection }, set: { shownGoogleConnection = $0 })) { connection in GoogleSyncSettingsView(connection: connection) }
        .sheet(item: Binding(get: { showsSettings ? nil : shownCloudKitConnection }, set: { shownCloudKitConnection = $0 })) { connection in CloudKitSyncSettingsView(connection:connection) }
        .sheet(item: Binding(get: { showsSettings ? nil : shownFolderConnection }, set: { shownFolderConnection = $0 })) { connection in FolderSyncSettingsView(connection:connection) }
    }
    private var conversationBar: some View {
        let chat = (try? state.exchange?.source["chats"]?.array("chats"))?.first {
            (try? $0["id"]?.string("id"))?.utf8.elementsEqual(state.conversation?.id.utf8 ?? "".utf8) == true
        }
        let config = chat?["config"]
        let configuredModel = (try? config?["model"]?.displayString("model")) ?? ""
        let model = configuredModel.isEmpty ? "モデル未選択" : configuredModel
        let local = config?["modelSource"] == .string("local")
        let openRouter = !local && config?["providerId"] == .string("openrouter")
        return VStack(spacing: 0) {
        HStack(spacing: 8) {
            Menu {
                Button("オンラインモデルを選択") {
                    do { modelDraft = try state.chatConfigDraft() } catch { errorMessage = error.localizedDescription }
                }
                Button("ローカルモデルと生成設定") {
                    do { configDraft = try state.chatConfigDraft() } catch { errorMessage = error.localizedDescription }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: local ? "cpu" : "sparkles")
                    Text(model).lineLimit(1).truncationMode(.middle)
                    Image(systemName: "chevron.down").font(.caption)
                }
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("会話のモデルと生成設定：\(model)")
            .disabled(state.generation != nil)
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                conversationViewButton(.chat, icon: "bubble.left.and.bubble.right")
                conversationViewButton(.branchEditor, icon: "point.3.connected.trianglepath.dotted")
                Menu("表示レイアウト", systemImage: "line.3.horizontal") {
                    Toggle("吹き出し表示", isOn: Binding(get: { state.style == .bubbles },
                        set: { state.style = $0 ? .bubbles : .stream }))
                        .disabled(state.generation != nil)
                    Divider()
                    ForEach(ChatActiveView.allCases) { mode in
                        Button(mode.title, systemImage: state.chatActiveView == mode ? "checkmark" : "rectangle.split.2x1") {
                            do { try state.setChatActiveView(mode) } catch { errorMessage = error.localizedDescription }
                        }
                    }
                    if state.chatActiveView == .splitHorizontal || state.chatActiveView == .splitVertical {
                        Toggle("チャットから分岐図へ連動",isOn:$state.branchEditorSyncEnabled)
                        Toggle("表示を入れ替え", isOn: Binding(get: { splitSwapped }, set: { swapped in
                            do { try state.saveDisplaySetting(.splitPanelSwapped,value:.bool(swapped)) }
                            catch { errorMessage = error.localizedDescription }
                        }))
                        Button("分割を均等に戻す",systemImage:"rectangle.split.2x1") { saveSplitRatio(0.5) }
                    }
                    Divider()
                    Button("編集を元に戻す",systemImage:"arrow.uturn.backward") {
                        do { try state.undoMessageEdit() } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canUndoMessageEdit)
                    Button("編集をやり直す",systemImage:"arrow.uturn.forward") {
                        do { try state.redoMessageEdit() } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canRedoMessageEdit)
                    if advancedMode {
                        Button("本文を追加",systemImage:"plus.bubble") {
                            do { draft = try state.messageDraft(nodeID:nil) } catch { errorMessage = error.localizedDescription }
                        }.disabled(state.generation != nil)
                    }
                    Button("非表示の枝を整理",systemImage:"line.3.horizontal.decrease") {
                        do { removalDraft = try state.pruneHiddenDraft(); showsRemoval = true } catch { errorMessage = error.localizedDescription }
                    }.disabled(state.generation != nil)
                    Divider()
                    fileMenu.disabled(state.generation != nil)
                    Button("設定",systemImage:"slider.horizontal.3") { showsSettings = true }.disabled(state.generation != nil)

                }
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
            }
        }
        .buttonStyle(.plain)
        .font(.subheadline)
        .padding(.horizontal, horizontalSizeClass == .compact ? 12 : 20)
        .disabled(state.exchange == nil)
        if openRouter {
            HStack(spacing: 6) {
                Text("OpenRouter残高").font(.caption).foregroundStyle(.secondary)
                if let display = state.openRouterCreditDisplay {
                    Text(display).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        .accessibilityLabel("OpenRouter残高 " + display)
                } else if state.openRouterCreditsFetching {
                    ProgressView().controlSize(.mini).accessibilityLabel("OpenRouter残高を取得中")
                } else if let message = state.openRouterCreditsError {
                    Text(message).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Button("残高を更新",systemImage:"arrow.clockwise") {
                    Task { await state.refreshOpenRouterCredits(reason:"manual") }
                }.labelStyle(.iconOnly).frame(minWidth:44,minHeight:44)
                    .disabled(state.openRouterCreditsFetching)
            }
            .padding(.horizontal, horizontalSizeClass == .compact ? 12 : 20)
        }
        }
        .background(Color(uiColor: .secondarySystemBackground))
        .overlay(alignment: .bottom) { Divider() }
    }
    private func conversationViewButton(_ mode: ChatActiveView, icon: String) -> some View {
        Button {
            do { try state.setChatActiveView(mode) } catch { errorMessage = error.localizedDescription }
        } label: {
            Image(systemName: icon)
                .frame(width: 44, height: 44)
                .overlay(alignment:.bottom) { if state.chatActiveView == mode { Rectangle().fill(Color.accentColor).frame(height:2) } }
        }
        .foregroundStyle(state.chatActiveView == mode ? Color.accentColor : .secondary)
        .accessibilityLabel(mode.title)
        .accessibilityAddTraits(state.chatActiveView == mode ? .isSelected : [])
    }
    @ViewBuilder private var activeContent: some View {
            Group {
                switch state.chatActiveView {
                case .chat: chatContent
                case .branchEditor: branchEditor
                case .splitHorizontal:
                    if horizontalSizeClass == .compact {
                        chatContent
                    } else {
                    GeometryReader { geometry in
                        if geometry.size.width >= 700 {
                            splitContent(horizontal: true)
                        } else {
                            splitContent(horizontal: false)
                        }
                    }
                    }
                case .splitVertical:
                    if horizontalSizeClass == .compact {
                        chatContent
                    } else {
                    splitContent(horizontal: false)
                    }
                }
            }
    }
    private var splitRatio: Double {
        let value = try? state.displaySetting(.splitPanelRatio).number("split ratio")
        return value.flatMap { $0.isFinite ? $0 : nil } ?? 0.5
    }
    private var splitSwapped: Bool {
        (try? state.displaySetting(.splitPanelSwapped).boolean("split order")) ?? false
    }
    private func saveSplitRatio(_ ratio: Double) {
        do { try state.saveSplitPanelRatio(ratio) }
        catch { errorMessage = error.localizedDescription }
    }
    private func splitContent(horizontal: Bool) -> some View {
        GeometryReader { geometry in
            let divider: CGFloat = 12
            let extent = max(0, (horizontal ? geometry.size.width : geometry.size.height) - divider)
            // Pane minima are a native layout constraint, independent of the saved Web ratio.
            let minimum = min(horizontal ? 240.0 : 160.0, extent / 2)
            let first = min(max(splitDragPosition ?? extent * splitRatio, minimum), extent - minimum)
            let chatExtent = splitSwapped ? extent - first : first
            let graphExtent = splitSwapped ? first : extent - first
            ZStack(alignment: .topLeading) {
                chatContent
                    .frame(width: horizontal ? chatExtent : geometry.size.width,
                           height: horizontal ? geometry.size.height : chatExtent)
                    .offset(x: horizontal && splitSwapped ? first + divider : 0,
                            y: !horizontal && splitSwapped ? first + divider : 0)
                branchEditor
                    .frame(width: horizontal ? graphExtent : geometry.size.width,
                           height: horizontal ? geometry.size.height : graphExtent)
                    .offset(x: horizontal && !splitSwapped ? first + divider : 0,
                            y: !horizontal && !splitSwapped ? first + divider : 0)
                Rectangle().fill(Color(uiColor:.secondarySystemBackground))
                    .overlay {
                        Capsule().fill(Color(uiColor:.separator))
                            .frame(width: horizontal ? 3 : 32, height: horizontal ? 32 : 3)
                    }
                    .frame(width: horizontal ? divider : geometry.size.width,
                           height: horizontal ? geometry.size.height : divider)
                    .contentShape(Rectangle())
                    .offset(x: horizontal ? first : 0, y: horizontal ? 0 : first)
                    .gesture(DragGesture(minimumDistance:0,coordinateSpace:.named("conversation-split"))
                        .updating($splitDragPosition) { value, position, _ in
                            guard extent > 0 else { return }
                            let raw = (horizontal ? value.location.x : value.location.y) - divider / 2
                            if let ratio = try? DisplaySettings.clampedSplitPanelRatio(raw / extent).number("split ratio") {
                                position = extent * ratio
                            }
                        }
                        .onEnded { value in
                            guard extent > 0 else { return }
                            let position = (horizontal ? value.location.x : value.location.y) - divider / 2
                            saveSplitRatio(min(max(position,minimum),extent - minimum) / extent)
                        })
                    .onTapGesture(count:2) { saveSplitRatio(0.5) }
                    .accessibilityElement()
                    .accessibilityLabel("分割位置")
                    .accessibilityValue("先頭の表示領域 \(Int((extent > 0 ? first / extent : 0.5) * 100))パーセント")
                    .accessibilityAdjustableAction { direction in
                        switch direction {
                        case .increment: saveSplitRatio(splitRatio + 0.05)
                        case .decrement: saveSplitRatio(splitRatio - 0.05)
                        @unknown default: break
                        }
                    }
            }
            .frame(width:geometry.size.width,height:geometry.size.height,alignment:.topLeading)
            .coordinateSpace(name:"conversation-split")
            .clipped()
        }
    }
    private var branchEditor: some View {
        BranchEditorView(state: state, showsSearch:$showsBranchSearch, configure: configureNode, deleteBranch: deleteNodeBranch, clipboard: { openBranchClipboard($0, operation:$1, throughLeaf:true) })
    }

    private func configureNode(_ nodeID: String) {
        do { optionsDraft = try state.nodeOptionsDraft(nodeID: nodeID) }
        catch { errorMessage = error.localizedDescription }
    }

    private func deleteNodeBranch(_ nodeID: String) {
        do { branchDeletion = try state.branchDeletionDraft(nodeID: nodeID); showsBranchDeletion = true }
        catch { errorMessage = error.localizedDescription }
    }

    private func openBranchClipboard(_ nodeID: String, operation: BranchClipboardOperation, throughLeaf: Bool = false) {
        do { clipboardDraft = try state.branchClipboardDraft(nodeID: nodeID, operation: operation, throughLeaf:throughLeaf) }
        catch { errorMessage = error.localizedDescription }
    }
    private func inlineTargetIsDisplayed(_ pending: MessageDraft, in conversation: Conversation) -> Bool {
        guard conversation.id.utf8.elementsEqual(pending.chatID.utf8),
              let messages = try? DisplaySettings.messagesForDisplay(conversation.visibleMessages,advancedMode:advancedMode) else { return false }
        return messages.contains { node in
            guard node.id.utf8.elementsEqual(pending.nodeID?.utf8 ?? "".utf8) else { return false }
            return (try? state.summaryInfo(chatID:conversation.id,nodeID:node.id))?["hidden"] != .bool(true)
        }
    }
    private var conversationFindBodies: [ConversationFindBody] {
        guard conversationFind.active, !conversationFind.query.isEmpty else { return [] }
        guard let conversation = state.conversation,
              let nodes = try? DisplaySettings.messagesForDisplay(conversation.visibleMessages,advancedMode:advancedMode) else { return [] }
        let inlineLatex = (try? state.displaySetting(.inlineLatex)) != .bool(false)
        let defaultRendered = MarkdownTextView.defaultRendered(settings:(try? state.publicationSnapshot().required("state")) ?? .object([]))
        return nodes.flatMap { node -> [ConversationFindBody] in
            let summary = try? state.summaryInfo(chatID:conversation.id,nodeID:node.id)
            guard (conversationFind.highlightsNodes || !conversationFind.starredOnly || node.options.starred), summary?["hidden"] != .bool(true), inlineDraft?.targets(chatID:conversation.id,nodeID:node.id) != true else { return [] }
            let rendered = conversationFind.modes[ConversationFindBody.key(node.id,"mode",context:conversation.identity)] ?? defaultRendered
            return MessageBodyItem.items(node:node,summaryInfo:summary,generation:generation(at:node,in:conversation),context:conversation.identity).compactMap { $0.findBody(rendered:rendered && !conversationFind.rawFallbacks.contains($0.id),inlineLatex:inlineLatex) }
        }
    }
    private struct FindInput: Equatable {
        let query: String
        let enabled: Bool
        let bodies: [ConversationFindBody]
        let running: Bool
        let starredOnly: Bool
        let highlightsNodes: Bool
        let nodeNavigation: UUID
        static func == (a:Self,b:Self) -> Bool { a.query.utf8.elementsEqual(b.query.utf8) && a.enabled == b.enabled && a.bodies == b.bodies && a.running == b.running && a.starredOnly == b.starredOnly && a.highlightsNodes == b.highlightsNodes && a.nodeNavigation == b.nodeNavigation }
    }
    private var chatScrollIDs: [Data] {
        guard let conversation = state.conversation,
              let nodes = try? DisplaySettings.messagesForDisplay(conversation.visibleMessages,advancedMode:advancedMode) else { return [] }
        return nodes.filter { (try? state.summaryInfo(chatID:conversation.id,nodeID:$0.id))?["hidden"] != .bool(true) }.map(\.identity)
    }
    private var chatContent: some View {
            GeometryReader { viewport in
            ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Color.clear.frame(height:0).id("connected-top")
                    if let conversation = state.conversation {
                        switch Result(catching: { try DisplaySettings.messagesForDisplay(conversation.visibleMessages, advancedMode: advancedMode) }) {
                        case .success(let messages):
                        ForEach(messages, id: \.identity) { node in
                            let summaryInfo = try? state.summaryInfo(chatID:conversation.id,nodeID:node.id)
                            let generation = generation(at:node, in:conversation)
                            if summaryInfo?["hidden"] != .bool(true) {
                                messageRow(node:node,conversation:conversation,summaryInfo:summaryInfo,generation:generation)
                                    .id(node.identity)
                                    .chatScrollMarker(.message(node.identity))
                                    .disabled(state.generation != nil)
                                if state.isLocalConversation && node.role == "user" && !node.options.collapsed {
                                    prefillInput(key:state.assistantPrefillKey(nodeID:node.id))
                                }
                            }
                        }
                        case .failure(let error): Text(error.localizedDescription).foregroundStyle(.red)
                        }
                        if let generationError = state.generationError { Text(generationError).foregroundStyle(.red) }
                        if state.canRetryFailedGeneration {
                            Button("生成を再試行",systemImage:"arrow.clockwise") {
                                do { try state.retryFailedGeneration() } catch { errorMessage = error.localizedDescription }
                            }.buttonStyle(.plain).foregroundStyle(Color(uiColor:.label)).frame(minHeight:44)
                        }
                        if let recoveryError = state.streamRecoveryError { Text(recoveryError).font(.footnote).foregroundStyle(.red) }
                        if state.isRecoveringStream {
                            HStack {
                                ProgressView("応答を復旧中")
                                Button("復旧を停止") { state.cancelProxyRecovery() }.frame(minHeight:44)
                            }
                        }
                        if let automaticEvaluationError = state.automaticEvaluationError { Text(automaticEvaluationError).foregroundStyle(.red) }
                        if let titleError = state.titleError { Text(titleError).foregroundStyle(.red) }
                        if let pending = inlineDraft, !inlineTargetIsDisplayed(pending,in:conversation) {
                            Text("表示対象が変わりました。編集中の本文を保持しています。").font(.footnote).foregroundStyle(.secondary)
                            inlineEditor(pending).padding(16).id("inline-recovery")
                        }
                        if state.exchange != nil {
                            composer(conversation).id("connected-composer").chatScrollMarker(.composer)
                        }

                    } else {
                        ContentUnavailableView("会話がありません", systemImage: "bubble.left.and.bubble.right")
                    }
                }
                .frame(maxWidth: horizontalSizeClass == .compact ? .infinity : 900)
                .frame(maxWidth: .infinity)
                .frame(minHeight: minimumChatContentHeight, alignment: .top)
                .chatScrollMarker(.content)
                .chatScrollMarker(.context(state.conversation?.identity ?? Data()))
            }
            .modifier(ChatScrollControls(state:state,scroll:scroll,ids:chatScrollIDs,viewportHeight:viewport.size.height,isEditing:inlineDraft != nil || composerFocused,minimumContentHeight:$minimumChatContentHeight,reportError:{ errorMessage = $0.localizedDescription }))
            .environment(\.messageViewport,viewport.frame(in:.global))
            .background(Color(uiColor:.secondarySystemBackground))
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: viewport.size.height) { _, _ in
                if inlineFocused, let pending = inlineDraft {
                    if let conversation = state.conversation, inlineTargetIsDisplayed(pending,in:conversation) {
                        if let nodeID = pending.nodeID { scroll.scrollTo(Data(nodeID.utf8),anchor:.center) }
                    } else { scroll.scrollTo("inline-recovery",anchor:.bottom) }
                } else if composerFocused { scroll.scrollTo("connected-composer",anchor:.bottom) }
            }
            .modifier(ConversationFindScrolling(find:conversationFind,scroll:scroll,viewportHeight:viewport.size.height))
            .onChange(of: state.navigationFocus) { _, focus in
                if let focus {
                    if !reduceMotion && (try? state.displaySetting(.animateBubbleNavigation)) == .bool(true) {
                        withAnimation { scroll.scrollTo(Data(focus.nodeID.utf8), anchor: .center) }
                    } else { scroll.scrollTo(Data(focus.nodeID.utf8), anchor: .center) }
                }
            }
            .onAppear {
                if let focus = state.navigationFocus { scroll.scrollTo(Data(focus.nodeID.utf8), anchor: .center) }
            }
            }
            }

    }
    private func composer(_ conversation: Conversation) -> some View {
        let roleName = state.inputRole == "assistant" ? "アシスタント" : "ユーザー"
        let roleIcon = state.inputRole == "assistant" ? "sparkles" : "person.fill"
        return VStack(alignment:.leading,spacing:4) {
            if advancedMode {
                Menu {
                    Button("ユーザー", systemImage: "person.fill") {
                        do { try state.setInputRole("user") } catch { state.generationError = error.localizedDescription }
                    }
                    Button("アシスタント", systemImage: "sparkles") {
                        do { try state.setInputRole("assistant") } catch { state.generationError = error.localizedDescription }
                    }
                } label: {
                    Label(roleName, systemImage: roleIcon)
                    Image(systemName: "chevron.down").font(.caption)
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("入力の役割：\(roleName)")
                .disabled(state.generation != nil)
            } else {
                Label(roleName, systemImage: roleIcon)
                    .accessibilityLabel("入力の役割：\(roleName)")
            }
            MessageInputView(text: Binding(
                get: { state.composerDraft(chatID: conversation.id).text },
                set: { state.setComposerText(chatID: conversation.id, text: $0) }),
                label: "送信する本文", enabled: state.generation == nil, sticky: true,
                focused: $composerFocused,
                enterToSubmit: { try state.displaySetting(.enterToSubmit) == .bool(true) },
                submit: { _ in
                    guard state.conversation?.identity == conversation.identity, state.generation == nil, !state.isRecoveringStream else { return }
                    do { try state.sendComposer() }
                    catch { state.generationError = error.localizedDescription }
                }, failure: { state.generationError = $0.localizedDescription })
                .id(conversation.identity)
                .background(Color(uiColor:.tertiarySystemBackground),in:RoundedRectangle(cornerRadius:10))
                .overlay(alignment: .topLeading) {
                    if state.composerDraft(chatID: conversation.id).text.isEmpty {
                        Text("送信する本文").foregroundStyle(.secondary).padding(.horizontal, 10).padding(.vertical, 10).allowsHitTesting(false)
                    }
                }
            HStack(alignment:.bottom,spacing:8) {
                composerAccessories(conversation)
                if advancedMode {
                Button {
                    do { configDraft = try state.chatConfigDraft() }
                    catch { errorMessage = error.localizedDescription }
                } label: { Image(systemName:"slider.horizontal.3").frame(width:44,height:44) }
                .accessibilityLabel("会話の生成設定")
                .disabled(state.generation != nil)
                }
                Spacer(minLength:0)
                if state.generation?.running == true {
                    Button("停止",systemImage:"stop.fill") { state.stopGeneration() }
                        .frame(minWidth:44,minHeight:44)
                } else {
                    Button {
                        do { try state.sendComposer() }
                        catch { state.generationError = error.localizedDescription }
                    } label: { Image(systemName:"arrow.up.circle.fill").font(.title3).frame(width:44,height:44) }
                    .accessibilityLabel("送信")
                    .foregroundStyle(Color.accentColor)
                    .frame(minWidth:44,minHeight:44)
                    .disabled(state.generation != nil || state.hasRunningLocalGeneration || state.isRecoveringStream)
                }
            }
            if let parts = try? state.composerDraft(chatID:conversation.id).parts.array("composer parts") {
                let images = Array(parts.enumerated()).filter { $0.element["type"] == .string("image_url") }
                if !images.isEmpty {
                ScrollView(.horizontal) {
                    HStack(alignment:.top) {
                        ForEach(images,id:\.offset) { index, part in
                            if case .string("image_url") = part["type"],
                               case .string(let url) = part["image_url"]?["url"],
                               case .string(let detail) = part["image_url"]?["detail"] {
                                VStack(alignment:.leading) {
                                    AttachmentImageView(url:url,detail:detail)
                                        .frame(width:100,height:80)
                                    Button("入力画像を取り消す",systemImage:"xmark.circle") {
                                        do { try state.removeComposerPart(chatID:conversation.id,index:index) }
                                        catch { state.generationError = error.localizedDescription }
                                    }
                                    .disabled(state.generation != nil)
                                }
                            }
                        }
                    }
                }
                .frame(maxHeight:120)
                }
            }
            if state.isLocalConversation { prefillInput(key:state.stickyPrefillKey) }
        }
        .padding(.vertical,12)
        .padding(.horizontal,state.style == .bubbles ? 12 : 0)
        .overlay(alignment:.top) { Divider() }
        .padding(.leading,state.style == .bubbles ? 0 : 44)
        .padding(.horizontal,16).padding(.vertical,8)
        .frame(maxWidth:900)
        .frame(maxWidth:.infinity)
        .buttonStyle(.plain)
    }
    @ViewBuilder private func composerAccessories(_ conversation: Conversation) -> some View {
        if let detail = try? state.composerImageDetail(chatID:conversation.id) {
            ImageInputView(destinationID:conversation.id) { chatID, urls in
                do { try state.addComposerImages(chatID:chatID,urls:urls,detail:detail) }
                catch { state.generationError = error.localizedDescription }
            }
            .disabled(state.generation != nil)
        }
        Button {
            do {
                let input = state.composerDraft(chatID: conversation.id)
                composerPromptRequest = try state.promptPickerRequest(.command(parts: input.parts, text: input.text))
            } catch { errorMessage = error.localizedDescription }
        } label: { Text("/").frame(width: 44, height: 44) }
        .accessibilityLabel("プロンプトライブラリ")
        .disabled(state.generation != nil)
    }
    private func prefillInput(key: String) -> some View {
        DisclosureGroup("アシスタントの先頭文") {
            TextField("応答の書き出し",text:Binding(
                get:{ state.assistantPrefill(key:key) },
                set:{ state.setAssistantPrefill(key:key,text:$0) }),axis:.vertical)
                .lineLimit(2...6).textFieldStyle(.roundedBorder)
            Text("端末内の生成で使う一時入力です。生成中に変更した内容は次回用に残ります。")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func prepareImport(_ data: Data, filename: String, allowPartialImport: Bool = false) {
        isPreparingImport = true
        Task {
            defer { isPreparingImport = false }
            do { importPreview = try await state.prepareImport(data: data, filename: filename, allowPartialImport: allowPartialImport) }
            catch let decision as ChatImportDecisionRequired {
                pendingPartialImport = (data, filename, decision.message)
                confirmsPartialImport = true
            }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func generation(at node: MessageNode, in conversation: Conversation) -> ActiveGeneration? {
        state.generation(for:conversation.id,nodeID:node.id)
    }

    private var branchSwipePreference: String? {
        guard let value = try? state.displaySetting(.branchSwipeDirection), DisplaySetting.branchSwipeDirection.accepts(value) else { return nil }
        return try? value.string("branch swipe direction")
    }
    private func messageRow(node: MessageNode, conversation: Conversation, summaryInfo: OrderedJSON?, generation: ActiveGeneration?) -> some View {
        let stream = node.role == "assistant" && generation?.running != true && summaryInfo?["tab"] != .string("readable") && summaryInfo?["tab"] != .string("compact")
            ? try? state.streamStatus(chatID:conversation.id,nodeID:node.id) : nil
        let recovery = stream?["canRecover"] == .bool(true)
            ? try? state.streamRecoveryRecord(chatID:conversation.id,nodeID:node.id,requestID:stream?["requestId"]) : nil
        let summarySelection: ((String,Bool) -> Void)? = state.exchange == nil || state.generation != nil ? nil : { id, use in
            do { try state.mutateSummary(chatID:conversation.id,action:"use",summaryID:id,use:use) }
            catch { errorMessage = error.localizedDescription }
        }
        let editor: AnyView? = inlineDraft.flatMap { pending in
            guard pending.targets(chatID:conversation.id,nodeID:node.id) else { return nil }
            return AnyView(inlineEditor(pending))
        }
        return MessageView(node: node, siblings: state.siblings(for: node.id), style: state.style, advancedMode: advancedMode, branchSwipeDirection: branchSwipePreference, branchSwipeContext: Data(conversation.id.utf8), generation: generation, streamStatus:stream, recoverStream:recovery.flatMap { record in
            guard let id = try? record.required("proxySessionId").string("session") else { return nil }
            return {
                Task { @MainActor in
                    do { try await state.recoverProxyStreams(sessionID:id) }
                    catch { errorMessage = error.localizedDescription }
                }
            }
        }, recoveringStream:state.isRecoveringStream, inlineEditor: editor, focusBranchEditor: horizontalSizeClass != .compact && state.branchEditorSyncEnabled && (state.chatActiveView == .splitHorizontal || state.chatActiveView == .splitVertical) ? {
            do { try state.focusBranchEditor(nodeID:node.id) } catch { errorMessage = error.localizedDescription }
        } : nil, edit: state.exchange == nil ? nil : {
            do { if inlineDraft == nil { inlineDraft = try state.messageDraft(nodeID: node.id) } }
            catch { errorMessage = error.localizedDescription }
        }, insertBefore: !advancedMode || state.exchange == nil ? nil : {
            do { draft = try state.messageInsertionDraft(beforeNodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, regenerate: state.exchange == nil ? nil : {
            generate(node.id, operation: .regenerate)
        }, generateFromHere: state.exchange == nil ? nil : {
            generate(node.id, operation: .fromHere)
        }, remove: state.exchange == nil ? nil : {
            do { removalDraft = try state.nodeRemovalDraft(nodeID: node.id); showsRemoval = true }
            catch { errorMessage = error.localizedDescription }
        }, moveUp: state.exchange == nil ? nil : {
            move(node.id, direction: .up)
        }, moveDown: state.exchange == nil ? nil : {
            move(node.id, direction: .down)
        }, replaceAndPrune: state.exchange == nil ? nil : {
            do { draft = try state.messageReplacementDraft(nodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, deleteBranch: state.exchange == nil ? nil : {
            deleteNodeBranch(node.id)
        }, copyRange: state.exchange == nil ? nil : {
            openBranchClipboard(node.id, operation: .copy)
        }, pasteRange: state.exchange == nil || !state.hasBranchClipboard ? nil : {
            openBranchClipboard(node.id, operation: .paste)
        }, configure: state.exchange == nil ? nil : {
            configureNode(node.id)
        }, showsCollapseControl: state.exchange != nil, toggleCollapse: state.exchange == nil ? nil : {
            do {
                var changed = try state.nodeOptionsDraft(nodeID: node.id)
                changed.value.collapsed.toggle()
                try state.saveNodeOptions(changed)
            } catch { errorMessage = error.localizedDescription }
        }, openEvaluation: state.exchange == nil ? nil : {
            do { evaluationDraft = try state.evaluationDraft(nodeID:node.id) }
            catch { errorMessage = error.localizedDescription }
        }, toggleOmitted: state.exchange == nil ? nil : {
            do {
                var changed = try state.nodeOptionsDraft(nodeID:node.id)
                changed.value.omitted.toggle()
                try state.saveNodeOptions(changed)
            } catch { errorMessage = error.localizedDescription }
        }, toggleProtected: state.exchange == nil ? nil : {
            do {
                var changed = try state.nodeOptionsDraft(nodeID:node.id)
                changed.value.protected.toggle()
                try state.saveNodeOptions(changed)
            } catch { errorMessage = error.localizedDescription }
        }, summaryInfo: summaryInfo, openSummary: state.exchange == nil ? nil : {
            do { summaryDraft = try state.summaryDraft(nodeID:node.id) }
            catch { errorMessage = error.localizedDescription }
        }, selectSummary: summarySelection) { siblingID in
            state.selectSibling(siblingID, of: node.id)
        }
    }

    private func inlineEditor(_ seed: MessageDraft) -> some View {
        let text = Binding(get: { inlineDraft?.text ?? seed.text }, set: { inlineDraft?.text = $0 })
        let selected = state.selectedConversationID.utf8.elementsEqual(seed.chatID.utf8)
        let canOverwrite = selected && !seed.isProtected && inlineDraft?.changed == true
        return VStack(alignment: .leading, spacing: 6) {
            MessageInputView(text:text,label:"本文を編集",enabled:state.generation == nil,sticky:false,
                maximumLines:10,fillsAvailableHeight:true,textInsets:UIEdgeInsets(top:12,left:7,bottom:12,right:7),focused:$inlineFocused,
                enterToSubmit:{ try state.displaySetting(.enterToSubmit) == .bool(true) },
                submit:{ action in
                    if action == .save { saveInline(.overwrite) }
                    else {
                        guard let pending = inlineDraft else { return }
                        do {
                            guard state.selectedConversationID.utf8.elementsEqual(pending.chatID.utf8) else { throw ExchangeError.invalid("編集中の会話を選択してください") }
                            inlineDraft = try state.saveMessageForGeneration(pending)
                            guard let nodeID = inlineDraft?.nodeID else { throw ExchangeError.invalid("生成先がありません") }
                            try state.startGeneration(state.messageGenerationDraft(nodeID:nodeID,operation:.append))
                            inlineFocused = false; inlineDraft = nil
                        } catch { errorMessage = error.localizedDescription }
                    }
                },failure:{ errorMessage = $0.localizedDescription })
                .frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.leading)
                .background(Color(uiColor:.tertiarySystemBackground),in:RoundedRectangle(cornerRadius:12))
                .overlay(RoundedRectangle(cornerRadius:12).stroke(inlineFocused ? Color.accentColor : Color(uiColor:.separator)))
                .accessibilityLabel("本文を編集")
                .onAppear { inlineFocused = true }
            if seed.isProtected { Text("保護中です。分岐として保存できます。").font(.footnote).foregroundStyle(.secondary) }
            Color.clear.frame(height:44)

        }
        .overlay {
            FloatingMessageActions {
            HStack(spacing: 8) {
                Button { inlineFocused = false; inlineDraft = nil } label: {
                    Text("取消").frame(minWidth:44,minHeight:44,alignment:.leading).contentShape(Rectangle())
                }
                Menu {
                    Button("役割・プロンプト・生成の詳細") {
                        guard let pending = inlineDraft else { return }
                        inlineFocused = false; draft = pending; inlineDraft = nil
                    }.disabled(!selected)
                } label: { Image(systemName:"ellipsis").frame(width:44,height:44) }
                    .accessibilityLabel("編集の詳細")
                Spacer(minLength:0)
                Button { saveInline(.branch) } label: {
                    Text("分岐保存").frame(minWidth:44,minHeight:44).contentShape(Rectangle())
                }.disabled(!selected)
                Button { saveInline(.overwrite) } label: {
                    Text("保存").padding(.horizontal,14).frame(minWidth:44,minHeight:44)
                        .foregroundStyle(canOverwrite ? Color.white : Color(uiColor:.secondaryLabel))
                        .background(canOverwrite ? Color.accentColor : Color(uiColor:.tertiarySystemFill),in:RoundedRectangle(cornerRadius:8))
                }.disabled(!canOverwrite)
            }.buttonStyle(.plain).font(.subheadline)
                .padding(.horizontal,6)
                .background(.regularMaterial,in:RoundedRectangle(cornerRadius:16))
            }
        }
        .disabled(state.generation != nil)
    }

    private func saveInline(_ mode: MessageSaveMode) {
        guard let pending = inlineDraft else { return }
        do {
            guard state.selectedConversationID.utf8.elementsEqual(pending.chatID.utf8) else {
                throw ExchangeError.invalid("編集中の会話を選択してください。本文は保持しています")
            }
            try state.saveMessage(pending,mode:mode)
            inlineFocused = false; inlineDraft = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private func generate(_ nodeID: String, operation: MessageGenerationOperation) {
        do {
            let draft = try state.messageGenerationDraft(nodeID:nodeID,operation:operation)
            try state.startGeneration(draft)
        } catch { errorMessage = error.localizedDescription }
    }

    private func move(_ nodeID: String, direction: NodeMoveDirection) {
        do {
            let result = try state.saveNodeTransform(state.nodeMoveDraft(nodeID: nodeID, direction: direction))
            if let explanation = result.explanation { errorMessage = explanation }
            else if result.status == "unchanged" { errorMessage = "位置を変更しませんでした。上下の端や、先頭のシステムメッセージとの交換では移動できません。" }
        } catch { errorMessage = error.localizedDescription }
    }

}

private struct ConversationModelPicker: View {
    @ObservedObject var state: ChatState
    @State var draft: ChatConfigDraft
    var body: some View {
        ProviderModelsView(state:state,draft:$draft) { row in
            var selected = draft
            selected.config = try ChatConfig.switched(selected.config,model:row.modelID,providerID:row.providerID,modelState:selected.modelState)
            try state.saveChatConfig(selected)
        }
    }
}

struct MessageView: View {
    let node: MessageNode
    let siblings: [MessageNode]
    let style: ChatStyle
    var advancedMode = true
    var branchSwipeDirection: String? = nil
    var branchSwipeContext: Data? = nil
    var generation: ActiveGeneration? = nil
    var streamStatus: OrderedJSON? = nil
    var recoverStream: (() -> Void)? = nil
    var recoveringStream = false
    var inlineEditor: AnyView? = nil
    var focusBranchEditor: (() -> Void)? = nil
    var edit: (() -> Void)? = nil
    var insertBefore: (() -> Void)? = nil
    var regenerate: (() -> Void)? = nil
    var generateFromHere: (() -> Void)? = nil
    var remove: (() -> Void)? = nil
    var moveUp: (() -> Void)? = nil
    var moveDown: (() -> Void)? = nil
    var replaceAndPrune: (() -> Void)? = nil
    var deleteBranch: (() -> Void)? = nil
    var copyRange: (() -> Void)? = nil
    var pasteRange: (() -> Void)? = nil
    var configure: (() -> Void)? = nil
    var showsCollapseControl = false
    var toggleCollapse: (() -> Void)? = nil
    var openEvaluation: (() -> Void)? = nil
    var toggleOmitted: (() -> Void)? = nil
    var toggleProtected: (() -> Void)? = nil
    var summaryInfo: OrderedJSON? = nil
    var openSummary: (() -> Void)? = nil
    var selectSummary: ((String,Bool) -> Void)? = nil
    let select: (String) -> Void
    private var streamStatusColor: Color {
        switch streamStatus?["tone"] {
        case .string("success"): return .green
        case .string("warning"): return .orange
        case .string("error"): return .red
        case .string("info"): return .blue
        default: return .secondary
        }
    }
    @Environment(\.isEnabled) private var isEnabled
    @GestureState private var swipeActive = false
    @State private var swipeSource: [Data]?
    @State private var swipeRejected = false
    @State private var swipePreference: String?
    @Environment(\.markdownSettings) private var markdownSettings
    @Environment(\.conversationFind) private var conversationFind
    @State private var markdownMode: Bool?
    @State private var markdownRevision = 0

    private var roleName: String {
        switch node.role {
        case "user": return "ユーザー"
        case "system": return "システム"
        default: return "アシスタント"
        }
    }

    private var icon: String {
        switch node.role {
        case "user": return "person.crop.circle"
        case "system": return "gearshape"
        default: return "sparkles"
        }
    }

    private var hasMessageOperations: Bool {
        edit != nil || insertBefore != nil || regenerate != nil || generateFromHere != nil || remove != nil || configure != nil || moveUp != nil || moveDown != nil || replaceAndPrune != nil || deleteBranch != nil || copyRange != nil || pasteRange != nil
    }

    @ViewBuilder private var messageOperations: some View {
        if hasMessageOperations {
            HStack(spacing:0) {
                if let focusBranchEditor {
                    Button(action:focusBranchEditor) { Image(systemName:"scope").frame(width:44,height:44) }
                        .accessibilityLabel("分岐図で表示")
                }
                if let edit {
                    Button(action:edit) { Image(systemName:"pencil").frame(width:44,height:44) }.accessibilityLabel("編集")
                }
                if let regenerate {
                    Button(action:regenerate) { Image(systemName:"arrow.clockwise").frame(width:44,height:44) }.accessibilityLabel("再生成")
                }
            Menu {
                if let generateFromHere { Button("ここから生成",systemImage:"sparkles",action:generateFromHere) }
                if let insertBefore { Button("前に挿入", systemImage: "text.insert", action: insertBefore) }
                if let configure { Button("メッセージ設定", systemImage: "slider.horizontal.3", action: configure) }
                if let moveUp { Button("上へ移動", systemImage: "arrow.up", action: moveUp) }
                if let moveDown { Button("下へ移動", systemImage: "arrow.down", action: moveDown) }
                if let replaceAndPrune { Button("後続を整理して編集", systemImage: "square.and.pencil", action: replaceAndPrune) }
                if let copyRange { Button("範囲コピー・切り取り・移動", systemImage: "doc.on.doc", action: copyRange) }
                if let pasteRange { Button("ここへ貼り付け", systemImage: "doc.on.clipboard", action: pasteRange) }
                if let remove { Button("1件削除", systemImage: "trash", role: .destructive, action: remove) }
                if let deleteBranch { Button("枝全体を削除", systemImage: "trash.fill", role: .destructive, action: deleteBranch) }
            } label: {
                Image(systemName:"ellipsis").frame(width:44,height:44)
            }
            .accessibilityLabel("メッセージ操作")
            .frame(minWidth: 44, minHeight: 44)
            }.buttonStyle(.plain)
                .background(.regularMaterial,in:Capsule())
        }
    }

    private var headerTitle: some View {
        HStack(spacing: 8) {
            if advancedMode, let edit {
                Button(action: edit) {
                    roleLabel
                    Image(systemName: "chevron.down").font(.caption)
                }
                .buttonStyle(.plain)
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
                .accessibilityLabel("\(roleName)：役割と本文を編集")
            } else {
                roleLabel
                    .font(.subheadline.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
            }
            if node.options.starred { Image(systemName:"star.fill").accessibilityLabel("スター") }
            if node.options.pinned { Image(systemName:"pin.fill").accessibilityLabel("ピン留め") }
        }
    }
    private var roleLabel: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(node.role == "user" ? Color(red: 0.78, green: 0.27, blue: 0.27) : node.role == "system" ? Color.blue : Color(red: 0.06, green: 0.64, blue: 0.50), in: RoundedRectangle(cornerRadius: 6))
                .accessibilityHidden(true)
            Text(roleName).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var headerControls: some View {
        return ViewThatFits(in:.horizontal) {
            HStack(spacing:2) { primaryHeaderControls; secondaryHeaderControls }
            VStack(alignment:.trailing,spacing:0) {
                primaryHeaderControls
                secondaryHeaderControls
            }
        }
    }

    private var primaryHeaderControls: some View {
        let tab = (try? summaryInfo?["tab"]?.string("tab")) ?? "original"
        let tabName = tab == "compact" ? "圧縮" : tab == "summary" ? "要約" : "原文"
        return HStack(spacing:2) {
            if let openSummary {
                Menu {
                    if let id = try? summaryInfo?["summary"]?["id"]?.string("summary ID") {
                        Button("原文",systemImage:"doc.text") { selectSummary?(id,false) }
                            .disabled(selectSummary == nil)
                    }
                    if summaryInfo?["valid"] == .bool(true) {
                        if let id = try? summaryInfo?["readable"]?["id"]?.string("summary ID") {
                            Button("要約",systemImage:"text.alignleft") { selectSummary?(id,true) }
                                .disabled(selectSummary == nil)
                        }
                        if let id = try? summaryInfo?["compact"]?["id"]?.string("summary ID") {
                            Button("圧縮",systemImage:"line.3.horizontal.decrease") { selectSummary?(id,true) }
                                .disabled(selectSummary == nil)
                        }
                    }
                    Divider()
                    Button("Markdownで整形",systemImage:"textformat") {
                        markdownMode = true; conversationFind?.setMode(true,nodeID:node.id,context:branchSwipeContext); markdownRevision += 1
                    }
                    Button("テキストで表示",systemImage:"text.quote") {
                        markdownMode = false; conversationFind?.setMode(false,nodeID:node.id,context:branchSwipeContext); markdownRevision += 1
                    }
                    Button("詳細設定",systemImage:"slider.horizontal.3",action:openSummary)
                } label: {
                    HStack(spacing:3) { Text(tabName); Image(systemName:"chevron.down").font(.caption2) }
                        .font(.subheadline)
                        .frame(minWidth:44,minHeight:44)
                }
                .accessibilityLabel("表示形式: \(tabName)")
            }
        }
    }

    @ViewBuilder private var savedSummaryControl: some View {
        if let info = summaryInfo,
           let anchor = try? info["anchor"]?.string("summary anchor"), anchor.utf8.elementsEqual(node.id.utf8),
           let versions = try? info["savedVersions"]?.array("saved summaries"), versions.count > 1,
           let selected = try? info["summary"]?["id"]?.string("summary ID") {
            let label = versions.first { (try? $0["id"]?.string("summary ID"))?.utf8.elementsEqual(selected.utf8) == true }?["label"]
            HStack(spacing: 6) {
                Text("保存済み要約").font(.caption).foregroundStyle(.secondary)
                Menu {
                    ForEach(Array(versions.enumerated()), id: \.offset) { _, version in
                        if let id = try? version["id"]?.string("summary ID"),
                           let title = try? version["label"]?.displayString("summary label") {
                            Button(title, systemImage: id.utf8.elementsEqual(selected.utf8) ? "checkmark" : "text.alignleft") {
                                selectSummary?(id, info["tab"] != .string("original"))
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text((try? label?.displayString("summary label")) ?? "選択").lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .font(.footnote)
                    .frame(minHeight: 44)
                }
                .disabled(selectSummary == nil)
                .accessibilityLabel("保存済み要約")
            }
        }
    }

    private var secondaryHeaderControls: some View {
        HStack(spacing:2) {
            if let openEvaluation {
                Button(action:openEvaluation) { Image(systemName:"checkmark.shield").frame(width:44,height:44) }
                    .accessibilityLabel("評価")
            }
            if let toggleOmitted {
                Button(action:toggleOmitted) { Image(systemName:node.options.omitted ? "eye.slash.fill" : "eye.slash").frame(width:44,height:44) }
                    .foregroundStyle(node.options.omitted ? Color.orange : Color.secondary)
                    .accessibilityLabel(node.options.omitted ? "生成時の文脈から除外中。解除" : "生成時の文脈から除外")
            } else if node.options.omitted { Image(systemName:"eye.slash.fill").accessibilityLabel("生成時の文脈から除外") }
            if let toggleProtected {
                Button(action:toggleProtected) { Image(systemName:node.options.protected ? "lock.fill" : "lock").frame(width:44,height:44) }
                    .foregroundStyle(node.options.protected ? Color.blue : Color.secondary)
                    .accessibilityLabel(node.options.protected ? "保護中。解除" : "上書き・削除から保護")
            } else if node.options.protected { Image(systemName:"lock.fill").accessibilityLabel("上書き・削除から保護") }
        }
    }
    private var metadataMenu: some View {
        Menu {
            if let openEvaluation { Button("評価", systemImage: "checkmark.shield", action: openEvaluation) }
            if let toggleOmitted {
                Button(node.options.omitted ? "文脈からの除外を解除" : "生成時の文脈から除外", systemImage: "eye.slash", action: toggleOmitted)
            }
            if let toggleProtected {
                Button(node.options.protected ? "保護を解除" : "上書き・削除から保護", systemImage: "lock", action: toggleProtected)
            }
        } label: {
            Image(systemName: node.options.protected ? "lock.fill" : node.options.omitted ? "eye.slash.fill" : "ellipsis.circle")
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel("評価・文脈・保護")
        .accessibilityValue([node.options.omitted ? "文脈から除外中" : "", node.options.protected ? "保護中" : ""].filter { !$0.isEmpty }.joined(separator: "、"))
    }

    private var branchSwipe: some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($swipeActive) { _, active, _ in active = true }
            .onChanged { value in
                if swipeSource == nil {
                    swipeSource = [branchSwipeContext ?? Data(), Data(node.id.utf8)] + siblings.map { Data($0.id.utf8) }
                    swipePreference = branchSwipeDirection
                }
                if abs(value.translation.width) <= abs(value.translation.height) * 1.5 { swipeRejected = true }
            }
            .onEnded { value in
                defer { swipeSource = nil; swipePreference = nil; swipeRejected = false }
                guard isEnabled, !swipeRejected, abs(value.translation.width) >= 44,
                      abs(value.translation.width) > abs(value.translation.height) * 1.5,
                      swipeSource == [branchSwipeContext ?? Data(), Data(node.id.utf8)] + siblings.map({ Data($0.id.utf8) }),
                      let preference = swipePreference, preference == branchSwipeDirection,
                      let position = siblings.firstIndex(where: { $0.id.utf8.elementsEqual(node.id.utf8) }),
                      let direction = try? BranchNavigation.swipeDirection(distance: Double(value.translation.width), preference: preference) else { return }
                let target = position + (direction == "next" ? 1 : -1)
                if siblings.indices.contains(target) { select(siblings[target].id) }
            }
    }
    @ViewBuilder private var branchControls: some View {
        if siblings.count > 1 {
            let position = (siblings.firstIndex(where: { $0.id.utf8.elementsEqual(node.id.utf8) }) ?? 0) + 1
            HStack(spacing: 8) {
                Button {
                    select(siblings[position - 2].id)
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(position == 1)
                .accessibilityLabel("前の分岐")
                Text("分岐 \(position) / \(siblings.count)")
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                    .simultaneousGesture(branchSwipe)
                    .onChange(of: swipeActive) { _, active in
                        if !active { swipeSource = nil; swipePreference = nil; swipeRejected = false }
                    }
                    .accessibilityHint("前後の分岐ボタン、またはこの番号の横スワイプで切り替え")
                    .accessibilityLabel("分岐 \(position) / \(siblings.count)")
                Button {
                    select(siblings[position].id)
                } label: {
                    Image(systemName: "chevron.right")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(position == siblings.count)
                .accessibilityLabel("次の分岐")
            }
        }
    }

    @ViewBuilder private var footerControls: some View {
        if siblings.count > 1 || hasMessageOperations {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    branchControls
                    if siblings.count > 1 { Spacer(minLength: 8) }
                    messageOperations
                }
                VStack(alignment: .leading, spacing: 0) {
                    branchControls
                    messageOperations.frame(maxWidth: .infinity, alignment: .center)
                }
            }
        }
    }

    var body: some View {
        let isBubble = style == .bubbles
        HStack(alignment: .top, spacing: 0) {
            if isBubble && node.role == "user" { Spacer(minLength: 24) }
            if showsCollapseControl {
            Button { toggleCollapse?() } label: {
                Image(systemName: node.options.collapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(.secondary)
            .disabled(toggleCollapse == nil || inlineEditor != nil)
            .accessibilityLabel("\(roleName)の本文を\(node.options.collapsed ? "展開" : "折りたたむ")")
            .accessibilityValue(node.options.collapsed ? "折りたたみ中" : "展開中")
            }
            VStack(alignment: .leading, spacing: 8) {
                ViewThatFits(in:.horizontal) {
                    HStack(spacing:8) {
                        headerTitle
                            .fixedSize()
                        Spacer(minLength:8)
                        headerControls
                            .fixedSize()
                    }
                    HStack(spacing: 8) {
                        headerTitle
                        Spacer(minLength: 0)
                        primaryHeaderControls
                            .fixedSize()
                        metadataMenu
                    }
                    VStack(alignment:.leading,spacing:0) {
                        headerTitle
                        HStack(spacing: 2) { primaryHeaderControls; Spacer(minLength: 0); metadataMenu }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 8) {
                savedSummaryControl
                ForEach(MessageBodyItem.items(node:node,summaryInfo:summaryInfo,generation:generation,context:branchSwipeContext)) { item in
                    Group {
                        switch item.content {
                        case .markdown(let text,let running): MarkdownTextView(text:text,isGenerating:running)
                        case .part(let part): MessagePartView(part:part,isGenerating:generation?.running ?? false)
                        case .label(let text): FindableMessagePlainText(text:text,baseFontSize:15).font(.subheadline).foregroundStyle(.secondary)
                        case .note(let text): Text(text).font(.caption).foregroundStyle(.secondary)
                        case .collapsed: Text("本文を折りたたみ中").foregroundStyle(.secondary)
                        }
                    }.environment(\.conversationFindBodyID,item.id)
                }
                }
                .simultaneousGesture(TapGesture().onEnded {
                    if inlineEditor == nil { focusBranchEditor?() }
                }, including: focusBranchEditor == nil ? .none : .all)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(minHeight:84,alignment:.topLeading)
                .padding(isBubble ? 0 : 12)
                .background {
                    if !isBubble {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(uiColor: .tertiarySystemBackground))
                    }
                }
                if let streamStatus, let text = try? streamStatus.required("text").string("stream status") {
                    VStack(alignment:.leading,spacing:4) {
                        Text(text).foregroundStyle(streamStatusColor)
                        if let recoverStream {
                            Button("プロキシから復旧",action:recoverStream).buttonStyle(.borderless).disabled(recoveringStream)
                        }
                        if streamStatus["incomplete"] == .bool(true), streamStatus["expired"] == .bool(true) {
                            Text("復旧データの保持期間が終了しました").foregroundStyle(.secondary)
                        }
                    }.font(.caption).frame(maxWidth:.infinity,alignment:.leading)
                }
                footerControls.hidden()
                }
                .opacity(inlineEditor == nil ? 1 : 0)
                .allowsHitTesting(inlineEditor == nil)
                .accessibilityHidden(inlineEditor != nil)
                .overlay {
                    if let inlineEditor {
                        inlineEditor.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
                    } else {
                        FloatingMessageActions { footerControls }
                    }
                }
            }
            .frame(maxWidth: isBubble ? nil : .infinity, alignment: .leading)
            .padding(isBubble ? 16 : 0)
            .background {
                if isBubble {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(node.role == "user" ? Color.accentColor.opacity(0.12) : Color(uiColor: .tertiarySystemBackground))
                }
            }
            if isBubble && node.role == "assistant" { Spacer(minLength: 24) }
        }
        .padding(.horizontal,16).padding(.vertical,8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .buttonStyle(.plain)
        .environment(\.markdownPresentation, MarkdownPresentation(mode:markdownMode ?? conversationFind?.modes[ConversationFindBody.key(node.id,"mode",context:branchSwipeContext)],revision:markdownRevision,controlsHidden:openSummary != nil))
    }
}


struct MessagePartView: View {
    let part: MessagePart
    var isGenerating = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch part {
            case .text(let text): MarkdownTextView(text: text, isGenerating: isGenerating)
            case .reasoning(let text):
                Text("推論").font(.headline)
                MarkdownTextView(text: text, isGenerating: isGenerating)
            case .image(let url, let detail):
                AttachmentImageView(url: url, detail: detail)
            case .toolCall(let id, let name, let arguments):
                Text("ツール呼び出し: \(name)").font(.headline)
                Text("ID: \(id)")
                FindableMessagePlainText(text:arguments)
            case .toolResult(let callID, let content):
                Text("ツール結果").font(.headline)
                Text("呼び出しID: \(callID)")
                FindableMessagePlainText(text:content)
            }
        }
        .font(.body)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct WebJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json, .gzip, .png, .data, UTType(filenameExtension:"md") ?? .plainText] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw ExchangeError.invalid("ファイル内容") }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}


struct ConversationLibraryView<Footer: View>: View {
    @ObservedObject var state: ChatState
    let onSelect: () -> Void
    let onClose: (() -> Void)?
    var onExport: (() -> Void)? = nil
    @Binding var showsSearch: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ViewBuilder let footer: () -> Footer
    @State private var isSelecting = false
    @State private var selected = Set<Data>()
    @State private var pendingDelete: [String] = []
    @State private var showsDelete = false
    @State private var renameID: String?
    @State private var renameTitle = ""
    @State private var showsRename = false
    @State private var errorMessage: String?
    @State private var folders: [ChatFolderRow] = []
    @State private var folderRenameID: String?
    @State private var folderRenameTitle = ""
    @State private var showsFolderRename = false
    @State private var folderDeleteID: String?
    @State private var showsFolderDelete = false
    @State private var chatSizes: [Data: String] = [:]
    @State private var sizeWorker = ChatSize()
    @State private var sizeTask: Task<Void, Never>?
    @State private var sizeRequestID = UUID()
    @State private var sizeError: String?

    var body: some View {
        NavigationStack {
            Group {
            if showsSearch {
                ChatSearchView(state:state,initialMode:.library,inline:true,close:{ showsSearch = false },library:true,reportError:{ errorMessage = $0 }) { result, mode in
                    try state.navigate(chatID:result.chatID,nodeID:result.nodeID,source:mode == .grep ? .grep : .search)
                    onSelect()
                }
                .transition(reduceMotion ? .opacity : .move(edge:.top).combined(with:.opacity))
                .zIndex(1)
            } else {
            List {
                if let sizeError { Text(sizeError).foregroundStyle(.red) }
                if state.exchange == nil {
                    Text("サンプル会話です。新規作成で保存用の会話を開始します。")
                        .foregroundStyle(.secondary)
                }
                ForEach(folders.filter { $0.displayParentID.isEmpty }, id: \.identity) { folder in
                    folderTree(folder)
                }
                Section(folders.isEmpty ? "会話" : "未所属") {
                    ForEach(state.conversations.filter { conversation in
                        guard let id = state.folderID(for: conversation.id) else { return true }
                        return !folders.contains { $0.id.utf8.elementsEqual(id.utf8) }
                    }, id: \.identity) { conversation in conversationRow(conversation) }
                }
            }
            .transition(.opacity)
            }
            }
            .animation(.easeInOut(duration:0.35),value:showsSearch)
            .clipped()
            .safeAreaInset(edge: .top, spacing: 0) {
                if !showsSearch {
                Button { showsSearch = true } label: {
                    Label("会話・フォルダを検索", systemImage: "magnifyingglass").foregroundStyle(Color(uiColor:.secondaryLabel))
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .disabled(state.exchange == nil)
                .padding(.horizontal)
                .background(.bar)
                .transition(reduceMotion ? .opacity : .move(edge:.top).combined(with:.opacity))
                }
            }
            .animation(.easeInOut(duration:0.35),value:showsSearch)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) { Divider(); footer().padding(.horizontal) }
                    .background(.bar)
            }
            .navigationTitle("会話")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing:.sidebarToggle)
            .onAppear { revealSelectedConversation() }
            .onReceive(state.$exchange) { refreshChatSizes($0?.source) }
            .onDisappear { sizeTask?.cancel(); sizeRequestID = UUID() }
            .onChange(of: Data(state.selectedConversationID.utf8)) { _, _ in revealSelectedConversation() }
            .onChange(of: state.exchange?.source) { _, _ in perform {} }
            .toolbar {
                if let onClose {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("会話一覧を閉じる",systemImage:"sidebar.left",action:onClose).labelStyle(.iconOnly)
                    }
                }
                if isSelecting {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("完了") { isSelecting = false; selected.removeAll() }
                            .frame(minWidth:44,minHeight:44)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新規フォルダ", systemImage: "folder.badge.plus") { perform { try state.applyFolder(.create(id: UUID().uuidString.lowercased())) } }
                        .disabled(state.hasGenerations)
                }
                if !selected.isEmpty {
                    ToolbarItem(placement: .bottomBar) {
                        Menu {
                            moveButtons(ids: state.conversations.filter { selected.contains($0.identity) }.map(\.id))
                        } label: {
                            Image(systemName: "folder").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("選択した\(selected.count)件を移動")
                        .disabled(state.hasGenerations)
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button(role: .destructive) {
                            pendingDelete = state.conversations.filter { selected.contains($0.identity) }.map(\.id)
                            showsDelete = true
                        } label: {
                            Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("選択した\(selected.count)件を削除")
                        .disabled(state.hasGenerations)
                    }
                }
            }
            .confirmationDialog("会話を削除しますか？", isPresented: $showsDelete, titleVisibility: .visible) {
                Button("削除", role: .destructive) {
                    perform {
                        try state.deleteChats(ids: pendingDelete)
                        selected.removeAll()
                    }
                }
                Button("取消", role: .cancel) {}
            } message: { Text("\(pendingDelete.count)件の会話を削除します。") }
            .sheet(isPresented: $showsRename) {
                NavigationStack {
                    Form {
                        TextField("名前", text: $renameTitle)
                        if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                    }
                    .navigationTitle("会話の名前")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("取消") { showsRename = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("保存") {
                                if let renameID, perform({ try state.renameChat(id: renameID, title: renameTitle) }) { showsRename = false }
                            }
                        }
                    }
                }
            }
            .confirmationDialog("フォルダを削除しますか？", isPresented: $showsFolderDelete, titleVisibility: .visible) {
                Button("削除", role: .destructive) { if let id = folderDeleteID { perform { try state.applyFolder(.remove(id: id)) } } }
                Button("取消", role: .cancel) {}
            } message: { Text("会話と子フォルダは親フォルダへ移ります。親がない場合は未所属・最上位になります。") }
            .sheet(isPresented: $showsFolderRename) {
                NavigationStack {
                    Form { TextField("名前", text: $folderRenameTitle); if let errorMessage { Text(errorMessage).foregroundStyle(.red) } }
                    .navigationTitle("フォルダの名前")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("取消") { showsFolderRename = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("保存") { if let id = folderRenameID, perform({ try state.applyFolder(.rename(id: id, name: folderRenameTitle)) }) { showsFolderRename = false } }
                        }
                    }
                }
            }
            .alert("会話を変更できませんでした", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("閉じる", role: .cancel) { errorMessage = nil }
            } message: { Text(errorMessage ?? "") }
        }
    }


    private func refreshChatSizes(_ source: OrderedJSON?) {
        sizeTask?.cancel()
        sizeRequestID = UUID()
        chatSizes = [:]; sizeError = nil
        guard (try? state.displaySetting(.displayChatSize)) == .bool(true), let source else { sizeTask = nil; return }
        let requestID = sizeRequestID
        sizeTask = Task { @MainActor in
            defer { if requestID == sizeRequestID { sizeTask = nil } }
            do {
                let result = try await sizeWorker.sizes(source: source, enabled: true)
                try Task.checkCancellation()
                guard requestID == sizeRequestID else { return }
                chatSizes = result
            } catch is CancellationError { }
            catch { if requestID == sizeRequestID { sizeError = error.localizedDescription } }
        }
    }

    private func conversationRow(_ conversation: Conversation) -> some View {
        let active = state.selectedConversationID.utf8.elementsEqual(conversation.id.utf8)
        return HStack {
            Group {
            if state.exchange != nil && isSelecting {
                Button {
                    if !selected.insert(conversation.identity).inserted { selected.remove(conversation.identity) }
                } label: {
                    Image(systemName: selected.contains(conversation.identity) ? "checkmark.circle.fill" : "circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("選択対象: \(conversation.title)")
                .accessibilityValue(selected.contains(conversation.identity) ? "選択中" : "未選択")
                .disabled(state.hasGenerations)
            } else {
                Image(systemName: "bubble.left")
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            Button {
                state.selectedConversationID = conversation.id
                if state.selectedConversationID.utf8.elementsEqual(conversation.id.utf8), state.persistenceError == nil { onSelect() }
                else { errorMessage = state.persistenceError }
            } label: {
                HStack(spacing: 4) {
                    Text(conversation.title.isEmpty ? "（タイトルなし）" : conversation.title).lineLimit(1).foregroundStyle(Color(uiColor:.label))
                    if (try? state.displaySetting(.displayChatSize)) == .bool(true), let size = chatSizes[conversation.identity] {
                        Text("(\(size))").font(.caption).foregroundStyle(.secondary).fixedSize()
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.borderless)
            .accessibilityAddTraits(active ? .isSelected : [])
            if state.exchange != nil {
                Menu {
                    Button("会話を選択",systemImage:"checkmark.circle") {
                        isSelecting = true
                        selected.insert(conversation.identity)
                    }
                    Button("改名") {
                        renameID = conversation.id
                        renameTitle = conversation.title
                        showsRename = true
                    }
                    if active, let onExport { Button("書き出す", systemImage: "square.and.arrow.up", action: onExport) }
                    Button("複製") {
                        if perform({ try state.duplicateChat(id: conversation.id) }) { onSelect() }
                    }
                    Menu("移動") { moveButtons(ids: [conversation.id]) }
                    Button("削除", role: .destructive) {
                        pendingDelete = [conversation.id]
                        showsDelete = true
                    }
                } label: {
                    Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("会話の操作: \(conversation.title)")
                .disabled(state.hasGenerations)
            }
            }
            if let generation = state.generation(for: conversation.id), generation.running {
                Button {
                    guard state.generation(for: conversation.id)?.id == generation.id else { return }
                    state.stopGeneration(chatID: conversation.id)
                } label: {
                    Image(systemName: "stop.circle").frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityLabel("生成を停止: \(conversation.title)")
            }
        }
        .background(active ? Color.primary.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius:8))
    }

    private func folderTree(_ folder: ChatFolderRow) -> AnyView {
        AnyView(Group {
            folderHeader(folder)
                .disabled(state.hasGenerations)
                .padding(.leading, CGFloat(folder.depth) * 16)
            if folder.expanded {
                ForEach(folders.filter { $0.displayParentID.utf8.elementsEqual(folder.id.utf8) }, id: \.identity) { child in
                    folderTree(child)
                }
                ForEach(state.conversations.filter { state.folderID(for: $0.id)?.utf8.elementsEqual(folder.id.utf8) == true }, id: \.identity) { conversation in
                    conversationRow(conversation)
                        .padding(.leading, CGFloat(folder.depth + 1) * 16)
                }
            }
        })
    }

    private func folderHeader(_ folder: ChatFolderRow) -> some View {
        HStack {
            Button { perform { try state.applyFolder(.expanded(id: folder.id, expanded: !folder.expanded)) } } label: {
                HStack { Image(systemName: folder.expanded ? "chevron.down" : "chevron.right"); Image(systemName: "folder.fill").foregroundStyle(folderColor(folder.color)); Text(folder.name.isEmpty ? "（名前なし）" : folder.name).frame(maxWidth: .infinity, alignment: .leading) }.frame(minHeight: 44)
            }.buttonStyle(.borderless).accessibilityLabel("フォルダ: \(folder.name)").accessibilityValue(folder.expanded ? "展開中" : "閉じています")
            Menu {
                Button("このフォルダに新規会話") {
                    if perform({ try state.createChat(folder: folder.id) }) { onSelect() }
                }
                Button("改名") { folderRenameID = folder.id; folderRenameTitle = folder.name; showsFolderRename = true }
                Menu("色") {
                    ForEach(["#be123c", "#6d28d9", "#0369a1", "#047857", "#b45309"], id: \.self) { color in
                        Button(color) { perform { try state.applyFolder(.color(id: folder.id, color: color)) } }
                    }
                    Button("標準色") { perform { try state.applyFolder(.color(id: folder.id, color: nil)) } }
                }
                Button("削除", role: .destructive) { folderDeleteID = folder.id; showsFolderDelete = true }
            } label: { Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44) }
            .accessibilityLabel("フォルダの操作: \(folder.name)")
        }
    }

    @ViewBuilder private func moveButtons(ids: [String]) -> some View {
        Button("未所属") { if perform({ try state.applyFolder(.move(chatIDs: ids, folderID: nil)) }) { selected.removeAll() } }
        ForEach(folders, id: \.identity) { folder in
            Button(folder.path.isEmpty ? "（名前なし）" : folder.path) {
                if perform({ try state.applyFolder(.move(chatIDs: ids, folderID: folder.id)) }) { selected.removeAll() }
            }
        }
    }
    private func folderColor(_ value: String?) -> Color {
        guard let value, value.hasPrefix("#"), value.count == 7, let rgb = UInt32(value.dropFirst(), radix: 16) else { return .secondary }
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }

    private func revealSelectedConversation() {
        perform {
            let rows = try state.folderRows()
            if let id = state.folderID(for: state.selectedConversationID), let folder = rows.first(where: { $0.id.utf8.elementsEqual(id.utf8) }), (!folder.visible || !folder.expanded) {
                try state.applyFolder(.move(chatIDs: [], folderID: id))
            }
        }
    }

    @discardableResult
    private func perform(_ operation: () throws -> Void) -> Bool {
        do { try operation(); folders = try state.folderRows(); errorMessage = nil; return true }
        catch { errorMessage = error.localizedDescription; return false }
    }
}


struct FileImportView: View {
    @ObservedObject var state: ChatState
    let preview: ChatImportPreview
    @Environment(\.dismiss) private var dismiss
    @State private var mode = ChatImportMode.append
    @State private var selectedChats: Set<Data> = []
    @State private var selectedFolders: Set<Data> = []
    @State private var includeSettings = false
    @State private var isSaving = false
    @State private var confirmsReplacement = false
    @State private var initialized = false
    @State private var errorMessage: String?
    private var unavailableSelection: Bool { preview.conversations.contains { selectedChats.contains($0.identity) && !(preview.unavailableContent[$0.id] ?? []).isEmpty } }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(preview.filename).font(.headline)
                    Text("確認中は保存済みの会話を変更しません。").font(.footnote).foregroundStyle(.secondary)
                    Picker("取り込み方法", selection: $mode) {
                        Text("選択した項目を追加").tag(ChatImportMode.append)
                        Text("ファイル全体で置換").tag(ChatImportMode.replace)
                    }
                    if mode == .replace {
                        Text("現在の会話とフォルダを、このファイルの内容で置き換えます。")
                        Toggle("設定も初期化して取り込む", isOn: $includeSettings)
                    } else {
                        HStack {
                            Button("すべて選択") { selectAll() }
                            Spacer()
                            Button("選択解除") { selectedChats.removeAll(); selectedFolders.removeAll() }
                        }
                    }
                    Text("会話 \(selectedChats.count)件・フォルダ \(selectedFolders.count)件")
                }
                if preview.recoveredContentCount > 0 {
                    Section { Text("復元できた本文: \(preview.recoveredContentCount)件") }
                }
                Section("会話") {
                    ForEach(preview.conversations, id: \.identity) { chat in
                        VStack(alignment: .leading) {
                            Toggle(isOn: selection(chat.id, in: $selectedChats)) { Text(chat.title) }.disabled(mode == .replace)
                            NavigationLink("内容を確認（\(chat.nodes.count)件）") { ImportConversationPreview(conversation: chat, style: state.style) }
                            if let missing = preview.unavailableContent[chat.id], !missing.isEmpty {
                                Text("本文が見つからない項目が\(missing.count)件あります。この会話は取り込めません。")
                                    .font(.footnote).foregroundStyle(.red)
                            }
                        }
                    }
                }
                if !preview.folderRows.isEmpty {
                    Section("フォルダ") {
                        ForEach(preview.folderRows, id: \.identity) { folder in
                            Toggle(folder.path.isEmpty ? folder.name : folder.path, isOn: selection(folder.id, in: $selectedFolders)).disabled(mode == .replace)
                        }
                        Text("選択した会話の所属先と、その親フォルダも含めます。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
                Section {
                    Button(isSaving ? "保存中" : mode == .replace ? "置換を確認" : "選択項目を取り込む") {
                        if mode == .replace { confirmsReplacement = true } else { commit() }
                    }.disabled(isSaving || unavailableSelection || (mode == .append && selectedChats.isEmpty && selectedFolders.isEmpty) || state.hasGenerations)
                }
            }
            .disabled(isSaving)
            .navigationTitle("取り込み内容を確認")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(isSaving) } }
            .interactiveDismissDisabled(isSaving)
            .onAppear { if !initialized { selectAll(); initialized = true } }
            .onChange(of: mode) { _, value in if value == .replace { selectAll() } }
            .confirmationDialog("保存済みの会話とフォルダを置き換えますか？", isPresented: $confirmsReplacement, titleVisibility: .visible) {
                Button("このファイルで置き換える", role: .destructive) { commit() }
                Button("取消", role: .cancel) {}
            } message: { Text(includeSettings ? "保存済みの会話・フォルダ・設定を初期化して、ファイルの内容に置き換えます。" : "保存済みの会話とフォルダを、ファイルの内容に置き換えます。設定は保持します。") }
        }
    }
    private func selection(_ id: String, in values: Binding<Set<Data>>) -> Binding<Bool> {
        Binding(get: { values.wrappedValue.contains(Data(id.utf8)) }, set: { chosen in
            if chosen { values.wrappedValue.insert(Data(id.utf8)) } else { values.wrappedValue.remove(Data(id.utf8)) }
        })
    }
    private func selectAll() {
        selectedChats = Set(preview.conversations.map(\.identity)); selectedFolders = Set(preview.folderRows.map(\.identity))
    }
    private func commit() {
        isSaving = true; errorMessage = nil
        Task {
            defer { isSaving = false }
            do {
                try await state.commitImport(preview, mode: mode, selectedChatIDs: preview.conversations.filter { selectedChats.contains($0.identity) }.map(\.id), selectedFolderIDs: preview.folderRows.filter { selectedFolders.contains($0.identity) }.map(\.id), includeSettings: mode == .replace && includeSettings)
                dismiss()
            } catch { errorMessage = error.localizedDescription }
        }
    }
}

struct ImportConversationPreview: View {
    let conversation: Conversation
    let style: ChatStyle
    private var otherNodes: [MessageNode] {
        let visible = Set(conversation.visibleMessages.map(\.identity))
        return conversation.nodes.filter { !visible.contains($0.identity) }
    }
    private func expanded(_ node: MessageNode) -> MessageNode {
        var value = node
        value.options.collapsed = false
        return value
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                Text("閲覧専用").font(.footnote).foregroundStyle(.secondary)
                ForEach(conversation.visibleMessages, id: \.identity) { node in
                    MessageView(node: expanded(node), siblings: [], style: style, select: { _ in })
                }
                if !otherNodes.isEmpty {
                    DisclosureGroup("その他の分岐（\(otherNodes.count)件）") {
                        ForEach(otherNodes, id: \.identity) { node in
                            MessageView(node: expanded(node), siblings: [], style: style, select: { _ in })
                        }
                    }
                }
            }.padding()
        }.navigationTitle(conversation.title)
    }
}

struct ChatExportView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var exportTask: Task<Void, Never>?
    let exported: (ChatExport.Artifact) -> Void
    @State private var format = ChatExport.Format.v3
    @State private var scope = ChatExport.Scope.all
    @State private var compressed = false
    @State private var errorMessage: String?
    init(state: ChatState, initialScope: ChatExport.Scope = .all, exported: @escaping (ChatExport.Artifact) -> Void) {
        self.state = state; self.exported = exported
        _scope = State(initialValue: initialScope)
    }
    var body: some View {
        NavigationStack {
            Form {
                Picker("形式", selection: $format) { ForEach(ChatExport.Format.allCases) { Text($0.label).tag($0) } }
                Picker("範囲", selection: $scope) { ForEach(format.scopes) { Text($0.label).tag($0) } }
                if scope != .all { Text(state.conversation?.title ?? "会話がありません") }
                if format == .v3 { Toggle("gzipで圧縮", isOn: $compressed) }
                switch format {
                case .v3:
                    Text("V3は分岐と属性を保持します。表示枝を指定すると、その枝だけを書き出します。")
                        .font(.footnote).foregroundStyle(.secondary)
                case .v1:
                    Text("各会話の現在枝を書き出します。分岐ツリーと折りたたみ設定は含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                case .openAI:
                    Text("全分岐または表示枝のテキスト本文を書き出します。メッセージの属性、画像・推論・tool call・tool resultは含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                case .openRouter, .lmStudio:
                    Text("各会話の現在枝のテキスト本文を書き出します。選択した会話では表示中の経路を使います。メッセージの属性、画像・推論・tool call・tool resultは含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                case .image:
                    Text("表示中の枝と本文の表示状態を画像にします。高度な操作を非表示にしている場合、先頭のシステム本文は含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                case .markdown:
                    Text("現在の本文と画像URLを書き出します。メッセージの属性、推論・tool call・tool resultは含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                Button("書き出しファイルを選ぶ") {
                    guard exportTask == nil else { return }
                    errorMessage = nil
                    if format == .image {
                        let dark = colorScheme == .dark
                        exportTask = Task { @MainActor in
                            defer { exportTask = nil }
                            do {
                                let artifact = try await state.exportChatImage(dark: dark)
                                try Task.checkCancellation()
                                exported(artifact); dismiss()
                            } catch is CancellationError { }
                            catch { errorMessage = error.localizedDescription }
                        }
                    } else {
                        do { exported(try state.exportWebData(format:format,scope:scope,compressed:format == .v3 && compressed)); dismiss() }
                        catch { errorMessage = error.localizedDescription }
                    }
                }.disabled(state.hasGenerations || state.exchange == nil)
                if exportTask != nil { ProgressView("画像を作成中") }
            }
            .disabled(exportTask != nil)
            .navigationTitle("会話を書き出す")
            .onChange(of: format) { _, next in if !next.scopes.contains(scope) { scope = next.scopes.first ?? .all } }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { exportTask?.cancel(); dismiss() } } }
            .onDisappear { exportTask?.cancel() }
        }
    }
}

struct BranchClipboardView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @State var draft: BranchClipboardDraft
    @State private var errorMessage: String?
    @State private var showsConfirmation = false
    private var source: Conversation? { state.conversations.first { $0.id.utf8.elementsEqual(draft.sourceChatID.utf8) } }
    private var target: Conversation? { state.conversations.first { $0.id.utf8.elementsEqual(draft.targetChatID.utf8) } }
    private var usesTarget: Bool { draft.operation == .paste || draft.operation == .move }
    private var label: String {
        switch draft.operation { case .copy: return "コピー"; case .cut: return "切り取り"; case .paste: return "貼り付け"; case .move: return "会話間移動" }
    }
    private func identifier(_ value: Binding<String>) -> Binding<Data> {
        Binding(get: { Data(value.wrappedValue.utf8) }, set: { value.wrappedValue = String(decoding: $0, as: UTF8.self) })
    }
    var body: some View {
        NavigationStack {
            Form {
                Picker("操作", selection: $draft.operation) {
                    Text("コピー").tag(BranchClipboardOperation.copy); Text("切り取り").tag(BranchClipboardOperation.cut)
                    Text("貼り付け").tag(BranchClipboardOperation.paste); Text("会話間移動").tag(BranchClipboardOperation.move)
                }
                if draft.operation != .paste {
                    Section("範囲") {
                        Picker("元の会話", selection: identifier($draft.sourceChatID)) {
                            ForEach(state.conversations, id: \.identity) { chat in Text(chat.title).tag(chat.identity) }
                        }
                        Picker("始点", selection: identifier($draft.fromNodeID)) { nodeChoices(source) }
                        Picker("終点", selection: identifier($draft.toNodeID)) { nodeChoices(source) }
                        Text("始点から終点へ親子関係でつながる範囲を選びます。非表示のメッセージも選択できます。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else if !state.hasBranchClipboard { Text("コピーした範囲がありません。") }
                if usesTarget {
                    Section("貼り付け先") {
                        Picker("会話", selection: identifier($draft.targetChatID)) {
                            ForEach(state.conversations, id: \.identity) { chat in Text(chat.title).tag(chat.identity) }
                        }
                        Picker("このメッセージの後へ", selection: identifier($draft.afterNodeID)) { nodeChoices(target) }
                        if target?.nodes.isEmpty != false { Text("貼り付け先にはメッセージが必要です。") }
                        Text("貼り付けた範囲を表示します。元の後続や、範囲外の枝は残します。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                Button(label) {
                    if draft.operation == .cut || draft.operation == .move { showsConfirmation = true } else { save() }
                }
                .disabled(state.branchClipboardIsBusy(draft) || (usesTarget && target?.nodes.isEmpty != false) || (draft.operation == .paste && !state.hasBranchClipboard))
            }
            .navigationTitle("メッセージ範囲")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
            .onChange(of: Data(draft.sourceChatID.utf8)) { _, _ in
                draft.fromNodeID = source?.nodes.first?.id ?? ""; draft.toNodeID = draft.fromNodeID
            }
            .onChange(of: Data(draft.targetChatID.utf8)) { _, _ in draft.afterNodeID = target?.nodes.first?.id ?? "" }
            .confirmationDialog(draft.operation == .cut ? "範囲を切り取りますか？" : "範囲を移動しますか？", isPresented: $showsConfirmation, titleVisibility: .visible) {
                Button(label, role: .destructive) { save() }; Button("キャンセル", role: .cancel) {}
            } message: {
                Text("元の会話から選択範囲を取り除きます。範囲外の子や後続は残ります。保護されたメッセージを含む場合は操作を行いません。ピン留めは操作を防ぎません。")
            }
        }
    }
    @ViewBuilder private func nodeChoices(_ chat: Conversation?) -> some View {
        ForEach(chat?.nodes ?? [], id: \.identity) { node in
            Text("\(node.role): \(node.parts.compactMap { if case .text(let text) = $0 { return text }; return nil }.joined().prefix(40)) · \(node.id)").tag(node.identity)
        }
    }
    private func save() {
        do {
            let result = try state.saveBranchClipboard(draft)
            if let explanation = result.explanation { errorMessage = explanation } else { dismiss() }
        } catch { errorMessage = error.localizedDescription }
    }
}

struct MessageEditorView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @State var draft: MessageDraft
    @State private var errorMessage: String?
    @State private var showsPruneConfirmation = false
    @State private var savedWarning: String?
    @State private var promptRequest: PromptPickerRequest?

    var body: some View {
        NavigationStack {
            Form {
                if (try? state.displaySetting(.advancedMode)) != .bool(false) {
                Picker("役割", selection: $draft.role) {
                    Text("ユーザー").tag("user")
                    Text("アシスタント").tag("assistant")
                    if draft.isInsertion || (draft.nodeID != nil && (draft.path.first?.utf8.elementsEqual(draft.nodeID!.utf8) == true || draft.originalRole == "system")) {
                        Text("システム").tag("system")
                    }
                }
                }
                Section("本文") {
                    Button {
                        do {
                            guard try state.exchange?.source.encoded() == draft.source.encoded() else { throw ExchangeError.invalid("会話が変更されました。本文を開き直してください") }
                            promptRequest = try state.promptPickerRequest(.command(parts: draft.parts, text: draft.text))
                        } catch { errorMessage = error.localizedDescription }
                    } label: { Text("/").frame(minWidth: 44, minHeight: 44) }
                    .accessibilityLabel("プロンプトライブラリ")
                    .disabled(state.generation != nil)
                    MessageInputView(text: $draft.text, label: "本文", enabled: state.generation == nil, sticky: false,
                        minimumHeight: 220,
                        enterToSubmit: { try state.displaySetting(.enterToSubmit) == .bool(true) },
                        submit: submit, failure: { errorMessage = $0.localizedDescription })
                    if !draft.isInsertion {
                        Text("最初のテキストを編集します。他の本文要素は保持します。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if draft.isReplacingAndPruning {
                    if draft.isProtected { Text("このメッセージは保護されているため置換できません。") }
                    Stepper("削除する後続: \(draft.removeCount)件", value: $draft.removeCount, in: 0...draft.followingCount)
                    Text("表示経路上の後続を指定します。範囲内に保護されたメッセージがある場合は本文だけを保存し、後続を削除しません。")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if draft.isProtected { Text("保護されたメッセージです。分岐として保存できます。") }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                if draft.isReplacingAndPruning {
                    Button("置換して後続を整理") { showsPruneConfirmation = true }.disabled(draft.isProtected)
                } else if draft.isInsertion {
                    Button("挿入して保存") { save(.insert) }
                } else if draft.nodeID != nil {
                    Button("上書き保存") { save(.overwrite) }
                        .disabled(draft.isProtected || !draft.changed)
                    Button("分岐として保存") { save(.branch) }
                } else {
                    Button("追加して保存") { save(.append) }
                        .disabled(draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .navigationTitle(draft.isReplacingAndPruning ? "本文と後続を編集" : draft.isInsertion ? "本文を挿入" : draft.nodeID == nil ? "本文を追加" : "本文を編集")
            .confirmationDialog("本文を置換して後続を整理しますか？", isPresented: $showsPruneConfirmation, titleVisibility: .visible) {
                Button("置換して整理", role: .destructive) { saveReplacingAndPruning() }
                Button("キャンセル", role: .cancel) {}
            } message: { Text("本文を置換し、表示経路上の後続\(draft.removeCount)件を整理します。保護された後続が範囲内にある場合は本文だけを保存します。ピン留めは整理を防ぎません。") }
            .alert("本文を保存しました", isPresented: Binding(get: { savedWarning != nil }, set: { if !$0 { savedWarning = nil } })) {
                Button("閉じる") { dismiss() }
            } message: { Text(savedWarning ?? "") }
            .sheet(item: $promptRequest) { request in
                PromptPickerView(request: request) { result in
                    guard case .command(let applied) = result else { throw ExchangeError.invalid("本文がありません") }
                    try state.validatePromptPicker(request, input: .command(parts: draft.parts, text: draft.text))
                    guard try state.exchange?.source.encoded() == draft.source.encoded() else { throw ExchangeError.invalid("会話が変更されました。本文を開き直してください") }
                    draft.promptParts = applied.parts
                    draft.text = applied.text
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
    }

    private func generate() {
        do {
            draft = try state.saveMessageForGeneration(draft)
            guard let nodeID = draft.nodeID else { throw ExchangeError.invalid("生成するメッセージがありません") }
            try state.startGeneration(state.messageGenerationDraft(nodeID: nodeID, operation: .append))
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }

    private func submit(_ action: EnterSubmission.Action) {
        guard state.generation == nil else { return }
        if action == .generate { generate(); return }
        if draft.isReplacingAndPruning {
            guard !draft.isProtected else { return }
            showsPruneConfirmation = true
        } else if draft.isInsertion { save(.insert) }
        else if draft.nodeID != nil {
            guard !draft.isProtected, draft.changed else { return }
            save(.overwrite)
        } else if !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { save(.append) }
    }

    private func saveReplacingAndPruning() {
        do {
            let result = try state.saveMessageReplacingAndPruning(draft)
            if let explanation = result.explanation { errorMessage = explanation }
            else if !result.pruneBlockedBy.isEmpty {
                savedWarning = "保護された後続があるため、本文だけを保存しました。後続は削除していません。対象: " + result.pruneBlockedBy.joined(separator: ", ")
            } else { dismiss() }
        } catch { errorMessage = error.localizedDescription }
    }

    private func save(_ mode: MessageSaveMode) {
        do { try state.saveMessage(draft, mode: mode); dismiss() }
        catch { errorMessage = error.localizedDescription }
    }
}


struct RemoteSettingsView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @State private var record = RemoteCredentialRecord()
    @State private var proxy = RemoteProxySettings()
    @State private var errorMessage: String?
    @State private var didLoad = false
    var body: some View {
        NavigationStack {
            Form {
                TextField("完了API URL（HTTPS）", text: $record.settings.endpoint).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("旧会話用の予備モデルID", text: $record.settings.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("API key", text: $record.key)
                Toggle("旧会話用の予備streaming", isOn: $record.settings.stream)
                Text("endpointとAPI keyは端末に保存します。modelとstreamingは会話設定を優先し、モデル未設定の旧会話だけ予備値を使います。local生成・評価は未接続です。")
                    .font(.footnote).foregroundStyle(.secondary)
                Section("ストリームプロキシ") {
                    Toggle("プロキシを使用",isOn:$proxy.enabled)
                    TextField("プロキシURL（HTTPS）",text:$proxy.endpoint).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("プロキシ認証token",text:$proxy.authToken)
                    NavigationLink("プロキシの状態を確認") { ProxyStatusView(state:state,settings:proxy) }
                        .disabled(proxy.endpoint.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    Text("有効時は生成本文とAPIキーを指定したプロキシ経由で送信します。設定と認証情報はこの端末のKeychainに保存します。").font(.footnote).foregroundStyle(.secondary)
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("remote生成設定")
            .task {
                guard !didLoad else { return }
                do { record = try RemoteCredentials.load(); proxy = record.proxy ?? RemoteProxySettings(); didLoad = true }
                catch { errorMessage = error.localizedDescription }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") {
                    do { record.proxy = proxy; try state.saveRemoteSettings(record); dismiss() } catch { errorMessage = error.localizedDescription }
                } }
            }
        }
    }
}

private struct ProxyStatusView: View {
    @ObservedObject var state: ChatState
    let settings: RemoteProxySettings
    @State private var status: OrderedJSON?
    @State private var labels: OrderedJSON?
    @State private var records: [OrderedJSON] = []
    @State private var recoveryGaps: OrderedJSON = .object([])
    @State private var manualID = ""
    @State private var selectedID = ""
    @State private var pages = [""]
    @State private var refresh = 0
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var deletionID: String?
    @State private var confirmsDeletion = false
    @State private var action: Task<Void,Never>?
    private var key: String { "\(settings.endpoint)\u{1f}\(settings.authToken)\u{1f}\(selectedID)\u{1f}\(pages.last ?? "")\u{1f}\(refresh)" }

    private func string(_ value: OrderedJSON?) -> String? { value.flatMap { try? $0.string("status") } }
    private func number(_ value: OrderedJSON?) -> Double? { value.flatMap { try? $0.number("status") } }
    private func display(_ value: OrderedJSON?) -> String { string(value) ?? value.flatMap { try? $0.encoded() }.flatMap { String(data:$0,encoding:.utf8) } ?? "—" }
    private func time(_ value: OrderedJSON?) -> String {
        guard let millis = number(value), millis > 0 else { return "—" }
        return Date(timeIntervalSince1970:millis / 1000).formatted(date:.omitted,time:.standard)
    }
    private func label(_ category: String, _ value: OrderedJSON?) -> String {
        guard let code = string(value) else { return "—" }
        return string(labels?[category]?[code]) ?? code
    }
    private func reason(_ value: OrderedJSON?) -> String {
        guard let code = string(value) else { return "—" }
        return "\(label("reason",value))（\(code)）"
    }
    private func local(_ id: String) -> OrderedJSON? { records.first { $0["proxySessionId"] == .string(id) } }

    private func load(_ expected: String) async {
        guard !loading, !busy else { return }
        loading = true
        defer { if key == expected { loading = false } }
        do {
            let local = try state.proxyRecoveryRecords()
            let result = try await ProxyManagementClient().status(settings:settings,sessionID:selectedID.isEmpty ? nil : selectedID,cursor:selectedID.isEmpty ? pages.last.flatMap { $0.isEmpty ? nil : $0 } : nil)
            try Task.checkCancellation()
            guard key == expected else { return }
            let matching = local.filter { $0["proxyEndpoint"] == .string(settings.endpoint.trimmingCharacters(in:.whitespacesAndNewlines).trimmingCharacters(in:CharacterSet(charactersIn:"/"))) }
            let bridge = try SharedWebOperations.Session()
            let gaps = try bridge.call("proxyManagement",.object([.init(key:"operation",value:.string("recoveryGaps")),
                .init(key:"sessions",value:result.required("sessions")),.init(key:"records",value:.array(matching.map { record in
                    .object([.init(key:"sessionId",value:record["proxySessionId"] ?? .null),
                        .init(key:"cursor",value:record["checkpoint"]?["decoder"]?["lastEventId"] ?? .number("0"))])
                }))]))
            records = matching
            recoveryGaps = gaps
            status = result
            labels = try bridge.call("proxyManagement",.object([.init(key:"operation",value:.string("labels"))]))
            error = nil
        } catch is CancellationError { }
        catch { if key == expected { self.error = ProxyManagementClient.errorMessage(error) } }
    }
    private func poll(_ expected: String) async {
        status = nil
        loading = false
        while !Task.isCancelled && key == expected {
            await load(expected)
            do { try await Task.sleep(nanoseconds:5_000_000_000) } catch { break }
        }
    }
    private func delete() {
        guard !busy else { return }
        busy = true; error = nil; notice = nil
        let id = deletionID
        action = Task {
            defer { busy = false; action = nil; refresh += 1 }
            do {
                let count = try await ProxyManagementClient().delete(settings:settings,sessionID:id)
                try Task.checkCancellation()
                notice = id == nil ? "\(count)件の保存データを削除しました。" : "このリクエストの保存データを削除しました。"
            } catch is CancellationError { }
            catch { self.error = ProxyManagementClient.errorMessage(error) }
        }
    }
    private func recover(_ id: String) {
        guard !busy else { return }
        busy = true; error = nil
        action = Task {
            defer { busy = false; action = nil; refresh += 1 }
            do { try await state.recoverProxyStreams(sessionID:id) }
            catch is CancellationError { }
            catch { self.error = ProxyManagementClient.errorMessage(error) }
        }
    }

    var body: some View {
        Form {
            Section {
                Text(settings.endpoint).font(.footnote).textSelection(.enabled)
                Button("更新") { refresh += 1 }.disabled(loading || busy)
                Text(loading ? "確認中…" : "5秒ごとに更新 · 最終確認 \(time(status?["checkedAt"]))").font(.footnote).foregroundStyle(.secondary)
                HStack {
                    TextField("セッションIDを指定して照会",text:$manualID).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("照会") { selectedID = manualID.trimmingCharacters(in:.whitespacesAndNewlines); pages = [""]; refresh += 1 }
                }
                if !selectedID.isEmpty { Button("全記録に戻る") { selectedID = ""; manualID = ""; pages = [""] } }
            }
            if let notice { Text(notice) }
            if let error { Text(error).foregroundStyle(.red) }
            if let status {
                Section("プロキシ") {
                    Text("Worker \(display(status["version"])) · 接続拠点 \(display(status["colo"])) · 実行環境 \(String((string(status["instanceId"]) ?? "—").prefix(8)))")
                    if let limits = status["limits"] {
                        Text("保存上限 \(number(limits["cacheBytes"]).map { String(format:"%.0f",$0 / 1048576) } ?? "—") MiB · 保存期限 \(number(limits["retentionMs"]).map { String(format:"%.0f",$0 / 60000) } ?? "—")分 · 上流の無通信期限 \(number(limits["idleTimeoutMs"]).map { String(format:"%.0f",$0 / 1000) } ?? "—")秒")
                    }
                    Text(string(status["scope"]) == "all-sessions" ? "全端末・全実行環境の保存記録を20件ずつ表示します。応答は最終保存から5分、診断履歴は24時間保持します。" : string(status["scope"]) == "durable-session" ? "指定したIDの永続保存先を照会しています。" : "この実行環境で確認できる履歴を表示します。別の拠点の履歴は一覧に含まれません。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if status["scope"] == .string("current-isolate"), status["recentSessionsVisible"] == .bool(false) {
                        Text("プロキシ認証が未設定のため、既知のIDだけを照会します。").font(.footnote)
                    }
                    if status["storageDeletion"]?["all"] == .bool(true) {
                        Button("プロキシの全保存データを削除",role:.destructive) { deletionID = nil; confirmsDeletion = true }.disabled(busy)
                    } else if status["storageDeletion"]?["individual"] == .bool(true) {
                        Text("全削除にはプロキシ側の認証設定が必要です。").font(.footnote)
                    }
                }
                if let unavailable = number(status["unavailableSessions"]), unavailable > 0 {
                    Text("\(Int(unavailable))件の記録を取得できませんでした。更新して再試行してください。").foregroundStyle(.red)
                }
                let sessions = (try? status.required("sessions").array("sessions")) ?? []
                if sessions.isEmpty { Text("このページに保存記録はありません。IDを指定して個別に照会できます。") }
                ForEach(Array(sessions.enumerated()),id:\.offset) { _, item in
                    let id = string(item["sessionId"]) ?? ""
                    let cache = item["cache"]
                    let localState = item["local"]
                    let record = local(id)
                    Section(id.isEmpty ? "セッション" : id) {
                        Text("中継: \(localState == nil || localState == .null ? "この実行環境では確認できません" : label("phase",localState?["phase"]))")
                        Text("復旧データ: \(label("cache",cache?["state"])) · 最終保存状態: \(label("phase",cache?["terminal"]))")
                        Text("端末の受信位置: \(record.map { display($0["checkpoint"]?["decoder"]?["lastEventId"]) } ?? "この端末に記録なし")")
                        Text("保存イベント範囲: \(display(cache?["firstEventId"])) ～ \(display(cache?["lastEventId"]))")
                        Text("最終受信 / 保存: \(time(localState?["lastChunkAt"])) / \(time(cache?["updatedAt"])) · 保存期限: \(time(cache?["expiresAt"]))")
                        if localState != nil && localState != .null {
                            Text("端末向け最終送信: \(time(localState?["lastClientWriteAt"])) · 切断検出: \(time(localState?["disconnectedAt"]))")
                            Text("受信 / 保持バイト: \(display(localState?["receivedBytes"])) / \(display(localState?["bufferedBytes"]))")
                            Text("保存試行 / 失敗: \(Int((number(localState?["cacheWrites"]) ?? 0) + (number(localState?["cacheFailures"]) ?? 0))) / \(display(localState?["cacheFailures"]))")
                            Text("終了・切断理由: \(reason(localState?["reason"] ?? cache?["reason"])) · \(reason(localState?["disconnectReason"]))")
                        } else if cache?["reason"] != nil { Text("保存時の理由: \(reason(cache?["reason"]))") }
                        if cache?["state"] == .string("not-recorded") { Text("サーバーに受付記録がありません。この表示だけでは保存失敗と判断できません。").font(.footnote) }
                        if let record {
                            let recoverable = state.canRecoverProxyRecord(record)
                            Text("端末の記録: \(display(record["requestId"]))").font(.footnote)
                            if recoveryGaps[id] == .bool(true) { Text("受信位置と保存範囲が一致せず、欠落なく復旧できません。").foregroundStyle(.orange) }
                            if !recoverable { Text("保存先のバブルまたは内容が変更されています。自動で上書きしません。").foregroundStyle(.orange) }
                            if recoverable && recoveryGaps[id] != .bool(true) {
                                Button("このリクエストを復旧") { recover(id) }
                                    .disabled(busy || state.hasGenerations || state.isRecoveringStream)
                            }
                        }
                        if status["storageDeletion"]?["individual"] == .bool(true) {
                            Button("この保存データを削除",role:.destructive) { deletionID = id; confirmsDeletion = true }.disabled(busy || id.isEmpty)
                        }
                    }
                }
                if selectedID.isEmpty {
                    Section {
                        HStack {
                            Button("前の20件") { pages.removeLast() }.disabled(loading || pages.count == 1)
                            Spacer()
                            Text("\(pages.count)ページ目")
                            Spacer()
                            Button("次の20件") { if let cursor = string(status["nextCursor"]) { pages.append(cursor) } }.disabled(loading || string(status["nextCursor"]) == nil)
                        }
                    }
                }
            }
        }
        .navigationTitle("プロキシの状態")
        .task(id:key) { await poll(key) }
        .onDisappear { action?.cancel() }
        .confirmationDialog(deletionID == nil ? "プロキシの全保存データを削除しますか？" : "この保存データを削除しますか？",isPresented:$confirmsDeletion,titleVisibility:.visible) {
            Button("削除",role:.destructive) { delete() }
        } message: {
            Text("プロキシの復旧データと診断履歴を削除し、中継中の場合は停止します。端末に保存済みの会話は残ります。プロキシからは復旧できなくなります。")
        }
    }
}

private struct MessageViewportKey: EnvironmentKey {
    static let defaultValue = CGRect.zero
}
private extension EnvironmentValues {
    var messageViewport: CGRect {
        get { self[MessageViewportKey.self] }
        set { self[MessageViewportKey.self] = newValue }
    }
}

// Keep controls inside their message while following the visible bottom of the chat.
private struct FloatingMessageActions<Content: View>: View {
    @Environment(\.messageViewport) private var viewport
    @State private var controlsHeight: CGFloat = 44
    @ViewBuilder var content: () -> Content
    var body: some View {
        GeometryReader { geometry in
            let frame = geometry.frame(in:.global)
            let bottom = viewport.isEmpty ? frame.maxY : min(frame.maxY,viewport.maxY - 8)
            content()
                .fixedSize(horizontal:false,vertical:true)
                .frame(maxWidth:.infinity)
                .onGeometryChange(for:CGFloat.self,of:{ $0.size.height }) { controlsHeight = $0 }
                .offset(y:max(0,min(geometry.size.height - controlsHeight,bottom - frame.minY - controlsHeight)))
        }
    }
}
