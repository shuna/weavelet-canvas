import SwiftUI

struct ChatConfigView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    let draft: ChatConfigDraft
    @State private var values: [String:String]
    @State private var stream: Bool
    @State private var forceReasoning: Bool
    @State private var errorMessage: String?
    private let originalValues: [String:String]
    private let originalStream: Bool
    private let originalForce: Bool
    private static let fields = ["model", "providerId", "max_tokens", "temperature", "reasoning_effort", "reasoning_budget_tokens", "verbosity"]
    init(state: ChatState, draft: ChatConfigDraft) {
        self.state = state; self.draft = draft
        let values = Dictionary(uniqueKeysWithValues:Self.fields.map { key -> (String,String) in
            let text: String
            switch draft.config[key] {
            case .string(let value), .number(let value): text = value
            default: text = ""
            }
            return (key,text)
        })
        let stream = draft.config["stream"] == .bool(true), force = draft.config["force_reasoning"] == .bool(true)
        self.originalValues = values; self.originalStream = stream; self.originalForce = force
        _values = State(initialValue:values); _stream = State(initialValue:stream); _forceReasoning = State(initialValue:force)
    }
    private func binding(_ key: String) -> Binding<String> { Binding(get:{ values[key] ?? "" },set:{ values[key] = $0 }) }
    var body: some View {
        NavigationStack {
            Form {
                TextField("モデルID",text:binding("model")).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("provider ID（任意）",text:binding("providerId")).textInputAutocapitalization(.never).autocorrectionDisabled()
                Text("モデル切替時は保存済み設定を復元します。送信時はモデルの対応状況に応じて共有Web処理がstream・token・推論設定を補正します。localモデルは未対応です。")
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
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) { Button("保存",action:save) }
            }
        }
    }
    private func save() {
        do {
            var changed = draft
            if values["model"] != originalValues["model"] || values["providerId"] != originalValues["providerId"] {
                changed.config = try ChatConfig.switched(changed.config,model:values["model"] ?? "",providerID:values["providerId"],modelState:draft.modelState)
            }
            var patches: [OrderedJSON] = []
            for key in Self.fields where key != "model" && key != "providerId" && values[key] != originalValues[key] {
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
            try state.saveChatConfig(changed); dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
