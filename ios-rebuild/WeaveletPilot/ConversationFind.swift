import SwiftUI
import WebKit

struct ConversationFindBody: Equatable {
    let id: String
    let nodeID: String
    let text: String
    let rendered: Bool
    let inlineLatex: Bool
    static func key(_ nodeID: String, _ part: String, context: Data? = nil) -> String { (context?.base64EncodedString() ?? "") + ":" + Data(nodeID.utf8).base64EncodedString() + ":" + part }
    static func == (a: Self, b: Self) -> Bool {
        a.id == b.id && a.text.utf8.elementsEqual(b.text.utf8) && a.rendered == b.rendered && a.inlineLatex == b.inlineLatex
    }
    var arguments: [String:Any] { ["id":id,"text":text,"rendered":rendered,"inlineLatex":inlineLatex] }
}

// The shared renderer indexes all displayed bodies; lazy SwiftUI rows only draw and report geometry.
@MainActor final class ConversationFind: ObservableObject {
    struct Match: Equatable { let bodyID: String; let nodeID: String; let index: Int }
    struct ScrollTarget: Equatable { let bodyID: String; let rect: CGRect; let height: CGFloat; let revision: UUID }
    @Published private(set) var query = ""
    @Published private(set) var enabled = false
    @Published private(set) var highlightsNodes = false
    @Published private(set) var nodeNavigation = UUID()
    var active: Bool { enabled || highlightsNodes }
    @Published private(set) var starredOnly = false
    @Published private(set) var matches: [Match] = []
    @Published private(set) var selectedIndex = -1
    @Published private(set) var ranges: [String:[NSRange]] = [:]
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var revision = UUID()
    @Published private(set) var reveal = UUID()
    @Published private(set) var scrollTarget: ScrollTarget?
    @Published private(set) var modes: [String:Bool] = [:]
    @Published private(set) var rawFallbacks: Set<String> = []
    private let indexer = ConversationFindIndexer()
    private let indexOperation: (([ConversationFindBody],String) async throws -> [String:ConversationFindIndexer.Result])?
    init(index: (([ConversationFindBody],String) async throws -> [String:ConversationFindIndexer.Result])? = nil) { indexOperation = index }
    func setFallback(_ fallback: Bool, bodyID: String) {
        if fallback { if !rawFallbacks.contains(bodyID) { rawFallbacks.insert(bodyID) } }
        else if rawFallbacks.contains(bodyID) { rawFallbacks.remove(bodyID) }
    }
    func suspend() { invalidate(); busy = true }
    private var indexedBodies: [ConversationFindBody] = []
    private var indexedCounts: [String:Int] = [:]
    private var epoch = UUID()
    var selected: Match? { matches.indices.contains(selectedIndex) ? matches[selectedIndex] : nil }
    @discardableResult func configure(query: String, enabled: Bool, starredOnly: Bool = false, highlightsNodes: Bool = false) -> Bool {
        guard !self.query.utf8.elementsEqual(query.utf8) || self.enabled != enabled || self.starredOnly != starredOnly || self.highlightsNodes != highlightsNodes else { return false }
        self.query = query; self.enabled = enabled; self.starredOnly = starredOnly; self.highlightsNodes = highlightsNodes; invalidate()
        return true
    }
    func refreshAfterNodeNavigation() {
        guard highlightsNodes else { return }
        invalidate(); nodeNavigation = UUID()
    }
    func setMode(_ value: Bool, nodeID: String, context: Data? = nil) { modes[ConversationFindBody.key(nodeID,"mode",context:context)] = value }
    private func invalidate() {
        epoch = UUID(); indexedBodies = []; indexedCounts = [:]; matches = []; ranges = [:]; selectedIndex = -1; scrollTarget = nil; error = nil; busy = false; revision = UUID()
    }
    func search(_ bodies: [ConversationFindBody]) async {
        guard active, !query.isEmpty else { invalidate(); return }
        let token = UUID(); epoch = token; busy = true; error = nil
        let previous = selected
        indexedBodies = []; indexedCounts = [:]
        matches = []; ranges = [:]; selectedIndex = -1; scrollTarget = nil; revision = UUID()
        do {
            try await Task.sleep(nanoseconds:250_000_000)
            let indexed: [String:ConversationFindIndexer.Result]
            if let indexOperation { indexed = try await indexOperation(bodies,query) }
            else { indexed = try await indexer.index(bodies,query:query) }
            try Task.checkCancellation()
            guard epoch == token else { return }
            var found: [Match] = [], raw: [String:[NSRange]] = [:]
            for body in bodies {
                guard let result = indexed[body.id] else { throw ExchangeError.invalid("検索対象の結果が不足しています") }
                raw[body.id] = result.ranges
                found += (0..<result.count).map { Match(bodyID:body.id,nodeID:body.nodeID,index:$0) }
            }
            indexedBodies = bodies; indexedCounts = indexed.mapValues(\.count)
            matches = found; ranges = raw
            selectedIndex = highlightsNodes ? (found.isEmpty ? -1 : 0) : previous.flatMap { found.firstIndex(of:$0) } ?? (found.isEmpty ? -1 : 0)
            busy = false; revision = UUID(); reveal = revision; scrollTarget = nil
        } catch is CancellationError {
            if epoch == token { busy = false }
        } catch {
            guard epoch == token else { return }
            matches = []; ranges = [:]; selectedIndex = -1; busy = false; self.error = error.localizedDescription
        }
    }
    func step(backward: Bool) {
        do { selectedIndex = try ChatSearch.stepResult(index:selectedIndex,count:matches.count,backward:backward); revision = UUID(); reveal = revision; scrollTarget = nil }
        catch { self.error = error.localizedDescription }
    }
    func request(for bodyID: String) -> MarkdownFindRequest? {
        guard active, !query.isEmpty, ranges[bodyID] != nil else { return nil }
        return .init(query:query,index:selected?.bodyID == bodyID ? selected!.index : -1,requestID:revision.uuidString + bodyID)
    }
    func accept(_ result: MarkdownFindResult, bodyID: String) {
        guard !busy, request(for:bodyID)?.requestID == result.requestID else { return }
        if let error = result.error { self.error = error; return }
        guard indexedCounts[bodyID] != result.count else { return }
        let previous = selected
        indexedCounts[bodyID] = result.count
        let found = indexedBodies.flatMap { body in
            (0..<(indexedCounts[body.id] ?? 0)).map { Match(bodyID:body.id,nodeID:body.nodeID,index:$0) }
        }
        let previousIndex = selectedIndex
        matches = found
        selectedIndex = previous.flatMap { found.firstIndex(of:$0) } ?? (found.isEmpty ? -1 : min(max(previousIndex,0),found.count-1))
        // DOM refresh can adjust selection without moving the user's scroll position.
        revision = UUID(); scrollTarget = nil
    }
    func report(bodyID: String, index: Int, rect: CGRect?, height: CGFloat) {
        guard revision == reveal, selected?.bodyID == bodyID, selected?.index == index, let rect, height > 0 else { return }
        let target = ScrollTarget(bodyID:bodyID,rect:rect,height:height,revision:revision)
        if scrollTarget != target { scrollTarget = target }
    }
}

@MainActor final class ConversationFindIndexer: NSObject, WKNavigationDelegate {
    struct Result { let count: Int; let ranges: [NSRange] }
    private var webView: WKWebView?
    private var loading: Task<Void,Error>?
    private var ready: CheckedContinuation<Void,Error>?
    private var timeout: Task<Void,Never>?
    private func load() async throws {
        if let loading { return try await loading.value }
        let task = Task { @MainActor [self] in
            let rules = try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<WKContentRuleList,Error>) in
                WKContentRuleListStore.default().compileContentRuleList(forIdentifier:"WeaveletFindOffline",encodedContentRuleList:#"[{"trigger":{"url-filter":"^http"},"action":{"type":"block"}},{"trigger":{"url-filter":"^ws"},"action":{"type":"block"}}]"#) { value, error in
                    if let value { continuation.resume(returning:value) }
                    else { continuation.resume(throwing:error ?? ExchangeError.invalid("検索の通信遮断を設定できません")) }
                }
            }
            try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<Void,Error>) in
                guard let directory = Bundle.main.url(forResource:"MarkdownResources",withExtension:nil) else {
                    continuation.resume(throwing:ExchangeError.invalid("検索リソースがありません")); return
                }
                self.webView?.stopLoading(); self.webView?.navigationDelegate = nil
                let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
                config.userContentController.add(rules)
                let view = WKWebView(frame:CGRect(x:0,y:0,width:420,height:800),configuration:config)
                self.webView = view; self.ready = continuation; view.navigationDelegate = self
                view.loadFileURL(directory.appendingPathComponent("index.html"),allowingReadAccessTo:directory)
                self.timeout = Task { @MainActor [weak self] in
                    do { try await Task.sleep(nanoseconds:15_000_000_000) } catch { return }
                    self?.finish(.failure(ExchangeError.invalid("検索リソースの読み込みがタイムアウトしました")))
                }
            }
        }
        loading = task
        do { try await task.value } catch { loading = nil; throw error }
    }
    private func finish(_ result: Swift.Result<Void,Error>) {
        timeout?.cancel(); timeout = nil
        let continuation = ready; ready = nil; continuation?.resume(with:result)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if self.webView === webView { finish(.success(())) } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if self.webView === webView { finish(.failure(error)) } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if self.webView === webView { finish(.failure(error)) } }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loading = nil; finish(.failure(ExchangeError.invalid("検索の描画処理が終了しました"))) }
    func index(_ bodies:[ConversationFindBody],query:String) async throws -> [String:Result] {
        try await load(); try Task.checkCancellation()
        guard let webView else { throw ExchangeError.invalid("検索を開始できません") }
        let raw = try await webView.callAsyncJavaScript("return await window.weaveletMarkdown.index(entries, query)",arguments:["entries":bodies.map(\.arguments),"query":query],in:nil,contentWorld:.page)
        guard let values = raw as? [[String:Any]], values.count == bodies.count else { throw ExchangeError.invalid("検索結果の形式が正しくありません") }
        var results: [String:Result] = [:]
        for value in values {
            guard let id = value["id"] as? String, results[id] == nil,
                  let body = bodies.first(where:{$0.id == id}), let count = value["count"] as? Int, count >= 0,
                  let positions = value["ranges"] as? [[String:Int]], body.rendered || positions.count == count else { throw ExchangeError.invalid("検索結果を検証できません") }
            let ranges = try positions.map { range -> NSRange in
                guard let start = range["start"], let end = range["end"], start >= 0, end > start, end <= body.text.utf16.count else { throw ExchangeError.invalid("検索位置が本文の範囲外です") }
                return NSRange(location:start,length:end-start)
            }
            results[id] = .init(count:count,ranges:ranges)
        }
        return results
    }
}

private struct ConversationFindKey: EnvironmentKey { static let defaultValue: ConversationFind? = nil }
private struct ConversationFindBodyKey: EnvironmentKey { static let defaultValue: String? = nil }
extension EnvironmentValues {
    var conversationFind: ConversationFind? { get { self[ConversationFindKey.self] } set { self[ConversationFindKey.self] = newValue } }
    var conversationFindBodyID: String? { get { self[ConversationFindBodyKey.self] } set { self[ConversationFindBodyKey.self] = newValue } }
}

struct ConversationFindBodyView: View {
    @ObservedObject var find: ConversationFind
    let bodyID: String
    let text: String
    let rendered: Bool
    let input: [String:Any]
    @Binding var height: Double
    @Binding var failure: String?
    var baseFontSize: CGFloat = 17
    @State private var rawHeight: CGFloat = 0
    @State private var rawRect: CGRect?
    @State private var rawRectRequestID: String?
    var body: some View {
        let request = find.request(for:bodyID)
        Group {
            if rendered {
                MarkdownWebView(input:input,height:$height,failure:$failure,find:request,onFind:{ result in
                    guard let request, find.request(for:bodyID) == request else { return }
                    find.accept(result,bodyID:bodyID)
                    if find.request(for:bodyID) == request { find.report(bodyID:bodyID,index:request.index,rect:result.rect,height:height) }
                }).frame(height:height)
            } else if let request {
                FindableTextView(text:text,matches:find.ranges[bodyID] ?? [],selectedIndex:request.index,baseFontSize:baseFontSize,onRect:{ rect in
                    guard find.request(for:bodyID) == request else { return }
                    rawRect = rect; rawRectRequestID = request.requestID
                    find.report(bodyID:bodyID,index:request.index,rect:rect,height:rawHeight)
                })
                .onGeometryChange(for:CGFloat.self,of:{$0.size.height}) { value in
                    rawHeight = value
                    if let request = find.request(for:bodyID), request.requestID == rawRectRequestID { find.report(bodyID:bodyID,index:request.index,rect:rawRect,height:value) }
                }
            } else {
                Text(text).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)
            }
        }.id(bodyID)
    }
}

struct ConversationFindControls: View {
    @ObservedObject var find: ConversationFind
    let navigate: (Bool) -> Void
    var body: some View {
        HStack(spacing:0) {
            if find.busy { ProgressView().controlSize(.small).accessibilityLabel("本文内を検索中") }
            Text(find.selected == nil ? "0 / \(find.matches.count)" : "\(find.selectedIndex + 1) / \(find.matches.count)")
                .font(.caption).foregroundStyle(.secondary)
            Spacer(minLength:0)
            Button { navigate(true) } label: { Image(systemName:"chevron.up").frame(width:44,height:44) }.accessibilityLabel("前の一致箇所")
            Button { navigate(false) } label: { Image(systemName:"chevron.down").frame(width:44,height:44) }.accessibilityLabel("次の一致箇所")
        }.disabled(find.busy || find.matches.isEmpty || find.error != nil)
        ConversationFindIssue(find:find)
    }
}

struct ConversationFindIssue: View {
    @ObservedObject var find: ConversationFind
    var body: some View {
        if let error = find.error { Text(error).font(.footnote).foregroundStyle(.red) }
    }
}

struct MessageBodyItem: Identifiable {
    enum Content { case markdown(String,Bool), part(MessagePart), note(String), label(String), collapsed }
    let id: String
    let nodeID: String
    let content: Content
    static func items(node:MessageNode,summaryInfo:OrderedJSON?,generation:ActiveGeneration?,context:Data? = nil) -> [Self] {
        func item(_ key:String,_ content:Content) -> Self { .init(id:ConversationFindBody.key(node.id,key,context:context),nodeID:node.id,content:content) }
        var items: [Self] = node.options.label.isEmpty ? [] : [item("label",.label(node.options.label))]
        let tab = (try? summaryInfo?["tab"]?.string("tab")) ?? "original"
        if let generation {
            items.append(item("generation-status",.note(generation.running ? "生成中" : "未保存の生成結果")))
            if !generation.output.reasoning.isEmpty { items.append(item("reasoning",.part(.reasoning(generation.output.reasoning)))) }
            if !generation.output.text.isEmpty { items.append(item("text",.markdown(generation.output.text,generation.running))) }
        } else if tab != "original", summaryInfo?["valid"] == .bool(true), let text = try? summaryInfo?["summary"]?["text"]?.string("summary text") {
            items += [item("summary-kind",.note(tab == "compact" ? "圧縮" : "要約")), item("summary",.markdown(text,false))]
        } else if node.options.collapsed {
            items.append(item("collapsed",.collapsed))
        } else if node.parts.isEmpty {
            items.append(item("content",.markdown(node.content,false)))
        } else {
            items += node.parts.enumerated().map { item("part-\($0.offset)",.part($0.element)) }
        }
        return items
    }
    func findBody(rendered:Bool,inlineLatex:Bool) -> ConversationFindBody? {
        var text: String, isRendered = rendered
        switch content {
        case .markdown(let value,_): text = value
        case .label(let value): text = value; isRendered = false
        case .part(let part):
            switch part {
            case .text(let value), .reasoning(let value): text = value
            case .toolCall(_,_,let value), .toolResult(_,let value): text = value; isRendered = false
            case .image: return nil
            }
        case .note, .collapsed: return nil
        }
        return .init(id:id,nodeID:nodeID,text:text,rendered:isRendered,inlineLatex:inlineLatex)
    }
}

struct FindableMessagePlainText: View {
    let text: String
    var baseFontSize: CGFloat = 17
    @Environment(\.conversationFind) private var find
    @Environment(\.conversationFindBodyID) private var bodyID
    @State private var height = 24.0
    @State private var failure: String?
    var body: some View {
        if let find, let bodyID {
            ConversationFindBodyView(find:find,bodyID:bodyID,text:text,rendered:false,input:[:],height:$height,failure:$failure,baseFontSize:baseFontSize)
        } else { Text(text) }
    }
}

struct ConversationFindScrolling: ViewModifier {
    @ObservedObject var find: ConversationFind
    let scroll: ScrollViewProxy
    let viewportHeight: CGFloat
    func body(content:Content) -> some View {
        content
            .onAppear {
                if let match = find.selected { scroll.scrollTo(Data(match.nodeID.utf8),anchor:.center) }
            }
            .onChange(of:find.reveal) { _, _ in
                if let match = find.selected { scroll.scrollTo(Data(match.nodeID.utf8),anchor:.center) }
            }
            .onChange(of:find.scrollTarget) { _, target in
                guard let target else { return }
                let extra = target.height - viewportHeight
                let anchor = extra > 0 ? min(max((target.rect.midY - viewportHeight / 2) / extra,0),1) : 0.5
                scroll.scrollTo(target.bodyID,anchor:UnitPoint(x:0.5,y:anchor))
            }
    }
}
