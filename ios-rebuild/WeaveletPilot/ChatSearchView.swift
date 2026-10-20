import SwiftUI

struct ChatSearchView: View {
    @ObservedObject var state: ChatState
    let navigate: (ChatSearchResult, ChatSearchMode) throws -> Void
    let inline: Bool
    let close: (() -> Void)?
    let library: Bool
    let chatIDs: [String]?
    let dismissOnSelection: Bool
    let reportError: ((String) -> Void)?
    let bodyFind: ConversationFind?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var inlineContentVisible = false
    @State private var inlineIsMounted = false
    // Keep literal query identity; Swift String equality merges canonical Unicode variants.
    @State private var queryBytes = Data()
    private var query: String {
        get { String(decoding:queryBytes,as:UTF8.self) }
        nonmutating set { queryBytes = Data(newValue.utf8) }
    }
    private var queryBinding: Binding<String> { Binding(get:{query},set:{query = $0}) }
    @State private var mode: ChatSearchMode = .grep
    @State private var scope: ChatSearchScope = .all
    @State private var starredOnly = false
    @State private var results: [ChatSearchResult] = []
    @State private var errorMessage: String?
    @State private var currentResultIndex = -1
    @FocusState private var queryFocused: Bool

    init(state: ChatState, initialMode: ChatSearchMode = .grep, initialScope: ChatSearchScope = .all, inline: Bool = false, close: (() -> Void)? = nil, library: Bool = false, chatIDs: [String]? = nil, dismissOnSelection: Bool = true, reportError: ((String) -> Void)? = nil, bodyFind: ConversationFind? = nil, navigate: @escaping (ChatSearchResult, ChatSearchMode) throws -> Void) {
        self.state = state
        self.navigate = navigate
        self.inline = inline
        self.close = close
        self.library = library
        self.chatIDs = chatIDs
        self.dismissOnSelection = dismissOnSelection
        self.reportError = reportError
        self.bodyFind = bodyFind
        _mode = State(initialValue: initialMode)
        _scope = State(initialValue: initialScope)
    }

    private var searchPrompt: String {
        library ? "会話を検索" : chatIDs == nil ? "現在の会話を検索" : "表示中の分岐図を検索"
    }
    private var scopePicker: some View {
        Picker("検索範囲",selection:$scope) {
            Text("表示中の経路").tag(ChatSearchScope.activePath)
            Text("すべての分岐").tag(ChatSearchScope.all)
        }.pickerStyle(.menu)
    }
    private var starredToggle: some View { Toggle("スターのみ",isOn:$starredOnly) }

    private var historyField: DisplaySetting {
        library ? .sidebarSearchHistory : chatIDs == nil ? .chatFindHistory : .searchHistory
    }
    private var historyMenu: some View {
        Menu {
            if let terms = try? state.displaySetting(historyField).array("search history") {
                ForEach(Array(terms.enumerated()),id:\.offset) { _, term in
                    if let text = try? term.displayString("query") { Button(text) { query = text; queryFocused = true } }
                }
                if terms.isEmpty { Text("履歴はありません") }
                if !terms.isEmpty {
                    Divider()
                    Button("検索履歴を消去",role:.destructive) {
                        do { try state.saveDisplaySetting(historyField,value:.array([])) }
                        catch { errorMessage = error.localizedDescription }
                    }
                }
            } else { Text("履歴を読み取れません") }
        } label: { Image(systemName:"clock.arrow.circlepath").frame(width:44,height:44) }
        .accessibilityLabel("検索履歴")
    }
    private func closeSearch() {
        do {
            try state.saveSearchQueryToHistory(query,field:historyField)
            queryFocused = false
            if inline { close?() } else { dismiss() }
        } catch { errorMessage = error.localizedDescription }
    }
    private func activate(_ index: Int, saveQuery: Bool = true, dismissAfter: Bool = false) {
        guard results.indices.contains(index) else { return }
        do {
            if saveQuery { try state.saveSearchQueryToHistory(query,field:historyField) }
            try navigate(results[index],mode)
            if mode == .nodes { bodyFind?.refreshAfterNodeNavigation() }
            currentResultIndex = index
            errorMessage = nil
            if dismissAfter {
                queryFocused = false
                if dismissOnSelection { if inline { close?() } else { dismiss() } }
            }
        } catch { errorMessage = error.localizedDescription }
    }
    private func stepResult(backward: Bool) {
        if usesBodyFind {
            do { try state.saveSearchQueryToHistory(query,field:historyField); bodyFind?.step(backward:backward) }
            catch { errorMessage = error.localizedDescription }
            return
        }
        do { activate(try ChatSearch.stepResult(index:currentResultIndex,count:results.count,backward:backward)) }
        catch { errorMessage = error.localizedDescription }
    }
    private var usesBodyFind: Bool { bodyFind != nil && mode == .nodes && scope == .activePath }
    private var resultControls: some View {
        HStack(spacing:0) {
            Text(results.indices.contains(currentResultIndex) ? "\(currentResultIndex + 1) / \(results.count)" : "0 / \(results.count)")
                .font(.caption).foregroundStyle(.secondary)
            Spacer(minLength:0)
            Button { stepResult(backward:true) } label: { Image(systemName:"chevron.up").frame(width:44,height:44) }
                .accessibilityLabel("前の検索結果")
            Button { stepResult(backward:false) } label: { Image(systemName:"chevron.down").frame(width:44,height:44) }
                .accessibilityLabel("次の検索結果")
        }.disabled(results.isEmpty || state.generation != nil)
    }

    private struct Request: Equatable {
        let query: Data
        let mode: ChatSearchMode
        let scope: ChatSearchScope
        let starredOnly: Bool
        let chatID: String
        let path: [String]
        let source: OrderedJSON?
        let chatIDs: [Data]?
    }
    private var request: Request {
        Request(query: Data(query.utf8), mode: mode, scope: scope, starredOnly: starredOnly, chatID: state.selectedConversationID, path: state.conversation?.visibleMessages.map(\.id) ?? [], source: state.exchange?.source, chatIDs:chatIDs?.map { Data($0.utf8) })
    }
    var body: some View {
        Group {
            if inline {
                VStack(spacing: 4) {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField(searchPrompt, text: queryBinding).textFieldStyle(.roundedBorder)
                            .accessibilityLabel(searchPrompt)
                            .focused($queryFocused)
                            .onSubmit { stepResult(backward:false) }
                        historyMenu
                        Button("閉じる",action:closeSearch).frame(minHeight:44)
                    }
                    if library {
                        Picker("検索対象",selection:$mode) {
                            Text("会話・フォルダ名").tag(ChatSearchMode.library)
                            Text("全会話の本文・ラベル").tag(ChatSearchMode.grep)
                        }.pickerStyle(.menu).font(.subheadline)
                    } else {
                        ViewThatFits(in:.horizontal) {
                            HStack { scopePicker; starredToggle; Spacer(minLength:0) }
                            VStack(alignment:.leading) { scopePicker; starredToggle }
                        }.font(.subheadline)
                    }
                    if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                    if library || !query.isEmpty || starredOnly {
                        if usesBodyFind, let bodyFind {
                            ConversationFindControls(find:bodyFind) { backward in
                                do { try state.saveSearchQueryToHistory(query,field:historyField); bodyFind.step(backward:backward) }
                                catch { errorMessage = error.localizedDescription }
                            }.disabled(state.generation != nil)
                        } else {
                            resultControls
                            if let bodyFind { ConversationFindIssue(find:bodyFind) }
                            ScrollView { LazyVStack(alignment:.leading,spacing:0) { resultRows } }
                                .frame(maxHeight:library ? .infinity : 180).buttonStyle(.plain)
                        }
                    }
                }.padding(.horizontal,12).padding(.bottom,8).background(.bar)
                    .compositingGroup()
                    .opacity(inlineContentVisible ? 1 : 0)
                    .offset(y:reduceMotion || inlineContentVisible ? 0 : -12)
                    .onAppear {
                        inlineIsMounted = true
                        withAnimation(.easeInOut(duration:0.35),completionCriteria:.removed) {
                            inlineContentVisible = true
                        } completion: {
                            if inlineIsMounted && inlineContentVisible { queryFocused = true }
                        }
                    }
                    .onDisappear {
                        inlineIsMounted = false
                        queryFocused = false
                    }
            } else {
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
                            resultRows
                        }
                    }
                    .searchable(text: queryBinding, prompt: "検索")
                    .navigationTitle("会話を検索")
                    .toolbar {
                        ToolbarItem(placement:.topBarLeading) { historyMenu }
                        ToolbarItem(placement:.confirmationAction) { Button("閉じる",action:closeSearch) }
                    }
                    .onSubmit(of:.search) { stepResult(backward:false) }
                }
            }
        }
        .task(id: request) {
            let highlightsNodes = bodyFind != nil && mode == .nodes && scope == .all
            let resetHighlight = bodyFind?.configure(query:query,enabled:usesBodyFind,starredOnly:starredOnly,highlightsNodes:highlightsNodes) ?? false
            if usesBodyFind { results = []; currentResultIndex = -1; errorMessage = nil; return }
            do {
                guard let source = state.exchange?.source else { results = []; return }
                let found = try ChatSearch.results(in: source, query: query, mode: mode, scope: scope,
                                                 starredOnly: mode == .nodes && starredOnly,
                                                 chatID: mode == .nodes && chatIDs == nil ? state.selectedConversationID : nil, chatIDs:chatIDs,
                                                 currentChatID: state.selectedConversationID, currentPath: chatIDs == nil ? state.conversation?.visibleMessages.map(\.id) : nil)
                let selection = try ChatSearch.resultSelection(previous:results,index:currentResultIndex,results:found)
                results = found
                currentResultIndex = highlightsNodes && resetHighlight ? (found.isEmpty ? -1 : 0) : selection.index
                errorMessage = nil
                if (chatIDs != nil || highlightsNodes) && (selection.shouldNavigate || resetHighlight) && state.generation == nil {
                    activate(currentResultIndex,saveQuery:false)
                }
            } catch { results = []; currentResultIndex = -1; errorMessage = error.localizedDescription }
        }
        .onDisappear {
            bodyFind?.configure(query:"",enabled:false)
            do { try state.saveSearchQueryToHistory(query,field:historyField) }
            catch { reportError?(error.localizedDescription) }
        }
    }
    @ViewBuilder private var resultRows: some View {
        ForEach(Array(results.enumerated()), id: \.offset) { index, result in
            Button {
                activate(index,dismissAfter:true)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(result.chatTitle.isEmpty ? "（名前なし）" : result.chatTitle).font(.subheadline.weight(.medium)).foregroundStyle(Color(uiColor:.label))
                    if !result.snippet.isEmpty { Text(result.snippet).font(.subheadline).lineLimit(3).foregroundStyle(Color(uiColor:.secondaryLabel)) }
                    if let label = result.label, !label.isEmpty { Text(label).font(.caption) }
                    if result.starred { Label("スター", systemImage: "star.fill").font(.caption) }
                }.frame(maxWidth: .infinity, minHeight:44, alignment: .leading).padding(.vertical, 4)
                    .accessibilityAddTraits(currentResultIndex == index ? .isSelected : [])
            }.disabled(state.generation != nil)
        }
    }
}

struct CollapsibleSearchPanel<Content: View>: View {
    let isPresented: Bool
    @ViewBuilder var content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var keepsContent = false
    @State private var expanded = false
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        VStack(spacing:0) {
            if keepsContent {
                content()
                    .fixedSize(horizontal:false,vertical:true)
                    .frame(maxWidth:.infinity)
                    .onGeometryChange(for:CGFloat.self,of:{ $0.size.height }) { height in
                        withAnimation(.easeInOut(duration:0.35)) {
                            contentHeight = height
                            expanded = isPresented
                        }
                    }
                    .offset(y:reduceMotion || expanded ? 0 : -12)
            }
        }
        .frame(height:expanded ? contentHeight : 0,alignment:.top)
        .opacity(expanded ? 1 : 0)
        .clipped()
        .allowsHitTesting(isPresented)
        .accessibilityHidden(!isPresented)
        .onChange(of:isPresented,initial:true) { _, presented in
            if presented {
                keepsContent = true
                withAnimation(.easeInOut(duration:0.35)) { expanded = true }
            } else {
                withAnimation(.easeInOut(duration:0.35),completionCriteria:.removed) {
                    expanded = false
                } completion: {
                    if !expanded { keepsContent = false }
                }
            }
        }
    }
}
