import SwiftUI

struct UsageCostSettingsView: View {
    @ObservedObject var state: ChatState
    @State private var errorMessage: String?
    @State private var confirmsReset = false

    private func price(_ value: OrderedJSON) -> String {
        if value["kind"] == .string("unknown") {
            return value["reason"] == .string("model-not-registered") ? "モデル未登録" : "料金情報なし"
        }
        if value["isFree"] == .bool(true) { return "無料" }
        return "USD " + ((try? value.required("display").string("price")) ?? "—")
    }
    var body: some View {
        Form {
            Toggle("利用量を累計する",isOn:Binding(get:{ state.usageCountingEnabled },set:{ enabled in
                do { try state.saveUsageCounting(enabled); errorMessage = nil }
                catch { errorMessage = error.localizedDescription }
            }))
            if state.usageCountingEnabled {
                Section("推定費用") {
                    switch Result(catching: { try state.usageCostReport() }) {
                    case .success(let report):
                        if let rows = try? report.required("rows").array("rows") {
                            ForEach(rows.indices,id:\.self) { index in
                                LabeledContent((try? rows[index].required("label").string("model")) ?? "",value:price(rows[index]))
                            }
                        }
                        if let total = report["total"] { LabeledContent("合計",value:price(total)).bold() }
                    case .failure(let error): Text(error.localizedDescription).foregroundStyle(.red)
                    }
                    Text("モデル設定の単価に基づく推定費用です。生成中の推定値は表示にだけ加算します。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button("累計をリセット",role:.destructive) { confirmsReset = true }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        }
        .navigationTitle("利用量と費用")
        .confirmationDialog("保存済みの利用量の累計をリセットしますか？",isPresented:$confirmsReset,titleVisibility:.visible) {
            Button("累計をリセット",role:.destructive) {
                do { try state.resetUsageTotals(); errorMessage = nil }
                catch { errorMessage = error.localizedDescription }
            }
        }
    }
}
