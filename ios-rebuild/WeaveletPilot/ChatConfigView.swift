import SwiftUI
import UniformTypeIdentifiers

struct LocalModelSettingsView: View {
    @ObservedObject var state: ChatState
    @State private var importingModelID: String?
    @State private var importingDirectoryModel: OrderedJSON?
    @State private var importTask: Task<Void, Never>?
    @State private var showsImporter = false
    @State private var copying = false
    @State private var importAllowsCancellation = false
    @State private var errorMessage: String?
    @State private var fileStatus: String?
    @State private var pendingRemoval: OrderedJSON?
    @State private var removing = false
    @State private var catalog: [OrderedJSON] = []
    @State private var catalogLoaded = false
    @StateObject private var hfSearch = HfModelSearch()
    @State private var hfDownloadIDs: [Data: String] = [:]

    private func name(_ model: OrderedJSON) -> String {
        (try? model["label"]?.string("label")) ?? (try? model["id"]?.string("id")) ?? "モデル"
    }
    private func singleGGUF(_ model: OrderedJSON) -> Bool {
        model["engine"] == .string("wllama") && model["manifest"]?["kind"] == .string("single-file")
    }
    private func multiFile(_ model: OrderedJSON) -> Bool {
        (model["engine"] == .string("transformers.js") && model["manifest"]?["kind"] == .string("multi-file")) ||
            (model["engine"] == .string("wllama") && model["manifest"]?["kind"] == .string("gguf-sharded"))
    }
    private func candidateKey(_ result: OrderedJSON, _ variant: OrderedJSON) -> Data? {
        guard let repository = try? result.required("repoId").string("repository"),
              let file = try? variant.required("fileName").string("GGUF file") else { return nil }
        return Data((repository + "\u{0}" + file).utf8)
    }
    private func save(_ action: () throws -> Void) {
        do { try action(); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
    var body: some View {
        Form {
            Group {
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
                                if singleGGUF(model) || multiFile(model), let id = try? model["id"]?.string("id"),
                                   let tasks = try? model["tasks"]?.array("tasks"), tasks.contains(.string(task)) {
                                    Button(name(model)) { save { try state.saveLocalModelRole(task:task,modelID:id) } }
                                }
                            }
                        } label: {
                            LabeledContent(task == "generation" ? "生成" : "分析・評価",value:selected.map(name) ?? selectedID ?? "未指定")
                                .frame(minHeight:44)
                        }
                    }
                    Text("ファイルの保存先は端末ごとに異なります。役割とモデル定義はWebと共通です。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("新しいモデル") {
                    Button("GGUFファイルを登録") { importingDirectoryModel = nil; importingModelID = nil; showsImporter = true }
                        .frame(minHeight:44)
                    Text("単一ファイル、または同じモデルの全分割ファイルを選択します。端末に保存し、空いている生成・分析の役割に割り当てます。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("保存済みのモデル定義") {
                    if models.isEmpty { Text("登録済みのモデル定義がありません。") }
                    ForEach(models.indices,id:\.self) { index in
                        let model = models[index]
                        VStack(alignment:.leading,spacing:8) {
                            HStack {
                                Text(name(model)).font(.subheadline.weight(.semibold))
                                Spacer()
                                let favorite = (try? state.publicationSnapshot()["state"]?["favoriteLocalModelIds"]?.array("favorites"))?.contains(model["id"] ?? .null) == true
                                Button(favorite ? "お気に入りから解除" : "お気に入りに追加",systemImage:favorite ? "star.fill" : "star") {
                                    save { try state.toggleLocalModelFavorite(model) }
                                }.labelStyle(.iconOnly).buttonStyle(.borderless).frame(minWidth:44,minHeight:44)
                            }
                            if let id = try? model["id"]?.string("id") {
                                Text(id).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                                if singleGGUF(model) {
                                    let available = (try? state.localModelFiles.installed(modelID:id)) != nil
                                    Text(available ? "この端末にファイルあり" : "この端末のファイル未指定").font(.footnote)
                                    Button(available ? "GGUFファイルを置き換える" : "GGUFファイルを選択") {
                                        importingDirectoryModel = nil; importingModelID = id; showsImporter = true
                                    }.frame(minHeight:44)
                                } else if multiFile(model) {
                                    let present = (try? state.localModelFiles.directoryIsPresent(modelID:id)) == true
                                    Text(present ? "この端末にフォルダーあり（内容未確認）" : "この端末のフォルダー未指定").font(.footnote)
                                    Button(present ? "モデルフォルダーを置き換える" : "モデルフォルダーを選択") {
                                        importingDirectoryModel = model; importingModelID = id; showsImporter = true
                                    }.frame(minHeight:44)
                                } else {
                                    Text("この形式の端末内実行は未対応です。定義は保持します。")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Button("モデルを削除",role:.destructive) { pendingRemoval = model }
                                    .buttonStyle(.borderless).frame(minHeight:44)
                            }
                        }
                    }
                }
            case .failure(let error): Text(error.localizedDescription).foregroundStyle(.red)
            }
            if copying { ProgressView("ファイルを保存中…") }
            if removing { ProgressView("モデルを削除中…") }
            if state.modelAssetRecoveryError != nil {
                Text("モデルファイルの復旧待ちです。再起動して復旧を再試行してください。")
                    .font(.footnote).foregroundStyle(.red)
            }
            if let fileStatus { Text(fileStatus).font(.footnote) }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .disabled(copying || removing || state.hasGenerations || state.evaluationJobs.values.contains { $0.busy })
            hfSearchSection
            catalogSection
        }
        .confirmationDialog("モデルを削除しますか？",isPresented:Binding(get:{pendingRemoval != nil},set:{if !$0 {pendingRemoval = nil}}),titleVisibility:.visible) {
            if let model = pendingRemoval {
                Button("モデルを削除",role:.destructive) {
                    pendingRemoval = nil; removing = true; errorMessage = nil; fileStatus = nil
                    Task { @MainActor in
                        defer { removing = false }
                        do { try await state.removeLocalModel(model); fileStatus = "モデルを削除しました" }
                        catch { errorMessage = error.localizedDescription }
                    }
                }
            }
            Button("取消",role:.cancel) { pendingRemoval = nil }
        } message: {
            Text("この端末のモデルファイルと、モデル定義・役割の割り当て・お気に入りを削除します。会話は保持します。")
        }
        .navigationTitle("ローカルモデル")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !catalogLoaded else { return }
            do { catalog = try state.localModelCatalog(); catalogLoaded = true }
            catch { errorMessage = error.localizedDescription }
        }
        .fileImporter(isPresented:$showsImporter,allowedContentTypes:importingDirectoryModel == nil ? [UTType(filenameExtension:"gguf") ?? .data] : [.folder],allowsMultipleSelection:importingModelID == nil) { result in
            do {
                let sources = try result.get()
                guard let source = sources.first else { return }
                let modelID = importingModelID, model = importingDirectoryModel
                guard importingModelID == nil || sources.count == 1 else { throw ExchangeError.invalid("置き換えるファイルまたはフォルダーを一つ選択してください") }
                importAllowsCancellation = model != nil || (modelID == nil && sources.count > 1)
                copying = true; errorMessage = nil; fileStatus = nil
                importTask = Task { @MainActor in
                    defer { copying = false; importTask = nil }
                    do {
                        if let model {
                            let importedID = try await state.importModelDirectory(source,model:model)
                            fileStatus = "モデルフォルダーを保存しました（" + importedID + "）"
                        } else if let modelID {
                            try await state.replaceLocalModelFile(source,modelID:modelID)
                            fileStatus = "ファイルを保存しました（" + modelID + "）"
                        } else {
                            let importedID = try await state.importGGUFFiles(sources)
                            fileStatus = "モデルを登録しました（" + importedID + "）"
                        }
                    } catch is CancellationError { fileStatus = "ファイルの保存を取り消しました" }
                    catch { errorMessage = error.localizedDescription }
                }
            } catch { errorMessage = error.localizedDescription }
        }
        .toolbar {
            if copying && importAllowsCancellation {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { importTask?.cancel() } }
            }
        }
        .onDisappear { if importAllowsCancellation { importTask?.cancel() } }
    }

    private var hfSearchSection: some View {
        Section("Hugging Face を検索") {
            TextField("リポジトリ名を検索", text: $hfSearch.query)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Picker("実行形式", selection: $hfSearch.engine) {
                Text("すべて").tag("all"); Text("GGUF").tag("wllama"); Text("Transformers").tag("transformers.js")
            }
            Picker("並び順", selection: $hfSearch.sort) {
                Text("更新日").tag("lastModified"); Text("ダウンロード数").tag("downloads"); Text("サイズ").tag("size")
            }
            Picker("順序", selection: $hfSearch.sortDirection) {
                Text("降順").tag("desc"); Text("昇順").tag("asc")
            }
            Button(hfSearch.searching ? "検索中…" : "検索") { hfSearch.search() }
                .frame(minHeight:44).disabled(hfSearch.searching)
            if hfSearch.searching || hfSearch.loadingMore {
                Button("検索を取り消す") { hfSearch.cancel() }.frame(minHeight:44)
            }
            if let error = hfSearch.error { Text(error).font(.footnote).foregroundStyle(.red) }
            ForEach(hfSearch.results.indices, id: \.self) { index in
                let result = hfSearch.results[index]
                hfResultRow(result)
                    .onAppear { hfSearch.loadVariants(for: result) }
            }
            if hfSearch.nextPageURL != nil {
                Button(hfSearch.loadingMore ? "追加分を取得中…" : "さらに読み込む") { hfSearch.loadMore() }
                    .frame(minHeight:44).disabled(hfSearch.loadingMore)
            }
        }
    }

    @ViewBuilder private func hfResultRow(_ result: OrderedJSON) -> some View {
        let repository = (try? result.required("repoId").string("repository")) ?? "Hugging Face"
        VStack(alignment:.leading, spacing:6) {
            Text(repository).font(.subheadline.weight(.semibold)).textSelection(.enabled)
            if let description = try? result["description"]?.string("description"), !description.isEmpty {
                Text(description).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
            if let variants = hfSearch.variants(for: result) {
                if variants.variants.isEmpty { Text("利用可能なGGUFはありません。").font(.footnote).foregroundStyle(.secondary) }
                else {
                    Picker("GGUF", selection: Binding(get: {
                        (try? hfSearch.selectedVariant(for: result)?.required("fileName").string("GGUF file")) ?? ""
                    }, set: { file in
                        if let selected = variants.variants.first(where: { (try? $0.required("fileName").string("GGUF file"))?.utf8.elementsEqual(file.utf8) == true }) {
                            hfSearch.select(variant:selected, for:result)
                        }
                    })) {
                        ForEach(variants.variants.indices, id: \.self) { variantIndex in
                            let variant = variants.variants[variantIndex]
                            Text((try? variant.required("label").string("GGUF label")) ?? "GGUF").tag((try? variant.required("fileName").string("GGUF file")) ?? "")
                        }
                    }
                    if let selected = hfSearch.selectedVariant(for: result) { hfVariantActions(result, selected) }
                }
            } else if let repository = try? result.required("repoId").string("repository"), hfSearch.variantFailures.contains(Data(repository.utf8)) {
                Text("GGUF候補を取得できませんでした。").font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
    }

    @ViewBuilder private func hfVariantActions(_ result: OrderedJSON, _ variant: OrderedJSON) -> some View {
        let status = (try? variant.required("supportStatus").string("variant status")) ?? "unsupported"
        if status == "unsupported" {
            Text((try? variant["supportReason"]?.string("variant reason")) ?? "このGGUFは利用できません。").font(.footnote).foregroundStyle(.secondary)
        } else {
            if status == "not-recommended", let reason = try? variant["supportReason"]?.string("variant reason") {
                Text(reason).font(.footnote).foregroundStyle(.secondary)
            }
            if let key = candidateKey(result, variant), let id = hfDownloadIDs[key] {
                let installedID = state.catalogDownload(id:id)?.installedModelID ?? id
                let installed = (try? state.localModelDefinitions())?.contains { model in
                    (try? model.required("id").string("model ID"))?.utf8.elementsEqual(installedID.utf8) == true &&
                        (try? state.localModelFiles.installed(model:model)) != nil
                } == true
                if installed {
                    Text("この端末にファイルあり").font(.footnote).foregroundStyle(.secondary)
                } else if let job = state.catalogDownload(id:id), job.running {
                    if let total = job.expectedBytes, total > 0 { ProgressView(value:Double(job.receivedBytes), total:Double(total)) }
                    else { ProgressView() }
                    Button("取得を取り消す") { state.cancelCatalogDownload(id:id) }.frame(minHeight:44)
                } else if let job = state.catalogDownload(id:id), let error = job.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                    Button("再試行") { startHfDownload(result, variant) }.frame(minHeight:44)
                } else if let job = state.catalogDownload(id:id), job.partial {
                    Button(job.canResume ? "取得を再開" : "再試行") { startHfDownload(result, variant) }.frame(minHeight:44)
                } else {
                    Button("再試行") { startHfDownload(result, variant) }.frame(minHeight:44)
                }
            } else {
                Button("ダウンロード", systemImage:"arrow.down.circle") { startHfDownload(result, variant) }.frame(minHeight:44)
            }
        }
    }

    private func startHfDownload(_ result: OrderedJSON, _ variant: OrderedJSON) {
        do {
            let id = try state.startHfModelDownload(result:result, variant:variant)
            if let key = candidateKey(result, variant) { hfDownloadIDs[key] = id }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private var catalogSection: some View {
        Section("モデルカタログ") {
            ForEach(catalog.indices,id:\.self) { index in
                let model = catalog[index]
                if let id = try? model["id"]?.string("model ID") {
                    let job = state.catalogDownload(id:id)
                    let registered = (try? state.localModelDefinitions())?.contains { model in
                        (try? model["id"]?.string("model ID"))?.utf8.elementsEqual(id.utf8) == true
                    } == true
                    let installed = registered && (try? state.localModelFiles.installed(modelID:id)) != nil
                    VStack(alignment:.leading,spacing:6) {
                        Text(name(model)).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        if let repo = try? model["huggingFaceRepo"]?.string("repository") {
                            Text(repo).font(.caption).foregroundStyle(.secondary)
                        }
                        if let bytes = try? model["expectedDownloadSize"]?.number("download size") {
                            Text(ByteCountFormatter.string(fromByteCount:Int64(bytes),countStyle:.file))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if job?.running == true {
                            if let total = job?.expectedBytes, total > 0 {
                                ProgressView(value:Double(job?.receivedBytes ?? 0),total:Double(total))
                            } else { ProgressView() }
                            Text(ByteCountFormatter.string(fromByteCount:job?.receivedBytes ?? 0,countStyle:.file))
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("取得を取り消す") { state.cancelCatalogDownload(id:id) }.frame(minHeight:44)
                        } else if installed && job?.error == nil {
                            Text("この端末にファイルあり").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Button(job?.canResume == true ? "取得を再開" : "ダウンロード",systemImage:"arrow.down.circle") {
                                save { try state.startCatalogDownload(id:id) }
                            }
                            .frame(minHeight:44)
                            .disabled(copying || state.hasGenerations || state.evaluationJobs.values.contains { $0.busy })
                        }
                        if let message = job?.error { Text(message).font(.footnote).foregroundStyle(.red) }
                    }
                }
            }
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
            case .utf16String(let units): text = JSONString(utf16: units).text
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
                            .disabled(!canEditSystemPrompt)
                        if !canEditSystemPrompt {
                            Text("文字情報を保持できないため、このシステム文はこの画面では編集・挿入できません。ほかの設定は保存できます。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
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
                    Text("ファイルはこの端末にコピーします。ほかの端末では同じモデルIDにファイルを選択してください。ここでは単一GGUFを指定します。分割モデルはローカルモデル設定から登録してください。")
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
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented:$showsModelImporter,allowedContentTypes:[UTType(filenameExtension:"gguf") ?? .data]) { result in
                do {
                    let source = try result.get(), modelID = importingModelID
                    copyingModel = true; errorMessage = nil
                    Task { @MainActor in
                        defer { copyingModel = false }
                        do {
                            try await state.replaceLocalModelFile(source,modelID:modelID)
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
    private var canEditSystemPrompt: Bool { draft.defaultSettings != nil || (try? ChatConfig.systemPromptForEditing(draft.config)) != nil }
    private func requireSystemPromptEditing() throws {
        if draft.defaultSettings == nil { _ = try ChatConfig.systemPromptForEditing(draft.config) }
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
        .disabled(!canEditSystemPrompt)
    }
    private func setSystemPrompt(_ text: String, request: PromptPickerRequest) throws {
        try requireSystemPromptEditing()
        try state.validatePromptPicker(request, input: .system(text: systemText))
        if draft.defaultSettings != nil { draft.defaultSettings?.systemMessage = text }
        else { values["systemPrompt"] = text }
    }
    private func choosePreset(_ id: String) {
        do {
            try requireSystemPromptEditing()
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
            do {
                try requireSystemPromptEditing()
                promptRequest = try state.promptPickerRequest(.system(text: systemText))
            }
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
                if key == "systemPrompt" { try requireSystemPromptEditing() }
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
            case .utf16String(let units): values[key] = JSONString(utf16: units).text
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

struct ConversationModelInspector: View {
    @ObservedObject var state: ChatState
    let close: () -> Void
    @State private var configDraft: ChatConfigDraft?
    @State private var errorMessage: String?
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private func value(_ config: OrderedJSON, _ key: String) -> String {
        guard let raw = config[key] else { return "未指定" }
        if case .bool(let enabled) = raw { return enabled ? "オン" : "オフ" }
        if case .number(let text) = raw { return text }
        if raw == .null { return "未指定" }
        return (try? raw.displayString(key)) ?? "表示できない値"
    }
    var body: some View {
        NavigationStack {
            Form {
                if let draft = try? state.chatConfigDraft() {
                    Section("現在のモデル") {
                        LabeledContent("モデル",value:value(draft.config,"model"))
                        LabeledContent("Provider",value:value(draft.config,"providerId"))
                        LabeledContent("実行先",value:draft.config["modelSource"] == .string("local") ? "この端末" : "オンライン")
                    }
                    Section("生成プロパティ") {
                        LabeledContent("最大出力トークン",value:value(draft.config,"max_tokens"))
                        LabeledContent("Temperature",value:value(draft.config,"temperature"))
                        LabeledContent("Top P",value:value(draft.config,"top_p"))
                        LabeledContent("ストリーミング",value:value(draft.config,"stream"))
                        LabeledContent("推論の強さ",value:value(draft.config,"reasoning_effort"))
                        LabeledContent("推論トークン予算",value:value(draft.config,"reasoning_budget_tokens"))
                        LabeledContent("応答の詳しさ",value:value(draft.config,"verbosity"))
                    }
                    Button("生成設定を編集",systemImage:"slider.horizontal.3") {
                        do { configDraft = try state.chatConfigDraft(); errorMessage = nil }
                        catch { errorMessage = error.localizedDescription }
                    }.frame(minHeight:44).disabled(state.generation != nil)
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.secondary) }
                } else {
                    ContentUnavailableView("会話を選択してください",systemImage:"bubble.left")
                }
            }
            .sheet(item:$configDraft) { draft in ChatConfigView(state:state,draft:draft) }
            .textSelection(.enabled)
            .navigationTitle("モデルのプロパティ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement:horizontalSizeClass == .compact ? .topBarLeading : .topBarTrailing) {
                    Button("プロパティを閉じる",systemImage:horizontalSizeClass == .compact ? "xmark.circle" : "sidebar.trailing",action:close)
                        .labelStyle(.iconOnly)
                }
            }
        }
    }
}
