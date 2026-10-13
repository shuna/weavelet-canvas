import SwiftUI

struct ChatSearchView: View {
    @ObservedObject var state: ChatState
    let navigate: (ChatSearchResult, ChatSearchMode) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var mode: ChatSearchMode = .grep
    @State private var scope: ChatSearchScope = .all
    @State private var starredOnly = false
    @State private var results: [ChatSearchResult] = []
    @State private var errorMessage: String?

    init(state: ChatState, initialMode: ChatSearchMode = .grep, navigate: @escaping (ChatSearchResult, ChatSearchMode) throws -> Void) {
        self.state = state
        self.navigate = navigate
        _mode = State(initialValue: initialMode)
    }

    private struct Request: Equatable {
        let query: String
        let mode: ChatSearchMode
        let scope: ChatSearchScope
        let starredOnly: Bool
        let chatID: String
        let path: [String]
        let source: OrderedJSON?
    }
    private var request: Request {
        Request(query: query, mode: mode, scope: scope, starredOnly: starredOnly, chatID: state.selectedConversationID, path: state.conversation?.visibleMessages.map(\.id) ?? [], source: state.exchange?.source)
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("検索対象", selection: $mode) {
                        Text("会話・フォルダ名").tag(ChatSearchMode.library)
                        Text("全会話の本文・ラベル").tag(ChatSearchMode.grep)
                        Text("現在の会話の分岐").tag(ChatSearchMode.nodes)
                    }
                    if mode == .nodes {
                        Picker("分岐の範囲", selection: $scope) {
                            Text("すべての分岐").tag(ChatSearchScope.all)
                            Text("表示中の経路").tag(ChatSearchScope.activePath)
                        }
                        Toggle("スターのみ", isOn: $starredOnly)
                    }
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                Section("結果（\(results.count)）") {
                    ForEach(Array(results.enumerated()), id: \.offset) { _, result in
                        Button {
                            do { try navigate(result, mode); dismiss() }
                            catch { errorMessage = error.localizedDescription }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(result.chatTitle.isEmpty ? "（名前なし）" : result.chatTitle).font(.headline)
                                if !result.snippet.isEmpty { Text(result.snippet).lineLimit(3).foregroundStyle(.secondary) }
                                if let label = result.label, !label.isEmpty { Text(label).font(.caption) }
                                if result.starred { Label("スター", systemImage: "star.fill").font(.caption) }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                        }.disabled(state.generation != nil)
                    }
                }
            }
            .searchable(text: $query, prompt: "検索")
            .navigationTitle("会話を検索")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
            .task(id: request) {
                do {
                    guard let source = state.exchange?.source else { results = []; return }
                    results = try ChatSearch.results(in: source, query: query, mode: mode, scope: scope,
                                                     starredOnly: mode == .nodes && starredOnly,
                                                     chatID: mode == .nodes ? state.selectedConversationID : nil,
                                                     currentChatID: state.selectedConversationID, currentPath: state.conversation?.visibleMessages.map(\.id))
                    errorMessage = nil
                } catch { results = []; errorMessage = error.localizedDescription }
            }
        }
    }
}
