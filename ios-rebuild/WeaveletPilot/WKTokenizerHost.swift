import Foundation
import WebKit

// The actual Web Worker owns tokenization and selection; this host owns only offline I/O and lifetime.
@MainActor final class WKTokenizerHost: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private(set) var webView: WKWebView?
    private(set) var acceptedMessages = 0
    private(set) var resourceRequests: [String] = []
    private var pending: [Int: (type: String, continuation: CheckedContinuation<OrderedJSON, Error>)] = [:]
    private var timeoutTask: Task<Void, Never>?
    private var loading: Task<Void, Error>?
    private var resources: TokenizerResources?
    private var nextID = 1
    private var epoch = 1
    private var closed = false
    private var loaded = false

    func load() async throws {
        try Task.checkCancellation()
        guard !closed else { throw CancellationError() }
        if loaded { return }
        if loading == nil {
            loading = Task { @MainActor in
                try await start()
                _ = try await send(type: "init", expected: "ready", fields: [])
                try Task.checkCancellation()
                loaded = true
            }
        }
        let task = loading!
        try await withTaskCancellationHandler(operation: { try await task.value; try Task.checkCancellation() },
            onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }
    func countTokens(messages: OrderedJSON, model: String) async throws -> Int {
        _ = try messages.array("tokenizer messages")
        let output = try await request(type: "countTokens", expected: "countTokensResult", fields: [
            .init(key: "messages", value: messages), .init(key: "model", value: .string(model))])
        guard case .number(let raw) = try output.required("count"), let count = Int(raw), count >= 0 else {
            throw ExchangeError.invalid("Tokenizer count is invalid")
        }
        return count
    }
    func limitMessages(messages: OrderedJSON, model: String, limit: Int) async throws -> OrderedJSON {
        let originals = try messages.array("tokenizer messages")
        guard limit >= 0 else { throw ExchangeError.invalid("Tokenizer limit is invalid") }
        let output = try await request(type: "limitMessages", expected: "limitMessagesResult", fields: [
            .init(key: "messages", value: messages), .init(key: "model", value: .string(model)),
            .init(key: "limit", value: .number(String(limit))), .init(key: "indicesOnly", value: .bool(true))])
        var previous = -1
        let retained = try output.required("indices").array("tokenizer indices").map { value -> OrderedJSON in
            guard case .number(let raw) = value, let index = Int(raw), originals.indices.contains(index), index > previous else {
                throw ExchangeError.invalid("Tokenizer selection is invalid")
            }
            previous = index
            return originals[index]
        }
        return .array(retained)
    }
    private func request(type: String, expected: String, fields: [JSONField]) async throws -> OrderedJSON {
        try Task.checkCancellation()
        guard loaded else { throw ExchangeError.invalid("Tokenizer is not loaded") }
        return try await withTaskCancellationHandler(operation: {
            let result = try await send(type: type, expected: expected, fields: fields)
            try Task.checkCancellation()
            return result
        }, onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }
    private func start() async throws {
        guard let root = Bundle.main.url(forResource: "TokenizerResources", withExtension: nil) else { throw ExchangeError.invalid("Tokenizer resources unavailable") }
        let resources = TokenizerResources(root: root)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(resources, forURLScheme: "weavelet-tokenizer")
        let rules = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WKContentRuleList, Error>) in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "WeaveletTokenizerOffline", encodedContentRuleList: #"[{"trigger":{"url-filter":"^http"},"action":{"type":"block"}},{"trigger":{"url-filter":"^ws"},"action":{"type":"block"}}]"#) { value, error in
                if let value { continuation.resume(returning: value) }
                else { continuation.resume(throwing: error ?? ExchangeError.invalid("Tokenizer offline rules unavailable")) }
            }
        }
        try Task.checkCancellation()
        guard !closed else { throw CancellationError() }
        configuration.userContentController.add(rules)
        configuration.userContentController.add(self, name: "tokenizerHost")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 200), configuration: configuration)
        view.navigationDelegate = self
        webView = view; self.resources = resources
        _ = try await withCheckedThrowingContinuation { continuation in
            pending[0] = ("runtimeReady", continuation)
            armTimeout()
            view.load(URLRequest(url: URL(string: "weavelet-tokenizer://bundle/index.html")!))
        }
    }
    private func send(type: String, expected: String, fields: [JSONField]) async throws -> OrderedJSON {
        guard let webView, !closed else { throw CancellationError() }
        let id = nextID; nextID += 1
        let json = try OrderedJSON.object([.init(key: "id", value: .number(String(id))), .init(key: "type", value: .string(type))] + fields).encoded()
        let raw = String(decoding: json, as: UTF8.self)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = (expected, continuation)
            armTimeout()
            webView.callAsyncJavaScript("window.tokenizerHost.send(json); return true", arguments: ["json": raw], in: nil, in: .page) { [weak self] result in
                if case .failure(let error) = result { self?.complete(id, .failure(error)) }
            }
        }
    }
    func cancel() {
        guard !closed else { return }
        closed = true; loaded = false; epoch += 1
        loading?.cancel()
        webView?.evaluateJavaScript("window.tokenizerHost.cancel()", completionHandler: nil)
        rejectAll(CancellationError())
    }
    func shutdown() {
        cancel()
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "tokenizerHost")
        webView?.navigationDelegate = nil
        if let resources { resourceRequests = resources.requests }
        webView = nil; resources = nil; loading = nil
    }
    private func armTimeout() {
        timeoutTask?.cancel()
        timeoutTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
            self?.fail(ExchangeError.invalid("Tokenizer timed out"))
        }
    }
    private func complete(_ id: Int, _ result: Result<OrderedJSON, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        if pending.isEmpty { timeoutTask?.cancel(); timeoutTask = nil }
        request.continuation.resume(with: result)
    }
    private func rejectAll(_ error: Error) {
        timeoutTask?.cancel(); timeoutTask = nil
        let requests = Array(pending.values); pending.removeAll()
        for request in requests { request.continuation.resume(throwing: error) }
    }
    private func fail(_ error: Error) { rejectAll(error); cancel() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !closed, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "weavelet-tokenizer",
              message.frameInfo.securityOrigin.host == "bundle", let envelope = message.body as? [String: Any],
              envelope["epoch"] as? Int == epoch, let json = envelope["json"] as? String else { return }
        do {
            let value = try OrderedJSON.decode(Data(json.utf8))
            guard case .number(let raw) = try value.required("id"), let id = Int(raw), let type = try? value.required("type").string("tokenizer reply") else { throw ExchangeError.invalid("Tokenizer reply is invalid") }
            if type == "error" {
                let error = ExchangeError.invalid((try? value.required("message").displayString("tokenizer error")) ?? "Tokenizer Worker failed")
                if id == 0 { fail(error) } else if pending[id] != nil { complete(id, .failure(error)) }
            } else if pending[id]?.type == type {
                acceptedMessages += 1
                complete(id, .success(value))
            }
        } catch { fail(error) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail(ExchangeError.invalid("Tokenizer WebContent process terminated")) }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.absoluteString == "weavelet-tokenizer://bundle/index.html" ? .allow : .cancel)
    }
    private final class TokenizerResources: NSObject, WKURLSchemeHandler {
        let root: URL
        var requests: [String] = []
        private let allowed = Set(["index.html", "host.js", "worker.js", "tiktoken_bg.wasm"])
        init(root: URL) { self.root = root }
        func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
            do {
                guard let url = task.request.url else { throw ExchangeError.invalid("Tokenizer resource denied") }
                let name = url.lastPathComponent
                guard allowed.contains(name), url.absoluteString == "weavelet-tokenizer://bundle/" + name else { throw ExchangeError.invalid("Tokenizer resource denied") }
                let data = try Data(contentsOf: root.appendingPathComponent(name))
                requests.append(name)
                let mime: String
                switch url.pathExtension { case "html": mime = "text/html"; case "js": mime = "text/javascript"; case "wasm": mime = "application/wasm"; default: mime = "application/octet-stream" }
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": mime, "Access-Control-Allow-Origin": "*", "Content-Length": String(data.count)])!
                task.didReceive(response); task.didReceive(data); task.didFinish()
            } catch { task.didFailWithError(error) }
        }
        func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    }
}
