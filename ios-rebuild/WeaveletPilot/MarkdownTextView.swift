import SwiftUI
import WebKit

private struct MarkdownSettingsKey: EnvironmentKey {
    static let defaultValue = OrderedJSON.object([])
}
struct MarkdownPresentation: Equatable {
    var mode: Bool? = nil
    var revision = 0
    var controlsHidden = false
}
private struct MarkdownPresentationKey: EnvironmentKey {
    static let defaultValue = MarkdownPresentation()
}
extension EnvironmentValues {
    var markdownSettings: OrderedJSON {
        get { self[MarkdownSettingsKey.self] }
        set { self[MarkdownSettingsKey.self] = newValue }
    }
    var markdownPresentation: MarkdownPresentation {
        get { self[MarkdownPresentationKey.self] }
        set { self[MarkdownPresentationKey.self] = newValue }
    }
}

struct MarkdownTextView: View {
    let text: String
    var isGenerating = false
    @Environment(\.conversationFind) private var conversationFind
    @Environment(\.conversationFindBodyID) private var findBodyID
    @Environment(\.markdownSettings) private var settings
    @Environment(\.markdownPresentation) private var presentation
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize = 17.0
    @State private var renderedOverride: Bool?
    @State private var height = 24.0
    @State private var failure: String?
    @State private var isVisible = false
    private static let defaults = try? ChatImport.call("defaults")
    static func defaultRendered(settings: OrderedJSON) -> Bool {
        if case .bool(let value) = settings["markdownMode"] ?? defaults?["markdownMode"] { return value }
        return false
    }
    private var rendered: Bool {
        presentation.mode ?? renderedOverride ?? Self.defaultRendered(settings:settings)
    }
    private var input: [String: Any] {
        var value: [String: Any] = ["content": text, "markdownMode": rendered, "isGenerating": isGenerating,
                                  "fontSize": fontSize, "dark": colorScheme == .dark,
                                  "isDesktopLike": ProcessInfo.processInfo.isMacCatalystApp,
                                  "saveData": ProcessInfo.processInfo.isLowPowerModeEnabled]
        if case .bool(let inlineLatex) = settings["inlineLatex"] { value["inlineLatex"] = inlineLatex }
        if case .string(let policy) = settings["streamingMarkdownPolicy"] { value["policy"] = policy }
        return value
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !presentation.controlsHidden {
                HStack {
                    Spacer()
                    Button(rendered ? "原文" : "整形") { renderedOverride = !rendered; failure = nil }
                        .font(.caption).accessibilityLabel(rendered ? "原文を表示" : "Markdownで表示")
                }
            }
            if let conversationFind, let findBodyID, !rendered || failure != nil || isVisible {
                ConversationFindBodyView(find:conversationFind,bodyID:findBodyID,text:text,rendered:rendered && failure == nil,input:input,height:$height,failure:$failure)
                if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            } else if !rendered || failure != nil {
                Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            } else if isVisible {
                MarkdownWebView(input: input, height: $height, failure: $failure)
                    .frame(height: height)
            } else {
                Color.clear.frame(height: height)
            }
        }
        .onChange(of:failure) { _, value in
            if let findBodyID { conversationFind?.setFallback(value != nil,bodyID:findBodyID) }
        }
        .onChange(of:presentation.revision) { _, _ in failure = nil }
        .onAppear {
            isVisible = true
            if let findBodyID { conversationFind?.setFallback(failure != nil,bodyID:findBodyID) }
        }
        .onDisappear { isVisible = false }
    }
}

struct MarkdownFindRequest: Equatable {
    let query: String
    var index = 0
    var requestID = UUID().uuidString
    var arguments: [String:Any] { ["query":query,"index":index,"requestID":requestID] }
}
struct MarkdownFindResult {
    let requestID: String
    let count: Int
    let selectedIndex: Int?
    let rect: CGRect?
    var error: String? = nil
}

// The bundled Web renderer owns parsing and streaming rules; WebKit handles text layout and selection.
struct MarkdownWebView: UIViewRepresentable {
    let input: [String: Any]
    @Binding var height: Double
    @Binding var failure: String?
    var find: MarkdownFindRequest? = nil
    var onFind: ((MarkdownFindResult) -> Void)? = nil
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "markdown")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false; view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear; view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        context.coordinator.webView = view
        if let root = Bundle.main.url(forResource: "MarkdownResources", withExtension: nil),
           FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) {
            context.coordinator.resourceRoot = root
            view.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        } else {
            DispatchQueue.main.async { failure = "本文表示のリソースを読み込めません。原文を表示しています。" }
        }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update()
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "markdown")
        view.navigationDelegate = nil
    }
    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: MarkdownWebView
        weak var webView: WKWebView?
        var resourceRoot: URL?
        var ready = false
        private var lastInput: Data?
        private var lastFind: MarkdownFindRequest?
        init(_ parent: MarkdownWebView) { self.parent = parent }
        func update() {
            guard ready, let webView else { return }
            if let encoded = try? JSONSerialization.data(withJSONObject:parent.input,options:[.sortedKeys]), encoded != lastInput {
                lastInput = encoded
                webView.callAsyncJavaScript("window.weaveletMarkdown.update(input)", arguments:["input":parent.input], in:nil, in:.page) { [weak self] result in
                    guard let self, self.lastInput == encoded else { return }
                    if case .failure = result { self.parent.failure = "本文を整形できませんでした。原文を表示しています。" }
                }
            }
            guard parent.find != lastFind else { return }
            lastFind = parent.find
            let submittedFind = parent.find
            let arguments = submittedFind?.arguments ?? ["query":"","index":0,"requestID":""]
            webView.callAsyncJavaScript("window.weaveletMarkdown.find(request)",arguments:["request":arguments],in:nil,in:.page) { [weak self] result in
                guard let self, self.parent.find == submittedFind, let request = submittedFind else { return }
                if case .failure = result {
                    self.parent.onFind?(.init(requestID:request.requestID,count:0,selectedIndex:nil,rect:nil,error:"本文内を検索できませんでした。"))
                }
            }
        }
        private func receiveFind(_ body:[String:Any]) {
            guard let request = parent.find, body["requestID"] as? String == request.requestID,
                  let count = body["count"] as? Int, count >= 0 else { return }
            let selected = body["selectedIndex"] as? Int
            let index = selected.flatMap { (0..<count).contains($0) ? $0 : nil }
            var rect: CGRect?
            if index != nil, let value = body["rect"] as? [String:Double],
               let x = value["x"], let y = value["y"], let width = value["width"], let height = value["height"],
               [x,y,width,height].allSatisfy({ $0.isFinite }), width >= 0, height >= 0 {
                rect = CGRect(x:x,y:y,width:width,height:height)
            }
            parent.onFind?(.init(requestID:request.requestID,count:count,selectedIndex:index,rect:rect))
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready = true; update() }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.failure = "本文を整形できませんでした。原文を表示しています。" }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { parent.failure = "本文を整形できませんでした。原文を表示しています。" }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.failure = "本文表示が終了しました。原文を表示しています。"
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "height":
                if let value = body["value"] as? Double, value.isFinite, value > 0, abs(parent.height - value) > 0.5 { parent.height = value }
            case "find": receiveFind(body)
            case "copy":
                if let text = body["text"] as? String { UIPasteboard.general.string = text }
            case "link":
                if let text = body["url"] as? String, let url = URL(string: text) { openLink(url) }
            default: break
            }
        }
        private func openLink(_ url: URL) {
            guard ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return }
            UIApplication.shared.open(url)
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated {
                if let url = action.request.url { openLink(url) }
                decisionHandler(.cancel)
            } else if action.request.url?.isFileURL == true, action.request.url?.deletingLastPathComponent() == resourceRoot {
                decisionHandler(.allow)
            } else { decisionHandler(.cancel) }
        }
    }
}
