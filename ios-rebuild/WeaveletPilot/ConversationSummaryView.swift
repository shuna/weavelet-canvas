import SwiftUI

struct SummaryIdentity: Hashable {
    let chatID: String
    let nodeID: String
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.chatID.utf8.elementsEqual(rhs.chatID.utf8) && lhs.nodeID.utf8.elementsEqual(rhs.nodeID.utf8)
    }
    func hash(into hasher: inout Hasher) { hasher.combine(Data(chatID.utf8)); hasher.combine(Data(nodeID.utf8)) }
}

struct SummaryJob {
    let id: UUID
    let chatID: String
    let originNodeID: String
    let sourceNodeIDs: [String]
    var busy: Bool
    var warning: String? = nil
    var error: String? = nil
}

struct ConversationSummaryDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String
    let info: OrderedJSON
}

struct ConversationSummaryView: View {
    @ObservedObject var state: ChatState
    let draft: ConversationSummaryDraft
    @Environment(\.dismiss) private var dismiss
    @State private var mode = "single"
    @State private var format = "readable"
    @State private var configDraft: ChatConfigDraft?
    @State private var errorMessage: String?

    private var info: OrderedJSON { (try? state.summaryInfo(chatID:draft.chatID,nodeID:draft.nodeID,mode:mode)) ?? draft.info }
    private var job: SummaryJob? { state.summaryJob(chatID:draft.chatID,nodeID:draft.nodeID) }
    private var sources: [String] { ((try? info["sourceNodeIds"]?.array("source IDs")) ?? []).compactMap { try? $0.string("node ID") } }

    var body: some View {
        NavigationStack {
            Form {
                Section("処理対象") {
                    Picker("範囲",selection:$mode) {
                        Text("このバブル").tag("single")
                        Text("ここまで").tag("through")
                        Text("選択範囲").tag("range")
                    }
                    .pickerStyle(.segmented)
                    if mode == "range", let path = try? info["path"]?.array("path") {
                        ForEach(Array(path.enumerated()),id:\.offset) { index, entry in
                            let nodeID = (try? entry["nodeId"]?.string("node ID")) ?? ""
                            let targeted = entry["targeted"] == .bool(true)
                            Button {
                                do { try state.mutateSummary(chatID:draft.chatID,action:"target",nodeID:nodeID) }
                                catch { errorMessage = error.localizedDescription }
                            } label: {
                                HStack(alignment:.top) {
                                    Image(systemName:targeted ? "checkmark.square.fill" : "square")
                                    VStack(alignment:.leading) {
                                        Text("\(index + 1). " + ((try? entry["role"]?.string("role")) ?? ""))
                                        Text((try? entry["text"]?.string("text")) ?? "").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .disabled(job?.busy == true || entry["eligible"] != .bool(true))
                        }
                    }
                    Text("対象 \(sources.count)件").foregroundStyle(.secondary)
                }
                Section("形式") {
                    Picker("要約の形式",selection:$format) {
                        Text("読みやすい要約").tag("readable")
                        Text("AI投入用の圧縮").tag("compact")
                    }
                    .pickerStyle(.segmented)
                }
                Section("生成") {
                    Button("要約の生成設定",systemImage:"slider.horizontal.3") {
                        do { configDraft = try state.summaryConfigDraft(chatID:draft.chatID) }
                        catch { errorMessage = error.localizedDescription }
                    }.disabled(job?.busy == true)
                    if job?.busy == true {
                        ProgressView("生成中")
                        Button("停止",role:.destructive) { state.stopSummary(chatID:draft.chatID,nodeID:job?.originNodeID ?? draft.nodeID) }
                    } else {
                        Button("要約を生成") {
                            do { try state.startSummary(draft,sourceNodeIDs:sources,mode:mode,format:format == "compact" ? "compact" : nil); errorMessage = nil }
                            catch { errorMessage = error.localizedDescription }
                        }
                        .disabled(sources.isEmpty)
                    }
                    if let warning = job?.warning { Text(warning).foregroundStyle(.orange) }
                    if let error = job?.error ?? errorMessage { Text(error).foregroundStyle(.red) }
                }
                if let candidates = try? info["candidates"]?.array("candidates"), !candidates.isEmpty {
                    Section("保存済みの要約") {
                        ForEach(Array(candidates.enumerated()),id:\.offset) { _, candidate in
                            let id = (try? candidate["id"]?.string("summary ID")) ?? ""
                            let use = candidate["useForSubmit"] == .bool(true)
                            VStack(alignment:.leading,spacing:8) {
                                Text(candidate["format"] == .string("compact") ? "圧縮" : "要約").font(.subheadline.weight(.semibold))
                                Text((try? candidate["text"]?.string("text")) ?? "").textSelection(.enabled)
                                HStack {
                                    Button(use ? "原文を使う" : "表示・送信に使う") {
                                        do { try state.mutateSummary(chatID:draft.chatID,action:"use",summaryID:id,use:!use) }
                                        catch { errorMessage = error.localizedDescription }
                                    }
                                    Spacer()
                                    Button("削除",role:.destructive) {
                                        do { try state.mutateSummary(chatID:draft.chatID,action:"remove",summaryID:id) }
                                        catch { errorMessage = error.localizedDescription }
                                    }
                                }
                                .disabled(job?.busy == true)
                            }
                        }
                    }
                }
            }
            .nativeNavigationTitle("要約・圧縮")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement:.confirmationAction) { Button("閉じる") { dismiss() } } }
            .sheet(item:$configDraft) { config in
                ChatConfigView(state:state,draft:config,auxiliary:true) { edited in
                    try state.saveSummaryConfig(edited.config,expected:config.snapshot["state"]?["bubbleSummaryConfig"])
                }
            }
        }
    }
}
