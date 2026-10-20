import XCTest
@testable import WeaveletPilot

private final class ParallelGenerationProtocol: URLProtocol {
    static let lock = NSLock()
    static var pending: [String: () -> Void] = [:]
    static var labels: [String] = []
    static var failures: Set<String> = []

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "parallel.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body = String(decoding: RemoteRequest.fixtureBody(request) ?? Data(), as: UTF8.self)
        let label = body.contains("parallel-A") ? "A" : "B"
        let reply: () -> Void = { [weak self] in
            guard let self, let url = self.request.url else { return }
            if Self.failures.contains(label) {
                self.client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            } else {
                self.client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                self.client?.urlProtocol(self, didLoad: Data(#"{"choices":[{"message":{"content":"reply-\#(label)"}}]}"#.utf8))
                self.client?.urlProtocolDidFinishLoading(self)
            }
        }
        Self.lock.lock(); Self.labels.append(label); Self.pending[label] = reply; Self.lock.unlock()
    }
    // Deliberately allow an already-buffered completion after cancellation.
    override func stopLoading() {}

    static func reset() { lock.lock(); defer { lock.unlock() }; pending = [:]; labels = []; failures = [] }
    static func release(_ label: String) { lock.lock(); let reply = pending.removeValue(forKey: label); lock.unlock(); reply?() }
}

@MainActor
final class ParallelGenerationTests: XCTestCase {
    private let composedID = "chat-\u{00E9}"
    private let decomposedID = "chat-e\u{0301}"

    func testDifferentUnicodeEquivalentChatsRunConcurrentlyAndCompleteOutOfOrder() async throws {
        let app = try makeState(), remote = client()
        try app.startGeneration(input: "parallel-A", record: record(), client: remote)
        try app.createChat(id: decomposedID, now: 1)
        try app.startGeneration(input: "parallel-B", record: record(), client: remote)
        try await wait { ParallelGenerationProtocol.labels.count == 2 }

        XCTAssertNotEqual(Data(composedID.utf8), Data(decomposedID.utf8))
        XCTAssertNotNil(app.generation(for: composedID))
        XCTAssertNotNil(app.generation(for: decomposedID))
        XCTAssertTrue(app.hasGenerations)
        XCTAssertTrue(app.selectedConversationID.utf8.elementsEqual(decomposedID.utf8))
        try app.saveUsageCounting(true)
        XCTAssertNotNil(app.generation(for: composedID))
        XCTAssertNotNil(app.generation(for: decomposedID))
        XCTAssertThrowsError(try app.startGeneration(input: "parallel-B-again", record: record(), client: remote))

        ParallelGenerationProtocol.release("B")
        try await wait { app.generation(for: decomposedID) == nil }
        XCTAssertNotNil(app.generation(for: composedID))
        ParallelGenerationProtocol.release("A")
        try await wait { !app.hasGenerations }
        XCTAssertTrue(app.selectedConversationID.utf8.elementsEqual(decomposedID.utf8))

        XCTAssertEqual(output(app,chatID:composedID), "reply-A")
        XCTAssertEqual(output(app,chatID:decomposedID), "reply-B")
    }

    func testStoppingOneChatIgnoresItsLateCompletionAndKeepsOtherGeneration() async throws {
        let app = try makeState(), remote = client()
        try app.startGeneration(input: "parallel-A", record: record(), client: remote)
        try app.createChat(id: decomposedID, now: 1)
        try app.startGeneration(input: "parallel-B", record: record(), client: remote)
        try await wait { ParallelGenerationProtocol.labels.count == 2 }

        app.stopGeneration(chatID: composedID)
        XCTAssertNil(app.generation(for: composedID))
        XCTAssertNotNil(app.generation(for: decomposedID))
        ParallelGenerationProtocol.release("A")
        ParallelGenerationProtocol.release("B")
        try await wait { !app.hasGenerations }

        XCTAssertNotEqual(output(app,chatID:composedID), "reply-A")
        XCTAssertEqual(output(app,chatID:decomposedID), "reply-B")
    }

    func testRemoteFailureInOneChatDoesNotRemoveOtherChatGeneration() async throws {
        let app = try makeState(), remote = client()
        try app.startGeneration(input: "parallel-A", record: record(), client: remote)
        try app.createChat(id: decomposedID, now: 1)
        try app.startGeneration(input: "parallel-B", record: record(), client: remote)
        try await wait { ParallelGenerationProtocol.labels.count == 2 }

        ParallelGenerationProtocol.failures = ["A"]
        ParallelGenerationProtocol.release("A")
        try await wait { app.generation(for: composedID) == nil }
        XCTAssertNotNil(app.generation(for: decomposedID))
        ParallelGenerationProtocol.release("B")
        try await wait { app.generation(for: decomposedID) == nil }
        XCTAssertEqual(output(app,chatID:decomposedID), "reply-B")
    }

    func testFailedSaveRetriesAgainstLatestOtherChatAndRetainsUnknownIOOnRestart() async throws {
        var reject = false
        var savedURL: URL?
        let app = try makeState { data,url in
            savedURL = url
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to:url,options:.atomic)
        }
        let remote = client()
        try app.startGeneration(input:"parallel-A",record:record(),client:remote)
        try app.createChat(id:decomposedID,now:1)
        try app.startGeneration(input:"parallel-B",record:record(),client:remote)
        try await wait { ParallelGenerationProtocol.labels.count == 2 }
        let original = app.exchange?.source
        let url = try XCTUnwrap(savedURL), bytes = try Data(contentsOf:url)
        reject = true
        ParallelGenerationProtocol.release("A")
        try await wait { app.generation(for:self.composedID)?.running == false }
        XCTAssertEqual(app.generation(for:composedID)?.output.text,"reply-A")
        XCTAssertEqual(app.exchange?.source,original)
        XCTAssertEqual(try Data(contentsOf:url),bytes)
        reject = false
        ParallelGenerationProtocol.release("B")
        try await wait { app.generation(for:self.decomposedID) == nil }
        XCTAssertNotNil(app.generation(for:composedID))
        XCTAssertTrue(app.selectedConversationID.utf8.elementsEqual(decomposedID.utf8))
        app.selectedConversationID = composedID
        try app.saveGenerationResult()
        XCTAssertFalse(app.hasGenerations)
        let restarted = ChatState(store:LocalStateStore(fileURL:url))
        XCTAssertEqual(try restarted.exportWebData(),try app.exportWebData())
        XCTAssertEqual(output(restarted,chatID:composedID),"reply-A")
        XCTAssertEqual(output(restarted,chatID:decomposedID),"reply-B")
        XCTAssertEqual(restarted.exchange?.source["xRoot"],.number("9007199254740993"))
        XCTAssertEqual(restarted.exchange?.source["xString"],original?["xString"])
    }

    private func output(_ app: ChatState, chatID: String) -> String? {
        app.conversations.first { $0.id.utf8.elementsEqual(chatID.utf8) }?.visibleMessages.last.map {
            $0.parts.compactMap { if case .text(let value) = $0 { return value }; return nil }.joined()
        }
    }

    func testOffPathGenerationFocusPreservesRunningRequestAndFailedSaveState() async throws {
        var reject = false
        var savedURL: URL?
        let app = try makeState { data,url in
            savedURL = url
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to:url,options:.atomic)
        }
        try app.setChatActiveView(.splitHorizontal)
        let remote = client()
        try app.startGeneration(input:"parallel-A",record:record(),client:remote)
        try await wait { ParallelGenerationProtocol.labels.count == 1 }
        ParallelGenerationProtocol.release("A")
        try await wait { !app.hasGenerations }
        let previous = try XCTUnwrap(app.conversation?.visibleMessages.last?.id)
        var branch = try app.messageDraft(nodeID:previous)
        branch.text = "alternative branch"
        try app.saveMessage(branch,mode:.branch,newIDs:["other-assistant"])
        let draft = try app.messageGenerationDraft(nodeID:"other-assistant",operation:.regenerate)
        try app.startGeneration(draft,record:record(),client:remote)
        try await wait { ParallelGenerationProtocol.labels.count == 2 }
        XCTAssertNil(try app.offPathGenerationTarget())
        let generationID = try XCTUnwrap(app.generation?.id)
        let target = try XCTUnwrap(app.generation?.plan?["targetNodeId"]).string("target")
        try app.navigate(chatID:composedID,nodeID:previous,source:.branchSwitch)
        XCTAssertEqual(try app.offPathGenerationTarget(),target)
        let before = try app.publicationSnapshot(), source = app.exchange?.source
        let visible = app.conversation?.visibleMessages.map(\.identity)
        let url = try XCTUnwrap(savedURL), bytes = try Data(contentsOf:url)
        reject = true
        XCTAssertThrowsError(try app.showOffPathGeneration(compact:true))
        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:url),bytes)
        XCTAssertNil(app.branchEditorFocus)
        XCTAssertEqual(app.generation?.id,generationID)
        reject = false
        try app.showOffPathGeneration(compact:false)
        XCTAssertEqual(app.chatActiveView,.splitHorizontal)
        XCTAssertEqual(app.branchEditorFocus?.nodeID,target)
        XCTAssertEqual(app.exchange?.source,source)
        XCTAssertEqual(app.conversation?.visibleMessages.map(\.identity),visible)
        XCTAssertEqual(app.generation?.id,generationID)
        XCTAssertTrue(app.generation?.running == true)
        let focusedSnapshot = try app.publicationSnapshot(), focusedBytes = try Data(contentsOf:url)
        reject = true
        ParallelGenerationProtocol.release("A")
        try await wait { app.generation?.running == false }
        XCTAssertEqual(app.generation?.output.text,"reply-A")
        XCTAssertEqual(try app.publicationSnapshot(),focusedSnapshot)
        XCTAssertEqual(try Data(contentsOf:url),focusedBytes)
        reject = false
        try app.saveGenerationResult()
        XCTAssertFalse(app.hasGenerations)
        XCTAssertNil(try app.offPathGenerationTarget())
        XCTAssertEqual(app.conversation?.visibleMessages.map(\.identity),visible)
        let generated = app.conversation?.nodes.first { $0.id.utf8.elementsEqual(target.utf8) }
        XCTAssertEqual(generated?.parts.compactMap { if case .text(let text) = $0 { return text }; return nil }.joined(),"reply-A")
        let restarted = ChatState(store:LocalStateStore(fileURL:url))
        XCTAssertEqual(try restarted.exportWebData(),try app.exportWebData())
        XCTAssertEqual(restarted.exchange?.source["xRoot"],.number("9007199254740993"))
        XCTAssertEqual(restarted.exchange?.source["xString"],source?["xString"])
    }

    private func makeState(writer: ((Data,URL) throws -> Void)? = nil) throws -> ChatState {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("parallel-generation-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = writer.map { LocalStateStore(fileURL:url,write:$0) } ?? LocalStateStore(fileURL:url)
        let app = ChatState(store: store, tokenCounting: NativeTokenCounting(count:{ _,_ in 1 },limit:{ messages,_,_ in messages }))
        let source = try OrderedJSON.decode(Data(#"{"version":3,"xRoot":9007199254740993,"xString":"\ud800","chats":[{"id":"chat-é","title":"Remote","config":{"model":"fake-model","max_tokens":128,"stream":false,"modelSource":"remote"},"messages":[{"role":"user","content":[{"type":"text","text":"seed"}]}]}]}"#.utf8))
        try app.importWebData(source.encoded())
        let snapshot = try app.publicationSnapshot()
        let config = try source.required("chats").array("chats")[0].required("config")
        try app.applySnapshot(snapshot.replacing("state",with:try snapshot.required("state").replacing("defaultChatConfig",with:config)))
        return app
    }

    private func record() -> RemoteCredentialRecord {
        RemoteCredentialRecord(settings: RemoteSettings(endpoint: "https://parallel.fixture.invalid/v1/chat/completions", model: "fake-model", stream: false), key: "FAKE")
    }

    private func client() -> RemoteClient {
        ParallelGenerationProtocol.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ParallelGenerationProtocol.self]
        return RemoteClient(session: URLSession(configuration: configuration))
    }

    private func wait(_ predicate: () -> Bool) async throws {
        for _ in 0..<300 {
            if predicate() { return }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Timed out waiting for parallel generation state")
    }
}
