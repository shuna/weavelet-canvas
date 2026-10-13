import SwiftUI
import WebKit

private struct MarkdownSettingsKey: EnvironmentKey {
    static let defaultValue = OrderedJSON.object([])
}
extension EnvironmentValues {
    var markdownSettings: OrderedJSON {
        get { self[MarkdownSettingsKey.self] }
        set { self[MarkdownSettingsKey.self] = newValue }
    }
}

struct MarkdownTextView: View {
    let text: String
    var isGenerating = false
    @Environment(\.markdownSettings) private var settings
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize = 17.0
    @State private var renderedOverride: Bool?
    @State private var height = 24.0
    @State private var failure: String?
    @State private var isVisible = false
    private static let defaults = try? ChatImport.call("defaults")
    private var rendered: Bool {
        if let renderedOverride { return renderedOverride }
        if case .bool(let value) = settings["markdownMode"] ?? Self.defaults?["markdownMode"] { return value }
        return false
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
            HStack {
                Spacer()
                Button(rendered ? "原文" : "整形") { renderedOverride = !rendered; failure = nil }
                    .font(.caption).accessibilityLabel(rendered ? "原文を表示" : "Markdownで表示")
            }
            if !rendered || failure != nil {
                Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            } else if isVisible {
                MarkdownWebView(input: input, height: $height, failure: $failure)
                    .frame(height: height)
            } else {
                Color.clear.frame(height: height)
            }
        }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
    }
}

// The bundled Web renderer owns parsing and streaming rules; WebKit handles text layout and selection.
struct MarkdownWebView: UIViewRepresentable {
    let input: [String: Any]
    @Binding var height: Double
    @Binding var failure: String?
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
        init(_ parent: MarkdownWebView) { self.parent = parent }
        func update() {
            guard ready, let webView, let encoded = try? JSONSerialization.data(withJSONObject: parent.input, options: [.sortedKeys]), encoded != lastInput else { return }
            lastInput = encoded
            webView.callAsyncJavaScript("window.weaveletMarkdown.update(input)", arguments: ["input": parent.input], in: nil, in: .page) { [weak self] result in
                guard let self, self.lastInput == encoded else { return }
                if case .failure = result { self.parent.failure = "本文を整形できませんでした。原文を表示しています。" }
            }
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
