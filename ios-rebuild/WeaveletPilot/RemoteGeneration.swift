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
              url.user == nil, url.password == nil else {
            throw ExchangeError.invalid("HTTPSの完了API URLを設定してください")
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
    static func make(source: OrderedJSON, chatID: String, path: [String], settings: RemoteSettings, key: String, modelState: OrderedJSON? = nil, apiVersion: String? = nil, customHeaders: OrderedJSON? = nil, regenerate: Bool = false) throws -> URLRequest {
        let url = try settings.validatedURL()
        let chat = try source.required("chats").array("chats").first { try $0.required("id").string("ID").utf8.elementsEqual(chatID.utf8) }
        guard let chat else { throw ExchangeError.invalid("chat ID") }
        var config = try chat["config"] ?? ChatDefaults.webInitial().config
        let savedModel = try config["model"]?.string("model") ?? ""
        if savedModel.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
            config = config.replacing("model",with:.string(settings.model)).replacing("stream",with:.bool(settings.stream))
        }
        guard case .string(let model) = config["model"], !model.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw ExchangeError.invalid("会話のモデルIDを設定してください") }
        guard config["modelSource"] != .string("local") else { throw ExchangeError.invalid("ローカルモデルはremote通信へ送信できません") }
        var boundary = SharedWebProjection()
        var transport: [JSONField] = [.init(key:"endpoint",value:.string(settings.endpoint)),
            .init(key:"endpointURL",value:.object([.init(key:"protocol",value:.string("https:")),.init(key:"hostname",value:.string(url.host!.lowercased()))])),
            .init(key:"hasApiKey",value:.bool(!key.isEmpty)),.init(key:"chatId",value:.string(chatID))]
        transport.append(.init(key:"regenerate",value:.bool(regenerate)))
        if let apiVersion { transport.append(.init(key:"apiVersion",value:.string(apiVersion))) }
        if let customHeaders { transport.append(.init(key:"customHeaders",value:customHeaders)) }
        var projectedConfig = try boundary.requestConfig(config)
        if let controls = config["openRouter"], let routing = controls["routing"], case .object(let prices) = routing["max_price"] {
            let projectedPrices = OrderedJSON.object(try prices.map { field in
                JSONField(key:field.key,value:["prompt","completion"].contains(field.key) ? field.value : try boundary.reference(field.value))
            })
            projectedConfig = projectedConfig.replacing("openRouter",with:controls.replacing("routing",with:routing.replacing("max_price",with:projectedPrices)))
        }
        var fields = try SharedGenerationContext.fields(source:source,chat:chat,config:projectedConfig,path:path,boundary:&boundary)
        fields.append(.init(key:"transport",value:.object(transport)))
        fields.append(.init(key:"modelState",value:modelState ?? .object([])))
        let input = OrderedJSON.object(fields)
        let envelope = try SharedWebOperations.call("generationRequest", input)
        let projectedBody = try envelope.required("body")
        let body = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: projectedBody)])]), to: .null, opaque: boundary.opaque)
        return try bindEnvelope(envelope,body:body,originalURL:url,key:key)
    }
    // The shared code never sees the secret. Only verified HTTP metadata can bind it.
    static func bindEnvelope(_ envelope: OrderedJSON, body: OrderedJSON, originalURL: URL, key: String) throws -> URLRequest {
        let endpoint = try envelope.required("endpoint").string("endpoint")
        let destination = try RemoteSettings(endpoint:endpoint).validatedURL()
        guard ProviderModels.sameOrigin(destination,originalURL) else { throw ExchangeError.invalid("生成先が認証設定のoriginから変更されています") }
        var request = URLRequest(url:destination); request.httpMethod = "POST"; request.timeoutInterval = 120
        var names: [String:String] = [:]
        func validate(_ name: String, _ value: String) throws {
            guard name.range(of:"\\A[!#$%&'*+.^_`|~0-9A-Za-z-]+\\z",options:.regularExpression) != nil,
                  !value.unicodeScalars.contains(where:{ ($0.value < 32 && $0.value != 9) || $0.value == 127 }) else { throw ExchangeError.invalid("HTTPヘッダーの名前または値が不正です") }
        }
        for field in try envelope.required("headers").object("headers") {
            let name = try field.key.native("header key"), value = try field.value.string("header value"); try validate(name,value)
            let folded = name.lowercased()
            guard names[folded] == nil else { throw ExchangeError.invalid("同じHTTPヘッダー名が大文字小文字違いで重複しています") }
            names[folded] = name; request.setValue(value,forHTTPHeaderField:name)
        }
        var authenticationNames = Set<String>()
        for descriptor in try envelope.required("authentication").array("authentication") {
            let name = try descriptor.required("name").string("auth name"), prefix = try descriptor.required("prefix").string("auth prefix")
            guard !key.isEmpty, (name == "Authorization" && prefix == "Bearer ") || (name == "api-key" && prefix.isEmpty) else { throw ExchangeError.invalid("認証ヘッダーの指定が不正です") }
            let folded = name.lowercased()
            guard authenticationNames.insert(folded).inserted, names[folded] == nil || names[folded] == name else { throw ExchangeError.invalid("認証ヘッダーが大文字小文字違いで重複しています") }
            let value = prefix + key; try validate(name,value)
            request.setValue(value,forHTTPHeaderField:name)
        }
        request.httpBody = try body.encoded()
        return request
    }
    static func streaming(_ request: URLRequest) throws -> Bool {
        guard let bytes = request.httpBody else { throw ExchangeError.invalid("生成要求の本文がありません") }
        return try OrderedJSON.decode(bytes).required("stream").boolean("stream")
    }

}

enum AuxiliaryRemoteRequest {
    static func providerSettings(state: OrderedJSON, fallbackEndpoint: String) throws -> OrderedJSON {
        let favorites = try (state["favoriteModels"] ?? .array([])).array("favoriteModels").map { item in
            OrderedJSON.object(["modelId", "providerId"].compactMap { key in item[key].map { .init(key:key,value:$0) } })
        }
        let providers = try (state["providers"] ?? .object([])).object("providers").map { field in
            JSONField(key:field.key,value:.object(["id", "endpoint"].compactMap { key in field.value[key].map { .init(key:key,value:$0) } }))
        }
        return .object([
            .init(key:"favoriteModels",value:.array(favorites)),
            .init(key:"providers",value:.object(providers)),
            .init(key:"fallbackProvider",value:.object([.init(key:"endpoint",value:.string(fallbackEndpoint))]))
        ])
    }
    static func credential(selection: OrderedJSON, state: OrderedJSON, legacy: RemoteCredentialRecord,
                           read: ProviderModels.CredentialReader) throws -> (record: RemoteCredentialRecord, url: URL) {
        let providerID = try selection["credentialProviderId"]?.string("provider ID")
        let config = OrderedJSON.object(providerID.map { [.init(key:"providerId",value:.string($0))] } ?? [])
        let record = try ProviderModels.generationCredential(config:config,state:state,legacy:legacy,read:read)
        let url = try record.settings.validatedURL()
        let endpoint = try selection.required("endpoint").string("endpoint")
        guard try ProviderModels.url(endpoint).absoluteString == url.absoluteString else {
            throw ExchangeError.invalid("補助生成先が端末認証設定のendpointと一致しません")
        }
        return (record,url)
    }
    static func transport(url: URL, key: String, apiVersion: OrderedJSON?) -> OrderedJSON {
        var value = OrderedJSON.object([
            .init(key:"hasApiKey",value:.bool(!key.isEmpty)),
            .init(key:"endpointURL",value:.object([
                .init(key:"protocol",value:.string(url.scheme! + ":")),
                .init(key:"hostname",value:.string(url.host!.lowercased()))
            ]))
        ])
        if let apiVersion { value = value.replacing("apiVersion",with:apiVersion) }
        return value
    }
    static func bind(_ envelope: OrderedJSON, boundary: SharedWebProjection, url: URL, key: String) throws -> URLRequest {
        let body = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:try envelope.required("body"))
        ])]),to:.null,opaque:boundary.opaque)
        let request = try RemoteRequest.bindEnvelope(envelope,body:body,originalURL:url,key:key)
        guard try !RemoteRequest.streaming(request) else { throw ExchangeError.invalid("補助生成は非streamingが必要です") }
        return request
    }
}

struct RemoteOutput {
    private(set) var text = ""
    private(set) var reasoning = ""
    private(set) var parts: OrderedJSON = .array([])
    private(set) var isEmpty = true
    private(set) var observation: OrderedJSON = .object([])
    private var state: OrderedJSON?
    private var session: SharedWebOperations.Session?
    private mutating func apply(_ input: [JSONField]) throws -> Bool {
        if session == nil { session = try SharedWebOperations.Session() }
        var fields = input
        if let state { fields.append(.init(key:"state",value:state)) }
        let output = try session!.call("remoteOutput",.object(fields))
        let nextState = try output.required("state")
        let nextText = try nextState.required("text").string("response text")
        let nextReasoning = try nextState.required("reasoning").string("response reasoning")
        let nextParts = try output.required("parts"), empty = try output.required("isEmpty").boolean("response empty")
        let finished = try output.required("finished").boolean("response finished")
        observation = nextState["observation"] ?? .object([])
        state = nextState; text = nextText; reasoning = nextReasoning; parts = nextParts; isEmpty = empty
        return finished
    }
    mutating func observeHeaders(_ response: URLResponse, request: URLRequest) throws {
        guard let http = response as? HTTPURLResponse, let url = request.url else { return }
        let headers = http.allHeaderFields.compactMap { field -> JSONField? in
            guard let name = field.key as? String, let value = field.value as? String else { return nil }
            return .init(key:name.lowercased(),value:.string(value))
        }
        _ = try apply([.init(key:"operation",value:.string("headers")),.init(key:"headers",value:.object(headers)),
            .init(key:"endpointURL",value:.object([.init(key:"protocol",value:.string((url.scheme ?? "") + ":")),.init(key:"hostname",value:.string(url.host?.lowercased() ?? ""))]))])
    }
    mutating func consume(_ value: OrderedJSON, streaming: Bool) throws -> Bool {
        try apply([.init(key:"operation",value:.string("consume")),.init(key:"value",value:value),.init(key:"streaming",value:.bool(streaming))])
    }
    mutating func consumeLocal(_ fullText: String, input: OrderedJSON) throws -> Bool {
        if session == nil { session = try SharedWebOperations.Session() }
        let output = try session!.call("localGenerationOutput",.object([
            .init(key:"fullText",value:.string(fullText)),.init(key:"prefix",value:input["assistantPrefix"] ?? .string("")),
            .init(key:"stop",value:input["options"]?["stop"] ?? .array([]))]))
        let nextText = try output.required("text").string("local text")
        let nextReasoning = try output.required("reasoning").string("local reasoning")
        let nextParts = try output.required("parts")
        let empty = try output.required("isEmpty").boolean("local empty")
        let stopped = try output.required("stopped").boolean("local stop")
        text = nextText; reasoning = nextReasoning; parts = nextParts; isEmpty = empty
        return stopped
    }
    mutating func flush() throws {
        guard state != nil else { return }
        _ = try apply([.init(key:"operation",value:.string("flush"))])
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

final class RemoteRedirectPolicy: NSObject, URLSessionTaskDelegate {
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
    func auxiliaryClient() -> RemoteClient { ownsSession ? RemoteClient() : self }
    func completeJSON(_ request: URLRequest) async throws -> OrderedJSON {
        defer { if ownsSession { session.invalidateAndCancel() } }
        let (data,response) = try await session.data(for:request)
        try check(response); try Task.checkCancellation()
        return try OrderedJSON.decode(data)
    }
    func complete(_ request: URLRequest, streaming: Bool, onOutput: @escaping @MainActor (RemoteOutput) -> Void) async throws {
        defer { if ownsSession { session.invalidateAndCancel() } }
        if !streaming {
            let (data, response) = try await session.data(for: request)
            try check(response)
            var output = RemoteOutput()
            try output.observeHeaders(response,request:request)
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
        try output.observeHeaders(response,request:request)
        var finished = false
        func consume(_ event: String) async throws -> Bool {
            if event == "[DONE]" {
                try output.flush()
                try Task.checkCancellation()
                await onOutput(output)
                return true
            }
            finished = try output.consume(OrderedJSON.decode(Data(event.utf8)), streaming: true) || finished
            try Task.checkCancellation()
            await onOutput(output)
            return false
        }
        do {
            for try await byte in bytes {
                try Task.checkCancellation()
                if let event = try parser.push(byte), try await consume(event) {
                    guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }; return
                }
            }
            if let event = try parser.finish(), try await consume(event) {
                guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }; return
            }
            guard finished else { throw ExchangeError.invalid("streamが完了前に切断されました") }
            try output.flush()
            guard !output.isEmpty else { throw ExchangeError.invalid("完了応答が空です") }
            try Task.checkCancellation()
            await onOutput(output)
        } catch {
            // Actual Web direct-remote finally flushes pending text even on failure/cancel.
            try output.flush()
            await onOutput(output)
            throw error
        }
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

enum NativeUsage {
    static func validateCounters(result: OrderedJSON, before: OrderedJSON, after: OrderedJSON) throws {
        if let key = try result["usageKey"]?.string("usage key"), let fields = result["counterFields"] {
            for field in try fields.array("counter fields") {
                let name = try field.string("counter")
                for value in [before[key]?[name],after[key]?[name]].compactMap({ $0 }) {
                    let number = try value.number("usage counter")
                    guard number.isFinite, abs(number) <= 9_007_199_254_740_991 else { throw ExchangeError.invalid("利用量の数値が共有処理の安全範囲を超えるため、生成結果を保持しています") }
                }
            }
        }
    }
}
