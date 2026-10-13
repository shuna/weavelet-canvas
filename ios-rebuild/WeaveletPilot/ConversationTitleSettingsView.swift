import SwiftUI

struct ConversationTitleSettingsDraft: Identifiable {
    let id = UUID()
    let original: OrderedJSON
    let value: OrderedJSON
    var catalog: ChatConfigDraft
}

struct ConversationTitleSettingsView: View {
    @ObservedObject var state: ChatState
    let original: ConversationTitleSettingsDraft
    @Environment(\.dismiss) private var dismiss
    @State private var enabled: Bool
    @State private var model: String
    @State private var provider: String
    @State private var catalog: ChatConfigDraft
    @State private var selecting = false
    @State private var errorMessage: String?
    init(state: ChatState, draft: ConversationTitleSettingsDraft) {
        self.state = state; original = draft
        _enabled = State(initialValue:draft.value["autoTitle"] == .bool(true))
        _model = State(initialValue:(try? draft.value.required("titleModel").string("model")) ?? "")
        _provider = State(initialValue:(try? draft.value["titleProviderId"]?.string("provider")) ?? "")
        _catalog = State(initialValue:draft.catalog)
    }
    var body: some View {
        NavigationStack {
            Form {
                Toggle("タイトルを自動生成",isOn:$enabled)
                if enabled {
                    TextField("モデルID",text:$model).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("provider ID（任意）",text:$provider).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("保存済みモデルから選択") { selecting = true }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                if let titleError = state.titleError { Text(titleError).foregroundStyle(.red) }
            }
            .sheet(isPresented:$selecting) {
                ProviderModelsView(state:state,draft:$catalog) { row in model = row.modelID; provider = row.providerID }
            }
            .navigationTitle("タイトルの自動生成")
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) {
                    Button("保存") {
                        do {
                            var value = OrderedJSON.object([.init(key:"autoTitle",value:.bool(enabled)),.init(key:"titleModel",value:.string(model))])
                            if !provider.isEmpty { value = value.replacing("titleProviderId",with:.string(provider)) }
                            try state.saveTitleSettings(original,value:value); dismiss()
                        } catch { errorMessage = error.localizedDescription }
                    }
                }
            }
        }
    }
}
