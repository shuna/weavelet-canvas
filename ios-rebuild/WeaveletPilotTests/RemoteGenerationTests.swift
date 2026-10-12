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
    private func state(_ store: LocalStateStore) throws -> ChatState {
        let state = ChatState(store: store)
        try state.importWebData(fixture().required("cases").array("cases")[0].required("source").encoded())
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
            XCTAssertEqual(try SyncRecords.canonical(body), try SyncRecords.canonical(expected.required("body")))
            XCTAssertEqual(source["apiKey"], .string("FAKE-imported-not-request-key"))
            XCTAssertThrowsError(try RemoteRequest.make(source: source, chatID: "remote", path: [], settings: RemoteSettings(endpoint: "http://fixture.invalid", model: "fake-model"), key: "FAKE"))
        }
    }
    func testNonstreamAndStreamingSaveAssistantRestartExportAndPreserveOldData() async throws {
        for streaming in [false, true] {
            let store = try store()
            let state = try state(store)
            let old = try XCTUnwrap(state.exchange).source
            let client = client()
            FakeRemoteProtocol.packets = streaming ? try streamPackets() : [.init(bytes: try fixture().required("responses").required("nonstream").encoded())]
            try state.startGeneration(input: "New user", record: record(stream: streaming), client: client)
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
        try state.startGeneration(input: "Stop", record: record(), client: client)
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
        let state = try state(store)
        let client = client()
        FakeRemoteProtocol.packets = [.init(bytes: try fixture().required("responses").required("nonstream").encoded(), delay: 0.05)]
        let original = state.exchange?.source
        let oldDisk = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        XCTAssertThrowsError(try state.startGeneration(input: "Preserved input", record: record(stream: false), client: client))
        XCTAssertEqual(state.exchange?.source, original)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), oldDisk)
        XCTAssertTrue(FakeRemoteProtocol.requests.isEmpty)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try state.startGeneration(input: "Preserved input", record: record(stream: false), client: client)
        let userSource = state.exchange?.source
        let userDisk = try Data(contentsOf: store.fileURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        try await wait { state.generation?.running == false }
        XCTAssertEqual(state.generation?.output.text, "Answer 日本語")
        XCTAssertEqual(state.exchange?.source, userSource)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), userDisk)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try state.saveGenerationResult()
        XCTAssertNil(state.generation)
        XCTAssertEqual(ChatState(store: store).exchange?.source, state.exchange?.source)
    }
    func testSourceReplacementInvalidatesOldSessionAndRejectsLateCompletion() async throws {
        let store = try store()
        let state = try state(store)
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
    func testSettingsFailureKeepsPublishedAndStoredRecordThenNewSettingsAffectRequest() throws {
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
        XCTAssertEqual(body["model"], .string("fake-changed"))
        XCTAssertEqual(body["stream"], .bool(true))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE-new")
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
