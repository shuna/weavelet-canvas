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
    private func number(_ value: OrderedJSON?, field: String) -> String {
        guard let value, case .number(let raw) = value, (try? value.number(field)) != nil else { return "—" }
        return raw
    }
    var body: some View {
        let roots = try? state.publicationSnapshot()["state"]
        let verified = (try? roots?["verifiedStats"]?.object("verified stats")) ?? []
        let pending = (try? roots?["pendingVerifications"]?.object("pending verifications")) ?? []
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
            if !verified.isEmpty {
                Section("OpenRouterの確定使用量") {
                    ForEach(verified.indices,id:\.self) { index in
                        let stats = verified[index].value
                        let model = (try? stats["model"]?.displayString("model")) ?? "モデル不明"
                        let generationID = (try? stats["generationId"]?.displayString("generation ID")) ?? "—"
                        VStack(alignment:.leading,spacing:4) {
                            Text(model).font(.subheadline)
                            Text(number(stats["nativePromptTokens"],field:"prompt tokens") + "+" + number(stats["nativeCompletionTokens"],field:"completion tokens") + " tokens · USD " + number(stats["totalCost"],field:"cost"))
                                .font(.caption).foregroundStyle(.secondary)
                            Text(generationID).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                }
            }
            if !pending.isEmpty {
                Section("OpenRouterの使用量確認待ち") {
                    ForEach(pending.indices,id:\.self) { index in
                        let item = pending[index].value
                        let key = try? pending[index].key.native("stats key")
                        let generationID = (try? item["generationId"]?.displayString("generation ID")) ?? "—"
                        let status = (try? item["status"]?.string("status")) ?? "pending"
                        VStack(alignment:.leading,spacing:4) {
                            Text(generationID).font(.subheadline).textSelection(.enabled)
                            Text(status == "fetching" ? "確認中" : status == "failed" ? "確認失敗" : "確認待ち")
                                .font(.caption).foregroundStyle(.secondary)
                            if let detail = try? item["lastError"]?.displayString("error"), !detail.isEmpty {
                                Text(detail).font(.caption).foregroundStyle(.secondary)
                            }
                            if let key {
                                Button("再確認",systemImage:"arrow.clockwise") {
                                    do { try state.retryOpenRouterVerification(key); state.runOpenRouterVerifications(); errorMessage = nil }
                                    catch { errorMessage = error.localizedDescription }
                                }.frame(minHeight:44).disabled(state.isVerifyingOpenRouter(key))
                            } else {
                                Text("識別子を表示できません").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            if let message = state.openRouterVerificationError { Text(message).font(.footnote).foregroundStyle(.secondary) }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        }
        .nativeNavigationTitle("利用量と費用")
        .confirmationDialog("保存済みの利用量の累計をリセットしますか？",isPresented:$confirmsReset,titleVisibility:.visible) {
            Button("累計をリセット",role:.destructive) {
                do { try state.resetUsageTotals(); errorMessage = nil }
                catch { errorMessage = error.localizedDescription }
            }
        }
    }
}
