import XCTest
@testable import WeaveletPilot

private final class FakeRemoteProtocol: URLProtocol {
    struct Packet { let bytes: Data; var delay: Double = 0 }
    static var packets: [Packet] = []
    static var status = 200
    static var failure: Error?
    static var requests: [URLRequest] = []
    static var holdLast = false
    static var releaseLast: (() -> Void)?
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { ["fixture.invalid", "unit-fixture.openai.azure.com", "openrouter.ai"].contains(request.url?.host ?? "") }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var captured = request
        captured.httpBody = RemoteRequest.fixtureBody(request)
        Self.requests.append(captured)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: ["Content-Type": captured.httpBody.flatMap { try? OrderedJSON.decode($0) }?["stream"] == .bool(true) ? "text/event-stream" : "application/json"])!, cacheStoragePolicy: .notAllowed)
        let packets = Self.packets
        let failure = Self.failure
        var delay = 0.0
        for (index, packet) in packets.enumerated() {
            delay += packet.delay
            let deliver: () -> Void = { [weak self] in
                guard let self else { return }
                self.lock.lock(); let stopped = self.stopped; self.lock.unlock()
                guard !stopped else { return }
                self.client?.urlProtocol(self, didLoad: packet.bytes)
                if index == packets.count - 1 {
                    if let failure { self.client?.urlProtocol(self, didFailWithError: failure) }
                    else { self.client?.urlProtocolDidFinishLoading(self) }
                }
            }
            if Self.holdLast && index == packets.count - 1 { Self.releaseLast = deliver }
            else { DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: deliver) }
        }
        if packets.isEmpty {
            if let failure { client?.urlProtocol(self, didFailWithError: failure) }
            else { client?.urlProtocolDidFinishLoading(self) }
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}

@MainActor
final class RemoteGenerationTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/remote-generation.json")))
    }
    func testActualSharedBranchMaterializationPreservesRawPartOrderNumbersAndOpaqueShapedConfig() throws {
        let source = try OrderedJSON.decode(Data(#"""
        {"xRoot":9007199254740993,"chats":[{"id":"target","config":{"model":"FAKE-model","max_tokens":100,"temperature":1.234567890123456789,"xFuture":{"opaqueRef":0}},"messages":[{"role":"user","content":[{"type":"text","text":"stale"}]}],"branchTree":{"rootId":"root","activePath":["root","a"],"nodes":{"root":{"id":"root","parentId":null,"role":"user","contentHash":"root"},"a":{"id":"a","parentId":"root","role":"assistant","contentHash":"a"},"b":{"id":"b","parentId":"root","role":"assistant","contentHash":"b"}}}}],"contentStore":{"root":{"content":[{"type":"text","text":"prompt","xPart":9007199254740993}],"refCount":1},"a":{"content":[{"type":"text","text":"unselected"}],"refCount":1},"b":{"content":[{"type":"text","text":"selected","xBig":1.234567890123456789},{"type":"text","text":"second","xFuture":{"opaqueRef":0}}],"refCount":1}}}
        """#.utf8)), before = try source.encoded()
        let request = try RemoteRequest.make(source: source, chatID: "target", path: ["root", "b"], settings: RemoteSettings(endpoint: "https://fixture.invalid/v1/chat/completions", model: "FAKE-model", stream: false), key: "FAKE")
        let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody))
        let messages = try body.required("messages").array("messages")
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages[0]["role"], .string("user")); XCTAssertEqual(messages[1]["role"], .string("assistant"))
        XCTAssertEqual(try messages[0].required("content").encoded(), try source.required("contentStore").required("root").required("content").encoded())
        XCTAssertEqual(try messages[1].required("content").encoded(), try source.required("contentStore").required("b").required("content").encoded())
        XCTAssertEqual(body["temperature"], .number("1.234567890123456789"))
        XCTAssertEqual(body["xFuture"], .object([.init(key:"opaqueRef",value:.number("0"))]))
        XCTAssertEqual(try source.encoded(), before)
    }

    func testSharedOpenRouterControlsReachOnlyEligibleEndpointAndKeepRawValues() throws {
        let metadata = OrderedJSON.object([.init(key:"huge",value:.number("9007199254740993")),.init(key:"decimal",value:.number("1.2300")),.init(key:"marker",value:.object([.init(key:"opaqueRef",value:.number("0"))]))])
        let price = OrderedJSON.object([.init(key:"prompt",value:.number("0.0100")),.init(key:"completion",value:.number("0.0200")),.init(key:"xFuture",value:metadata)])
        let routing = OrderedJSON.object([.init(key:"order",value:.array([.string("fake-provider")])),.init(key:"only",value:.array([.string("fake-provider")])),.init(key:"ignore",value:.array([.string("fake-other")])),.init(key:"allow_fallbacks",value:.bool(false)),.init(key:"require_parameters",value:.bool(true)),.init(key:"max_price",value:price),.init(key:"data_collection",value:.string("deny")),.init(key:"zdr",value:.bool(true))])
        let controls = OrderedJSON.object([.init(key:"routing",value:routing),.init(key:"stickySession",value:.bool(true)),.init(key:"promptCache",value:.object([.init(key:"mode",value:.string("claude-conversation")),.init(key:"ttl",value:.string("1h"))])),.init(key:"responseCache",value:.object([.init(key:"mode",value:.string("on")),.init(key:"ttlSeconds",value:.number("30"))]))])
        let config = OrderedJSON.object([.init(key:"model",value:.string("anthropic/claude-3.7-sonnet")),.init(key:"providerId",value:.string("openrouter")),.init(key:"stream",value:.bool(false)),.init(key:"max_tokens",value:.number("100")),.init(key:"openRouter",value:controls)])
        let source = OrderedJSON.object([.init(key:"chats",value:.array([.object([.init(key:"id",value:.string("or-chat")),.init(key:"config",value:config),.init(key:"messages",value:.array([.object([.init(key:"role",value:.string("user")),.init(key:"content",value:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Prompt")),.init(key:"xFuture",value:metadata)])]))])]))])]))]), before = try source.encoded()
        let request = try RemoteRequest.make(source:source,chatID:"or-chat",path:[],settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE-native-secret")
        let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody)), provider = try body.required("provider")
        XCTAssertEqual(provider["order"],routing["order"]); XCTAssertEqual(provider["only"],routing["only"]); XCTAssertEqual(provider["ignore"],routing["ignore"])
        XCTAssertEqual(provider["allow_fallbacks"],.bool(false)); XCTAssertEqual(provider["require_parameters"],.bool(true)); XCTAssertEqual(provider["zdr"],.bool(true))
        XCTAssertEqual(provider["data_collection"],.string("deny")); XCTAssertEqual(provider["max_price"]?["prompt"],.number("0.01"))
        XCTAssertEqual(try provider.required("max_price").required("xFuture").encoded(),try metadata.encoded())
        XCTAssertEqual(body["session_id"],.string("weavelet:or-chat")); XCTAssertEqual(body["cache_control"]?["ttl"],.string("1h"))
        XCTAssertNil(request.value(forHTTPHeaderField:"X-OpenRouter-Cache"))
        XCTAssertFalse(String(decoding:try XCTUnwrap(request.httpBody),as:UTF8.self).contains("FAKE-native-secret"))
        // Web applyOpenRouterControls rejects OpenRouter settings at a non-OpenRouter origin.
        XCTAssertThrowsError(try RemoteRequest.make(source:source,chatID:"or-chat",path:[],settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions"),key:"FAKE-native-secret"))
        let unrelatedChat = try source.required("chats").array("chats")[0].replacing("config",with:config.replacing("providerId",with:.string("openai")))
        let unrelatedSource = source.replacing("chats",with:.array([unrelatedChat]))
        let unrelated = try RemoteRequest.make(source:unrelatedSource,chatID:"or-chat",path:[],settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions"),key:"FAKE-native-secret")
        let unrelatedBody = try OrderedJSON.decode(XCTUnwrap(unrelated.httpBody))
        XCTAssertNil(unrelatedBody["provider"]); XCTAssertNil(unrelatedBody["session_id"]); XCTAssertNil(unrelatedBody["cache_control"])
        XCTAssertEqual(try source.encoded(),before)
    }
    func testAzureUsesSavedApiVersionAndNativeAuthenticationRejectsInvalidHeadersOrOrigin() async throws {
        let local = try store(), state = try state(local,stream:false)
        let saved = try state.publicationSnapshot(), apiVersion = OrderedJSON.string("2025-01-01-preview")
        try state.applySnapshot(.object([.init(key:"version",value:saved.required("version")),.init(key:"state",value:.object([.init(key:"apiVersion",value:apiVersion)]))]))
        var credentials = record(stream:false); credentials.settings.endpoint = "https://unit-fixture.openai.azure.com"
        let remote = client(); FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        try state.startGeneration(input:"Azure boundary",record:credentials,client:remote)
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError)
        let sent = try XCTUnwrap(FakeRemoteProtocol.requests.first)
        XCTAssertEqual(sent.url?.path,"/openai/deployments/fake-model/chat/completions"); XCTAssertEqual(sent.url?.query,"api-version=2025-01-01-preview")
        XCTAssertEqual(sent.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE"); XCTAssertEqual(sent.value(forHTTPHeaderField:"api-key"),"FAKE")
        XCTAssertEqual(try state.publicationSnapshot().required("state").required("apiVersion").encoded(),try apiVersion.encoded())
        let source = try XCTUnwrap(state.exchange).source, before = try source.encoded()
        let path = try XCTUnwrap(state.conversation).visibleMessages.map(\.id)
        let exactOverride = try RemoteRequest.make(source:source,chatID:"remote",path:path,settings:credentials.settings,key:"FAKE",customHeaders:.object([.init(key:"Authorization",value:.string("FAKE-overridden"))]))
        XCTAssertEqual(exactOverride.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE")
        // HTTP names are case insensitive; reject aliases instead of emitting two auth values.
        for headers in [OrderedJSON.object([.init(key:"authorization",value:.string("FAKE-other"))]),.object([.init(key:"X-Trace",value:.string("line\r\nbreak"))]),.object([.init(key:"X-Trace\n",value:.string("trace"))]),.object([.init(key:"Content-Type",value:.string("a")),.init(key:"content-type",value:.string("b"))])] {
            XCTAssertThrowsError(try RemoteRequest.make(source:source,chatID:"remote",path:path,settings:credentials.settings,key:"FAKE",customHeaders:headers))
        }
        XCTAssertThrowsError(try RemoteRequest.make(source:source,chatID:"remote",path:path,settings:credentials.settings,key:"FAKE\r\ninvalid"))
        let forged = OrderedJSON.object([.init(key:"endpoint",value:.string("https://other.invalid/completions")),.init(key:"headers",value:.object([])),.init(key:"authentication",value:.array([.object([.init(key:"name",value:.string("Authorization")),.init(key:"prefix",value:.string("Bearer "))])]))])
        XCTAssertThrowsError(try RemoteRequest.bindEnvelope(forged,body:.object([]),originalURL:credentials.settings.validatedURL(),key:"FAKE"))
        XCTAssertEqual(try source.encoded(),before)
    }

    func testSavedModelCatalogReachesSharedReasoningBodyWithoutChangingRawCatalog() async throws {
        let local = try store(), state = try state(local)
        let snapshot = try state.publicationSnapshot(), saved = try snapshot.required("state")
        var chats = try saved.required("chats").array("chats")
        let chatID = try XCTUnwrap(state.conversation).id
        let index = try XCTUnwrap(chats.firstIndex { $0["id"] == .string(chatID) })
        let config = try chats[index].required("config").replacing("model",with:.string("anthropic/claude-opus-5.5")).replacing("stream",with:.bool(true)).replacing("providerId",with:.string("openrouter")).replacing("reasoning_effort",with:.string("none"))
        chats[index] = chats[index].replacing("config",with:config)
        let modelState = try OrderedJSON.decode(Data(#"{"favoriteModels":[{"modelId":"anthropic/claude-opus-5.5","providerId":"openrouter","supportsReasoning":true,"reasoningMandatory":true,"streamSupport":false,"xRaw":{"huge":9007199254740993,"decimal":1.2300}}],"providerModelCache":{},"providerCustomModels":{}}"#.utf8))
        let roots = try modelState.object("modelState")
        try state.applySnapshot(.object([.init(key:"version",value:snapshot.required("version")),.init(key:"state",value:.object([.init(key:"chats",value:.array(chats)),.init(key:"providers",value:.object([.init(key:"openrouter",value:.object([.init(key:"id",value:.string("openrouter")),.init(key:"name",value:.string("FAKE OpenRouter")),.init(key:"endpoint",value:.string("https://openrouter.ai/api/v1/chat/completions")),.init(key:"modelsRequireAuth",value:.bool(false)),.init(key:"apiKey",value:.string("FAKE-snapshot-unused"))]))]))] + roots))]))
        let source = try XCTUnwrap(state.exchange).source, sourceBytes = try source.encoded(), before = try state.publicationSnapshot().encoded()
        // Match the shared OpenRouter origin rule; the injected URLProtocol captures every request.
        var credentials = record(stream:true)
        credentials.settings.endpoint = "https://openrouter.ai/api/v1/chat/completions"
        credentials.settings.model = "unused-device-model"
        let direct = try RemoteRequest.make(source:source,chatID:chatID,path:XCTUnwrap(state.conversation).visibleMessages.map(\.id),settings:credentials.settings,key:credentials.key,modelState:modelState)
        let directBody = try OrderedJSON.decode(XCTUnwrap(direct.httpBody))
        XCTAssertEqual(directBody["reasoning"]?["effort"],.string("low"))
        XCTAssertEqual(directBody["model"],.string("anthropic/claude-opus-5.5")); XCTAssertEqual(directBody["stream"],.bool(false))
        XCTAssertEqual(try source.encoded(),sourceBytes); XCTAssertEqual(try state.publicationSnapshot().encoded(),before)
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        var bound = credentials; bound.key = "FAKE-bound-provider"
        credentials.key = "FAKE-wrong-legacy"
        var selectedProviders: [String] = []
        try state.startGeneration(input:"Catalog boundary",record:credentials,client:remote,readProviderCredential:{ id in selectedProviders.append(id); return bound })
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError)
        let sent = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
        XCTAssertEqual(sent["reasoning"],directBody["reasoning"])
        XCTAssertEqual(selectedProviders,["openrouter"])
        XCTAssertEqual(FakeRemoteProtocol.requests.first?.url?.host,"openrouter.ai")
        XCTAssertEqual(FakeRemoteProtocol.requests.first?.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-bound-provider")
        let after = try state.publicationSnapshot().required("state")
        for field in roots { XCTAssertEqual(try after.required(field.key).encoded(),try field.value.encoded()) }
    }

    func testSavedSummaryUsesSharedSubmissionRules() throws {
        let source = try OrderedJSON.decode(Data(#"{"chats":[{"id":"summary-chat","config":{"model":"fake-model","max_tokens":100},"messages":[{"role":"user","content":[{"type":"text","text":"Original"}]}],"summaries":[{"id":"s","mode":"single","useForSubmit":true,"text":"Saved context","sources":[{"nodeId":"0","parentId":null,"role":"user","textParts":["Original"]}]}]}]}"#.utf8))
        let request = try RemoteRequest.make(source: source, chatID: "summary-chat", path: ["0"], settings: record().settings, key: "FAKE")
        let messages = try OrderedJSON.decode(XCTUnwrap(request.httpBody)).required("messages").array("messages")
        XCTAssertEqual(try messages[0].required("content").array("content")[0].required("text").string("text"), "Past conversation summary:\nSaved context")
    }

    private func enableUsage(_ app: ChatState, totals: OrderedJSON = .object([])) throws {
        let snapshot = try app.publicationSnapshot()
        try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("countTotalTokens",with:.bool(true)).replacing("totalTokenUsed",with:totals)))
    }
    func testObservedUsageAndReplySaveAtomicallyAndRetryCountsOnlyOnce() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("usage-failure-\(UUID().uuidString)")
        var reject = false
        let local = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")) { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let app = try state(local,stream:false), remote = client()
        let totals = try OrderedJSON.decode(Data(#"{"fake-model":{"promptTokens":5,"completionTokens":6,"imageTokens":9007199254740993,"future":1.2300},"untouched":{"promptTokens":9007199254740993}}"#.utf8))
        try enableUsage(app,totals:totals)
        FakeRemoteProtocol.packets = [.init(bytes:Data(#"{"choices":[{"message":{"content":"FAKE observed reply"},"finish_reason":"stop"}],"usage":{"prompt_tokens":13,"completion_tokens":7,"cost":0}}"#.utf8))]
        var credential = record(stream:false); credential.settings.endpoint = "https://openrouter.ai/api/v1/chat/completions"
        try app.startGeneration(input:"FAKE question",record:credential,client:remote)
        let reserved = try XCTUnwrap(app.generation?.plan?["targetNodeId"]?.string("target"))
        let preparedChat = try XCTUnwrap(app.exchange).source.required("chats").array("chats")[0]
        let preparedPath = try XCTUnwrap(preparedChat["branchTree"]?["activePath"]).array("path")
        XCTAssertEqual(preparedPath.last, .string(reserved))
        XCTAssertEqual(preparedChat["branchTree"]?["nodes"]?[reserved]?["role"], .string("assistant"))
        XCTAssertEqual(try preparedChat.required("messages").array("messages").last?["content"],
                       .array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string(""))])]))
        let baseline = try app.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        reject = true
        try await wait { app.generation?.running == false }
        XCTAssertNotNil(app.generationError)
        XCTAssertEqual(try app.publicationSnapshot(),baseline); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        reject = false; try app.saveGenerationResult()
        let saved = try app.publicationSnapshot()["state"]?["totalTokenUsed"]
        XCTAssertEqual(saved?["fake-model"]?["promptTokens"],.number("18"))
        XCTAssertEqual(saved?["fake-model"]?["completionTokens"],.number("13"))
        XCTAssertEqual(saved?["fake-model"]?["imageTokens"],totals["fake-model"]?["imageTokens"])
        XCTAssertEqual(saved?["fake-model"]?["future"],totals["fake-model"]?["future"])
        XCTAssertEqual(saved?["untouched"],totals["untouched"])
        let chat = try app.exchange!.source.required("chats").array("chats")[0]
        let node = try chat.required("branchTree").required("activePath").array("path").last!.string("target")
        XCTAssertEqual(node, reserved)
        XCTAssertEqual(chat["branchTree"]?["nodes"]?[node]?["openRouterObservation"]?["cost"],.number("0"))
        let wire = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody)).required("messages").array("messages")
        XCTAssertEqual(wire.last?["role"], .string("user"))
        XCTAssertThrowsError(try app.saveGenerationResult())
        XCTAssertEqual(try ChatState(store:local).publicationSnapshot(),try app.publicationSnapshot())
    }
    func testStopAndNetworkFailureKeepObservationWithoutAddingUsage() async throws {
        for stopping in [true,false] {
            let app = try state(store()), remote = client()
            let totals = try OrderedJSON.decode(Data(#"{"fake-model":{"promptTokens":5,"completionTokens":6,"imageTokens":2}}"#.utf8))
            try enableUsage(app,totals:totals)
            let event = Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":3}}\n\n".utf8)
            FakeRemoteProtocol.packets = [.init(bytes:event),.init(bytes:Data("data: [DONE]\n\n".utf8),delay:0.05)]
            if stopping { FakeRemoteProtocol.holdLast = true }
            else { FakeRemoteProtocol.packets = [.init(bytes:event),.init(bytes:Data(),delay:0.05)]; FakeRemoteProtocol.failure = URLError(.networkConnectionLost) }
            var credential = record(); credential.settings.endpoint = "https://openrouter.ai/api/v1/chat/completions"
            try app.startGeneration(input:"FAKE question",record:credential,client:remote)
            if stopping { try await wait { app.generation?.output.text == "Partial" }; app.stopGeneration(); FakeRemoteProtocol.releaseLast?() }
            try await wait { app.generation == nil }
            XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"],totals)
            let chat = try app.exchange!.source.required("chats").array("chats")[0]
            let node = try chat.required("branchTree").required("activePath").array("path").last!.string("target")
            XCTAssertEqual(chat["branchTree"]?["nodes"]?[node]?["openRouterObservation"]?["promptTokens"],.number("10"))
        }
    }
    func testUsageOnlyStopPreservesObservationOnEmptyAssistant() async throws {
        let app = try state(store()), remote = client()
        try enableUsage(app)
        FakeRemoteProtocol.holdLast = true
        FakeRemoteProtocol.packets = [.init(bytes:Data("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":0,\"cost\":0}}\n\n".utf8)),.init(bytes:Data("data: [DONE]\n\n".utf8),delay:0.1)]
        var credential = record(); credential.settings.endpoint = "https://openrouter.ai/api/v1/chat/completions"
        try app.startGeneration(input:"FAKE question",record:credential,client:remote)
        try await wait { app.generation?.output.observation["promptTokens"] == .number("10") }
        XCTAssertTrue(try XCTUnwrap(app.generation).output.isEmpty)
        app.stopGeneration(); FakeRemoteProtocol.releaseLast?()
        XCTAssertNil(app.generation); XCTAssertNil(app.generationError)
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"],.object([]))
        let chat = try app.exchange!.source.required("chats").array("chats")[0]
        let target = try chat.required("branchTree").required("activePath").array("path").last!.string("target")
        XCTAssertEqual(chat["branchTree"]?["nodes"]?[target]?["openRouterObservation"]?["cost"],.number("0"))
    }

    func testUnsafeChangedUsagePreservesPendingReplyAndRawCounters() async throws {
        let local = try store(), app = try state(local,stream:false), remote = client()
        let totals = try OrderedJSON.decode(Data(#"{"fake-model":{"promptTokens":9007199254740993,"completionTokens":6,"imageTokens":0}}"#.utf8))
        try enableUsage(app,totals:totals)
        FakeRemoteProtocol.packets = [.init(bytes:Data(#"{"choices":[{"message":{"content":"Pending reply"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}"#.utf8))]
        var credential = record(stream:false); credential.settings.endpoint = "https://openrouter.ai/api/v1/chat/completions"
        try app.startGeneration(input:"FAKE question",record:credential,client:remote)
        let baseline = try app.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        try await wait { app.generation?.running == false }
        XCTAssertNotNil(app.generationError); XCTAssertEqual(app.generation?.output.text,"Pending reply")
        XCTAssertEqual(try app.publicationSnapshot(),baseline); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
    }

    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-remote-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path); try? FileManager.default.removeItem(at: directory) }
        return LocalStateStore(fileURL: directory.appendingPathComponent("local-state.json"))
    }
    private func client() -> RemoteClient {
        FakeRemoteProtocol.requests = []; FakeRemoteProtocol.holdLast = false; FakeRemoteProtocol.releaseLast = nil; FakeRemoteProtocol.status = 200; FakeRemoteProtocol.failure = nil; FakeRemoteProtocol.packets = []
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FakeRemoteProtocol.self]
        return RemoteClient(session: URLSession(configuration: config))
    }
    private func record(stream: Bool = true) -> RemoteCredentialRecord {
        RemoteCredentialRecord(settings: RemoteSettings(endpoint: "https://fixture.invalid/v1/chat/completions", model: "fake-model", stream: stream), key: "FAKE")
    }
    private func state(_ store: LocalStateStore, stream: Bool = true) throws -> ChatState {
        let state = ChatState(store: store)
        var source = try fixture().required("cases").array("cases")[0].required("source")
        var chats = try source.required("chats").array("chats")
        // Transport fixtures intentionally exercise the provider-unspecified legacy record.
        let config = OrderedJSON.object(try chats[0].required("config").object("config").filter { $0.key != "providerId" })
        chats[0] = chats[0].replacing("config",with:config.replacing("stream",with:.bool(stream)))
        source = source.replacing("chats",with:.array(chats))
        try state.importWebData(source.encoded())
        return state
    }
    private func wait(_ predicate: () -> Bool) async throws {
        for _ in 0..<300 {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Isolated request did not reach expected state")
    }
    private func streamPackets() throws -> [FakeRemoteProtocol.Packet] {
        try fixture().required("responses").required("stream").array("stream").map { .init(bytes: Data(try $0.string("event").utf8), delay: 0.01) }
    }
    func testComposerRawBoundaryAndDelayedImagesUseOriginalChatIdentity() throws {
        let opaque = OrderedJSON.object([.init(key:"huge",value:.number("9007199254740993")),.init(key:"decimal",value:.number("1.2300")),.init(key:"marker",value:.object([.init(key:"opaqueRef",value:.number("0"))]))])
        let text = OrderedJSON.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("old")),.init(key:"unknown",value:opaque)])
        let second = text.replacing("text",with:.string("second"))
        let prepared = try ComposerContent.prepare(.array([text,second]),text:"new")
        let parts = try prepared.parts.array("parts")
        XCTAssertEqual(try parts[0].required("unknown").encoded(),try opaque.encoded())
        XCTAssertEqual(try parts[1].encoded(),try second.encoded())
        let state = try state(store()), originalID = try XCTUnwrap(state.conversation).id
        state.setComposerText(chatID:originalID,text:"original input")
        let detail = try state.composerImageDetail(chatID:originalID)
        try state.createChat(defaults:ChatDefaults.webInitial(),id:"new-chat")
        try state.addComposerImages(chatID:originalID,urls:["data:image/png;base64,FAKE_LATE"],detail:detail)
        XCTAssertEqual(state.composerDraft(chatID:"new-chat").parts,.array([]))
        let oldDraft = state.composerDraft(chatID:originalID)
        XCTAssertEqual(oldDraft.text,"original input")
        XCTAssertEqual(try oldDraft.parts.array("parts").last?["image_url"]?["detail"],.string(detail))
        XCTAssertEqual(state.conversation?.id,"new-chat")
        try state.removeComposerPart(chatID:originalID,index:0)
        XCTAssertEqual(state.composerDraft(chatID:originalID).parts,.array([]))
        XCTAssertEqual(state.composerDraft(chatID:originalID).text,"original input")
        XCTAssertEqual(try ComposerContent.prepare(.array([]),images:[("data:image/png;base64,FAKE_ONLY","auto")]).hasMeaningfulContent,true)
    }
    func testSharedWebRequestProjectionAndSourcePreservation() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture["fixtureVersion"], .number("1"))
        let cases = try fixture.required("cases").array("cases")
        XCTAssertEqual(cases.count, 4)
        for test in cases {
            let source = try test.required("source")
            _ = try WebExchange(source: source)
            let settings = try JSONDecoder().decode(RemoteSettings.self, from: test.required("settings").encoded())
            let request = try RemoteRequest.make(source: source, chatID: "remote", path: [], settings: settings, key: test.required("key").string("key"))
            let expected = try test.required("expected")
            XCTAssertEqual(request.url?.absoluteString, try expected.required("endpoint").string("endpoint"))
            for header in try expected.required("headers").object("headers") { XCTAssertEqual(request.value(forHTTPHeaderField: header.key), try header.value.string("header")) }
            let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody))
            // The fixture's device override is superseded by the saved conversation's stream.
            let expectedBody = try expected.required("body").replacing("stream",with:source.required("chats").array("chats")[0].required("config").required("stream"))
            XCTAssertEqual(try SyncRecords.canonical(body), try SyncRecords.canonical(expectedBody))
            XCTAssertEqual(source["apiKey"], .string("FAKE-imported-not-request-key"))
            XCTAssertThrowsError(try RemoteRequest.make(source: source, chatID: "remote", path: [], settings: RemoteSettings(endpoint: "http://fixture.invalid", model: "fake-model"), key: "FAKE"))
        }
    }
    func testNonstreamAndStreamingSaveAssistantRestartExportAndPreserveOldData() async throws {
        for streaming in [false, true] {
            let store = try store()
            let state = try state(store,stream:streaming)
            let old = try XCTUnwrap(state.exchange).source
            let client = client()
            // Same final parts through the actual structured-content/reasoning-details/think route.
            if streaming {
                FakeRemoteProtocol.packets = [
                    .init(bytes:Data(#"data: {"choices":[{"delta":{"content":[{"type":"text","text":"<thi"}],"reasoning_details":[{"type":"reasoning.text","text":"Rea"}]}}]}"#.appending("\n\n").utf8)),
                    .init(bytes:Data(#"data: {"choices":[{"delta":{"content":"nk>son</think>An"}}]}"#.appending("\n\n").utf8)),
                    .init(bytes:Data(#"data: {"choices":[{"delta":{"content":[{"type":"output_text","text":"swer 日本語"}]},"finish_reason":"stop"}]}"#.appending("\n\ndata: [DONE]\n\n").utf8))]
            } else {
                FakeRemoteProtocol.packets = [.init(bytes:Data(#"{"choices":[{"message":{"content":[{"type":"text","text":"<think>son</think>Answer 日本語"}],"reasoning_details":[{"type":"reasoning.text","text":"Rea"}]},"finish_reason":"stop"}]}"#.utf8))]
            }
            // Device stream deliberately disagrees: the parser must use the final request.
            if streaming {
                let imageOnly = OrderedJSON.array([.object([.init(key:"type",value:.string("image_url")),.init(key:"image_url",value:.object([.init(key:"url",value:.string("data:image/png;base64,FAKE_ONLY")),.init(key:"detail",value:.string("auto"))]))])])
                try state.startGeneration(parts:imageOnly,record:record(stream:false),client:client)
            } else { try state.startGeneration(input:"New user",record:record(stream:true),client:client) }
            try await wait { state.generation == nil }
            XCTAssertNil(state.generationError)
            let source = try XCTUnwrap(state.exchange).source
            let chat = try source.required("chats").array("chats")[0]
            let messages = try chat.required("messages").array("messages")
            XCTAssertEqual(messages.last?["role"], .string("assistant"))
            XCTAssertEqual(messages.last?["content"], .array([.object([JSONField(key: "type", value: .string("reasoning")), JSONField(key: "text", value: .string("Reason"))]), .object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("Answer 日本語"))])]))
            let original = try old.required("chats").array("chats")[0].required("messages").array("messages")
            // Attribute projection may reorder object keys; every value and array position must remain identical.
            XCTAssertEqual(Data(try SyncRecords.canonical(.array(Array(messages.prefix(original.count)))).utf8),
                           Data(try SyncRecords.canonical(.array(original)).utf8))
            XCTAssertEqual(source["xRoot"], old["xRoot"])
            XCTAssertEqual(source["apiKey"], old["apiKey"])
            XCTAssertEqual(source["contentStore"]?["unrelated"], old["contentStore"]?["unrelated"])
            let fresh = ChatState(store: store)
            XCTAssertNil(fresh.persistenceError)
            XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(fresh.exchange).encoded()), source)
            let requestBody = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
            let wireMessages = try requestBody.required("messages").array("messages")
            if streaming { XCTAssertEqual(try wireMessages.last!.required("content").array("parts").last?["image_url"]?["url"],.string("data:image/png;base64,FAKE_ONLY")) }
            XCTAssertFalse(wireMessages.contains { $0["xMessage"] != nil })
            XCTAssertFalse(try wireMessages.contains { message in try message.required("content").array("parts").contains { $0["text"] == .string("Omitted") } })
            XCTAssertEqual(FakeRemoteProtocol.requests.count, 1)
            XCTAssertEqual(FakeRemoteProtocol.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE")
        }
    }
    func testRegenerateAndContinueReplaceAssistantKeepFollowingNodeAndStopRestartExport() async throws {
        let local = try store(), state = try state(local,stream:false)
        // The general transport fixture has six messages; seed this middle-replacement case explicitly.
        let initial = try XCTUnwrap(state.exchange).source
        let original = try initial.required("chats").array("chats")[0]
        let threeMessages = try Array(original.required("messages").array("messages").prefix(3))
        try state.importWebData(initial.replacing("chats",with:.array([original.replacing("messages",with:.array(threeMessages))])).encoded())
        var tail = try state.messageDraft(nodeID:nil); tail.text = "Following user"
        try state.saveMessage(tail,mode:.append,newIDs:["system","user","old-assistant","tail"])
        let seeded = try XCTUnwrap(state.exchange).source
        var chats = try seeded.required("chats").array("chats")
        let treeSeed = try chats[0].required("branchTree"), nodesSeed = try treeSeed.required("nodes")
        let markedTail = try nodesSeed.required("tail").replacing("xFuture",with:.number("9007199254740993"))
        chats[0] = chats[0].replacing("branchTree",with:treeSeed.replacing("nodes",with:nodesSeed.replacing("tail",with:markedTail)))
        try state.importWebData(seeded.replacing("chats",with:.array(chats)).encoded())
        let before = try XCTUnwrap(state.exchange).source
        let oldChat = try before.required("chats").array("chats")[0]
        let tailNode = try oldChat.required("branchTree").required("nodes").required("tail")
        let tailContent = try before.required("contentStore").required(tailNode.required("contentHash").string("hash")).required("content")
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        let draft = try state.messageGenerationDraft(nodeID:"old-assistant",operation:.regenerate)
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.encoded(),try before.encoded())
        try state.startGeneration(draft,record:record(stream:false),client:remote,nodeIDs:["replacement"])
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError); XCTAssertFalse(state.canUndoMessageEdit)
        let regenerated = try XCTUnwrap(state.exchange).source
        let tree = try regenerated.required("chats").array("chats")[0].required("branchTree")
        XCTAssertEqual(tree["activePath"],.array(["system","user","replacement","tail"].map(OrderedJSON.string)))
        XCTAssertNil(tree["nodes"]?["old-assistant"])
        XCTAssertEqual(tree["nodes"]?["tail"]?["parentId"],.string("replacement"))
        XCTAssertEqual(try regenerated.required("contentStore").required(tailNode.required("contentHash").string("hash")).required("content").encoded(),try tailContent.encoded())
        let body = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
        let tailBytes = try tailContent.encoded()
        XCTAssertFalse(try body.required("messages").array("messages").contains { message in
            (try? message.required("content").encoded()) == tailBytes
        })
        var config = try state.chatConfigDraft(); config.config = config.config.replacing("stream",with:.bool(true)); try state.saveChatConfig(config)
        let streaming = client()
        FakeRemoteProtocol.holdLast = true
        FakeRemoteProtocol.packets = [.init(bytes:Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial<th\"}}]}\n\n".utf8)),.init(bytes:Data("data: [DONE]\n\n".utf8),delay:0.1)]
        let next = try state.messageGenerationDraft(nodeID:"user",operation:.fromHere)
        try state.startGeneration(next,record:record(),client:streaming,nodeIDs:["continued"])
        try await wait { state.generation?.output.text == "Partial" }
        state.stopGeneration(); FakeRemoteProtocol.releaseLast?()
        XCTAssertNil(state.generation)
        let completed = try XCTUnwrap(state.exchange).source
        let finalTree = try completed.required("chats").array("chats")[0].required("branchTree")
        XCTAssertEqual(finalTree["activePath"],.array(["system","user","continued","tail"].map(OrderedJSON.string)))
        XCTAssertNil(finalTree["nodes"]?["replacement"])
        XCTAssertEqual(finalTree["nodes"]?["tail"]?["parentId"],.string("continued"))
        XCTAssertEqual(try finalTree.required("nodes").required("tail").required("xFuture").encoded(),try tailNode.required("xFuture").encoded())
        let hash = try finalTree.required("nodes").required("continued").required("contentHash").string("hash")
        XCTAssertEqual(try SyncRecords.resolveContent(completed.required("contentStore"),hash:hash),.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Partial<th"))])]))
        let restarted = ChatState(store:local)
        XCTAssertNil(restarted.persistenceError)
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
    }

    func testRegenerationPreparationAndFinalSaveFailureKeepSourceAndDraftGuards() async throws {
        let local = try store(), state = try state(local,stream:false), remote = client()
        let draft = try state.messageGenerationDraft(nodeID:"message-2",operation:.regenerate)
        let original = try XCTUnwrap(state.exchange).source.encoded(), disk = try Data(contentsOf:local.fileURL)
        let directory = local.fileURL.deletingLastPathComponent()
        defer { try? FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path) }
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:directory.path)
        XCTAssertThrowsError(try state.startGeneration(draft,record:record(stream:false),client:remote))
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.encoded(),original); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty); XCTAssertNil(state.generation)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded(),delay:0.05)]
        try state.startGeneration(draft,record:record(stream:false),client:remote)
        let prepared = try XCTUnwrap(state.exchange).source.encoded(), preparedDisk = try Data(contentsOf:local.fileURL)
        XCTAssertThrowsError(try state.startGeneration(draft,record:record(stream:false),client:remote))
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:directory.path)
        try await wait { state.generation?.running == false }
        XCTAssertEqual(state.generation?.output.text,"Answer 日本語")
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.encoded(),prepared); XCTAssertEqual(try Data(contentsOf:local.fileURL),preparedDisk)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        try state.saveGenerationResult()
        XCTAssertNil(state.generation)
        XCTAssertThrowsError(try state.startGeneration(draft,record:record(stream:false),client:remote))
        XCTAssertEqual(try ChatState(store:local).exportWebData(),try state.exportWebData())
    }

    func testStopKeepsPartialAndRejectsDelayedResult() async throws {
        let store = try store()
        let state = try state(store)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial<th\"}}]}\n\n".utf8)), .init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\" LATE\"}}]}\n\ndata: [DONE]\n\n".utf8), delay: 0.1)]
        FakeRemoteProtocol.holdLast = true
        let configDraft = try state.chatConfigDraft()
        try state.startGeneration(input: "Stop", record: record(), client: client)
        XCTAssertThrowsError(try state.saveChatConfig(configDraft))
        try await wait { state.generation?.output.text == "Partial" }
        XCTAssertNotNil(FakeRemoteProtocol.releaseLast)
        state.stopGeneration()
        FakeRemoteProtocol.releaseLast?()
        let stopped = try XCTUnwrap(state.exchange).source
        await Task.yield()
        XCTAssertNil(state.generation)
        XCTAssertEqual(state.exchange?.source, stopped)
        let fresh = ChatState(store: store)
        let content = try XCTUnwrap(fresh.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content")
        XCTAssertEqual(content, .array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("Partial<th"))])]))
    }
    func testNetworkFailurePreservesUserAndPartialWithoutChangingPriorMessages() async throws {
        for partial in [false, true] {
            let store = try store()
            let state = try state(store)
            let original = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages")
            let client = client()
            if partial { FakeRemoteProtocol.packets = [.init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\"Recovered<th\"}}]}\n\n".utf8))] }
            else { FakeRemoteProtocol.status = 500 }
            try state.startGeneration(input: "Failure", record: record(), client: client)
            try await wait { state.generation == nil }
            XCTAssertNotNil(state.generationError)
            let messages = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages")
            // Attribute projection may reorder object keys; every value and array position must remain identical.
            XCTAssertEqual(Data(try SyncRecords.canonical(.array(Array(messages.prefix(original.count)))).utf8),
                           Data(try SyncRecords.canonical(.array(original)).utf8))
            // Web generationPlan keeps its reserved empty assistant when no stream parts arrive.
            XCTAssertEqual(messages.count, original.count + 2)
            if partial { XCTAssertEqual(try messages.last!.required("content").array("parts")[0]["text"],.string("Recovered<th")) }
            else { XCTAssertEqual(messages.last?["content"],.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string(""))])])) }
            XCTAssertEqual(ChatState(store: store).exchange?.source, state.exchange?.source)
        }
    }
    func testSaveFailuresRetainInputSourceDiskAndUnpublishedOutputForRetry() async throws {
        let store = try store()
        let state = try state(store,stream:false)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.05)]
        let original = state.exchange?.source
        let oldDisk = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        let chatID = try XCTUnwrap(state.conversation).id
        state.setComposerText(chatID:chatID,text:"Preserved input")
        try state.addComposerImages(chatID:chatID,urls:["data:image/png;base64,FAKE_COMPOSER_IMAGE"],detail:"high")
        let draft = state.composerDraft(chatID:chatID)
        XCTAssertThrowsError(try state.sendComposer(record:record(stream:false),client:client))
        XCTAssertEqual(state.composerDraft(chatID:chatID).parts,draft.parts)
        XCTAssertEqual(state.composerDraft(chatID:chatID).text,draft.text)
        XCTAssertEqual(state.exchange?.source, original)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), oldDisk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try state.sendComposer(record:record(stream:false),client:client)
        XCTAssertEqual(state.composerDraft(chatID:chatID).parts,.array([]))
        let userSource = state.exchange?.source
        let userDisk = try Data(contentsOf: store.fileURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        try await wait { state.generation?.running == false }
        XCTAssertEqual(state.generation?.output.text, "Answer 日本語")
        XCTAssertEqual(state.exchange?.source, userSource)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), userDisk)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try state.saveGenerationResult()
        let body = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
        let sent = try body.required("messages").array("messages").last!.required("content").array("parts")
        XCTAssertEqual(sent.last?["image_url"]?["url"],.string("data:image/png;base64,FAKE_COMPOSER_IMAGE"))
        XCTAssertEqual(sent.last?["image_url"]?["detail"],.string("high"))
        XCTAssertNil(state.generation)
        XCTAssertEqual(ChatState(store: store).exchange?.source, state.exchange?.source)
    }
    func testSourceReplacementInvalidatesOldSessionAndRejectsLateCompletion() async throws {
        let store = try store()
        let state = try state(store,stream:false)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.1)]
        FakeRemoteProtocol.holdLast = true
        try state.startGeneration(input: "Old session", record: record(stream: false), client: client)
        try await wait { FakeRemoteProtocol.releaseLast != nil }
        try state.renameChat(id: "remote", title: "New source")
        let changed = state.exchange?.source
        FakeRemoteProtocol.releaseLast?()
        await Task.yield()
        XCTAssertNil(state.generation)
        XCTAssertEqual(state.exchange?.source, changed)
    }
    func testSettingsFailureKeepsRecordAndSavedChatModelWinsWithLegacyFallback() throws {
        let state = ChatState()
        var stored = record(stream: false)
        try state.loadRemoteSettings(read: { stored })
        let before = state.remoteSettings
        var next = stored
        next.settings.model = "fake-changed"; next.settings.stream = true; next.key = "FAKE-new"
        XCTAssertThrowsError(try state.saveRemoteSettings(next, write: { _ in throw ExchangeError.invalid("FAKE Keychain failure") }))
        XCTAssertEqual(state.remoteSettings, before)
        XCTAssertEqual(stored.settings, before)
        try state.saveRemoteSettings(next, write: { stored = $0 })
        XCTAssertEqual(state.remoteSettings, next.settings)
        let source = try fixture().required("cases").array("cases")[0].required("source")
        let request = try RemoteRequest.make(source: source, chatID: "remote", path: [], settings: stored.settings, key: stored.key)
        let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody))
        XCTAssertEqual(body["model"], .string("fake-model"))
        XCTAssertEqual(body["stream"], .bool(true))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE-new")
        var legacyChats = try source.required("chats").array("chats")
        legacyChats[0] = legacyChats[0].replacing("config",with:try legacyChats[0].required("config").replacing("model",with:.string("")))
        let legacy = source.replacing("chats",with:.array(legacyChats)), legacyBefore = try legacy.encoded()
        let fallback = try RemoteRequest.make(source:legacy,chatID:"remote",path:[],settings:stored.settings,key:stored.key)
        let fallbackBody = try OrderedJSON.decode(XCTUnwrap(fallback.httpBody))
        XCTAssertEqual(fallbackBody["model"],.string("fake-changed")); XCTAssertEqual(fallbackBody["stream"],.bool(true))
        XCTAssertEqual(try legacy.encoded(),legacyBefore)
    }
    func testMalformedEventsMultilineAndUnsupportedResponseAreRejected() throws {
        var parser = RemoteSSE()
        let data = Data(": keepalive\r\ndata: {\"choices\":\r\ndata: [{\"delta\":{\"content\":\"日本語\"}}]}\r\n\r\n".utf8)
        var events: [String] = []
        for byte in data { if let event = try parser.push(byte) { events.append(event) } }
        XCTAssertEqual(events.count, 1)
        var output = RemoteOutput()
        _ = try output.consume(OrderedJSON.decode(Data(events[0].utf8)), streaming: true)
        XCTAssertEqual(output.text, "日本語")
        XCTAssertThrowsError(try output.consume(OrderedJSON.decode(Data("{\"error\":{\"message\":\"FAKE\"}}".utf8)), streaming: true))
        XCTAssertThrowsError(try output.consume(OrderedJSON.decode(Data("{\"choices\":[{\"delta\":{\"tool_calls\":[]}}]}".utf8)), streaming: true))
        XCTAssertThrowsError(try OrderedJSON.decode(Data("malformed".utf8)))
    }
    func testSharedResponseSessionCarriesPendingThinkStateAndFlushParts() throws {
        var output = RemoteOutput()
        _ = try output.consume(OrderedJSON.decode(Data(#"{"choices":[{"delta":{"content":"<thi"}}]}"#.utf8)),streaming:true)
        XCTAssertTrue(output.isEmpty)
        _ = try output.consume(OrderedJSON.decode(Data(#"{"choices":[{"delta":{"content":"nk>日本語</think>Answer<th"},"finish_reason":"stop"}]}"#.utf8)),streaming:true)
        XCTAssertEqual(output.reasoning,"日本語"); XCTAssertEqual(output.text,"Answer")
        try output.flush()
        XCTAssertEqual(output.text,"Answer<th")
        XCTAssertEqual(output.parts,.array([.object([.init(key:"type",value:.string("reasoning")),.init(key:"text",value:.string("日本語"))]),.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Answer<th"))])]))
    }
    func testSSELineEndingsBOMAndByteBoundariesPreserveAllText() throws {
        let a = "data: {\"choices\":[{\"delta\":{\"content\":\"A日本語\"}}]}"
        let b = "data: {\"choices\":[{\"delta\":{\"content\":\"B\\uFEFF\"}}]}"
        for ending in ["\n", "\r", "\r\n"] {
            for bom in [Data(), Data([0xEF, 0xBB, 0xBF])] {
                let data = bom + Data((a + ending + ending + b + ending + ending + "data: [DONE]" + ending + ending).utf8)
                // Every byte enters separately, including the UTF8 BOM, Japanese and CR/LF boundaries.
                var parser = RemoteSSE()
                var events: [String] = []
                for byte in data { if let event = try parser.push(byte) { events.append(event) } }
                XCTAssertNil(try parser.finish())
                XCTAssertEqual(events.count, 3)
                XCTAssertEqual(events.last, "[DONE]")
                var output = RemoteOutput()
                for event in events.dropLast() { _ = try output.consume(OrderedJSON.decode(Data(event.utf8)), streaming: true) }
                XCTAssertEqual(output.text, "A日本語B\u{FEFF}")
            }
        }
        // Only a BOM at the very start is ignored; an interior BOM remains ordinary data.
        var parser = RemoteSSE()
        let interior = Data((": comment\r\n" + "\u{FEFF}" + "data: ignored\r\rdata: kept\n\n").utf8)
        var events: [String] = []
        for byte in interior { if let event = try parser.push(byte) { events.append(event) } }
        XCTAssertEqual(events, ["kept"])
    }

}
