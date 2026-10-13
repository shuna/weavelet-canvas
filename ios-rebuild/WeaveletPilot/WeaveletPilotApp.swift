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
    @State private var showsSettings = false
    @State private var showsLibrary = false
    @State private var showsSearch = false
    @State private var showsRemoteSettings = false
    @State private var shownGoogleConnection: GoogleSyncConnection?
    @State private var googleConnection: GoogleSyncConnection?
    @State private var input = ""
    @State private var showsImporter = false
    @State private var showsExporter = false
    @State private var exportDocument: WebJSONDocument?
    @State private var errorMessage: String?
    @State private var draft: MessageDraft?
    @State private var optionsDraft: NodeOptionsDraft?
    @State private var removalDraft: NodeRemovalDraft?
    @State private var showsRemoval = false
    @State private var branchDeletion: NodeTransformDraft?
    @State private var showsBranchDeletion = false
    @State private var clipboardDraft: BranchClipboardDraft?

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if let conversation = state.conversation {
                        ForEach(conversation.visibleMessages, id: \.identity) { node in
                            MessageView(node: node, siblings: state.siblings(for: node.id), style: state.style, edit: state.exchange == nil || state.generation != nil ? nil : {
                                do { draft = try state.messageDraft(nodeID: node.id) }
                                catch { errorMessage = error.localizedDescription }
                            }, insertBefore: state.exchange == nil || state.generation != nil ? nil : {
                                do { draft = try state.messageInsertionDraft(beforeNodeID: node.id) }
                                catch { errorMessage = error.localizedDescription }
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
                            }) { siblingID in
                                state.selectSibling(siblingID, of: node.id)
                            }
                            .id(node.identity)
                            .disabled(state.generation != nil)
                        }
                        if state.exchange != nil {
                            Button("本文を追加", systemImage: "plus.bubble") {
                                do { draft = try state.messageDraft(nodeID: nil) }
                                catch { errorMessage = error.localizedDescription }
                            }
                            .frame(minHeight: 44)
                            .disabled(state.generation != nil)
                            Button("非表示の枝を整理", systemImage: "line.3.horizontal.decrease") {
                                do { removalDraft = try state.pruneHiddenDraft(); showsRemoval = true }
                                catch { errorMessage = error.localizedDescription }
                            }
                            .frame(minHeight: 44).disabled(state.generation != nil)
                        }
                        if let generation = state.generation {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(generation.running ? "生成中" : "未保存の生成結果").font(.headline)
                                if !generation.output.reasoning.isEmpty { MessagePartView(part: .reasoning(generation.output.reasoning)) }
                                if !generation.output.text.isEmpty { MessagePartView(part: .text(generation.output.text)) }
                                if generation.running { Button("停止") { state.stopGeneration() }.frame(minHeight: 44) }
                                else { Button("生成結果の保存を再試行") {
                                    do { try state.saveGenerationResult() } catch { state.generationError = error.localizedDescription }
                                }.frame(minHeight: 44) }
                            }
                        }
                        if let generationError = state.generationError { Text(generationError).foregroundStyle(.red) }
                        if state.exchange != nil {
                            TextField("送信する本文", text: $input, axis: .vertical)
                                .lineLimit(3...8).textFieldStyle(.roundedBorder)
                                .disabled(state.generation != nil)
                            Button("送信", systemImage: "paperplane") {
                                do {
                                    let record = try RemoteCredentials.load()
                                    try state.startGeneration(input: input, record: record)
                                    input = ""
                                } catch { state.generationError = error.localizedDescription }
                            }
                            .frame(minHeight: 44)
                            .disabled(state.generation != nil || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
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
            .navigationTitle(RemoteFixture.enabled ? "Weavelet Pilot · FAKE" : "Weavelet Pilot")
            .task {
                guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
                do { try state.loadRemoteSettings() } catch { state.generationError = error.localizedDescription }
            }
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("編集を元に戻す", systemImage: "arrow.uturn.backward") {
                        do { try state.undoMessageEdit() } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canUndoMessageEdit)
                    Button("編集をやり直す", systemImage: "arrow.uturn.forward") {
                        do { try state.redoMessageEdit() } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canRedoMessageEdit)
                    Button("戻る", systemImage: "chevron.backward") {
                        do { try state.moveNavigation(.back) } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canNavigateBack || state.generation != nil)
                    Button("進む", systemImage: "chevron.forward") {
                        do { try state.moveNavigation(.forward) } catch { errorMessage = error.localizedDescription }
                    }.disabled(!state.canNavigateForward || state.generation != nil)
                }
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button("会話一覧", systemImage: "list.bullet") { showsLibrary = true }
                        .disabled(state.generation != nil)
                        .frame(minWidth: 44, minHeight: 44)
                    Picker("会話", selection: Binding(get: { Data(state.selectedConversationID.utf8) }, set: { state.selectedConversationID = String(decoding: $0, as: UTF8.self) })) {
                        ForEach(state.conversations, id: \.identity) { conversation in
                            Text(conversation.title).tag(conversation.identity)
                        }
                    }
                    .pickerStyle(.menu)
                    .disabled(state.generation != nil)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("検索", systemImage: "magnifyingglass") { showsSearch = true }
                        .disabled(state.exchange == nil || state.generation != nil)
                        .frame(minWidth: 44, minHeight: 44)
                    Menu("ファイル", systemImage: "doc") {
                        Button("V3 JSONを読み込む") { showsImporter = true }
                        Button("読み込んだV3 JSONを書き出す") {
                            do {
                                exportDocument = WebJSONDocument(data: try state.exportWebData())
                                showsExporter = true
                            } catch { errorMessage = error.localizedDescription }
                        }
                        .disabled(state.exchange == nil)
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(state.generation != nil)
                    Button("表示設定", systemImage: "slider.horizontal.3") { showsSettings = true }
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { return }
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    try state.importWebData(Data(contentsOf: url))
                } catch {
                    if (error as? CocoaError)?.code != .userCancelled { errorMessage = error.localizedDescription }
                }
            }
            .fileExporter(isPresented: $showsExporter, document: exportDocument, contentType: .json, defaultFilename: "weavelet-native-v3") { result in
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
            .sheet(item: $draft) { draft in MessageEditorView(state: state, draft: draft) }
            .sheet(item: $clipboardDraft) { draft in BranchClipboardView(state: state, draft: draft) }
            .sheet(item: $optionsDraft) { draft in NodeOptionsView(state: state, draft: draft) }
            .sheet(isPresented: $showsSearch) {
                ChatSearchView(state: state) { result, mode in
                    try state.navigate(chatID: result.chatID, nodeID: result.nodeID, source: mode == .grep ? .grep : .search)
                }
            }
            .sheet(isPresented: $showsLibrary) { ConversationLibraryView(state: state) }
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
                        Button("remote生成設定") { showsRemoteSettings = true }
                            .disabled(state.generation != nil)
                    }
                    .sheet(item: $shownGoogleConnection) { connection in
                        GoogleSyncSettingsView(connection: connection)
                    }
                    .sheet(isPresented: $showsRemoteSettings) { RemoteSettingsView(state: state) }
                    .navigationTitle("表示設定")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完了") { showsSettings = false } } }
                }
            }
        }
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
    var remove: (() -> Void)? = nil
    var moveUp: (() -> Void)? = nil
    var moveDown: (() -> Void)? = nil
    var replaceAndPrune: (() -> Void)? = nil
    var deleteBranch: (() -> Void)? = nil
    var copyRange: (() -> Void)? = nil
    var pasteRange: (() -> Void)? = nil
    var configure: (() -> Void)? = nil
    var toggleCollapse: (() -> Void)? = nil
    let select: (String) -> Void

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

    var body: some View {
        let isBubble = style == .bubbles
        HStack(spacing: 0) {
            if isBubble && node.role == "user" { Spacer(minLength: 24) }
            VStack(alignment: .leading, spacing: 12) {
                Label(roleName, systemImage: icon)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                if !node.options.label.isEmpty { Text(node.options.label).font(.subheadline).foregroundStyle(.secondary) }
                if node.options.starred || node.options.pinned || node.options.omitted || node.options.protected {
                    HStack(spacing: 12) {
                        if node.options.starred { Image(systemName: "star.fill").accessibilityLabel("スター") }
                        if node.options.pinned { Image(systemName: "pin.fill").accessibilityLabel("ピン留め") }
                        if node.options.omitted { Image(systemName: "eye.slash").accessibilityLabel("生成時の文脈から除外") }
                        if node.options.protected { Image(systemName: "lock.fill").accessibilityLabel("上書き・削除から保護") }
                    }.foregroundStyle(.secondary)
                }
                if node.options.collapsed {
                    Text("本文を折りたたみ中").foregroundStyle(.secondary)
                } else if node.parts.isEmpty {
                    Text(node.content)
                        .font(.body)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(Array(node.parts.enumerated()), id: \.offset) { _, part in
                        MessagePartView(part: part)
                    }
                }
                if edit != nil || insertBefore != nil || remove != nil || configure != nil || toggleCollapse != nil || moveUp != nil || moveDown != nil || replaceAndPrune != nil || deleteBranch != nil || copyRange != nil || pasteRange != nil {
                    Menu("メッセージ操作", systemImage: "ellipsis") {
                        if let edit { Button("編集", systemImage: "square.and.pencil", action: edit) }
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
                    }
                    .frame(minWidth: 44, minHeight: 44)
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
    }
}


struct MessagePartView: View {
    let part: MessagePart
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch part {
            case .text(let text): Text(text)
            case .reasoning(let text):
                Text("推論").font(.headline)
                Text(text)
            case .image(let url, let detail):
                Text("画像（\(detail)）").font(.headline)
                Text(url)
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
    static var readableContentTypes: [UTType] { [.json] }
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
    @Environment(\.dismiss) private var dismiss
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
                ForEach(folders, id: \.identity) { folder in
                    Section {
                        folderHeader(folder)
                        if folder.expanded {
                            ForEach(state.conversations.filter { state.folderID(for: $0.id)?.utf8.elementsEqual(folder.id.utf8) == true }, id: \.identity) { conversation in
                                conversationRow(conversation)
                            }
                        }
                    }
                }
                Section(folders.isEmpty ? "会話" : "未所属") {
                    ForEach(state.conversations.filter { conversation in
                        guard let id = state.folderID(for: conversation.id) else { return true }
                        return !folders.contains { $0.id.utf8.elementsEqual(id.utf8) }
                    }, id: \.identity) { conversation in conversationRow(conversation) }
                }
            }
            .navigationTitle("会話一覧")
            .onAppear {
                perform {
                    folders = try state.folderRows()
                    if let id = state.folderID(for: state.selectedConversationID), let folder = folders.first(where: { $0.id.utf8.elementsEqual(id.utf8) }), !folder.expanded {
                        try state.applyFolder(.expanded(id: id, expanded: true))
                    }
                }
            }
            .onChange(of: state.exchange?.source) { _, _ in perform {} }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("閉じる") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新規フォルダ", systemImage: "folder.badge.plus") { perform { try state.applyFolder(.create(id: UUID().uuidString.lowercased())) } }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新規", systemImage: "plus") { perform { try state.createChat(defaults: .webInitial()) } }
                }
                ToolbarItem(placement: .bottomBar) {
                    Menu("選択を移動（\(selected.count)）") {
                        moveButtons(ids: state.conversations.filter { selected.contains($0.identity) }.map(\.id))
                    }.disabled(selected.isEmpty)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("選択を削除（\(selected.count)）", role: .destructive) {
                        pendingDelete = state.conversations.filter { selected.contains($0.identity) }.map(\.id)
                        showsDelete = true
                    }
                    .disabled(selected.isEmpty)
                    .frame(minHeight: 44)
                }
            }
            .confirmationDialog("会話を削除しますか？", isPresented: $showsDelete, titleVisibility: .visible) {
                Button("削除", role: .destructive) {
                    perform {
                        try state.deleteChats(ids: pendingDelete, defaults: .webInitial())
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
            } message: { Text("会話は削除せず、未所属へ移します。") }
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
                if state.selectedConversationID.utf8.elementsEqual(conversation.id.utf8), state.persistenceError == nil { dismiss() }
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
                        perform { try state.duplicateChat(id: conversation.id) }
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

    private func folderHeader(_ folder: ChatFolderRow) -> some View {
        HStack {
            Button { perform { try state.applyFolder(.expanded(id: folder.id, expanded: !folder.expanded)) } } label: {
                HStack { Image(systemName: folder.expanded ? "chevron.down" : "chevron.right"); Image(systemName: "folder.fill").foregroundStyle(folderColor(folder.color)); Text(folder.name.isEmpty ? "（名前なし）" : folder.name).frame(maxWidth: .infinity, alignment: .leading) }.frame(minHeight: 44)
            }.buttonStyle(.borderless).accessibilityLabel("フォルダ: \(folder.name)").accessibilityValue(folder.expanded ? "展開中" : "閉じています")
            Menu {
                Button("このフォルダに新規会話") { perform { try state.createChat(defaults: .webInitial(), folder: folder.id) } }
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
            Button(folder.name.isEmpty ? "（名前なし）" : folder.name) {
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
                TextField("モデルID", text: $record.settings.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("API key", text: $record.key)
                Toggle("streaming", isOn: $record.settings.stream)
                Text("OpenAI互換remoteの文字列本文と推論に対応します。provider別設定・local生成・評価・token上限制御は未接続です。")
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
