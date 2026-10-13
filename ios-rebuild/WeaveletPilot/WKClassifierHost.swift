import Foundation
import WebKit

// Web owns classification. This host supplies local bytes and manages the WebKit/Worker lifetime.
@MainActor final class WKClassifierHost: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private(set) var webView: WKWebView?
    private(set) var failure: Error?
    private(set) var acceptedMessages = 0
    private(set) var blockedFetchURLs: [String] = []
    private(set) var resourceRequests: [String] = []
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var timeoutTask: Task<Void, Never>?
    private var nextID = 1
    private var closed = false
    private var resources: ClassifierResources?
    private let origin: String
    private let names: [String]
    private var modelData: [Data: Data]
    private var loaded = false
    private(set) var inputObservation: [String: Any]?

    init(origin: String, files: [(path: String, data: Data)]) throws {
        guard !origin.isEmpty, !files.isEmpty else { throw ExchangeError.invalid("モデルのoriginとファイルが必要です") }
        self.origin = origin
        names = files.map(\.path)
        var supplied: [Data: Data] = [:]
        for file in files {
            let url = try Self.modelURL(file.path)
            guard supplied.updateValue(file.data, forKey: Data(url.utf8)) == nil else { throw ExchangeError.invalid("モデルファイルのURLが重複しています") }
        }
        modelData = supplied
        super.init()
    }
    private static func modelURL(_ path: String) throws -> String {
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.utf8.contains(0), !segments.isEmpty,
              segments.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw ExchangeError.invalid("モデルの相対パスが正しくありません") }
        let safe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let escaped = try segments.map { segment -> String in
            guard let value = String(segment).addingPercentEncoding(withAllowedCharacters: safe) else { throw ExchangeError.invalid("モデルのURLを作れません") }
            return value
        }.joined(separator: "/")
        return "weavelet-classifier://model/" + escaped
    }
    func load() async throws {
        guard !loaded else { return }
        _ = try await start()
        _ = try await request("loadClassifier")
        try Task.checkCancellation()
        loaded = true
    }
    func classify(text: String) async throws -> [(label: String, score: Double)] {
        try Task.checkCancellation()
        guard loaded else { throw ExchangeError.invalid("分類モデルが読み込まれていません") }
        let output = try await request("classify", text: text)
        try Task.checkCancellation()
        guard let labels = output["labels"] as? [[String: Any]] else { throw ExchangeError.invalid("分類結果が正しくありません") }
        return try labels.map {
            guard let label = $0["label"] as? String, let score = $0["score"] as? Double, score.isFinite else { throw ExchangeError.invalid("分類結果が正しくありません") }
            return (label, score)
        }
    }
    func unload() async throws { _ = try await request("unload"); loaded = false }


    func start() async throws -> [String: Any] {
        try await withTaskCancellationHandler(operation: { try Task.checkCancellation(); return try await startWorker() },
            onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }
    private func startWorker() async throws -> [String: Any] {
        guard webView == nil, !closed else { throw ExchangeError.invalid("Classifier lifetime already started") }
        let root = try BundledResources.root()
        let resources = try ClassifierResources(root: root, modelData: modelData)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(resources, forURLScheme: "weavelet-classifier")
        let rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "WeaveletClassifierOffline", encodedContentRuleList: #"[{"trigger":{"url-filter":"^http"},"action":{"type":"block"}},{"trigger":{"url-filter":"^ws"},"action":{"type":"block"}}]"#) { value, error in
                if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: error ?? ExchangeError.invalid("Offline rules unavailable")) }
            }
        }
        guard !closed else { throw CancellationError() }
        configuration.userContentController.add(rules)
        configuration.userContentController.add(self, name: "classifierHost")
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
        try await withTaskCancellationHandler(operation: { try Task.checkCancellation(); return try await send(type, text: text) },
            onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }
    private func send(_ type: String, text: String?) async throws -> [String: Any] {
        guard let webView, !closed else { throw ExchangeError.invalid("Classifier worker is closed") }
        let id = nextID; nextID += 1
        var input: [String: Any] = ["id": id, "type": type]
        if let text { input["text"] = text }
        if type == "loadClassifier" { input["modelId"] = origin; input["names"] = names }
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            armTimeout()
            do {
                let json = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
                webView.evaluateJavaScript("(() => { const request = " + json + "; window.classifierHost.send(request).catch(error => window.webkit.messageHandlers.classifierHost.postMessage({id:request.id,type:'error',message:error.message})); })()") { [weak self] _, error in
                    if let error { self?.complete(id, .failure(error)) }
                }
            } catch { complete(id, .failure(error)) }
        }
    }
    func cancel() {
        guard !closed else { return }
        closed = true; loaded = false
        webView?.evaluateJavaScript("window.classifierHost.cancel()", completionHandler: nil)
        rejectAll(CancellationError())
    }
    func shutdown() {
        cancel()
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "classifierHost")
        webView?.navigationDelegate = nil
        if let resources { resourceRequests = resources.requests }
        webView = nil; resources = nil; modelData.removeAll()
    }
    private func armTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
            let error = ExchangeError.invalid("Offline classifier timed out")
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
        if type == "classifierInput" { inputObservation = value; return }
        if type == "classifierBlockedFetch" {
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
        let error = ExchangeError.invalid("Classifier WebContent process terminated")
        failure = error; closed = true; rejectAll(error)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.scheme == "weavelet-classifier" ? .allow : .cancel)
    }
    private enum BundledResources {
        static func root() throws -> URL {
            guard let root = Bundle.main.url(forResource: "ClassifierResources", withExtension: nil) else { throw ExchangeError.invalid("Classifier resources unavailable") }
            return root
        }
    }
    private final class ClassifierResources: NSObject, WKURLSchemeHandler {
        let root: URL
        let allowed: Set<String>
        let modelData: [Data: Data]
        var requests: [String] = []
        init(root: URL, modelData: [Data: Data]) throws {
            self.root = root; self.modelData = modelData
            guard let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("provenance.json"))) as? [String: Any],
                  let assets = manifest["assets"] as? [String: Any] else { throw ExchangeError.invalid("Classifier resource manifest is invalid") }
            allowed = Set(assets.keys)
        }
        func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
            do {
                guard let url = task.request.url, url.scheme == "weavelet-classifier", url.query == nil, url.fragment == nil else { throw ExchangeError.invalid("Classifier resource denied") }
                let name = String(url.path.dropFirst()), data: Data
                if url.host == "bundle", allowed.contains(name) { data = try Data(contentsOf: root.appendingPathComponent(name)) }
                else if url.host == "model", let supplied = modelData[Data(url.absoluteString.utf8)] { data = supplied }
                else { throw ExchangeError.invalid("Classifier resource denied") }
                requests.append(url.host! + "/" + name)
                let mime: String
                switch url.pathExtension { case "html": mime = "text/html"; case "js", "mjs": mime = "text/javascript"; case "wasm": mime = "application/wasm"; case "json": mime = "application/json"; default: mime = "application/octet-stream" }
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type":mime,"Access-Control-Allow-Origin":"*","Content-Length":String(data.count)])!
                task.didReceive(response); task.didReceive(data); task.didFinish()
            } catch { task.didFailWithError(error) }
        }
        func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    }
}
