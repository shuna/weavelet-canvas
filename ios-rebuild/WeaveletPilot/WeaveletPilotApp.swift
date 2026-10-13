import SwiftUI
import UniformTypeIdentifiers

@main
struct WeaveletPilotApp: App {
    @StateObject private var state = ChatState(store: WeaveletPilotApp.stateStore)
    private static var stateStore: LocalStateStore? {
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil { return nil }
        #if DEBUG
        if RemoteFixture.enabled { return LocalStateStore(fileURL: LocalStateStore.applicationStore.fileURL.deletingLastPathComponent().appendingPathComponent("debug-remote-fixture/local-state.json")) }
        #endif
        return .applicationStore
    }
    var body: some Scene {
        WindowGroup { ChatView(state: state) }
    }
}

struct ChatView: View {
    @ObservedObject var state: ChatState
    @State private var titleSettingsDraft: ConversationTitleSettingsDraft?
    @State private var defaultConfigDraft: ChatConfigDraft?
    @State private var showsSettings = false
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var preferredCompactColumn: NavigationSplitViewColumn = .detail
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var showsSearch = false
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
    @State private var pendingPartialImport: (data: Data, filename: String, message: String)?
    @State private var confirmsPartialImport = false
    @State private var showsExporter = false
    @State private var showsExportOptions = false
    @State private var pendingExport: ChatExport.Artifact?
    @State private var exportContentType: UTType = .json
    @State private var exportFilename = "weavelet-native-v3"
    @State private var exportDocument: WebJSONDocument?
    @State private var errorMessage: String?
    @State private var draft: MessageDraft?
    @State private var configDraft: ChatConfigDraft?
    @State private var optionsDraft: NodeOptionsDraft?
    @State private var removalDraft: NodeRemovalDraft?
    @State private var showsRemoval = false
    @State private var branchDeletion: NodeTransformDraft?
    @State private var showsBranchDeletion = false
    @State private var clipboardDraft: BranchClipboardDraft?
    @State private var summaryDraft: ConversationSummaryDraft?
    @State private var evaluationDraft: ConversationEvaluationDraft?

    var body: some View {
        let closeLibrary: (() -> Void)? = horizontalSizeClass == .compact ? { preferredCompactColumn = .detail } : nil
        NavigationSplitView(columnVisibility:$columnVisibility, preferredCompactColumn:$preferredCompactColumn) {
            ConversationLibraryView(state:state, onSelect: {
                preferredCompactColumn = .detail
            }, onClose: closeLibrary)
                .navigationSplitViewColumnWidth(min:260,ideal:300,max:380)
        } detail: {
        NavigationStack {
            ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if let conversation = state.conversation {
                        ForEach(conversation.visibleMessages, id: \.identity) { node in
                            let summaryInfo = try? state.summaryInfo(chatID:conversation.id,nodeID:node.id)
                            if summaryInfo?["hidden"] != .bool(true) {
                                messageRow(node:node,conversation:conversation,summaryInfo:summaryInfo)
                                    .id(node.identity)
                                    .disabled(state.generation != nil)
                                if state.isLocalConversation && node.role == "user" && !node.options.collapsed {
                                    prefillInput(key:state.assistantPrefillKey(nodeID:node.id))
                                }
                            }
                        }
                        if let generation = state.generation {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(generation.running ? "生成中" : "未保存の生成結果").font(.headline)
                                if !generation.output.reasoning.isEmpty { MessagePartView(part: .reasoning(generation.output.reasoning), isGenerating: generation.running) }
                                if !generation.output.text.isEmpty { MessagePartView(part: .text(generation.output.text), isGenerating: generation.running) }
                                if !generation.running { Button("生成結果の保存を再試行") {
                                    do { try state.saveGenerationResult() } catch { state.generationError = error.localizedDescription }
                                }.frame(minHeight: 44) }
                            }
                        }
                        if let generationError = state.generationError { Text(generationError).foregroundStyle(.red) }
                        if let titleError = state.titleError { Text(titleError).foregroundStyle(.red) }
                    } else {
                        ContentUnavailableView("会話がありません", systemImage: "bubble.left.and.bubble.right")
                    }
                }
                .padding(20)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: state.navigationFocus) { _, focus in
                if let focus { scroll.scrollTo(Data(focus.nodeID.utf8), anchor: .center) }
            }
            }
            .safeAreaInset(edge:.bottom,spacing:0) {
                if let conversation = state.conversation, state.exchange != nil { composer(conversation) }
            }
            .navigationTitle((state.conversation.flatMap { $0.title.isEmpty ? nil : $0.title } ?? "Weavelet Pilot") + (RemoteFixture.enabled ? " · FAKE" : ""))
            .navigationBarTitleDisplayMode(.inline)
            .task {
                guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                do { try state.loadRemoteSettings() } catch { state.generationError = error.localizedDescription }
                if cloudKitConnection == nil { cloudKitConnection = CloudKitSyncConnection(state:state) }
                cloudKitConnection?.run { try await cloudKitConnection?.restoreAutomaticSync() }
            }
            .onChange(of:scenePhase) { _, phase in if phase == .background { cloudKitConnection?.flushInBackground() } else if phase == .active { cloudKitConnection?.resumeOnForeground() } }
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    if horizontalSizeClass == .compact {
                        Button("会話一覧", systemImage: "sidebar.left") {
                            preferredCompactColumn = .sidebar
                        }
                            .disabled(state.generation != nil)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    Menu("履歴",systemImage:"arrow.uturn.backward.circle") {
                        Button("編集を元に戻す",systemImage:"arrow.uturn.backward") {
                            do { try state.undoMessageEdit() } catch { errorMessage = error.localizedDescription }
                        }.disabled(!state.canUndoMessageEdit)
                        Button("編集をやり直す",systemImage:"arrow.uturn.forward") {
                            do { try state.redoMessageEdit() } catch { errorMessage = error.localizedDescription }
                        }.disabled(!state.canRedoMessageEdit)
                        Button("戻る",systemImage:"chevron.backward") {
                            do { try state.moveNavigation(.back) } catch { errorMessage = error.localizedDescription }
                        }.disabled(!state.canNavigateBack || state.generation != nil)
                        Button("進む",systemImage:"chevron.forward") {
                            do { try state.moveNavigation(.forward) } catch { errorMessage = error.localizedDescription }
                        }.disabled(!state.canNavigateForward || state.generation != nil)
                    }
                    .frame(minWidth:44,minHeight:44)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu("会話操作",systemImage:"ellipsis.circle") {
                        Button("本文を追加",systemImage:"plus.bubble") {
                            do { draft = try state.messageDraft(nodeID:nil) }
                            catch { errorMessage = error.localizedDescription }
                        }.disabled(state.exchange == nil || state.generation != nil)
                        Button("非表示の枝を整理",systemImage:"line.3.horizontal.decrease") {
                            do { removalDraft = try state.pruneHiddenDraft(); showsRemoval = true }
                            catch { errorMessage = error.localizedDescription }
                        }.disabled(state.exchange == nil || state.generation != nil)
                    }
                    .frame(minWidth:44,minHeight:44)
                    Button("検索", systemImage: "magnifyingglass") { showsSearch = true }
                        .disabled(state.exchange == nil || state.generation != nil)
                        .frame(minWidth: 44, minHeight: 44)
                    Menu("ファイル", systemImage: "doc") {
                        Button("ファイルを取り込む") { showsImporter = true }.disabled(isPreparingImport)
                        Button("読み込んだV3 JSONを書き出す") {
                            do {
                                exportContentType = .json; exportFilename = "weavelet-native-v3"
                                exportDocument = WebJSONDocument(data: try state.exportWebData())
                                showsExporter = true
                            } catch { errorMessage = error.localizedDescription }
                        }
                        .disabled(state.exchange == nil)
                        Button("形式・範囲を指定して書き出す") { showsExportOptions = true }.disabled(state.exchange == nil)
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(state.generation != nil)
                    Button("表示設定", systemImage: "slider.horizontal.3") { showsSettings = true }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.json, .gzip], allowsMultipleSelection: false) { result in
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
            .sheet(isPresented: $showsExportOptions, onDismiss: {
                if let artifact = pendingExport {
                    exportDocument = WebJSONDocument(data: artifact.data); exportContentType = artifact.contentType; exportFilename = artifact.filename
                    pendingExport = nil; showsExporter = true
                }
            }) { ChatExportView(state: state) { pendingExport = $0 } }
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
            .sheet(item: $draft) { draft in MessageEditorView(state: state, draft: draft) }
            .sheet(item: $clipboardDraft) { draft in BranchClipboardView(state: state, draft: draft) }
            .sheet(item: $configDraft) { draft in ChatConfigView(state:state,draft:draft) }
            .sheet(item: $summaryDraft) { draft in ConversationSummaryView(state:state,draft:draft) }
            .sheet(item: $evaluationDraft) { draft in ConversationEvaluationView(state:state,draft:draft) }
            .sheet(item: $optionsDraft) { draft in NodeOptionsView(state: state, draft: draft) }
            .sheet(isPresented: $showsSearch) {
                ChatSearchView(state: state) { result, mode in
                    try state.navigate(chatID: result.chatID, nodeID: result.nodeID, source: mode == .grep ? .grep : .search)
                }
            }
            .sheet(isPresented: $showsSettings) {
                NavigationStack {
                    Form {
                        Picker("チャット表示", selection: $state.style) {
                            ForEach(ChatStyle.allCases) { style in Text(style.rawValue).tag(style) }
                        }
                        .pickerStyle(.inline)
                        Button("Google同期") {
                            if googleConnection == nil { googleConnection = GoogleSyncConnection(state: state) }
                            shownGoogleConnection = googleConnection
                        }.disabled(state.generation != nil)
                        Button("CloudKit同期") {
                            if cloudKitConnection == nil { cloudKitConnection = CloudKitSyncConnection(state:state) }
                            shownCloudKitConnection = cloudKitConnection
                        }.disabled(state.generation != nil)
                        Button("フォルダー同期・iCloud Drive") {
                            if folderConnection == nil { folderConnection = FolderSyncConnection(state:state) }
                            shownFolderConnection = folderConnection
                        }.disabled(state.generation != nil)
                        Button("タイトルの自動生成") {
                            do { titleSettingsDraft = try state.titleSettingsDraft() } catch { state.generationError = error.localizedDescription }
                        }.disabled(state.generation != nil)
                        Button("新規会話の既定設定") {
                            do { defaultConfigDraft = try state.defaultChatConfigDraft() }
                            catch { state.generationError = error.localizedDescription }
                        }.disabled(state.generation != nil)
                        NavigationLink("利用量と費用") { UsageCostSettingsView(state:state) }
                        NavigationLink("ローカルモデル") { LocalModelSettingsView(state:state) }
                        Button("remote生成設定") { showsRemoteSettings = true }
                            .disabled(state.generation != nil)
                    }
                    .sheet(item: $shownGoogleConnection) { connection in
                        GoogleSyncSettingsView(connection: connection)
                    }
                    .sheet(item: $shownCloudKitConnection) { connection in CloudKitSyncSettingsView(connection:connection) }
                    .sheet(item: $shownFolderConnection) { connection in FolderSyncSettingsView(connection:connection) }
                    .sheet(item: $titleSettingsDraft) { draft in ConversationTitleSettingsView(state:state,draft:draft) }
                    .sheet(item: $defaultConfigDraft) { draft in ChatConfigView(state:state,draft:draft) }
                    .sheet(isPresented: $showsRemoteSettings) { RemoteSettingsView(state: state) }
                    .navigationTitle("表示設定")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完了") { showsSettings = false } } }
                }
            }
        }
        }
        .environment(\.markdownSettings, (try? state.publicationSnapshot().required("state")) ?? .object([]))
    }
    private func composer(_ conversation: Conversation) -> some View {
        VStack(alignment:.leading,spacing:6) {
            HStack(alignment:.bottom,spacing:8) {
                Button {
                    do { configDraft = try state.chatConfigDraft() }
                    catch { errorMessage = error.localizedDescription }
                } label: { Image(systemName:"slider.horizontal.3").frame(width:44,height:44) }
                .accessibilityLabel("会話の生成設定")
                .disabled(state.generation != nil)
                TextField("送信する本文",text:Binding(
                    get:{ state.composerDraft(chatID:conversation.id).text },
                    set:{ state.setComposerText(chatID:conversation.id,text:$0) }),axis:.vertical)
                    .lineLimit(3...8).textFieldStyle(.roundedBorder)
                    .disabled(state.generation != nil)
                if state.generation?.running == true {
                    Button("停止",systemImage:"stop.fill") { state.stopGeneration() }
                        .frame(minWidth:44,minHeight:44)
                } else {
                    Button("送信",systemImage:"paperplane") {
                        do { try state.sendComposer() }
                        catch { state.generationError = error.localizedDescription }
                    }
                    .frame(minWidth:44,minHeight:44)
                    .disabled(state.generation != nil)
                }
            }
            if let detail = try? state.composerImageDetail(chatID:conversation.id) {
                ImageInputView(destinationID:conversation.id) { chatID, urls in
                    do { try state.addComposerImages(chatID:chatID,urls:urls,detail:detail) }
                    catch { state.generationError = error.localizedDescription }
                }
                .disabled(state.generation != nil)
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
        .padding(.horizontal,20).padding(.vertical,8)
        .frame(maxWidth:900)
        .frame(maxWidth:.infinity)
        .background(.regularMaterial)
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

    private func messageRow(node: MessageNode, conversation: Conversation, summaryInfo: OrderedJSON?) -> some View {
        let summarySelection: ((String,Bool) -> Void)? = state.exchange == nil || state.generation != nil ? nil : { id, use in
            do { try state.mutateSummary(chatID:conversation.id,action:"use",summaryID:id,use:use) }
            catch { errorMessage = error.localizedDescription }
        }
        return MessageView(node: node, siblings: state.siblings(for: node.id), style: state.style, edit: state.exchange == nil || state.generation != nil ? nil : {
            do { draft = try state.messageDraft(nodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, insertBefore: state.exchange == nil || state.generation != nil ? nil : {
            do { draft = try state.messageInsertionDraft(beforeNodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, regenerate: state.exchange == nil || state.generation != nil ? nil : {
            generate(node.id, operation: .regenerate)
        }, generateFromHere: state.exchange == nil || state.generation != nil ? nil : {
            generate(node.id, operation: .fromHere)
        }, remove: state.exchange == nil || state.generation != nil ? nil : {
            do { removalDraft = try state.nodeRemovalDraft(nodeID: node.id); showsRemoval = true }
            catch { errorMessage = error.localizedDescription }
        }, moveUp: state.exchange == nil || state.generation != nil ? nil : {
            move(node.id, direction: .up)
        }, moveDown: state.exchange == nil || state.generation != nil ? nil : {
            move(node.id, direction: .down)
        }, replaceAndPrune: state.exchange == nil || state.generation != nil ? nil : {
            do { draft = try state.messageReplacementDraft(nodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, deleteBranch: state.exchange == nil || state.generation != nil ? nil : {
            do { branchDeletion = try state.branchDeletionDraft(nodeID: node.id); showsBranchDeletion = true }
            catch { errorMessage = error.localizedDescription }
        }, copyRange: state.exchange == nil || state.generation != nil ? nil : {
            do { clipboardDraft = try state.branchClipboardDraft(nodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, pasteRange: state.exchange == nil || state.generation != nil || !state.hasBranchClipboard ? nil : {
            do { clipboardDraft = try state.branchClipboardDraft(nodeID: node.id, operation: .paste) }
            catch { errorMessage = error.localizedDescription }
        }, configure: state.exchange == nil || state.generation != nil ? nil : {
            do { optionsDraft = try state.nodeOptionsDraft(nodeID: node.id) }
            catch { errorMessage = error.localizedDescription }
        }, toggleCollapse: state.exchange == nil || state.generation != nil ? nil : {
            do {
                var changed = try state.nodeOptionsDraft(nodeID: node.id)
                changed.value.collapsed.toggle()
                try state.saveNodeOptions(changed)
            } catch { errorMessage = error.localizedDescription }
        }, openEvaluation: state.exchange == nil ? nil : {
            do { evaluationDraft = try state.evaluationDraft(nodeID:node.id) }
            catch { errorMessage = error.localizedDescription }
        }, toggleOmitted: state.exchange == nil || state.generation != nil ? nil : {
            do {
                var changed = try state.nodeOptionsDraft(nodeID:node.id)
                changed.value.omitted.toggle()
                try state.saveNodeOptions(changed)
            } catch { errorMessage = error.localizedDescription }
        }, toggleProtected: state.exchange == nil || state.generation != nil ? nil : {
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

struct MessageView: View {
    let node: MessageNode
    let siblings: [MessageNode]
    let style: ChatStyle
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
    var toggleCollapse: (() -> Void)? = nil
    var openEvaluation: (() -> Void)? = nil
    var toggleOmitted: (() -> Void)? = nil
    var toggleProtected: (() -> Void)? = nil
    var summaryInfo: OrderedJSON? = nil
    var openSummary: (() -> Void)? = nil
    var selectSummary: ((String,Bool) -> Void)? = nil
    let select: (String) -> Void
    @Environment(\.markdownSettings) private var markdownSettings
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

    @ViewBuilder private var messageOperations: some View {
        if edit != nil || insertBefore != nil || regenerate != nil || generateFromHere != nil || remove != nil || configure != nil || toggleCollapse != nil || moveUp != nil || moveDown != nil || replaceAndPrune != nil || deleteBranch != nil || copyRange != nil || pasteRange != nil {
            Menu {
                if let edit { Button("編集", systemImage: "square.and.pencil", action: edit) }
                if let regenerate { Button("再生成", systemImage:"arrow.clockwise",action:regenerate) }
                if let generateFromHere { Button("ここから生成",systemImage:"sparkles",action:generateFromHere) }
                if let insertBefore { Button("前に挿入", systemImage: "text.insert", action: insertBefore) }
                if let toggleCollapse { Button(node.options.collapsed ? "本文を展開" : "本文を折りたたむ", systemImage: node.options.collapsed ? "chevron.down" : "chevron.up", action: toggleCollapse) }
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
        }
    }

    private var headerTitle: some View {
        HStack(spacing: 8) {
            Label(roleName,systemImage:icon)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if node.options.starred { Image(systemName:"star.fill").accessibilityLabel("スター") }
            if node.options.pinned { Image(systemName:"pin.fill").accessibilityLabel("ピン留め") }
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
                        markdownMode = true; markdownRevision += 1
                    }
                    Button("テキストで表示",systemImage:"text.quote") {
                        markdownMode = false; markdownRevision += 1
                    }
                    Button("詳細設定",systemImage:"slider.horizontal.3",action:openSummary)
                } label: {
                    Label(tabName,systemImage:"chevron.down")
                        .font(.subheadline)
                        .frame(minHeight:44)
                }
                .accessibilityLabel("表示形式: \(tabName)")
            }
            if let openEvaluation {
                Button(action:openEvaluation) { Image(systemName:"checkmark.shield").frame(width:44,height:44) }
                    .accessibilityLabel("評価")
            }
        }
    }

    private var secondaryHeaderControls: some View {
        HStack(spacing:2) {
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
            messageOperations
        }
    }

    var body: some View {
        let isBubble = style == .bubbles
        let summary = summaryInfo?["summary"]
        let tab = (try? summaryInfo?["tab"]?.string("tab")) ?? "original"
        let showsSummary = tab != "original" && summaryInfo?["valid"] == .bool(true)
        HStack(spacing: 0) {
            if isBubble && node.role == "user" { Spacer(minLength: 24) }
            VStack(alignment: .leading, spacing: 12) {
                ViewThatFits(in:.horizontal) {
                    HStack(spacing:8) {
                        headerTitle
                        Spacer(minLength:8)
                        headerControls
                    }
                    VStack(alignment:.leading,spacing:0) {
                        headerTitle
                        headerControls.frame(maxWidth:.infinity,alignment:.trailing)
                    }
                }
                if !node.options.label.isEmpty { Text(node.options.label).font(.subheadline).foregroundStyle(.secondary) }
                if showsSummary, let text = try? summary?["text"]?.string("summary text") {
                    Text(tab == "compact" ? "圧縮" : "要約").font(.caption).foregroundStyle(.secondary)
                    MarkdownTextView(text:text)
                } else if node.options.collapsed {
                    Text("本文を折りたたみ中").foregroundStyle(.secondary)
                } else if node.parts.isEmpty {
                    MarkdownTextView(text: node.content)
                } else {
                    ForEach(Array(node.parts.enumerated()), id: \.offset) { _, part in
                        MessagePartView(part: part)
                    }
                }
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
            .frame(maxWidth: isBubble ? nil : .infinity, alignment: .leading)
            .padding(isBubble ? 16 : 0)
            .background {
                if isBubble {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(node.role == "user" ? Color.accentColor.opacity(0.12) : Color(uiColor: .secondarySystemBackground))
                }
            }
            if isBubble && node.role == "assistant" { Spacer(minLength: 24) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.markdownPresentation, MarkdownPresentation(mode:markdownMode,revision:markdownRevision,controlsHidden:openSummary != nil))
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
                Text(arguments)
            case .toolResult(let callID, let content):
                Text("ツール結果").font(.headline)
                Text("呼び出しID: \(callID)")
                Text(content)
            }
        }
        .font(.body)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct WebJSONDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json, .gzip, UTType(filenameExtension:"md") ?? .plainText] }
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


struct ConversationLibraryView: View {
    @ObservedObject var state: ChatState
    let onSelect: () -> Void
    let onClose: (() -> Void)?
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

    var body: some View {
        NavigationStack {
            List {
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
            .disabled(state.generation != nil)
            .navigationTitle("会話")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                perform {
                    folders = try state.folderRows()
                    if let id = state.folderID(for: state.selectedConversationID), let folder = folders.first(where: { $0.id.utf8.elementsEqual(id.utf8) }), (!folder.visible || !folder.expanded) {
                        try state.applyFolder(.move(chatIDs: [], folderID: id))
                        folders = try state.folderRows()
                    }
                }
            }
            .onChange(of: state.exchange?.source) { _, _ in perform {} }
            .toolbar {
                if let onClose {
                    ToolbarItem(placement: .topBarLeading) { Button("閉じる",action:onClose) }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新規フォルダ", systemImage: "folder.badge.plus") { perform { try state.applyFolder(.create(id: UUID().uuidString.lowercased())) } }
                        .disabled(state.generation != nil)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新規", systemImage: "plus") {
                        if perform({ try state.createChat() }) { onSelect() }
                    }
                    .disabled(state.generation != nil)
                }
                if !selected.isEmpty {
                    ToolbarItem(placement: .bottomBar) {
                        Menu {
                            moveButtons(ids: state.conversations.filter { selected.contains($0.identity) }.map(\.id))
                        } label: {
                            Image(systemName: "folder").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("選択した\(selected.count)件を移動")
                        .disabled(state.generation != nil)
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button(role: .destructive) {
                            pendingDelete = state.conversations.filter { selected.contains($0.identity) }.map(\.id)
                            showsDelete = true
                        } label: {
                            Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("選択した\(selected.count)件を削除")
                        .disabled(state.generation != nil)
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


    private func conversationRow(_ conversation: Conversation) -> some View {
        HStack {
            if state.exchange != nil {
                Button {
                    if !selected.insert(conversation.identity).inserted { selected.remove(conversation.identity) }
                } label: {
                    Image(systemName: selected.contains(conversation.identity) ? "checkmark.circle.fill" : "circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("選択対象: \(conversation.title)")
                .accessibilityValue(selected.contains(conversation.identity) ? "選択中" : "未選択")
            }
            Button {
                state.selectedConversationID = conversation.id
                if state.selectedConversationID.utf8.elementsEqual(conversation.id.utf8), state.persistenceError == nil { onSelect() }
                else { errorMessage = state.persistenceError }
            } label: {
                Text(conversation.title.isEmpty ? "（タイトルなし）" : conversation.title)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.borderless)
            if state.exchange != nil {
                Menu {
                    Button("改名") {
                        renameID = conversation.id
                        renameTitle = conversation.title
                        showsRename = true
                    }
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
            }
        }
    }

    private func folderTree(_ folder: ChatFolderRow) -> AnyView {
        AnyView(Group {
            folderHeader(folder)
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
                    }.disabled(isSaving || unavailableSelection || (mode == .append && selectedChats.isEmpty && selectedFolders.isEmpty) || state.generation != nil)
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
    let exported: (ChatExport.Artifact) -> Void
    @State private var format = ChatExport.Format.v3
    @State private var scope = ChatExport.Scope.all
    @State private var compressed = false
    @State private var errorMessage: String?
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
                case .markdown:
                    Text("現在の本文と画像URLを書き出します。メッセージの属性、推論・tool call・tool resultは含めません。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                Button("書き出しファイルを選ぶ") {
                    do { exported(try state.exportWebData(format:format,scope:scope,compressed:format == .v3 && compressed)); dismiss() }
                    catch { errorMessage = error.localizedDescription }
                }.disabled(state.generation != nil || state.exchange == nil)
            }
            .navigationTitle("会話を書き出す")
            .onChange(of: format) { _, next in if !next.scopes.contains(scope) { scope = next.scopes.first ?? .all } }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
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
                .disabled(state.generation != nil || (usesTarget && target?.nodes.isEmpty != false) || (draft.operation == .paste && !state.hasBranchClipboard))
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

    var body: some View {
        NavigationStack {
            Form {
                Picker("役割", selection: $draft.role) {
                    Text("ユーザー").tag("user")
                    Text("アシスタント").tag("assistant")
                    if draft.isInsertion || (draft.nodeID != nil && (draft.path.first?.utf8.elementsEqual(draft.nodeID!.utf8) == true || draft.originalRole == "system")) {
                        Text("システム").tag("system")
                    }
                }
                Section("本文") {
                    TextEditor(text: $draft.text).frame(minHeight: 220)
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
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
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
    @State private var errorMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                TextField("完了API URL（HTTPS）", text: $record.settings.endpoint).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("旧会話用の予備モデルID", text: $record.settings.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("API key", text: $record.key)
                Toggle("旧会話用の予備streaming", isOn: $record.settings.stream)
                Text("endpointとAPI keyは端末に保存します。modelとstreamingは会話設定を優先し、モデル未設定の旧会話だけ予備値を使います。local生成・評価は未接続です。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("remote生成設定")
            .task { do { record = try RemoteCredentials.load() } catch { errorMessage = error.localizedDescription } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("保存") {
                    do { try state.saveRemoteSettings(record); dismiss() } catch { errorMessage = error.localizedDescription }
                } }
            }
        }
    }
}
