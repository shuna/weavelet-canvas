import Foundation

enum RemoteFixture {
    static var enabled: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--native-remote-fixture") ||
            ["YES", "true", "1"].contains(String(describing: Bundle.main.object(forInfoDictionaryKey: "WeaveletRemoteFixture") ?? ""))
        #else
        return false
        #endif
    }
}

struct RemoteSettings: Codable, Equatable {
    var endpoint = "https://api.openai.com/v1/chat/completions"
    var model = ""
    var stream = true
    func validatedURL() throws -> URL {
        guard let url = URL(string: endpoint.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ExchangeError.invalid("HTTPSの完了API URLとモデルを設定してください")
        }
        return url
    }
}

enum RemoteRequest {
    #if DEBUG
    static func fixtureBody(_ request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count >= 0 else { return nil }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
    #endif
    static func make(source: OrderedJSON, chatID: String, path: [String], settings: RemoteSettings, key: String, modelState: OrderedJSON? = nil) throws -> URLRequest {
        let url = try settings.validatedURL()
        let chat = try source.required("chats").array("chats").first { try $0.required("id").string("ID").utf8.elementsEqual(chatID.utf8) }
        guard let chat else { throw ExchangeError.invalid("chat ID") }
        var config = try chat["config"] ?? ChatDefaults.webInitial().config
        config = config.replacing("model", with: .string(settings.model)).replacing("stream", with: .bool(settings.stream))
        var boundary = SharedWebProjection()
        let store = try boundary.store(source["contentStore"] ?? .object([]))
        var contextChat = chat
        if chat["branchTree"] == nil {
            let messages = try chat.required("messages").array("messages").map { message in
                OrderedJSON.object([.init(key: "role", value: try message.required("role")),
                    .init(key: "content", value: try boundary.parts(message.required("content")))])
            }
            contextChat = contextChat.replacing("messages", with: .array(messages))
        }
        let input = OrderedJSON.object([
            .init(key: "contentStore", value: store),
            .init(key: "chat", value: contextChat),
            .init(key: "config", value: try boundary.requestConfig(config)),
            .init(key: "activePath", value: .array(path.map(OrderedJSON.string))),
            .init(key: "omittedNodes", value: chat["omittedNodes"] ?? .object([])),
            .init(key: "modelState", value: modelState ?? .object([])),
        ])
        let projectedBody = try SharedWebOperations.call("generationRequest", input)
        let body = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: projectedBody)])]), to: .null, opaque: boundary.opaque)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try body.encoded()
        return request
    }
}

struct RemoteOutput {
    var text = ""
    var reasoning = ""
    var parts: OrderedJSON {
        var values: [OrderedJSON] = []
        if !reasoning.isEmpty { values.append(.object([JSONField(key: "type", value: .string("reasoning")), JSONField(key: "text", value: .string(reasoning))])) }
        if !text.isEmpty { values.append(.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string(text))])) }
        return .array(values)
    }
    var isEmpty: Bool { text.isEmpty && reasoning.isEmpty }
    mutating func consume(_ value: OrderedJSON, streaming: Bool) throws -> Bool {
        guard value["error"] == nil else { throw ExchangeError.invalid("remote APIがエラーを返しました") }
        let choices = try value.required("choices").array("choices")
        guard let choice = choices.first else { return false }
        guard let payload = choice[streaming ? "delta" : "message"] else { throw ExchangeError.invalid("完了応答の本文がありません") }
        if payload["tool_calls"] != nil || payload["function_call"] != nil { throw ExchangeError.invalid("このremote経路は生成tool callに未対応です") }
        if let content = payload["content"], content != .null {
            guard case .string(let content) = content else { throw ExchangeError.invalid("このremote経路は文字列の生成本文のみ対応です") }
            text += content
        }
        if let reason = payload["reasoning"] ?? payload["reasoning_content"], reason != .null { reasoning += try reason.string("reasoning") }
        if let finish = choice["finish_reason"], finish != .null { _ = try finish.string("finish reason"); return true }
        return !streaming
    }
}

struct RemoteSSE {
    private var line = Data()
    private var lines: [String] = []
    private var firstLine = true
    private var skipLF = false
    mutating func push(_ byte: UInt8) throws -> String? {
        if skipLF { skipLF = false; if byte == 10 { return nil } }
        if byte == 13 { skipLF = true; return try endLine() }
        if byte == 10 { return try endLine() }
        line.append(byte)
        return nil
    }
    private mutating func endLine() throws -> String? {
        if firstLine {
            firstLine = false
            if line.starts(with: [0xEF, 0xBB, 0xBF]) { line.removeFirst(3) }
        }
        guard String(data: line, encoding: .utf8) != nil else { throw ExchangeError.invalid("stream UTF8") }
        let string = String(decoding: line, as: UTF8.self)
        line.removeAll(keepingCapacity: true)
        if string.isEmpty {
            guard !lines.isEmpty else { return nil }
            let event = lines.joined(separator: "\n"); lines.removeAll(keepingCapacity: true); return event
        }
        if string.hasPrefix("data:") {
            var value = String(string.dropFirst(5)); if value.first == " " { value.removeFirst() }; lines.append(value)
        }
        return nil
    }
    mutating func finish() throws -> String? {
        if !line.isEmpty { _ = try endLine() }
        guard !lines.isEmpty else { return nil }
        let event = lines.joined(separator: "\n"); lines.removeAll(); return event
    }
}

private final class RemoteRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

struct RemoteClient {
    let session: URLSession
    private let ownsSession: Bool
    init(session: URLSession? = nil) {
        if let session { self.session = session; ownsSession = false }
        else {
            ownsSession = true
            let config = URLSessionConfiguration.ephemeral
            #if DEBUG
            if RemoteFixture.enabled { config.protocolClasses = [PilotRemoteFixtureProtocol.self] }
            #endif
            config.httpCookieStorage = nil; config.urlCredentialStorage = nil
            self.session = URLSession(configuration: config, delegate: RemoteRedirectPolicy(), delegateQueue: nil)
        }
    }
    func complete(_ request: URLRequest, streaming: Bool, onOutput: @escaping @MainActor (RemoteOutput) -> Void) async throws {
        defer { if ownsSession { session.invalidateAndCancel() } }
        if !streaming {
            let (data, response) = try await session.data(for: request)
            try check(response)
            var output = RemoteOutput()
            _ = try output.consume(OrderedJSON.decode(data), streaming: false)
            guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }
            try Task.checkCancellation()
            await onOutput(output)
            return
        }
        let (bytes, response) = try await session.bytes(for: request)
        try check(response)
        var parser = RemoteSSE()
        var output = RemoteOutput()
        var finished = false
        func consume(_ event: String) async throws -> Bool {
            if event == "[DONE]" { return true }
            finished = try output.consume(OrderedJSON.decode(Data(event.utf8)), streaming: true) || finished
            try Task.checkCancellation()
            await onOutput(output)
            return false
        }
        for try await byte in bytes {
            try Task.checkCancellation()
            if let event = try parser.push(byte), try await consume(event) {
                guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }; return
            }
        }
        if let event = try parser.finish(), try await consume(event) {
            guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }; return
        }
        guard finished, !output.isEmpty else { throw ExchangeError.invalid("streamが完了前に切断されました") }
    }
    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ExchangeError.invalid("remote HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
        }
    }
}

#if DEBUG
// Explicit local UI verification mode. No request leaves this URLProtocol.
final class PilotRemoteFixtureProtocol: URLProtocol {
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body = RemoteRequest.fixtureBody(request).flatMap { try? OrderedJSON.decode($0) }
        let stream = body?["stream"] == .bool(true)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": stream ? "text/event-stream" : "application/json"])!, cacheStoragePolicy: .notAllowed)
        let events = stream ? [
            "data: {\"choices\":[{\"delta\":{\"content\":\"FAKE partial\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" complete\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
        ] : ["{\"choices\":[{\"message\":{\"content\":\"FAKE nonstream complete\"},\"finish_reason\":\"stop\"}]}"]
        for (index, event) in events.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + (index == 0 ? 1 : 12)) { [weak self] in
                guard let self else { return }
                self.lock.lock(); let stopped = self.stopped; self.lock.unlock()
                guard !stopped else { return }
                self.client?.urlProtocol(self, didLoad: Data(event.utf8))
                if index == events.count - 1 { self.client?.urlProtocolDidFinishLoading(self) }
            }
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}
#endif
