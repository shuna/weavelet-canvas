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
    static var onControl: ((URLRequest) -> Void)?
    static var recoveryResponses: [(status:Int,packets:[Packet],headers:[String:String])] = []
    static var managementResponses: [(status:Int,body:String)] = []
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { ["fixture.invalid", "unit-fixture.openai.azure.com", "openrouter.ai"].contains(request.url?.host ?? "") }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var captured = request
        captured.httpBody = RemoteRequest.fixtureBody(request)
        Self.requests.append(captured)
        if captured.url?.path.contains("/api/ack/") == true || captured.url?.path.contains("/api/cancel/") == true || (captured.url?.path.hasPrefix("/api/v1/generation/") == true && captured.url?.path.hasSuffix("/cancel") == true) {
            Self.onControl?(captured)
            client?.urlProtocol(self,didReceive:HTTPURLResponse(url:captured.url!,statusCode:200,httpVersion:nil,headerFields:[:])!,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:Data("{\"deleted\":true}".utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if captured.url?.path.contains("/api/status") == true || captured.url?.path.contains("/api/storage") == true, !Self.managementResponses.isEmpty {
            let result = Self.managementResponses.removeFirst()
            client?.urlProtocol(self,didReceive:HTTPURLResponse(url:captured.url!,statusCode:result.status,httpVersion:nil,headerFields:[:])!,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:Data(result.body.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        let scripted = captured.httpMethod == "GET" && !Self.recoveryResponses.isEmpty ? Self.recoveryResponses.removeFirst() : nil
        var headers = ["Content-Type": captured.httpBody.flatMap { try? OrderedJSON.decode($0) }?["stream"] == .bool(true) ? "text/event-stream" : "application/json"]
        if let scripted { headers.merge(scripted.headers) { _,new in new } }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: scripted?.status ?? Self.status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        let packets = scripted?.packets ?? Self.packets
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
        FakeRemoteProtocol.requests = []; FakeRemoteProtocol.onControl = nil; FakeRemoteProtocol.recoveryResponses = []; FakeRemoteProtocol.managementResponses = []; FakeRemoteProtocol.holdLast = false; FakeRemoteProtocol.releaseLast = nil; FakeRemoteProtocol.status = 200; FakeRemoteProtocol.failure = nil; FakeRemoteProtocol.packets = []
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
    private func creditsState(_ store: LocalStateStore) throws -> ChatState {
        let state = try state(store)
        var source = try XCTUnwrap(state.exchange?.source)
        var chats = try source.required("chats").array("chats")
        chats[0] = chats[0].replacing("config",with:try chats[0].required("config").replacing("providerId",with:.string("openrouter")))
        source = source.replacing("chats",with:.array(chats))
        try state.importWebData(source.encoded())
        return state
    }
    func testCreditsRequestUsesDeviceCredentialAndDoesNotPersistEphemeralBalance() async throws {
        let local = try store(), state = try creditsState(local)
        let source = try state.exchange?.source.encoded(), snapshot = try state.document?.snapshot.encoded()
        let disk = try Data(contentsOf:local.fileURL)
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE-device-only")
        var requests: [URLRequest] = []
        let fetch: (URLRequest) async throws -> OrderedJSON = { request in
            requests.append(request)
            return try OrderedJSON.decode(Data(#"{"data":{"total_credits":10,"total_usage":2.5}}"#.utf8))
        }
        await state.refreshOpenRouterCredits(reason:"open",readCredential:{ _ in credential },fetch:fetch,now:400_000)
        XCTAssertEqual(state.openRouterCreditDisplay,"$7.50")
        XCTAssertFalse(state.openRouterCreditsFetching)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url?.absoluteString,"https://openrouter.ai/api/v1/credits")
        XCTAssertEqual(request.httpMethod,"GET"); XCTAssertNil(request.httpBody)
        XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-device-only")
        await state.refreshOpenRouterCredits(reason:"open",readCredential:{ _ in credential },fetch:fetch,now:410_000)
        XCTAssertEqual(requests.count,1) // The bridge applies Web's fresh-cache policy.
        await state.refreshOpenRouterCredits(reason:"manual",readCredential:{ _ in credential },fetch:{ _ in .null },now:420_000)
        XCTAssertEqual(state.openRouterCreditDisplay,"$7.50")
        XCTAssertNotNil(state.openRouterCreditsError)
        XCTAssertEqual(try state.exchange?.source.encoded(),source)
        XCTAssertEqual(try state.document?.snapshot.encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        XCTAssertNil(ChatState(store:local).openRouterCreditDisplay)
    }
    func testCreditsRejectUntrustedCredentialsAndLateAccountResponseWithoutChangingData() async throws {
        let local = try store(), state = try creditsState(local)
        let disk = try Data(contentsOf:local.fileURL)
        var credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE-old-account")
        var release: CheckedContinuation<OrderedJSON,Error>?
        let pending = Task { @MainActor in
            await state.refreshOpenRouterCredits(reason:"manual",readCredential:{ _ in credential },fetch:{ _ in
                try await withCheckedThrowingContinuation { release = $0 }
            },now:400_000)
        }
        try await wait { release != nil }
        credential.key = "FAKE-new-account"
        release?.resume(returning:try OrderedJSON.decode(Data(#"{"data":{"total_credits":100,"total_usage":1}}"#.utf8)))
        await pending.value
        XCTAssertNil(state.openRouterCreditDisplay)
        XCTAssertFalse(state.openRouterCreditsFetching)
        state.invalidateOpenRouterCredits()
        credential.settings.endpoint = "https://openrouter.ai:8443/api/v1/chat/completions"
        var fetched = false
        await state.refreshOpenRouterCredits(reason:"manual",readCredential:{ _ in credential },fetch:{ _ in
            fetched = true; return .null
        },now:500_000)
        XCTAssertFalse(fetched)
        XCTAssertNil(state.openRouterCreditDisplay)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        // Even an explicitly saved matching custom provider credential must not go to canonical credits.
        let snapshot = try state.publicationSnapshot(), roots = try snapshot.required("state")
        var providers = try ChatImport.call("defaults").required("providers")
        let provider = try providers.required("openrouter").replacing("endpoint",with:.string(credential.settings.endpoint))
        providers = providers.replacing("openrouter",with:provider)
        try state.applySnapshot(snapshot.replacing("state",with:roots.replacing("providers",with:providers)))
        let configuredDisk = try Data(contentsOf:local.fileURL)
        await state.refreshOpenRouterCredits(reason:"manual",readCredential:{ _ in credential },fetch:{ _ in
            fetched = true; return .null
        },now:510_000)
        XCTAssertFalse(fetched)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),configuredDisk)
    }

    func testOldCreditsRequestCannotClearNewAccountBalance() async throws {
        let state = try creditsState(store())
        var credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE-old-account")
        var release: CheckedContinuation<OrderedJSON,Error>?
        let old = Task { @MainActor in
            await state.refreshOpenRouterCredits(reason:"manual",readCredential:{ _ in credential },fetch:{ _ in
                try await withCheckedThrowingContinuation { release = $0 }
            },now:400_000)
        }
        try await wait { release != nil }
        credential.key = "FAKE-new-account"
        // Also exercises identity invalidation before the fresh-cache/in-flight policy.
        await state.refreshOpenRouterCredits(reason:"open",readCredential:{ _ in credential },fetch:{ _ in
            try OrderedJSON.decode(Data(#"{"data":{"total_credits":100,"total_usage":2}}"#.utf8))
        },now:400_001)
        XCTAssertEqual(state.openRouterCreditDisplay,"$98.00")
        release?.resume(returning:try OrderedJSON.decode(Data(#"{"data":{"total_credits":10,"total_usage":1}}"#.utf8)))
        await old.value
        XCTAssertEqual(state.openRouterCreditDisplay,"$98.00")
        XCTAssertFalse(state.openRouterCreditsFetching)
        XCTAssertNil(state.openRouterCreditsError)
    }

    private func statsPayload(_ generationID: String = "gen-verified") throws -> OrderedJSON {
        try OrderedJSON.decode(Data("{\"data\":{\"id\":\"\(generationID)\",\"model\":\"actual-model\",\"tokens_prompt\":10,\"tokens_completion\":20,\"native_tokens_prompt\":11,\"native_tokens_completion\":21,\"total_cost\":0.0015,\"cache_discount\":null}}".utf8))
    }
    private func pendingStats(_ app: ChatState, generationID: String = "gen-verified") throws -> String {
        try app.ensureBranchTreeForEditor()
        let chat = try app.exchange!.source.required("chats").array("chats")[0]
        let tree = try chat.required("branchTree")
        let node = try XCTUnwrap(tree.required("activePath").array("path").last(where:{ raw in
            guard let id = try? raw.string("node") else { return false }
            return tree["nodes"]?[id]?["role"] == .string("assistant")
        })).string("node")
        let chatID = try chat.required("id").string("chat")
        let key = try SharedWebOperations.call("openRouterStats",.object([.init(key:"operation",value:.string("key")),.init(key:"chatId",value:.string(chatID)),.init(key:"targetNodeId",value:.string(node))])).required("key").string("key")
        let pending = OrderedJSON.object([.init(key:"generationId",value:.string(generationID)),.init(key:"chatId",value:.string(chatID)),.init(key:"targetNodeId",value:.string(node)),.init(key:"requestedAt",value:.number("1")),.init(key:"nextAttemptAt",value:.number("1")),.init(key:"attemptCount",value:.number("0")),.init(key:"status",value:.string("pending"))])
        let snapshot = try app.publicationSnapshot(), roots = try snapshot.required("state")
        try app.applySnapshot(snapshot.replacing("state",with:roots.replacing("pendingVerifications",with:.object([.init(key:key,value:pending)]))))
        return key
    }
    func testGenerationQueuesVerifiedStatsAtomicallyAndNativeFetchKeepsOtherRawData() async throws {
        let local = try store(), app = try creditsState(local), remote = client()
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions",stream:false),key:"FAKE-device-key")
        FakeRemoteProtocol.packets = [.init(bytes:Data("data: {\"id\":\"gen-verified\",\"choices\":[{\"delta\":{\"content\":\"Reply\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".utf8))]
        try app.startGeneration(input:"Question",record:credential,client:remote,readProviderCredential:{ _ in credential })
        try await wait { app.generation == nil }
        XCTAssertNil(app.generationError)
        let snapshot = try app.publicationSnapshot(), pending = try snapshot.required("state").required("pendingVerifications").object("pending")
        let key = try XCTUnwrap(pending.first).key.native("key")
        XCTAssertEqual(pending.first?.value["generationId"],.string("gen-verified"))
        let restored = ChatState(store:local)
        XCTAssertEqual(try restored.publicationSnapshot(),snapshot)
        let raw = try OrderedJSON.decode(Data(#"{"z":{"fetchedAt":1,"future":{"opaqueRef":0,"huge":9007199254740993,"decimal":1.2300,"s":"\ud800"}},"a":{"fetchedAt":2,"model":"old"}}"#.utf8))
        var roots = try snapshot.required("state"); roots = roots.replacing("verifiedStats",with:raw)
        try restored.applySnapshot(snapshot.replacing("state",with:roots))
        let queuedSnapshot = try restored.syncInputSnapshot()
        try restored.importWebData(restored.exportWebData())
        XCTAssertEqual(try restored.publicationSnapshot().required("state")["pendingVerifications"]?.encoded(),try queuedSnapshot["state"]?["pendingVerifications"]?.encoded())
        let received = try SyncRecords.fromRecords(SyncRecords.toRecords(queuedSnapshot))
        XCTAssertNil(received["state"]?["verifiedStats"])
        XCTAssertNil(received["state"]?["pendingVerifications"])
        try restored.applySynchronizedSnapshot(received,expected:restored.syncInputSnapshot())
        XCTAssertEqual(try restored.publicationSnapshot().required("state")["verifiedStats"]?.encoded(),try raw.encoded())
        XCTAssertEqual(try restored.publicationSnapshot().required("state")["pendingVerifications"]?.encoded(),try queuedSnapshot["state"]?["pendingVerifications"]?.encoded())
        let source = try restored.exchange?.source.encoded()
        try await restored.verifyOpenRouterGeneration(key,readCredential:{ _ in credential },fetch:{ request in
            XCTAssertEqual(request.httpMethod,"GET"); XCTAssertNil(request.httpBody)
            XCTAssertEqual(request.url?.absoluteString,"https://openrouter.ai/api/v1/generation?id=gen-verified")
            XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-device-key")
            return try self.statsPayload()
        },now:500_000)
        let updated = try restored.publicationSnapshot().required("state")
        XCTAssertNil(updated["pendingVerifications"]?[key])
        XCTAssertEqual(updated["verifiedStats"]?[key]?["totalCost"],.number("0.0015"))
        for field in try raw.object("old stats") { XCTAssertEqual(try updated.required("verifiedStats")[field.key.native("key")]?.encoded(),try field.value.encoded()) }
        XCTAssertEqual(try restored.exchange?.source.encoded(),source)
        let reloaded = ChatState(store:local)
        XCTAssertEqual(try reloaded.publicationSnapshot(),try restored.publicationSnapshot())
        // Web ExportChat supplies conversation roots only; settings.ts excludes these device-local stats from record sync.
        let exported = try restored.exportWebData(), v3 = try OrderedJSON.decode(exported)
        XCTAssertNil(v3["verifiedStats"])
        XCTAssertNil(v3["pendingVerifications"])
        let imported = ChatState(store:try store())
        try imported.importWebData(exported)
        XCTAssertNil(try imported.publicationSnapshot().required("state")["verifiedStats"])
        XCTAssertNil(try imported.publicationSnapshot().required("state")["pendingVerifications"])
        try restored.importWebData(exported)
        XCTAssertEqual(try restored.publicationSnapshot().required("state")["verifiedStats"]?.encoded(),try updated["verifiedStats"]?.encoded())
        let recovery = try OrderedJSON.decode(await reloaded.recoveryExport())
        XCTAssertEqual(try recovery["sources"]?["liveStore"]?["data"]?["verifiedStats"]?.encoded(),try updated["verifiedStats"]?.encoded())
    }
    func testVerifiedStatsLateResponseDoesNotReplaceNewPendingGeneration() async throws {
        let local = try store(), app = try creditsState(local), key = try pendingStats(app)
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE")
        var release: CheckedContinuation<OrderedJSON,Error>?
        let job = Task { @MainActor in
            try await app.verifyOpenRouterGeneration(key,readCredential:{ _ in credential },fetch:{ _ in
                try await withCheckedThrowingContinuation { release = $0 }
            },now:500_000)
        }
        try await wait { release != nil }
        _ = try pendingStats(app,generationID:"gen-new")
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        release?.resume(returning:try statsPayload())
        try await job.value
        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
    }
    func testVerifiedStatsSaveFailurePreservesDiskAndRestartCanRetry() async throws {
        let backing = try store()
        var reject = false
        let guarded = LocalStateStore(fileURL:backing.fileURL) { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let app = try creditsState(guarded), key = try pendingStats(app)
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions"),key:"FAKE")
        var disk: Data?, snapshot: OrderedJSON?
        do {
            try await app.verifyOpenRouterGeneration(key,readCredential:{ _ in credential },fetch:{ _ in
                disk = try Data(contentsOf:backing.fileURL); snapshot = try app.publicationSnapshot(); reject = true
                return try self.statsPayload()
            },now:500_000)
            XCTFail("The atomic save must fail")
        } catch { XCTAssertTrue(reject) }
        XCTAssertEqual(try app.publicationSnapshot(),snapshot)
        XCTAssertEqual(try Data(contentsOf:backing.fileURL),disk)
        reject = false
        let restarted = ChatState(store:guarded)
        try restarted.recoverOpenRouterVerifications(now:500_001)
        XCTAssertEqual(try restarted.publicationSnapshot()["state"]?["pendingVerifications"]?[key]?["status"],.string("pending"))
        try await restarted.verifyOpenRouterGeneration(key,readCredential:{ _ in credential },fetch:{ _ in .null },now:500_002)
        XCTAssertEqual(try restarted.publicationSnapshot()["state"]?["pendingVerifications"]?[key]?["status"],.string("failed"))
        try restarted.retryOpenRouterVerification(key,now:500_003)
        try await restarted.verifyOpenRouterGeneration(key,readCredential:{ _ in credential },fetch:{ _ in try self.statsPayload() },now:500_004)
        XCTAssertNotNil(try restarted.publicationSnapshot()["state"]?["verifiedStats"]?[key])
        XCTAssertNil(try restarted.publicationSnapshot()["state"]?["pendingVerifications"]?[key])
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
            for header in try expected.required("headers").object("headers") { XCTAssertEqual(request.value(forHTTPHeaderField: header.key.text), try header.value.string("header")) }
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
    private func proxyRecord(stream: Bool = true) -> RemoteCredentialRecord {
        var value = record(stream:stream)
        value.proxy = RemoteProxySettings(enabled:true,endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY")
        return value
    }
    private func proxyPacket(_ id: Int, raw: String) throws -> FakeRemoteProtocol.Packet {
        let encoded = String(decoding:try OrderedJSON.string(raw).encoded(),as:UTF8.self)
        return .init(bytes:Data("id: \(id)\ndata: \(encoded)\n\n".utf8))
    }
    private var proxyDone: FakeRemoteProtocol.Packet { .init(bytes:Data("event: done\ndata: {\"complete\":true,\"totalChunks\":2}\n\n".utf8)) }

    func testProxyGenerationRoutesCredentialsAndAcknowledgesOnlyAfterPrimarySave() async throws {
        for streaming in [false,true] {
            let local = try store(), state = try state(local,stream:streaming), remote = client()
            var savedAtAck: Data?
            FakeRemoteProtocol.onControl = { request in
                if request.url?.path.contains("/api/ack/") == true { savedAtAck = try? Data(contentsOf:local.fileURL) }
            }
            if streaming {
                FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Proxy 日本語\"}}]}\n\n"),try proxyPacket(2,raw:"data: [DONE]\n\n"),proxyDone]
            } else { FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())] }
            try state.startGeneration(input:"Through proxy",record:proxyRecord(stream:streaming),client:remote)
            try await wait { state.generation == nil }
            XCTAssertNil(state.generationError)
            if streaming { try await wait { savedAtAck != nil }; XCTAssertEqual(savedAtAck,try Data(contentsOf:local.fileURL)) }
            else { XCTAssertNil(savedAtAck) }
            let sent = try XCTUnwrap(FakeRemoteProtocol.requests.first)
            XCTAssertEqual(sent.url?.path,streaming ? "/relay/api/stream" : "/relay/api/request")
            XCTAssertEqual(sent.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-PROXY")
            let envelope = try OrderedJSON.decode(XCTUnwrap(sent.httpBody))
            XCTAssertEqual(envelope["endpoint"],.string("https://fixture.invalid/v1/chat/completions"))
            let header = try envelope.required("headers").object("upstream headers").first { (try? $0.key.native("header").lowercased()) == "authorization" }
            XCTAssertEqual(header?.value,.string("Bearer FAKE"))
            XCTAssertEqual(envelope["body"]?["stream"],.bool(streaming))
            if streaming { XCTAssertTrue(try envelope.required("sessionId").string("session ID").hasPrefix("remote:")) }
            else { XCTAssertNil(envelope["sessionId"]) }
            XCTAssertFalse(String(decoding:try state.exportWebData(),as:UTF8.self).contains("FAKE-PROXY"))
            XCTAssertEqual(ChatState(store:local).exchange?.source,state.exchange?.source)
        }
    }

    func testProxySaveFailureRetainsOutputAndDoesNotAcknowledgeBeforeSaveRetry() async throws {
        let base = try store()
        var failPrimarySave = false
        let local = LocalStateStore(fileURL:base.fileURL) { data, url in
            if failPrimarySave { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to:url,options:.atomic)
        }
        let state = try state(local), remote = client()
        var done = proxyDone; done.delay = 0.08
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Save safely\"}}]}\n\n"),try proxyPacket(2,raw:"data: [DONE]\n\n"),done]
        try state.startGeneration(input:"Proxy save",record:proxyRecord(),client:remote)
        let disk = try Data(contentsOf:local.fileURL), source = state.exchange?.source
        // Fail only the primary snapshot: the checkpoint must still reach disk before the completed stream can be acknowledged.
        failPrimarySave = true
        try await wait { state.generation?.running == false }
        XCTAssertEqual(state.generation?.output.text,"Save safely")
        XCTAssertEqual(state.exchange?.source,source)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        failPrimarySave = false
        try state.saveGenerationResult()
        try await wait { FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true } }
        XCTAssertNil(state.generation)
        XCTAssertEqual(ChatState(store:local).exchange?.source,state.exchange?.source)
    }

    func testProxyIncompleteAndStoppedStreamsPreservePartialWithoutAcknowledgement() async throws {
        for stopped in [false,true] {
            let local = try store(), state = try state(local), remote = client()
            let text = try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Partial<th\"}}]}\n\n")
            if stopped { FakeRemoteProtocol.holdLast = true; FakeRemoteProtocol.packets = [text,proxyDone] }
            else { FakeRemoteProtocol.packets = [text,proxyDone] } // Outer done without inner [DONE] is incomplete.
            try state.startGeneration(input:"Incomplete proxy",record:proxyRecord(),client:remote)
            if stopped { try await wait { state.generation?.output.text == "Partial" }; state.stopGeneration(); FakeRemoteProtocol.releaseLast?() }
            try await wait { state.generation == nil }
            if stopped { try await wait { FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/cancel/") == true } }; XCTAssertFalse(state.canRetryFailedGeneration) }
            else { XCTAssertNotNil(state.generationError); XCTAssertTrue(state.canRetryFailedGeneration) }
            XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
            let parts = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content").array("parts")
            XCTAssertEqual(parts.first?["text"],.string("Partial<th"))
        }
    }

    func testStopForwardsAuthorizedProviderCancellationDirectlyOrThroughProxy() async throws {
        for proxied in [false,true] {
            let local = try store(), app = try state(local), remote = client()
            let source = try XCTUnwrap(app.exchange).source
            let chat = try source.required("chats").array("chats")[0]
            try app.importWebData(source.replacing("chats",with:.array([chat.replacing("config",with:try chat.required("config").replacing("providerId",with:.string("openrouter")))])).encoded())
            var credentials = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://openrouter.ai/api/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE-OPENROUTER")
            if proxied { credentials.proxy = RemoteProxySettings(enabled:true,endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY") }
            let raw = "data: {\"id\":\"gen-first\",\"choices\":[{\"delta\":{\"content\":\"Partial<th\"}}]}\n\n"
            FakeRemoteProtocol.packets = proxied ? [try proxyPacket(1,raw:raw),proxyDone] : [.init(bytes:Data(raw.utf8)),.init(bytes:Data("data: [DONE]\n\n".utf8))]
            FakeRemoteProtocol.holdLast = true
            try app.startGeneration(input:"Cancel upstream",record:credentials,client:remote,readProviderCredential:{ _ in credentials })
            try await wait { app.generation?.output.generationID == "gen-first" }
            app.stopGeneration(); FakeRemoteProtocol.releaseLast?()
            try await wait { FakeRemoteProtocol.requests.contains { $0.url?.path.hasSuffix("/cancel") == true || $0.url?.path.contains("/api/cancel/") == true } }
            let cancel = try XCTUnwrap(FakeRemoteProtocol.requests.last { $0.url?.path.hasSuffix("/cancel") == true || $0.url?.path.contains("/api/cancel/") == true })
            if proxied {
                XCTAssertEqual(cancel.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-PROXY")
                let payload = try OrderedJSON.decode(XCTUnwrap(cancel.httpBody))
                XCTAssertEqual(payload["providerCancel"]?["generationId"],.string("gen-first"))
                XCTAssertEqual(payload["providerCancel"]?["apiKey"],.string("FAKE-OPENROUTER"))
            } else {
                XCTAssertEqual(cancel.url?.absoluteString,"https://openrouter.ai/api/v1/generation/gen-first/cancel")
                XCTAssertEqual(cancel.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-OPENROUTER")
                XCTAssertNil(cancel.httpBody)
            }
            XCTAssertNil(app.generation)
            XCTAssertFalse(app.canRetryFailedGeneration)
            let parts = try XCTUnwrap(app.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content").array("parts")
            XCTAssertEqual(parts.first?["text"],.string("Partial<th"))
            XCTAssertEqual(ChatState(store:local).exchange?.source,app.exchange?.source)
            XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
            XCTAssertFalse(String(decoding:try app.exportWebData(),as:UTF8.self).contains("FAKE-OPENROUTER"))
        }
    }

    func testProviderCancelDoesNotSendCredentialsFromOtherOriginsOrProviders() async throws {
        for (endpoint,provider) in [("https://fixture.invalid/v1/chat/completions","openrouter"),("https://openrouter.ai/api/v1/chat/completions","openai"),("https://openrouter.ai:8443/api/v1/chat/completions","openrouter")] {
            let remote = client()
            var request = URLRequest(url:URL(string:endpoint)!)
            request.httpMethod = "POST"; request.httpBody = Data("{\"stream\":true}".utf8)
            request.setValue("Bearer FAKE-OTHER-KEY",forHTTPHeaderField:"Authorization")
            await remote.cancelProvider(request,providerID:provider,generationID:"gen-forged")
            XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        }
    }

    func testDiscardPendingProxyRecoveryRecordsKeepsConversationAndLibraryFile() async throws {
        let local = try store(), app = try state(local)
        let journal = NativeProxyRecoveryStore(libraryURL: local.fileURL)
        try journal.upsert(.object([.init(key: "requestId", value: .string("pending")), .init(key: "future", value: .number("9007199254740993"))]))
        let source = try app.exportWebData(), disk = try Data(contentsOf: local.fileURL)
        try await app.discardPendingProxyRecoveryRecords()
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertEqual(try app.exportWebData(), source)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertEqual(app.diagnostics.entries["stream-recovery"]?.status, "done")
        let pending = OrderedJSON.object([.init(key:"requestId",value:.string("while-generating"))])
        try journal.upsert(pending)
        FakeRemoteProtocol.packets = [.init(bytes:Data("data: [DONE]\n\n".utf8),delay:1)]
        try app.startGeneration(input:"FAKE guarded discard",record:record(),client:client())
        let activeSource = try app.exportWebData(), activeDisk = try Data(contentsOf:local.fileURL)
        app.diagnostics.clear()
        do { try await app.discardPendingProxyRecoveryRecords(); XCTFail("Active generation must retain its recovery journal") } catch {}
        XCTAssertEqual(app.generation?.running,true)
        XCTAssertEqual(try journal.records(),[pending])
        XCTAssertEqual(try app.exportWebData(),activeSource)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),activeDisk)
        app.stopGeneration()
    }

    func testProxyRecoveryRetriesHTTPAndCacheMissWithTheSameCheckpoint() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Visible<th\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Retry recovery",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let restarted = ChatState(store:local), recoveryClient = client()
        let missing = FakeRemoteProtocol.Packet(bytes:Data("event: cache-miss\ndata: {\"complete\":false}\n\n".utf8))
        FakeRemoteProtocol.recoveryResponses = [(503,[],["Retry-After":"0"]),(200,[missing],[:]),
            (200,[try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"ink>reason</think> tail\"}}]}\n\n"),try proxyPacket(3,raw:"data: [DONE]\n\n"),proxyDone],[:])]
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient)
        XCTAssertNil(restarted.streamRecoveryError)
        let gets = FakeRemoteProtocol.requests.filter { $0.httpMethod == "GET" }
        XCTAssertEqual(gets.count,3)
        XCTAssertTrue(gets.allSatisfy { $0.url?.query == "lastEventId=1" })
        let parts = try XCTUnwrap(restarted.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content").array("parts")
        XCTAssertEqual(parts.compactMap { $0["text"] },[.string("reason"),.string("Visible tail")])
        XCTAssertTrue(try NativeProxyRecoveryStore(libraryURL:local.fileURL).records().isEmpty)
    }

    func testProxyInnerDecodeFailureDoesNotAdvanceCursorWithoutItsResponse() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Saved\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Atomic decode",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let restarted = ChatState(store:local), recoveryClient = client(), before = try restarted.exportWebData()
        let invalid = try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\" uncommitted\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[]}}]}\n\n")
        FakeRemoteProtocol.recoveryResponses = Array(repeating:(200,[invalid],[:]),count:4)
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient)
        XCTAssertNotNil(restarted.streamRecoveryError)
        XCTAssertEqual(try restarted.exportWebData(),before)
        XCTAssertEqual(FakeRemoteProtocol.requests.filter { $0.httpMethod == "GET" }.count,4)
        let saved = try XCTUnwrap(NativeProxyRecoveryStore(libraryURL:local.fileURL).records().first)
        XCTAssertEqual(saved["checkpoint"]?["decoder"]?["lastEventId"],.number("1"))
        XCTAssertEqual(saved["checkpoint"]?["response"]?["text"],.string("Saved"))
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
    }

    func testProxyRecoveryRetryBudgetRetainsRecordAndCancellationStopsWaiting() async throws {
        for cancelled in [false,true] {
            let local = try store(), initial = try state(local), remote = client()
            FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Saved partial\"}}]}\n\n"),proxyDone]
            try initial.startGeneration(input:"Bounded recovery",record:proxyRecord(),client:remote)
            try await wait { initial.generation == nil }
            let restarted = ChatState(store:local), recoveryClient = client(), before = try restarted.exportWebData()
            FakeRemoteProtocol.recoveryResponses = Array(repeating:(503,[],["Retry-After":cancelled ? "5" : "0"]),count:4)
            let recovery = Task { try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient) }
            if cancelled {
                try await wait { FakeRemoteProtocol.requests.contains { $0.httpMethod == "GET" } }
                recovery.cancel()
                do { try await recovery.value; XCTFail("Recovery should cancel") } catch is CancellationError { }
            } else { try await recovery.value; XCTAssertNotNil(restarted.streamRecoveryError) }
            XCTAssertEqual(FakeRemoteProtocol.requests.filter { $0.httpMethod == "GET" }.count,cancelled ? 1 : 4)
            XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
            XCTAssertEqual(try restarted.exportWebData(),before)
            XCTAssertEqual(try NativeProxyRecoveryStore(libraryURL:local.fileURL).records().count,1)
        }
    }

    func testProxyRecoveryAfterRestartRestoresCursorInnerPartialAndThinkState() async throws {
        let local = try store(), initial = try state(local), remote = client()
        let raw = try OrderedJSON.decode(Data(#"{"big":9007199254740993,"decimal":1.2300,"text":"\ud800"}"#.utf8))
        let source = try XCTUnwrap(initial.exchange).source.replacing("xRecovery",with:raw)
        try initial.importWebData(source.encoded())
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Visible<th\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Recover",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        let record = try XCTUnwrap(journal.records().first)
        XCTAssertEqual(record["checkpoint"]?["decoder"]?["lastEventId"],.number("1"))
        XCTAssertEqual(record["checkpoint"]?["response"]?["think"]?["pending"],.string("<th"))
        XCTAssertFalse(String(decoding:try Data(contentsOf:journal.fileURL),as:UTF8.self).contains("FAKE"))
        let restarted = ChatState(store:local), recoveryClient = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"duplicate\"}}]}\n\n"),try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"ink>thought</think> tail\"}}]}\n\ndata: [DO"),try proxyPacket(3,raw:"NE]\n\n"),proxyDone]
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient)
        XCTAssertNil(restarted.streamRecoveryError)
        let request = try XCTUnwrap(FakeRemoteProtocol.requests.first)
        XCTAssertEqual(request.httpMethod,"GET")
        XCTAssertEqual(request.url?.query,"lastEventId=1")
        XCTAssertTrue(request.url!.path.contains("/api/recover/remote:"))
        XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-PROXY")
        let final = try XCTUnwrap(restarted.exchange).source
        let parts = try final.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content")
        XCTAssertEqual(parts,.array([.object([.init(key:"type",value:.string("reasoning")),.init(key:"text",value:.string("thought"))]),.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Visible tail"))])]))
        XCTAssertEqual(try final.required("xRecovery").encoded(),try raw.encoded())
        XCTAssertTrue(try journal.records().isEmpty)
        XCTAssertTrue(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        XCTAssertEqual(ChatState(store:local).exchange?.source,restarted.exchange?.source)
    }

    func testProxyCompletedCheckpointSurvivesPrimarySaveFailureAndReplaysWithoutNetwork() async throws {
        let base = try store()
        var failSave = false
        let local = LocalStateStore(fileURL:base.fileURL) { data,url in
            if failSave { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to:url,options:.atomic)
        }
        let initial = try state(local), remote = client()
        var done = proxyDone; done.delay = 0.06
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Durable complete\"}}]}\n\n"),try proxyPacket(2,raw:"data: [DONE]\n\n"),done]
        try initial.startGeneration(input:"Commit boundary",record:proxyRecord(),client:remote)
        let before = try Data(contentsOf:base.fileURL)
        failSave = true
        try await wait { initial.generation?.running == false }
        XCTAssertEqual(initial.generation?.completedSuccessfully,true)
        XCTAssertEqual(try Data(contentsOf:base.fileURL),before)
        let journal = NativeProxyRecoveryStore(libraryURL:base.fileURL)
        let pending = try XCTUnwrap(journal.records().first)
        XCTAssertEqual(pending["proxyComplete"],.bool(true))
        XCTAssertNotNil(pending["appliedHash"])
        let restarted = ChatState(store:base), recoveryClient = client()
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient)
        XCTAssertNil(restarted.streamRecoveryError)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.httpMethod == "GET" })
        XCTAssertTrue(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        XCTAssertTrue(try journal.records().isEmpty)
        let parts = try XCTUnwrap(restarted.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content").array("parts")
        XCTAssertEqual(parts.first?["text"],.string("Durable complete"))
        XCTAssertEqual(ChatState(store:base).exchange?.source,restarted.exchange?.source)
    }

    func testProxyRecoveryRejectsConcurrentEditAndRetainsOriginalCheckpoint() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Edit boundary",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let restarted = ChatState(store:local), recoveryClient = client()
        FakeRemoteProtocol.holdLast = true
        FakeRemoteProtocol.packets = [try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\" server tail\"}}]}\n\n"),proxyDone]
        let recovery = Task { try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient) }
        try await wait { FakeRemoteProtocol.releaseLast != nil }
        let nodeID = try XCTUnwrap(restarted.conversation?.visibleMessages.last?.id)
        var edit = try restarted.messageDraft(nodeID:nodeID); edit.text = "Edited after restart"
        try restarted.saveMessage(edit,mode:.overwrite)
        let edited = try restarted.exportWebData()
        FakeRemoteProtocol.releaseLast?()
        do { try await recovery.value } catch is CancellationError { }
        XCTAssertEqual(try restarted.exportWebData(),edited)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        XCTAssertEqual(try journal.records().count,1)
        let anotherClient = client()
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:anotherClient)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        XCTAssertEqual(try restarted.exportWebData(),edited)
        XCTAssertEqual(try journal.records().count,1)
    }

    func testProxyRecoveryPrimarySaveFailureKeepsBothPriorAndPlannedHashes() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Saved A\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Repeated commit boundary",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let before = try Data(contentsOf:local.fileURL)
        let failing = LocalStateStore(fileURL:local.fileURL) { _,_ in throw CocoaError(.fileWriteNoPermission) }
        let restarted = ChatState(store:failing), recoveryClient = client()
        FakeRemoteProtocol.packets = [try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\" plus B\"}}]}\n\n"),try proxyPacket(3,raw:"data: [DONE]\n\n"),proxyDone]
        do { try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient); XCTFail("Primary write must fail") }
        catch let error as CocoaError { XCTAssertEqual(error.code,.fileWriteNoPermission) }
        XCTAssertEqual(try Data(contentsOf:local.fileURL),before)
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        let retained = try XCTUnwrap(journal.records().first)
        let oldChat = try XCTUnwrap(restarted.exchange).source.required("chats").array("chats")[0]
        let nodeID = try retained.required("nodeId").string("node ID")
        XCTAssertEqual(retained["checkpointHash"],oldChat["branchTree"]?["nodes"]?[nodeID]?["contentHash"])
        XCTAssertNotEqual(retained["checkpointHash"],retained["appliedHash"])
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        let again = ChatState(store:local), finalClient = client()
        try await again.recoverProxyStreams(record:proxyRecord(),client:finalClient)
        XCTAssertNil(again.streamRecoveryError)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.httpMethod == "GET" })
        XCTAssertTrue(try journal.records().isEmpty)
        let parts = try XCTUnwrap(again.exchange).source.required("chats").array("chats")[0].required("messages").array("messages").last!.required("content").array("parts")
        XCTAssertEqual(parts.first?["text"],.string("Saved A plus B"))
    }

    func testProxyRecoveryRefusesMismatchedPlanAndUntrustedEndpoint() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Plan identity",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        let original = try XCTUnwrap(journal.records().first)
        let wrong = try original.replacing("plan",with:original.required("plan").replacing("targetNodeId",with:.string("different-node")))
        try journal.upsert(wrong)
        let restarted = ChatState(store:local), recoveryClient = client(), before = try restarted.exportWebData()
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        XCTAssertEqual(try restarted.exportWebData(),before)
        XCTAssertEqual(try journal.records().count,1)
        try journal.upsert(original)
        var other = proxyRecord(); other.proxy?.endpoint = "https://unit-fixture.openai.azure.com/other"
        try await restarted.recoverProxyStreams(record:other,client:recoveryClient)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        XCTAssertEqual(try restarted.exportWebData(),before)
        XCTAssertEqual(try journal.records().count,1)
    }

    func testProxyCheckpointFailurePreservesPriorFileAndUnpublishedOutput() async throws {
        let local = try store(), initial = try state(local), remote = client()
        var packet = try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"In memory\"}}]}\n\n"); packet.delay = 0.06
        FakeRemoteProtocol.packets = [packet,proxyDone]
        try initial.startGeneration(input:"Checkpoint boundary",record:proxyRecord(),client:remote)
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        try await wait { (try? journal.records().count) == 1 }
        let oldJournal = try Data(contentsOf:journal.fileURL), oldPrimary = try Data(contentsOf:local.fileURL)
        let directory = local.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path) }
        try await wait { initial.generation?.running == false }
        XCTAssertEqual(initial.generation?.output.text,"In memory")
        XCTAssertEqual(try Data(contentsOf:journal.fileURL),oldJournal)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),oldPrimary)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        try initial.saveGenerationResult()
        XCTAssertNil(initial.generation)
        XCTAssertEqual(try journal.records().count,1)
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.path.contains("/api/ack/") == true })
    }

    func testProxySettingsRejectUnsafeDestinationsAndKeepExistingCredentialEncoding() throws {
        let old = Data(#"{"settings":{"endpoint":"https://fixture.invalid/v1/chat/completions","model":"fake-model","stream":true},"key":"FAKE"}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(RemoteCredentialRecord.self,from:old).proxy)
        for endpoint in ["http://fixture.invalid","https://user:pass@fixture.invalid","https://fixture.invalid?token=FAKE","https://fixture.invalid/#fragment"] {
            XCTAssertThrowsError(try RemoteProxySettings(enabled:true,endpoint:endpoint).validated())
        }
        XCTAssertThrowsError(try RemoteProxySettings(enabled:true,endpoint:"https://fixture.invalid",authToken:"FAKE\r\nX-Bad: 1").validated())
        let configured = proxyRecord()
        XCTAssertEqual(try JSONDecoder().decode(RemoteCredentialRecord.self,from:JSONEncoder().encode(configured)),configured)
        let control = try XCTUnwrap(configured.proxy).request("ack",sessionID:"chat/a?#%:request")
        XCTAssertTrue(control.url!.absoluteString.contains("chat%2Fa%3F%23%25:request"))
        XCTAssertNil(control.httpBody)
        var upstream = URLRequest(url:URL(string:"https://fixture.invalid/v1/chat/completions")!)
        upstream.setValue("Bearer FAKE-UPSTREAM",forHTTPHeaderField:"Authorization")
        let raw = Data(#"{"stream":false,"xFuture":{"integer":9007199254740993,"decimal":1.2300,"text":"\ud800"}}"#.utf8)
        upstream.httpBody = raw
        let wrapped = try XCTUnwrap(configured.proxy).wrapping(upstream,streaming:false,sessionID:"unused")
        let envelope = try OrderedJSON.decode(XCTUnwrap(wrapped.httpBody))
        XCTAssertEqual(try envelope.required("body").encoded(),raw)
        XCTAssertEqual(wrapped.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-PROXY")
        XCTAssertFalse(wrapped.allHTTPHeaderFields!.values.contains("Bearer FAKE-UPSTREAM"))
    }

    func testFailedGenerationRetryReplacesOnlyAssistantAndKeepsComposerDraft() async throws {
        for partial in [false,true] {
            let local = try store(), state = try state(local)
            let initial = try XCTUnwrap(state.conversation).visibleMessages.count
            let remote = client()
            if partial { FakeRemoteProtocol.packets = [.init(bytes:Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n".utf8))] }
            else { FakeRemoteProtocol.status = 500 }
            try state.startGeneration(input:"Retry once",record:record(),client:remote)
            try await wait { state.generation == nil }
            XCTAssertTrue(state.canRetryFailedGeneration)
            let failedID = try XCTUnwrap(state.conversation?.visibleMessages.last?.id)
            let chatID = try XCTUnwrap(state.conversation).id
            state.setComposerText(chatID:chatID,text:"Unsent draft")
            let retryClient = client()
            FakeRemoteProtocol.packets = try streamPackets()
            try state.retryFailedGeneration(record:record(),client:retryClient,nodeIDs:["retry-assistant"])
            XCTAssertFalse(state.canRetryFailedGeneration)
            try await wait { state.generation == nil }
            XCTAssertNil(state.generationError)
            let messages = try XCTUnwrap(state.conversation).visibleMessages
            XCTAssertEqual(messages.count,initial + 2)
            XCTAssertEqual(messages.last?.id,"retry-assistant")
            XCTAssertFalse(messages.contains { $0.id == failedID })
            XCTAssertEqual(state.composerDraft(chatID:chatID).text,"Unsent draft")
            XCTAssertFalse(state.canRetryFailedGeneration)
            let request = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
            let wire = try request.required("messages").array("messages")
            // Web submitContext.ensureRoleAlternation concatenates consecutive user parts in order.
            XCTAssertEqual(try wire.last?.required("content").array("parts").compactMap { $0["text"] },[.string("Next"),.string("Merged"),.string("Retry once")])
            XCTAssertEqual(FakeRemoteProtocol.requests.count,1)
            XCTAssertEqual(ChatState(store:local).exchange?.source,state.exchange?.source)
        }
    }

    func testFailedGenerationRetryPreservesMiddleFollowingNodeAndRejectsChangedChat() async throws {
        let local = try store(), state = try state(local,stream:false)
        let source = try XCTUnwrap(state.exchange).source
        let chat = try source.required("chats").array("chats")[0]
        let messages = try Array(chat.required("messages").array("messages").prefix(3))
        try state.importWebData(source.replacing("chats",with:.array([chat.replacing("messages",with:.array(messages))])).encoded())
        var tail = try state.messageDraft(nodeID:nil); tail.text = "Following user"
        try state.saveMessage(tail,mode:.append,newIDs:["system","user","old-assistant","tail"])
        let seeded = try XCTUnwrap(state.exchange).source
        var chats = try seeded.required("chats").array("chats")
        let tree = try chats[0].required("branchTree"), nodes = try tree.required("nodes")
        let marked = try nodes.required("tail").replacing("xFuture",with:.number("9007199254740993"))
        chats[0] = chats[0].replacing("branchTree",with:tree.replacing("nodes",with:nodes.replacing("tail",with:marked)))
        try state.importWebData(seeded.replacing("chats",with:.array(chats)).encoded())
        let remote = client(); FakeRemoteProtocol.status = 500
        try state.startGeneration(state.messageGenerationDraft(nodeID:"old-assistant",operation:.regenerate),record:record(stream:false),client:remote,nodeIDs:["failed-middle"])
        try await wait { state.generation == nil }
        XCTAssertTrue(state.canRetryFailedGeneration)
        let retryClient = client()
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        try state.retryFailedGeneration(record:record(stream:false),client:retryClient,nodeIDs:["retry-middle"])
        try await wait { state.generation == nil }
        let retried = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("branchTree")
        XCTAssertEqual(retried["activePath"],.array(["system","user","retry-middle","tail"].map(OrderedJSON.string)))
        XCTAssertEqual(retried["nodes"]?["tail"]?["xFuture"],.number("9007199254740993"))
        XCTAssertEqual(retried["nodes"]?["tail"]?["parentId"],.string("retry-middle"))
        let wire = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody)).required("messages").array("messages")
        XCTAssertEqual(wire.count,2)
        let failClient = client(); FakeRemoteProtocol.status = 500
        try state.startGeneration(input:"Changed target",record:record(stream:false),client:failClient)
        try await wait { state.generation == nil }
        XCTAssertTrue(state.canRetryFailedGeneration)
        try state.renameChat(id:"remote",title:"Changed after failure")
        let changed = try state.exportWebData()
        XCTAssertFalse(state.canRetryFailedGeneration)
        XCTAssertThrowsError(try state.retryFailedGeneration(record:record(stream:false),client:failClient))
        XCTAssertEqual(try state.exportWebData(),changed)
    }

    func testFailedGenerationRetrySaveFailureKeepsSavedResultAndRetryContext() async throws {
        let local = try store(), state = try state(local,stream:false)
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes:Data("{invalid response".utf8),delay:0.05)]
        try state.startGeneration(input:"Retry safely",record:record(stream:false),client:remote)
        try await wait { state.generation == nil }
        let source = state.exchange?.source, disk = try Data(contentsOf:local.fileURL)
        let directory = local.fileURL.deletingLastPathComponent()
        let retryClient = client()
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path) }
        XCTAssertThrowsError(try state.retryFailedGeneration(record:record(stream:false),client:retryClient,nodeIDs:["retry-safe"]))
        XCTAssertTrue(state.canRetryFailedGeneration)
        XCTAssertNil(state.generation)
        XCTAssertEqual(state.exchange?.source,source)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        try state.retryFailedGeneration(record:record(stream:false),client:retryClient,nodeIDs:["retry-safe"])
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError)
        XCTAssertFalse(state.canRetryFailedGeneration)
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
    func testRenameKeepsGenerationTargetAndPreservesTitleOnCompletion() async throws {
        let store = try store()
        let state = try state(store,stream:false)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.1)]
        FakeRemoteProtocol.holdLast = true
        try state.startGeneration(input: "Old session", record: record(stream: false), client: client)
        try await wait { FakeRemoteProtocol.releaseLast != nil }
        try state.renameChat(id: "remote", title: "New source")
        let changed = state.exchange?.source
        // Web aiTaskFingerprint excludes the title from generation dependencies.
        XCTAssertNotNil(state.generation)
        FakeRemoteProtocol.releaseLast?()
        try await wait { state.generation == nil }
        XCTAssertEqual(state.conversation?.title, "New source")
        XCTAssertNotEqual(state.exchange?.source, changed)
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

    private func roleComposerParts() throws -> OrderedJSON {
        try OrderedJSON.decode(Data(#"[{"type":"image_url","image_url":{"url":"data:image/png;base64,FAKE_ROLE_IMAGE","detail":"auto","xRaw":1.2300}},{"type":"text","text":"Role seed","xRaw":9007199254740993},{"type":"reasoning","text":"private","xKeep":{"opaqueRef":0}}]"#.utf8))
    }
    func testInputRoleIsRuntimeGlobalKeepsDraftAndFailureThenLegacySendUsesUser() async throws {
        let location = try store()
        var rejects = false, rejectedWrites = 0
        let local = LocalStateStore(fileURL: location.fileURL) { data, file in
            if rejects { rejectedWrites += 1; throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        let app = try state(local, stream: false), chatID = try XCTUnwrap(app.conversation).id
        let parts = try roleComposerParts(), draft = ComposerDraft(parts: parts, text: "Role seed", hasMeaningfulContent: true)
        try app.setComposerPrompt(draft, chatID: chatID, expected: .empty)
        XCTAssertEqual(app.inputRole, "user")
        let beforeSelection = try app.publicationSnapshot(), diskBefore = try Data(contentsOf: local.fileURL)
        for role in ["assistant", "user", "assistant"] {
            try app.setInputRole(role)
            XCTAssertEqual(app.inputRole, role)
            XCTAssertEqual(try app.composerDraft(chatID: chatID).parts.encoded(), try parts.encoded())
            XCTAssertEqual(app.composerDraft(chatID: chatID).text, draft.text)
        }
        XCTAssertThrowsError(try app.setInputRole("system"))
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertEqual(try app.publicationSnapshot().encoded(), try beforeSelection.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), diskBefore)
        try app.createChat(defaults: ChatDefaults.webInitial(), id: "other-role-chat")
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertEqual(app.composerDraft(chatID: "other-role-chat").parts, .array([]))
        app.selectedConversationID = chatID
        XCTAssertEqual(app.conversation?.id, chatID)
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertEqual(ChatState(store: local).inputRole, "user")
        XCTAssertNil(try app.publicationSnapshot().required("state")["inputRole"])
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.05)]
        // Unknown new part types retain the existing closed validation, without losing the draft on rejection.
        let futureParts = try OrderedJSON.array(parts.array("parts") + [.object([.init(key: "type", value: .string("future_part")), .init(key: "raw", value: .number("1.2300"))])])
        let futureDraft = ComposerDraft(parts: futureParts, text: draft.text, hasMeaningfulContent: true)
        try app.setComposerPrompt(futureDraft, chatID: chatID, expected: draft)
        try app.setInputRole("user"); try app.setInputRole("assistant")
        XCTAssertEqual(try app.composerDraft(chatID: chatID).parts.encoded(), try futureParts.encoded())
        XCTAssertThrowsError(try app.sendComposer(record: record(stream: false), client: remote))
        XCTAssertEqual(try app.composerDraft(chatID: chatID).parts.encoded(), try futureParts.encoded())
        XCTAssertEqual(try app.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        try app.setComposerPrompt(draft, chatID: chatID, expected: futureDraft)
        rejects = true
        XCTAssertThrowsError(try app.sendComposer(record: record(stream: false), client: remote))
        XCTAssertEqual(rejectedWrites, 1)
        XCTAssertNil(app.generation)
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertEqual(try app.composerDraft(chatID: chatID).parts.encoded(), try parts.encoded())
        XCTAssertEqual(app.composerDraft(chatID: chatID).text, draft.text)
        XCTAssertEqual(try app.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        rejects = false
        // Existing non-composer callers keep their user default even when sticky input is assistant.
        try app.startGeneration(input: "Legacy input", record: record(stream: false), client: remote)
        XCTAssertEqual(app.conversation?.visibleMessages.dropLast().last?.role, "user")
        XCTAssertThrowsError(try app.setInputRole("user"))
        XCTAssertEqual(app.inputRole, "assistant")
        try await wait { app.generation == nil }
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertEqual(try app.composerDraft(chatID: chatID).parts.encoded(), try parts.encoded())
        XCTAssertEqual(app.composerDraft(chatID: chatID).text, draft.text)
    }
    func testAssistantComposerUsesSharedAppendRequestContextAndPreservesInactiveBranches() async throws {
        let local = try store(), app = ChatState(store: local)
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        var source = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
        var chats = try source.required("chats").array("chats")
        let configured = try fixture().required("cases").array("cases")[0].required("source").required("chats").array("chats")[0].required("config")
        let config = OrderedJSON.object(try configured.object("config").filter { $0.key != "providerId" }).replacing("stream", with: .bool(false))
        chats[0] = chats[0].replacing("config", with: config)
        source = source.replacing("chats", with: .array(chats))
        try app.importWebData(source.encoded())
        let chatID = try XCTUnwrap(app.conversation).id, parts = try roleComposerParts()
        let originalNodes = try app.exchange!.source.required("chats").array("chats")[0].required("branchTree").required("nodes")
        let inactive = try app.exchange!.source.required("contentStore").required("inactive").encoded()
        let previousAssistant = try app.exchange!.source.required("contentStore").required("answer").required("content").array("content")[0]
        try app.setComposerPrompt(ComposerDraft(parts: parts, text: "Role seed", hasMeaningfulContent: true), chatID: chatID, expected: .empty)
        try app.setInputRole("assistant")
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.05)]
        try app.sendComposer(record: record(stream: false), client: remote, nodeIDs: ["role-seed"])
        XCTAssertEqual(app.composerDraft(chatID: chatID).parts, .array([]))
        XCTAssertEqual(app.inputRole, "assistant")
        XCTAssertThrowsError(try app.setInputRole("user"))
        XCTAssertEqual(try app.messageDraft(nodeID: "role-seed").role, "assistant")
        XCTAssertEqual(try app.messageDraft(nodeID: "role-seed").parts.encoded(), try parts.encoded())
        XCTAssertEqual(app.conversation?.visibleMessages.suffix(2).map(\.role), ["assistant", "assistant"])
        let appended = try app.exchange!.source.required("chats").array("chats")[0].required("branchTree")
        XCTAssertEqual(try appended.required("activePath").array("path").dropLast(), [.string("n-system"), .string("n-user"), .string("n-assistant"), .string("role-seed")])
        XCTAssertFalse(app.canUndoMessageEdit) // Existing generation guard protects editing history while busy.
        try await wait { app.generation == nil }
        let body = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
        let transmitted = try body.required("messages").array("messages")
        XCTAssertEqual(transmitted.last?["role"], .string("assistant"))
        // Actual Web submitContext merges consecutive assistant content and drops reasoning only on the wire.
        XCTAssertEqual(try transmitted.last?.required("content").encoded(), try OrderedJSON.array([previousAssistant, parts.array("parts")[0], parts.array("parts")[1]]).encoded())
        XCTAssertEqual(try app.messageDraft(nodeID: "role-seed").parts.encoded(), try parts.encoded())
        let savedNodes = try app.exchange!.source.required("chats").array("chats")[0].required("branchTree").required("nodes")
        for field in try originalNodes.object("nodes") { XCTAssertEqual(try savedNodes.required(field.key).encoded(), try field.value.encoded()) }
        XCTAssertEqual(try app.exchange!.source.required("contentStore").required("inactive").encoded(), inactive)
        XCTAssertEqual(app.conversation?.visibleMessages.last?.role, "assistant")
        XCTAssertNil(app.generationError)
        let savedParts = try XCTUnwrap(app.conversation?.visibleMessages.last?.parts)
        XCTAssertEqual(savedParts.compactMap { if case .text(let text) = $0 { return text }; return nil }.joined(), "Answer 日本語")
        // Shared generation preparation invalidates this chat's editing history, as Web useSubmit does.
        XCTAssertFalse(app.canUndoMessageEdit)
        XCTAssertEqual(ChatState(store: local).exchange?.source, app.exchange?.source)
        XCTAssertEqual(ChatState(store: local).inputRole, "user")
    }

    func testProxyManagementUsesSharedPlansAndKeepsLocalFilesUntouched() async throws {
        let transport = client()
        let management = ProxyManagementClient(client:transport)
        let settings = RemoteProxySettings(enabled:false,endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY")
        let local = try store()
        let app = try state(local)
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        let retained = try OrderedJSON.decode(Data(#"{"requestId":"FAKE retained","proxySessionId":"other","future":{"big":9007199254740993,"text":"\ud800"}}"#.utf8))
        try journal.upsert(retained)
        let before = try Data(contentsOf:local.fileURL), beforeJournal = try Data(contentsOf:journal.fileURL)
        let beforeSource = try XCTUnwrap(app.exchange).source
        let cursor = "session:" + String(repeating:"a",count:64)
        FakeRemoteProtocol.managementResponses = [
            (200,#"{"sessions":[],"scope":"all-sessions","nextCursor":null}"#),
            (200,#"{"sessions":[],"scope":"durable-session"}"#),
            (200,"{\"deleted\":1,\"failed\":0,\"before\":123,\"cursor\":\"\(cursor)\"}"),
            (200,#"{"deleted":2,"failed":0,"before":123,"cursor":null}"#)
        ]
        let all = try await management.status(settings:settings)
        XCTAssertEqual(try all.required("sessions").array("sessions").count,0)
        let gaps = try SharedWebOperations.call("proxyManagement",OrderedJSON.decode(Data(#"{"operation":"recoveryGaps","records":[{"sessionId":"known","cursor":1}],"sessions":[{"sessionId":"known","cache":{"state":"available","firstEventId":3,"lastEventId":5,"terminal":"complete"}}]}"#.utf8)))
        XCTAssertEqual(gaps["known"],.bool(true))
        let id = "known/one?#"
        _ = try await management.status(settings:settings,sessionID:id)
        let deleted = try await management.delete(settings:settings)
        XCTAssertEqual(deleted,3)
        XCTAssertEqual(FakeRemoteProtocol.requests.map(\.httpMethod),["GET","GET","DELETE","DELETE"])
        XCTAssertEqual(FakeRemoteProtocol.requests[0].url?.path,"/relay/api/status")
        XCTAssertEqual(URLComponents(url:FakeRemoteProtocol.requests[0].url!,resolvingAgainstBaseURL:false)?.queryItems?.first?.value,"1")
        XCTAssertEqual(URLComponents(url:FakeRemoteProtocol.requests[1].url!,resolvingAgainstBaseURL:false)?.queryItems?.first?.value,id)
        XCTAssertEqual(URLComponents(url:FakeRemoteProtocol.requests[3].url!,resolvingAgainstBaseURL:false)?.queryItems?.map(\.name),["before","cursor"])
        XCTAssertTrue(FakeRemoteProtocol.requests.allSatisfy { $0.value(forHTTPHeaderField:"Authorization") == "Bearer FAKE-PROXY" && $0.httpBody == nil })
        XCTAssertEqual(try Data(contentsOf:local.fileURL),before)
        XCTAssertEqual(try Data(contentsOf:journal.fileURL),beforeJournal)
        XCTAssertEqual(try app.exchange?.source.encoded(),try beforeSource.encoded())
        XCTAssertEqual(try journal.records(),[retained])
    }

    func testProxyManagementFailureDoesNotReportDeletion() async throws {
        let management = ProxyManagementClient(client:client())
        let settings = RemoteProxySettings(endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY")
        FakeRemoteProtocol.managementResponses = [(403,"{\"secret\":\"leak\"}")]
        do { _ = try await management.delete(settings:settings,sessionID:"known"); XCTFail("Must fail") }
        catch {
            let message = ProxyManagementClient.errorMessage(error)
            XCTAssertFalse(message.contains("leak"))
            XCTAssertFalse(message.contains("V3 JSON"))
            XCTAssertFalse(message.hasPrefix("Error: "))
            XCTAssertTrue(message.contains("認証"))
        }
    }

    func testProxyManagementSingleDeleteAndCancellationUseNativeTransportBoundaries() async throws {
        let management = ProxyManagementClient(client:client())
        let settings = RemoteProxySettings(endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY")
        FakeRemoteProtocol.managementResponses = [(200,#"{"deleted":true}"#)]
        let count = try await management.delete(settings:settings,sessionID:"known/one?#")
        XCTAssertEqual(count,1)
        let request = try XCTUnwrap(FakeRemoteProtocol.requests.last)
        XCTAssertTrue(request.url!.absoluteString.contains("/api/storage/known%2Fone%3F%23"))
        XCTAssertFalse(request.url!.absoluteString.contains("FAKE-PROXY"))
        let before = FakeRemoteProtocol.requests.count
        let task = Task { try await management.status(settings:settings) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Must cancel before sending") }
        catch is CancellationError { }
        XCTAssertEqual(FakeRemoteProtocol.requests.count,before)
    }

    func testSelectedProxyRecoveryDoesNotTouchOtherJournalEntries() async throws {
        let local = try store(), initial = try state(local), remote = client()
        FakeRemoteProtocol.packets = [try proxyPacket(1,raw:"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n"),proxyDone]
        try initial.startGeneration(input:"Recover one",record:proxyRecord(),client:remote)
        try await wait { initial.generation == nil }
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        let selected = try XCTUnwrap(journal.records().first)
        let other = selected.replacing("requestId",with:.string("FAKE other request"))
            .replacing("proxySessionId",with:.string("FAKE other session"))
            .replacing("future",with:try OrderedJSON.decode(Data(#"{"big":9007199254740993,"text":"\ud800"}"#.utf8)))
        try journal.upsert(other)
        let restarted = ChatState(store:local), recoveryClient = client()
        FakeRemoteProtocol.packets = [try proxyPacket(2,raw:"data: {\"choices\":[{\"delta\":{\"content\":\" tail\"}}]}\n\ndata: [DONE]\n\n"),proxyDone]
        try await restarted.recoverProxyStreams(record:proxyRecord(),client:recoveryClient,sessionID:selected.required("proxySessionId").string("session"))
        XCTAssertEqual(try journal.records(),[other])
        XCTAssertFalse(FakeRemoteProtocol.requests.contains { $0.url?.absoluteString.contains("FAKE%20other%20session") == true })
        XCTAssertEqual(ChatState(store:local).exchange?.source,restarted.exchange?.source)
    }

    func testStreamStateStartsAndCompletesWithSharedLimitReasonAndRestart() async throws {
        let local = try store(), app = try state(local,stream:false), remote = client()
        FakeRemoteProtocol.packets = [.init(bytes:Data(#"{"choices":[{"message":{"content":"FAKE limited answer"},"finish_reason":"length"}]}"#.utf8))]
        try app.startGeneration(input:"FAKE question",record:record(stream:false),client:remote)
        let current = try XCTUnwrap(app.generation), target = try current.plan!.required("targetNodeId").string("node")
        let started = try app.exchange!.source.required("chats").array("chats")[0].required("branchTree").required("nodes").required(target).required("streamState")
        XCTAssertEqual(started["reason"],.string("streaming"))
        XCTAssertEqual(started["requestId"],.string(current.id.uuidString.lowercased()))
        XCTAssertEqual(started["proxy"],.bool(false))
        try await wait { app.generation == nil }
        let completed = try app.exchange!.source.required("chats").array("chats")[0].required("branchTree").required("nodes").required(target).required("streamState")
        XCTAssertEqual(completed,started.replacing("reason",with:.string("max_tokens")))
        XCTAssertEqual(try app.streamStatus(chatID:current.chatID,nodeID:target)?["reason"],.string("max_tokens"))
        XCTAssertEqual(ChatState(store:local).exchange?.source,app.exchange?.source)
    }

    func testImportedStreamStateKeepsRawAttributesIORecordsAndRequestIdentityGuard() throws {
        let local = try store(), app = try state(local)
        var source = try XCTUnwrap(app.exchange).source
        let originalChat = try source.required("chats").array("chats")[0]
        let ids = try (0..<(originalChat.required("messages").array("messages").count + 1)).map { "FAKE-stream-node-\($0)" }
        source = try MessageEditing.generation(in:source,chatID:originalChat.required("id").string("chat"),operation:"prepare",action:.append,
            viewingPath:[],newIDs:ids,now:1,history:nil) { _ in }.source
        var chats = try source.required("chats").array("chats")
        let chatID = try chats[0].required("id").string("chat")
        let tree = try chats[0].required("branchTree"), nodes = try tree.required("nodes")
        let field = try XCTUnwrap(nodes.object("nodes").first { $0.value["role"] == .string("assistant") })
        let nodeID = try field.key.native("node")
        let saved = try OrderedJSON.decode(Data(#"{"reason":"error","requestId":"FAKE original","proxy":true,"createdAt":1,"future":{"big":9007199254740993,"decimal":1.2300,"text":"\ud800"}}"#.utf8))
        chats[0] = chats[0].replacing("branchTree",with:tree.replacing("nodes",with:nodes.replacing(nodeID,with:field.value.replacing("streamState",with:saved))))
        source = source.replacing("chats",with:.array(chats))
        try app.importWebData(source.encoded())
        let plan = OrderedJSON.object([.init(key:"targetNodeId",value:.string(nodeID))])
        let recovery = OrderedJSON.object([.init(key:"requestId",value:.string("FAKE other")),.init(key:"chatId",value:.string(chatID)),
            .init(key:"nodeId",value:.string(nodeID)),.init(key:"checkpointRole",value:try field.value.required("role")),
            .init(key:"checkpointHash",value:try field.value.required("contentHash")),.init(key:"plan",value:plan)])
        XCTAssertFalse(app.canRecoverProxyRecord(recovery))
        XCTAssertTrue(app.canRecoverProxyRecord(recovery.replacing("requestId",with:.string("FAKE original"))))
        let changed = try MessageEditing.streamState(in:source,chatID:chatID,plan:plan,stream:.object([.init(key:"reason",value:.string("recovered_partial"))]),now:10)
        let updated = try changed.required("chats").array("chats")[0].required("branchTree").required("nodes").required(nodeID).required("streamState")
        XCTAssertEqual(try updated.encoded(),try saved.replacing("reason",with:.string("recovered_partial")).encoded())
        try app.importWebData(changed.encoded())
        XCTAssertEqual(try app.streamStatus(chatID:chatID,nodeID:nodeID,now:10)?["reason"],.string("recovered_partial"))
        XCTAssertEqual(try WebExchange(data:app.exportWebData()).source.encoded(),try app.exchange!.source.encoded())
        XCTAssertEqual(ChatState(store:local).exchange?.source,app.exchange?.source)
        let snapshot = try app.publicationSnapshot(), records = try SyncRecords.toRecords(snapshot)
        let roundtrip = try SyncRecords.toRecords(SyncRecords.fromRecords(records))
        // Web diffRecords compares the record map by key and exact string; node order remains inside those strings.
        XCTAssertEqual(try roundtrip.object("records").count,try records.object("records").count)
        for field in try records.object("records") {
            XCTAssertEqual(try roundtrip.required(field.key).string("record").utf8.map { $0 },try field.value.string("record").utf8.map { $0 })
        }
        try OrderedJSON.object([.init(key:"snapshot",value:snapshot),.init(key:"records",value:records)]).encoded()
            .write(to:URL(fileURLWithPath:"/private/tmp/weavelet-stream-state-native-output.json"),options:.atomic)
    }

    func testEmptyProxyJournalFailureKeepsGenerationAndPrimaryBytesForSaveRetry() async throws {
        let local = try store(), app = try state(local), remote = client()
        let journal = NativeProxyRecoveryStore(libraryURL:local.fileURL)
        try FileManager.default.createDirectory(at:journal.fileURL,withIntermediateDirectories:false)
        try app.startGeneration(input:"FAKE empty failure",record:proxyRecord(),client:remote)
        let before = try Data(contentsOf:local.fileURL)
        try await wait { app.generation?.running == false }
        let current = try XCTUnwrap(app.generation)
        XCTAssertTrue(current.failed)
        XCTAssertEqual(app.exchange?.source,current.baseSource)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),before)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        try FileManager.default.removeItem(at:journal.fileURL)
        try app.saveGenerationResult()
        XCTAssertNil(app.generation)
        let saved = try XCTUnwrap(journal.records().first)
        let target = try saved.required("nodeId").string("node")
        XCTAssertEqual(try app.streamStatus(chatID:current.chatID,nodeID:target)?["reason"],.string("error"))
        XCTAssertEqual(ChatState(store:local).exchange?.source,app.exchange?.source)
    }

    func testEmptyProxyPostCommitCleanupFailureDoesNotBecomeAnUnsavableGeneration() async throws {
        let base = try store(), journal = NativeProxyRecoveryStore(libraryURL:base.fileURL)
        var failCleanup = false
        let retained = Data(#"{"version":999,"records":[],"future":"FAKE preserve"}"#.utf8)
        let local = LocalStateStore(fileURL:base.fileURL) { bytes,url in
            try bytes.write(to:url,options:.atomic)
            if failCleanup { try retained.write(to:journal.fileURL,options:.atomic) }
        }
        let app = try state(local), remote = client()
        FakeRemoteProtocol.packets = [proxyDone]
        FakeRemoteProtocol.holdLast = true
        try app.startGeneration(input:"FAKE stop before output",record:proxyRecord(),client:remote)
        try await wait { !FakeRemoteProtocol.requests.isEmpty }
        let current = try XCTUnwrap(app.generation), target = try current.plan!.required("targetNodeId").string("node")
        failCleanup = true
        app.stopGeneration()
        XCTAssertNil(app.generation)
        XCTAssertNil(app.generationError)
        XCTAssertNotNil(app.streamRecoveryError)
        XCTAssertEqual(try Data(contentsOf:journal.fileURL),retained)
        XCTAssertEqual(try app.streamStatus(chatID:current.chatID,nodeID:target)?["reason"],.string("interrupted"))
        XCTAssertEqual(ChatState(store:base).exchange?.source,app.exchange?.source)
    }
}
