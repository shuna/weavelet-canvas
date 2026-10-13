import Foundation
import WebKit

// Trusted fixture experiment only. No product model-selection or safety decision uses this host.
@MainActor final class WKClassifierProof: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private(set) var webView: WKWebView?
    private(set) var failure: Error?
    private(set) var acceptedMessages = 0
    private(set) var blockedFetchURLs: [String] = []
    private(set) var resourceRequests: [String] = []
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var timeoutTask: Task<Void, Never>?
    private var nextID = 1
    private var closed = false
    private var resources: ProofResources?

    func start() async throws -> [String: Any] {
        guard webView == nil, !closed else { throw ExchangeError.invalid("Proof lifetime already started") }
        let root = try BundledResources.root()
        let resources = try ProofResources(root: root)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(resources, forURLScheme: "weavelet-classifier")
        let rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "WeaveletClassifierProofOffline", encodedContentRuleList: #"[{"trigger":{"url-filter":"^http"},"action":{"type":"block"}},{"trigger":{"url-filter":"^ws"},"action":{"type":"block"}}]"#) { value, error in
                if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: error ?? ExchangeError.invalid("Offline rules unavailable")) }
            }
        }
        guard !closed else { throw CancellationError() }
        configuration.userContentController.add(rules)
        configuration.userContentController.add(self, name: "classifierProof")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 200), configuration: configuration)
        view.navigationDelegate = self
        self.webView = view; self.resources = resources
        return try await withCheckedThrowingContinuation { continuation in
            pending[0] = continuation
            armTimeout()
            view.load(URLRequest(url: URL(string: "weavelet-classifier://bundle/index.html")!))
        }
    }
    func request(_ type: String, text: String? = nil) async throws -> [String: Any] {
        guard let webView, !closed else { throw ExchangeError.invalid("Proof worker is closed") }
        let id = nextID; nextID += 1
        var input: [String: Any] = ["id": id, "type": type]
        if let text { input["text"] = text }
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            armTimeout()
            do {
                let json = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
                webView.evaluateJavaScript("(() => { const request = " + json + "; window.classifierProof.send(request).catch(error => window.webkit.messageHandlers.classifierProof.postMessage({id:request.id,type:'error',message:error.message})); })()") { [weak self] _, error in
                    if let error { self?.complete(id, .failure(error)) }
                }
            } catch { complete(id, .failure(error)) }
        }
    }
    func cancel() {
        guard !closed else { return }
        closed = true
        webView?.evaluateJavaScript("window.classifierProof.cancel()", completionHandler: nil)
        rejectAll(CancellationError())
    }
    func shutdown() {
        cancel()
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "classifierProof")
        webView?.navigationDelegate = nil
        if let resources { resourceRequests = resources.requests }
        webView = nil; resources = nil
    }
    private func armTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
            let error = ExchangeError.invalid("Offline classifier proof timed out")
            self?.failure = error; self?.rejectAll(error); self?.cancel()
        }
    }
    private func complete(_ id: Int, _ result: Result<[String: Any], Error>) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        if pending.isEmpty { timeoutTask?.cancel(); timeoutTask = nil }
        continuation.resume(with: result)
    }
    private func rejectAll(_ error: Error) {
        timeoutTask?.cancel(); timeoutTask = nil
        let continuations = Array(pending.values); pending.removeAll()
        for continuation in continuations { continuation.resume(throwing: error) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !closed, message.frameInfo.isMainFrame, let value = message.body as? [String: Any], let id = value["id"] as? Int, let type = value["type"] as? String else { return }
        if type == "proofBlockedFetch" {
            if let url = value["url"] as? String { blockedFetchURLs.append(url) }
            return
        }
        if type == "error" {
            let error = ExchangeError.invalid(value["message"] as? String ?? "Worker failed")
            failure = error
            if pending[id] != nil { complete(id, .failure(error)) } else { rejectAll(error) }
        } else {
            acceptedMessages += 1
            complete(id, .success(value))
            if type == "unloaded" { closed = true; rejectAll(CancellationError()) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failure = error; rejectAll(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failure = error; rejectAll(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let error = ExchangeError.invalid("Classifier proof WebContent process terminated")
        failure = error; closed = true; rejectAll(error)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.scheme == "weavelet-classifier" ? .allow : .cancel)
    }
    private enum BundledResources {
        static func root() throws -> URL {
            guard let root = Bundle.main.url(forResource: "ClassifierProofResources", withExtension: nil) else { throw ExchangeError.invalid("Proof resources unavailable") }
            return root
        }
    }
    private final class ProofResources: NSObject, WKURLSchemeHandler {
        let root: URL
        let allowed: Set<String>
        var requests: [String] = []
        init(root: URL) throws {
            self.root = root
            guard let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("provenance.json"))) as? [String: Any],
                  let assets = manifest["assets"] as? [String: Any] else { throw ExchangeError.invalid("Proof resource manifest is invalid") }
            allowed = Set(assets.keys)
        }
        func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
            do {
                guard let url = task.request.url, url.scheme == "weavelet-classifier", url.host == "bundle", url.query == nil,
                      allowed.contains(String(url.path.dropFirst())) else { throw ExchangeError.invalid("Proof resource denied") }
                let name = String(url.path.dropFirst()), data = try Data(contentsOf: root.appendingPathComponent(name))
                requests.append(name)
                let mime: String
                switch url.pathExtension { case "html": mime = "text/html"; case "js", "mjs": mime = "text/javascript"; case "wasm": mime = "application/wasm"; case "json": mime = "application/json"; default: mime = "application/octet-stream" }
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type":mime,"Access-Control-Allow-Origin":"*","Content-Length":String(data.count)])!
                task.didReceive(response); task.didReceive(data); task.didFinish()
            } catch { task.didFailWithError(error) }
        }
        func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    }
}
