import SwiftUI

struct ChatConfigView: View {
    @ObservedObject var state: ChatState
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
    private static let fields = ["model", "providerId", "max_tokens", "temperature", "reasoning_effort", "reasoning_budget_tokens", "verbosity"]
    init(state: ChatState, draft: ChatConfigDraft) {
        self.state = state; _draft = State(initialValue:draft)
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
                Button("保存済みモデル一覧から選択") {
                    do { draft = try editedDraft(); syncFields(); showsModels = true }
                    catch { errorMessage = error.localizedDescription }
                }
                Button("入力したモデルへ切替・設定を復元") {
                    do { draft = try editedDraft(); syncFields() }
                    catch { errorMessage = error.localizedDescription }
                }
                TextField("モデルID",text:binding("model")).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("provider ID（任意）",text:binding("providerId")).textInputAutocapitalization(.never).autocorrectionDisabled()
                Text("モデル切替時は保存済み設定を復元します。モデルに応じて出力上限を調整し、非対応モデルではストリーミングを使いません。ローカルモデルは未対応です。")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("streaming",isOn:$stream)
                TextField("最大出力token（空欄で解除）",text:binding("max_tokens"))
                TextField("temperature（空欄で解除）",text:binding("temperature"))
                TextField("reasoning effort（任意）",text:binding("reasoning_effort")).textInputAutocapitalization(.never)
                TextField("reasoning budget tokens（任意）",text:binding("reasoning_budget_tokens"))
                TextField("verbosity（任意）",text:binding("verbosity")).textInputAutocapitalization(.never)
                Toggle("推論を要求",isOn:$forceReasoning)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("会話の生成設定")
            .sheet(isPresented:$showsModels) {
                ProviderModelsView(state:state,draft:$draft) { row in
                    draft.config = try ChatConfig.switched(draft.config,model:row.modelID,providerID:row.providerID,modelState:draft.modelState)
                    syncFields()
                }
            }
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) { Button("保存",action:save) }
            }
        }
    }
    private func editedDraft() throws -> ChatConfigDraft {
            var changed = draft
            if Self.valuesDiffer(values["model"],originalValues["model"]) || Self.valuesDiffer(values["providerId"],originalValues["providerId"]) {
                changed.config = try ChatConfig.switched(changed.config,model:values["model"] ?? "",providerID:values["providerId"],modelState:draft.modelState)
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
        originalValues = values; originalStream = stream; originalForce = forceReasoning
    }
    private func save() {
        do { try state.saveChatConfig(editedDraft()); dismiss() }
        catch { errorMessage = error.localizedDescription }
    }
}
