import SwiftUI

struct NodeOptionsDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String
    let source: OrderedJSON
    let original: NodeOptions.Value
    var value: NodeOptions.Value
}

struct NodeOptionsView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @State var draft: NodeOptionsDraft
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("検索・整理") {
                    TextField("ラベル", text: $draft.value.label)
                    Toggle("スター", isOn: $draft.value.starred)
                    Toggle("ピン留め", isOn: $draft.value.pinned)
                }
                Section {
                    Toggle("本文を折りたたむ", isOn: $draft.value.collapsed)
                    Toggle("生成時の文脈から除外", isOn: $draft.value.omitted)
                    Toggle("上書き・削除から保護", isOn: $draft.value.protected)
                } header: { Text("表示と生成") } footer: {
                    Text("ツール呼び出し・結果を含むメッセージは、生成時の文脈から除外されません。")
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("メッセージ設定")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        do { try state.saveNodeOptions(draft); dismiss() }
                        catch { errorMessage = error.localizedDescription }
                    }.disabled(draft.value == draft.original || state.generation != nil)
                }
            }
        }
    }
}
