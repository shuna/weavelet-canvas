import SwiftUI

struct ConversationEvaluationDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String
}
struct EvaluationJob {
    let id: UUID
    var busy: Bool
    var error: String? = nil
    var progress = OrderedJSON.object([])
}

struct ConversationEvaluationView: View {
    @ObservedObject var state: ChatState
    let draft: ConversationEvaluationDraft
    @Environment(\.dismiss) private var dismiss
    @State private var dimension = "quality"
    @State private var scope = "full-context"
    @State private var includeOmitted = false
    @State private var errorMessage: String?
    private var job: EvaluationJob? { state.evaluationJobs[.init(chatID:draft.chatID,nodeID:draft.nodeID)] }
    private var result: OrderedJSON? { try? state.evaluationResult(chatID:draft.chatID,nodeID:draft.nodeID) }
    private var report: OrderedJSON? { try? state.evaluationReport(chatID:draft.chatID,nodeID:draft.nodeID) }
    var body: some View {
        NavigationStack {
            Form {
                Section("評価対象") {
                    Picker("評価",selection:$dimension) {
                        Text("品質").tag("quality")
                        Text("安全性").tag("safety")
                    }.pickerStyle(.segmented)
                    Picker("範囲",selection:$scope) {
                        Text("この発言").tag("single")
                        Text("会話全体").tag("full-context")
                    }.pickerStyle(.segmented)
                    if scope == "full-context" { Toggle("送信から除外した発言も含める",isOn:$includeOmitted) }
                }.disabled(job?.busy == true)
                Section {
                    if job?.busy == true {
                        ProgressView("評価中")
                        if let fields = try? job?.progress.object("axis progress") {
                            ForEach(Array(fields.enumerated()),id:\.offset) { _, field in
                                HStack { Text(label(field.key.text)); Spacer(); Text(label((try? field.value.string("progress")) ?? "")) }
                            }
                        }
                        Button("停止",role:.destructive) { state.stopEvaluation(chatID:draft.chatID,nodeID:draft.nodeID) }
                    } else {
                        Button("評価を実行") {
                            do {
                                try state.startEvaluation(draft,dimension:dimension,scope:scope,omittedMode:includeOmitted ? "include-omitted" : "respect-omitted")
                                errorMessage = nil
                            } catch { errorMessage = error.localizedDescription }
                        }
                    }
                    if let error = job?.error ?? errorMessage { Text(error).foregroundStyle(.red) }
                }
                if let result = result?[dimension] {
                    Section("保存済みの評価") {
                        if result["source"] == .string("local") { Text("端末内モデルの評価（実験的）").font(.caption).foregroundStyle(.secondary) }
                        if let context = self.result?[dimension + "Context"] {
                            Text(context["scope"] == .string("single") ? "単一の発言" : "会話全体").foregroundStyle(.secondary)
                        }
                        if dimension == "quality" {
                            reportRows(report?["quality"]?["axes"])
                            suggestions(result["promptSuggestions"],title:"プロンプトへの提案")
                            suggestions(result["configSuggestions"],title:"設定への提案")
                        } else {
                            Text(result["flagged"] == .bool(true) ? "要確認" : "フラグなし")
                            reportRows(report?["safety"]?["categories"])
                        }
                    }
                }
            }
            .navigationTitle("評価")
            .toolbar { ToolbarItem(placement:.confirmationAction) { Button("閉じる") { dismiss() } } }
        }
    }
    private func label(_ key: String) -> String {
        ["taskCompletion":"課題の達成", "faithfulness":"事実への忠実さ", "coherence":"一貫性", "conciseness":"簡潔さ", "instructionFollowing":"指示への準拠",
         "roleClarity":"役割の明確さ", "constraintConsistency":"制約の整合性", "safetyAdequacy":"安全性の配慮", "operability":"運用のしやすさ",
         "sexual":"性的な内容", "hate":"憎悪", "harassment":"嫌がらせ", "self-harm":"自傷", "sexual/minors":"未成年の性的内容",
         "hate/threatening":"憎悪による脅迫", "violence/graphic":"生々しい暴力", "violence":"暴力", "harassment/threatening":"嫌がらせによる脅迫",
         "self-harm/intent":"自傷の意図", "self-harm/instructions":"自傷の手順", "illicit":"違法行為", "illicit/violent":"暴力を伴う違法行為",
         "waiting":"待機", "generating":"生成中", "done":"完了",
         "green":"良好", "yellow":"改善余地", "red":"要改善", "safe":"低リスク", "review":"要確認", "block":"高リスク"][key] ?? key
    }
    @ViewBuilder private func reportRows(_ values: OrderedJSON?) -> some View {
        if let entries = try? values?.array("evaluation rows") {
            ForEach(Array(entries.enumerated()),id:\.offset) { _, entry in
                VStack(alignment:.leading,spacing:4) {
                    HStack {
                        Text(label((try? entry["key"]?.string("axis")) ?? ""))
                        Spacer()
                        if let score = try? entry["score"]?.number("score") { Text(score,format:.number.precision(.fractionLength(2))) }
                        if let status = try? entry["status"]?.string("status") { Text(label(status)).font(.caption).foregroundStyle(.secondary) }
                    }
                    if let text = try? entry["reasoning"]?.string("reasoning"), !text.isEmpty { Text(text).foregroundStyle(.secondary).textSelection(.enabled) }
                }
            }
        }
    }
    @ViewBuilder private func suggestions(_ suggestions: OrderedJSON?, title: String) -> some View {
        if let values = try? suggestions?.array("suggestions"), !values.isEmpty {
            Text(title).font(.headline)
            ForEach(Array(values.enumerated()),id:\.offset) { _, value in
                if let text = try? value.string("suggestion") { Text(text).textSelection(.enabled) }
            }
        }
    }
}

struct EvaluationSettingsView: View {
    @ObservedObject var state: ChatState
    @State private var errorMessage: String?

    private func mode(_ key: String) -> Binding<String> {
        Binding(get: { (try? state.evaluationSettings()[key]?.string(key)) ?? "manual" }, set: { value in
            do { try state.saveEvaluationSetting(key,value:.string(value)); errorMessage = nil }
            catch { errorMessage = error.localizedDescription }
        })
    }
    var body: some View {
        Form {
            Section("安全性") {
                Picker("送信前",selection:mode("safetyPreSend")) { Text("手動").tag("manual"); Text("自動").tag("auto") }
                Picker("受信後",selection:mode("safetyPostReceive")) { Text("手動").tag("manual"); Text("自動").tag("auto") }
                let engine = (try? state.evaluationSettings()["safetyEngine"]?.string("engine")) ?? "remote"
                Picker("判定方式",selection:Binding(get:{ engine },set:{ value in
                    do { try state.saveEvaluationSetting("safetyEngine",value:.string(value)); errorMessage = nil }
                    catch { errorMessage = error.localizedDescription }
                })) {
                    Text("Remote").tag("remote"); Text("Local").tag("local"); Text("Hybrid").tag("hybrid")
                    if !["remote","local","hybrid"].contains(engine) { Text(engine).tag(engine) }
                }
                if engine == "hybrid" {
                    Toggle("Localで安全な場合もRemote判定",isOn:Binding(get:{
                        (try? state.evaluationSettings()["hybridRemoteOnSafe"]) != .bool(false)
                    },set:{ value in
                        do { try state.saveEvaluationSetting("hybridRemoteOnSafe",value:.bool(value)); errorMessage = nil }
                        catch { errorMessage = error.localizedDescription }
                    }))
                }
                if engine == "local" || engine == "hybrid" {
                    Text("選択したローカルモデルで自動判定します。読み込みや判定に失敗した場合は Remote を使用します。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("品質") {
                Picker("送信前",selection:mode("qualityPreSend")) { Text("手動").tag("manual"); Text("自動").tag("auto") }
                Picker("受信後",selection:mode("qualityPostReceive")) { Text("手動").tag("manual"); Text("自動").tag("auto") }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            if let automaticEvaluationError = state.automaticEvaluationError {
                Text(automaticEvaluationError).foregroundStyle(.red)
            }
        }
        .disabled(state.generation != nil)
        .navigationTitle("評価設定")
    }
}
