import SwiftUI
import UniformTypeIdentifiers

struct LocalModelSettingsView: View {
    @ObservedObject var state: ChatState
    @State private var importingModelID: String?
    @State private var showsImporter = false
    @State private var copying = false
    @State private var errorMessage: String?
    @State private var fileStatus: String?

    private func name(_ model: OrderedJSON) -> String {
        (try? model["label"]?.string("label")) ?? (try? model["id"]?.string("id")) ?? "モデル"
    }
    private func singleGGUF(_ model: OrderedJSON) -> Bool {
        model["engine"] == .string("wllama") && model["manifest"]?["kind"] == .string("single-file")
    }
    private func save(_ action: () throws -> Void) {
        do { try action(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
    var body: some View {
        Form {
            Toggle("ローカルモデルを使用",isOn:Binding(get:{state.localModelsEnabled},set:{enabled in
                save { try state.saveLocalModelRole(enabled:enabled) }
            }))
            switch Result(catching:{try state.localModelDefinitions()}) {
            case .success(let models):
                Section("役割") {
                    ForEach(["generation","analysis"],id:\.self) { task in
                        let selectedID = state.activeLocalModel(task)
                        let selected = models.first { model in
                            guard let id = try? model["id"]?.string("id"), let selectedID else { return false }
                            return id.utf8.elementsEqual(selectedID.utf8)
                        }
                        Menu {
                            Button("未指定") { save { try state.saveLocalModelRole(task:task) } }
                            ForEach(models.indices,id:\.self) { index in
                                let model = models[index]
                                if singleGGUF(model), let id = try? model["id"]?.string("id"),
                                   let tasks = try? model["tasks"]?.array("tasks"), tasks.contains(.string(task)) {
                                    Button(name(model)) { save { try state.saveLocalModelRole(task:task,modelID:id) } }
                                }
                            }
                        } label: {
                            LabeledContent(task == "generation" ? "生成" : "分析・品質評価",value:selected.map(name) ?? selectedID ?? "未指定")
                                .frame(minHeight:44)
                        }
                    }
                    Text("ファイルの保存先は端末ごとに異なります。役割とモデル定義はWebと共通です。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("新しいモデル") {
                    Button("単一GGUFを登録") { importingModelID = nil; showsImporter = true }
                        .frame(minHeight:44)
                    Text("選択したファイルをこの端末に保存し、空いている生成・分析の役割に割り当てます。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("保存済みのモデル定義") {
                    if models.isEmpty { Text("登録済みのモデル定義がありません。") }
                    ForEach(models.indices,id:\.self) { index in
                        let model = models[index]
                        VStack(alignment:.leading,spacing:8) {
                            Text(name(model)).font(.headline)
                            if let id = try? model["id"]?.string("id") {
                                Text(id).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                                if singleGGUF(model) {
                                    let available = (try? state.localModelFiles.installed(modelID:id)) != nil
                                    Text(available ? "この端末にファイルあり" : "この端末のファイル未指定").font(.footnote)
                                    Button(available ? "GGUFファイルを置き換える" : "GGUFファイルを選択") {
                                        importingModelID = id; showsImporter = true
                                    }.frame(minHeight:44)
                                } else {
                                    Text("この形式の端末内実行は未対応です。定義は保持します。")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            case .failure(let error): Text(error.localizedDescription).foregroundStyle(.red)
            }
            if copying { ProgressView("ファイルを保存中…") }
            if let fileStatus { Text(fileStatus).font(.footnote) }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        }
        .disabled(copying || state.generation != nil || state.evaluationJobs.values.contains { $0.busy })
        .navigationTitle("ローカルモデル")
        .fileImporter(isPresented:$showsImporter,allowedContentTypes:[UTType(filenameExtension:"gguf") ?? .data]) { result in
            do {
                let source = try result.get()
                let modelID = importingModelID, files = state.localModelFiles
                copying = true; errorMessage = nil
                Task { @MainActor in
                    defer { copying = false }
                    do {
                        if let modelID {
                            try await Task.detached { try files.install(source,modelID:modelID) }.value
                            fileStatus = "ファイルを保存しました（" + modelID + "）"
                        } else {
                            let importedID = try await state.importSingleGGUF(source)
                            fileStatus = "モデルを登録しました（" + importedID + "）"
                        }
                    } catch { errorMessage = error.localizedDescription }
                }
            } catch { errorMessage = error.localizedDescription }
        }
    }
}

struct ChatConfigView: View {
    @ObservedObject var state: ChatState
    let auxiliary: Bool
    let saveAction: ((ChatConfigDraft) throws -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ChatConfigDraft
    @State private var values: [String:String]
    @State private var stream: Bool
    @State private var forceReasoning: Bool
    @State private var errorMessage: String?
    @State private var originalValues: [String:String]
    @State private var originalStream: Bool
    @State private var originalForce: Bool
    @State private var showsModels = false
    @State private var modelSource: String
    @State private var originalSource: String
    @State private var showsModelImporter = false
    @State private var showsLocalModelSettings = false
    @State private var importingModelID = ""
    @State private var copyingModel = false
    @State private var fileStatus: String?
    @State private var promptRequest: PromptPickerRequest?
    @State private var systemPresets: [SystemPromptPresetRow] = []
    @State private var presetWorker = PromptApplication()
    @State private var presetTask: Task<Void, Never>?
    @State private var pendingPreset: (request: PromptPickerRequest, choice: SystemPromptPresetChoice)?
    @State private var showsPresetConfirmation = false
    private static let fields = ["model", "providerId", "max_tokens", "temperature", "reasoning_effort", "reasoning_budget_tokens", "verbosity", "systemPrompt"]
    init(state: ChatState, draft: ChatConfigDraft, auxiliary: Bool = false, saveAction: ((ChatConfigDraft) throws -> Void)? = nil) {
        self.auxiliary = auxiliary; self.saveAction = saveAction
        self.state = state; _draft = State(initialValue:draft)
        let source = draft.config["modelSource"] == .string("local") ? "local" : "remote"
        _modelSource = State(initialValue:source); _originalSource = State(initialValue:source)
        let values = Dictionary(uniqueKeysWithValues:Self.fields.map { key -> (String,String) in
            let text: String
            switch draft.config[key] {
            case .string(let value), .number(let value): text = value
            default: text = ""
            }
            return (key,text)
        })
        let stream = draft.config["stream"] == .bool(true), force = draft.config["force_reasoning"] == .bool(true)
        _originalValues = State(initialValue:values); _originalStream = State(initialValue:stream); _originalForce = State(initialValue:force)
        _values = State(initialValue:values); _stream = State(initialValue:stream); _forceReasoning = State(initialValue:force)
    }
    static func valuesDiffer(_ lhs: String?, _ rhs: String?) -> Bool { !(lhs ?? "").utf8.elementsEqual((rhs ?? "").utf8) }
    private func binding(_ key: String) -> Binding<String> { Binding(get:{ values[key] ?? "" },set:{ values[key] = $0 }) }
    var body: some View {
        NavigationStack {
            Form {
                if draft.defaultSettings != nil {
                    Section("新規会話の初期値") {
                        TextField("システム文",text:Binding(get:{draft.defaultSettings?.systemMessage ?? ""},set:{draft.defaultSettings?.systemMessage = $0}),axis:.vertical)
                        systemPromptActions
                        Picker("画像品質",selection:Binding(get:{draft.defaultSettings?.imageDetail ?? "auto"},set:{draft.defaultSettings?.imageDetail = $0})) {
                            Text("自動").tag("auto"); Text("低").tag("low"); Text("高").tag("high")
                        }
                        Text("保存済みの会話は変更しません。").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if draft.defaultSettings == nil && !auxiliary {
                    Section("システム文") {
                        TextField("会話のシステム文", text: binding("systemPrompt"), axis: .vertical)
                        systemPromptActions
                    }
                }
                Picker("実行場所",selection:$modelSource) {
                    Text("オンライン").tag("remote")
                    if !auxiliary { Text("この端末（GGUF）").tag("local") }
                }
                if modelSource == "remote" { Button("保存済みモデル一覧から選択") {
                    do { draft = try editedDraft(); syncFields(); showsModels = true }
                    catch { errorMessage = error.localizedDescription }
                }
                }
                Button("入力したモデルへ切替・設定を復元") {
                    do { draft = try editedDraft(); syncFields() }
                    catch { errorMessage = error.localizedDescription }
                }
                TextField("モデルID",text:binding("model")).textInputAutocapitalization(.never).autocorrectionDisabled()
                if modelSource == "remote" {
                    TextField("provider ID（任意）",text:binding("providerId")).textInputAutocapitalization(.never).autocorrectionDisabled()
                } else {
                    Button("新しいGGUFを登録") { showsLocalModelSettings = true }
                    Button(copyingModel ? "モデルを保存中…" : "このモデルのGGUFファイルを選択") {
                        importingModelID = values["model"] ?? ""
                        showsModelImporter = true
                    }.disabled(copyingModel || (values["model"] ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    Text("ファイルはこの端末にコピーします。ほかの端末では同じモデルIDにファイルを選択してください。現在は単一GGUFに対応しています。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let fileStatus { Text(fileStatus).font(.footnote) }
                }
                Text("モデル切替時は保存済み設定を復元します。モデルに応じて出力上限を調整し、非対応モデルではストリーミングを使いません。ローカル実行は端末内のモデルファイルを使用します。")
                    .font(.footnote).foregroundStyle(.secondary)
                if !auxiliary { Toggle("streaming",isOn:$stream) }
                TextField("最大出力token（空欄で解除）",text:binding("max_tokens"))
                TextField("temperature（空欄で解除）",text:binding("temperature"))
                TextField("reasoning effort（任意）",text:binding("reasoning_effort")).textInputAutocapitalization(.never)
                TextField("reasoning budget tokens（任意）",text:binding("reasoning_budget_tokens"))
                TextField("verbosity（任意）",text:binding("verbosity")).textInputAutocapitalization(.never)
                Toggle("推論を要求",isOn:$forceReasoning)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .disabled(copyingModel)
            .navigationTitle(auxiliary ? "要約の生成設定" : draft.defaultSettings == nil ? "会話の生成設定" : "新規会話の既定設定")
            .fileImporter(isPresented:$showsModelImporter,allowedContentTypes:[UTType(filenameExtension:"gguf") ?? .data]) { result in
                do {
                    let source = try result.get(), modelID = importingModelID, files = state.localModelFiles
                    copyingModel = true; errorMessage = nil
                    Task { @MainActor in
                        defer { copyingModel = false }
                        do {
                            try await Task.detached { try files.install(source,modelID:modelID) }.value
                            fileStatus = "モデルファイルを保存しました（" + modelID + "）"
                        } catch { errorMessage = error.localizedDescription }
                    }
                } catch { errorMessage = error.localizedDescription }
            }
            .sheet(item: $promptRequest) { request in
                PromptPickerView(request: request) { result in
                    guard case .system(let applied) = result else { throw ExchangeError.invalid("システム文がありません") }
                    try setSystemPrompt(applied, request: request)
                }
            }
            .sheet(isPresented:$showsLocalModelSettings) { NavigationStack { LocalModelSettingsView(state:state) } }
            .sheet(isPresented:$showsModels) {
                ProviderModelsView(state:state,draft:$draft) { row in
                    draft.config = try ChatConfig.switched(draft.config,model:row.modelID,providerID:row.providerID,modelState:draft.modelState)
                    syncFields()
                }
            }
            .task {
                guard !auxiliary else { return }
                do {
                    let presets = try await presetWorker.systemPresets()
                    try Task.checkCancellation()
                    systemPresets = presets
                } catch is CancellationError { }
                catch { errorMessage = error.localizedDescription }
            }
            .confirmationDialog("現在のシステム文をプリセットに置き換えますか？", isPresented: $showsPresetConfirmation, titleVisibility: .visible) {
                Button("置き換える") {
                    guard let pending = pendingPreset else { return }
                    do { try setSystemPrompt(pending.choice.content, request: pending.request) }
                    catch { errorMessage = error.localizedDescription }
                    pendingPreset = nil
                }
                Button("取消", role: .cancel) { pendingPreset = nil }
            }
            .onDisappear { presetTask?.cancel(); pendingPreset = nil; showsPresetConfirmation = false }
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() }.disabled(copyingModel) }
                ToolbarItem(placement:.confirmationAction) { Button("保存",action:save).disabled(copyingModel) }
            }
        }
    }
    private var systemText: String { draft.defaultSettings?.systemMessage ?? values["systemPrompt"] ?? "" }
    private var systemPromptActions: some View {
        HStack {
            Menu("プリセット") {
                ForEach(systemPresets) { preset in
                    Section {
                        Button(preset.name + (preset.approxTokens.map { " · 約\($0) token/回" } ?? "")) { choosePreset(preset.id) }
                    } header: { Text(preset.description) }
                }
            }
            .frame(minHeight: 44)
            .disabled(state.generation != nil || presetTask != nil || systemPresets.isEmpty)
            Spacer()
            promptLibraryButton
        }
    }
    private func setSystemPrompt(_ text: String, request: PromptPickerRequest) throws {
        try state.validatePromptPicker(request, input: .system(text: systemText))
        if draft.defaultSettings != nil { draft.defaultSettings?.systemMessage = text }
        else { values["systemPrompt"] = text }
    }
    private func choosePreset(_ id: String) {
        do {
            let previous = systemText
            let request = try state.promptPickerRequest(.system(text: previous))
            presetTask = Task { @MainActor in
                defer { presetTask = nil }
                do {
                    let choice = try await presetWorker.systemPreset(id: id, previous: previous)
                    try Task.checkCancellation()
                    if choice.needsConfirmation {
                        try state.validatePromptPicker(request, input: .system(text: systemText))
                        pendingPreset = (request, choice)
                        showsPresetConfirmation = true
                    } else { try setSystemPrompt(choice.content, request: request) }
                } catch is CancellationError { }
                catch { errorMessage = error.localizedDescription }
            }
        } catch { errorMessage = error.localizedDescription }
    }
    private var promptLibraryButton: some View {
        Button("ライブラリから挿入") {
            do { promptRequest = try state.promptPickerRequest(.system(text: systemText)) }
            catch { errorMessage = error.localizedDescription }
        }
        .frame(minHeight: 44)
        .disabled(state.generation != nil)
    }
    private func editedDraft() throws -> ChatConfigDraft {
            var changed = draft
            if modelSource != originalSource || Self.valuesDiffer(values["model"],originalValues["model"]) || Self.valuesDiffer(values["providerId"],originalValues["providerId"]) {
                changed.config = try ChatConfig.switched(changed.config,model:values["model"] ?? "",providerID:modelSource == "local" ? nil : values["providerId"],modelState:draft.modelState,modelSource:modelSource)
            }
            var patches: [OrderedJSON] = []
            for key in Self.fields where key != "model" && key != "providerId" && Self.valuesDiffer(values[key],originalValues[key]) {
                let text = values[key] ?? "", value: OrderedJSON
                if text.isEmpty { patches.append(.object([.init(key:"op",value:.string("remove")),.init(key:"path",value:.array([.string(key)]))])); continue }
                if ["max_tokens", "temperature", "reasoning_budget_tokens"].contains(key) {
                    value = try OrderedJSON.decode(Data(text.utf8)); _ = try value.number(key)
                } else { value = .string(text) }
                patches.append(.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([.string(key)])),.init(key:"value",value:value)]))
            }
            if stream != originalStream { changed.config = changed.config.replacing("stream",with:.bool(stream)) }
            if forceReasoning != originalForce { changed.config = changed.config.replacing("force_reasoning",with:.bool(forceReasoning)) }
            changed.config = try OrderedJSONChanges.apply(.array(patches),to:changed.config)
            return changed
    }
    private func syncFields() {
        for key in Self.fields {
            switch draft.config[key] {
            case .string(let value), .number(let value): values[key] = value
            default: values[key] = ""
            }
        }
        stream = draft.config["stream"] == .bool(true); forceReasoning = draft.config["force_reasoning"] == .bool(true)
        modelSource = draft.config["modelSource"] == .string("local") ? "local" : "remote"
        originalSource = modelSource
        originalValues = values; originalStream = stream; originalForce = forceReasoning
    }
    private func save() {
        do {
            let edited = try editedDraft()
            if let saveAction { try saveAction(edited) }
            else if edited.defaultSettings != nil { try state.saveDefaultChatConfig(edited) }
            else { try state.saveChatConfig(edited) }
            dismiss()
        }
        catch { errorMessage = error.localizedDescription }
    }
}
