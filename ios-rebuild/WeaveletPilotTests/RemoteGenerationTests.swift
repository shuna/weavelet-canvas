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
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
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
        try state.applySnapshot(.object([.init(key:"version",value:snapshot.required("version")),.init(key:"state",value:.object([.init(key:"chats",value:.array(chats))] + roots))]))
        let source = try XCTUnwrap(state.exchange).source, sourceBytes = try source.encoded(), before = try state.publicationSnapshot().encoded()
        var credentials = record(stream:true)
        credentials.settings.model = "unused-device-model"
        let direct = try RemoteRequest.make(source:source,chatID:chatID,path:XCTUnwrap(state.conversation).visibleMessages.map(\.id),settings:credentials.settings,key:credentials.key,modelState:modelState)
        let directBody = try OrderedJSON.decode(XCTUnwrap(direct.httpBody))
        XCTAssertEqual(directBody["reasoning"]?["effort"],.string("low"))
        XCTAssertEqual(directBody["model"],.string("anthropic/claude-opus-5.5")); XCTAssertEqual(directBody["stream"],.bool(false))
        XCTAssertEqual(try source.encoded(),sourceBytes); XCTAssertEqual(try state.publicationSnapshot().encoded(),before)
        let remote = client()
        FakeRemoteProtocol.packets = [.init(bytes:try fixture().required("responses").required("nonstream").encoded())]
        try state.startGeneration(input:"Catalog boundary",record:credentials,client:remote)
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError)
        let sent = try OrderedJSON.decode(XCTUnwrap(FakeRemoteProtocol.requests.first?.httpBody))
        XCTAssertEqual(sent["reasoning"],directBody["reasoning"])
        let after = try state.publicationSnapshot().required("state")
        for field in roots { XCTAssertEqual(try after.required(field.key).encoded(),try field.value.encoded()) }
    }

    func testSavedSummaryUsesSharedSubmissionRules() throws {
        let source = try OrderedJSON.decode(Data(#"{"chats":[{"id":"summary-chat","config":{"model":"fake-model","max_tokens":100},"messages":[{"role":"user","content":[{"type":"text","text":"Original"}]}],"summaries":[{"id":"s","mode":"single","useForSubmit":true,"text":"Saved context","sources":[{"nodeId":"0","parentId":null,"role":"user","textParts":["Original"]}]}]}]}"#.utf8))
        let request = try RemoteRequest.make(source: source, chatID: "summary-chat", path: ["0"], settings: record().settings, key: "FAKE")
        let messages = try OrderedJSON.decode(XCTUnwrap(request.httpBody)).required("messages").array("messages")
        XCTAssertEqual(try messages[0].required("content").array("content")[0].required("text").string("text"), "Past conversation summary:\nSaved context")
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
        chats[0] = chats[0].replacing("config",with:try chats[0].required("config").replacing("stream",with:.bool(stream)))
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
            FakeRemoteProtocol.packets = streaming ? try streamPackets() : [.init(bytes: try fixture().required("responses").required("nonstream").encoded())]
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
    func testStopKeepsPartialAndRejectsDelayedResult() async throws {
        let store = try store()
        let state = try state(store)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n".utf8)), .init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\" LATE\"}}]}\n\ndata: [DONE]\n\n".utf8), delay: 0.1)]
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
        XCTAssertEqual(content, .array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("Partial"))])]))
    }
    func testNetworkFailurePreservesUserAndPartialWithoutChangingPriorMessages() async throws {
        for partial in [false, true] {
            let store = try store()
            let state = try state(store)
            let original = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages")
            let client = client()
            if partial { FakeRemoteProtocol.packets = [.init(bytes: Data("data: {\"choices\":[{\"delta\":{\"content\":\"Recovered\"}}]}\n\n".utf8))] }
            else { FakeRemoteProtocol.status = 500 }
            try state.startGeneration(input: "Failure", record: record(), client: client)
            try await wait { state.generation == nil }
            XCTAssertNotNil(state.generationError)
            let messages = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages")
            // Attribute projection may reorder object keys; every value and array position must remain identical.
            XCTAssertEqual(Data(try SyncRecords.canonical(.array(Array(messages.prefix(original.count)))).utf8),
                           Data(try SyncRecords.canonical(.array(original)).utf8))
            XCTAssertEqual(messages.count, original.count + (partial ? 2 : 1))
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
