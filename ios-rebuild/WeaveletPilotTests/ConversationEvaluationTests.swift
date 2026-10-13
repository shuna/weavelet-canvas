import XCTest
import Combine
@testable import WeaveletPilot

private final class EvaluationProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var reply = Data()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" || request.url?.host == "openrouter.ai" || request.url?.host == "api.openai.com" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Self.reply)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class ConversationEvaluationTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.decode(Data(text.utf8)) }
    private func client() -> RemoteClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EvaluationProtocol.self]
        return RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
    }
    private func source() throws -> OrderedJSON {
        try json(#"{"chats":[{"id":"chat","config":{"model":"fake-model","providerId":"openrouter","openRouter":{"routing":{"only":["provider-a"],"max_price":{"prompt":0.0100,"xFuture":9007199254740993}},"responseCache":{"mode":"on"}}},"branchTree":{"activePath":["user","assistant"],"nodes":{"user":{"id":"user","parentId":null,"role":"user","contentHash":"u"},"assistant":{"id":"assistant","parentId":"user","role":"assistant","contentHash":"a"}}},"omittedNodes":{}}],"contentStore":{"u":{"content":[{"type":"text","text":"質問"}],"refCount":1},"a":{"content":[{"type":"text","text":"回答"}],"refCount":1}},"evaluationResults":{},"xRoot":9007199254740993}"#)
    }
    private func state() throws -> OrderedJSON {
        try json(#"{"providers":{"openrouter":{"id":"openrouter","name":"OpenRouter","endpoint":"https://openrouter.ai/api/v1/chat/completions","modelsRequireAuth":true},"openai":{"id":"openai","name":"OpenAI","endpoint":"https://api.openai.com/v1/chat/completions","modelsRequireAuth":true}},"evaluationResults":{"chat:assistant:post-receive":{"phase":"post-receive","safety":{"flagged":false,"xLarge":9007199254740993},"xFuture":1.234567890123456789}},"xRoot":9007199254740993}"#)
    }
    private func read(_ id: String) -> RemoteCredentialRecord? {
        let endpoint = id == "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions"
        return RemoteCredentialRecord(settings:RemoteSettings(endpoint:endpoint,model:"fake-model",stream:false),key:"FAKE-\(id)")
    }

    func testQualityUsesSharedJudgeRequestAndPreservesOtherResultAndUnsafeNumbers() async throws {
        let source = try source(), state = try state(), before = try state.encoded()
        let prepared = try ConversationEvaluation.prepare(source:source,state:state,chatID:"chat",nodeID:"assistant",
            dimension:"quality",legacy:RemoteCredentialRecord(),readProviderCredential:read)
        XCTAssertEqual(prepared.key,"chat:assistant:post-receive")
        XCTAssertEqual(prepared.request.url?.host,"openrouter.ai")
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-openrouter")
        let body = try OrderedJSON.decode(XCTUnwrap(prepared.request.httpBody))
        XCTAssertEqual(body["provider"]?["only"],.array([.string("provider-a")]))
        XCTAssertEqual(body["provider"]?["max_price"]?["xFuture"],.number("9007199254740993"))
        XCTAssertNil(prepared.request.value(forHTTPHeaderField:"X-OpenRouter-Cache"))
        EvaluationProtocol.requests = []
        EvaluationProtocol.reply = Data(#"{"choices":[{"message":{"content":"{\"scores\":{\"taskCompletion\":0.8}}"}}]}"#.utf8)
        do {
            _ = try await ConversationEvaluation.run(prepared,client:client(),isCurrent:{ false })
            XCTFail("stale request was sent")
        } catch { XCTAssertTrue(EvaluationProtocol.requests.isEmpty) }
        let result = try await ConversationEvaluation.run(prepared,client:client())
        let updated = try ConversationEvaluation.apply(result,prepared:prepared,source:source,state:state)
        let existing = try updated.required("evaluationResults").required(prepared.key)
        XCTAssertEqual(existing["safety"]?["xLarge"],.number("9007199254740993"))
        XCTAssertEqual(existing["xFuture"],.number("1.234567890123456789"))
        XCTAssertEqual(existing["quality"]?["scores"]?["taskCompletion"],.number("0.8"))
        XCTAssertEqual(updated["xRoot"],.number("9007199254740993"))
        XCTAssertEqual(try state.encoded(),before)
    }

    func testSafetyUsesOpenAIDedicatedCredentialAndSharedCategoryParser() async throws {
        let safetySource = try source()
        let original = try safetySource.required("chats").array("chats")[0]
        XCTAssertThrowsError(try ConversationEvaluation.prepare(source:safetySource,state:state(),chatID:"chat",nodeID:"assistant",
            dimension:"safety",scope:"single",readProviderCredential:read))
        let safeChat = original.replacing("config",with:.object(try original.required("config").object("config").filter { $0.key != "openRouter" }))
        let prepared = try ConversationEvaluation.prepare(source:safetySource.replacing("chats",with:.array([safeChat])),state:state(),chatID:"chat",nodeID:"assistant",
            dimension:"safety",scope:"single",readProviderCredential:read)
        XCTAssertEqual(prepared.request.url?.absoluteString,"https://api.openai.com/v1/moderations")
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-openai")
        XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(prepared.request.httpBody)).required("input"),.string("回答"))
        EvaluationProtocol.reply = Data(#"{"results":[{"flagged":true,"categories":{"violence":true,"future":true},"category_scores":{"violence":0.91,"future":0.1234567890123456789}}]}"#.utf8)
        let result = try await ConversationEvaluation.run(prepared,client:client())
        XCTAssertEqual(result["flagged"],.bool(true))
        XCTAssertEqual(result["categories"]?["future"],.bool(true))
        XCTAssertEqual(result["categoryScores"]?["future"],.number("0.1234567890123456789"))
        let saved = try ConversationEvaluation.apply(result,prepared:prepared,source:safetySource.replacing("chats",with:.array([safeChat])),state:state())
        XCTAssertEqual(saved["evaluationResults"]?[prepared.key]?["safety"]?["categoryScores"]?["future"],.number("0.1234567890123456789"))
    }

    func testPreparedEvaluationRejectsChangedTargetAndCancellation() async throws {
        let source = try source(), state = try state()
        let prepared = try ConversationEvaluation.prepare(source:source,state:state,chatID:"chat",nodeID:"assistant",
            dimension:"quality",readProviderCredential:read)
        let changed = source.replacing("chats",with:.array([try source.required("chats").array("chats")[0].replacing("omittedNodes",with:.object([.init(key:"user",value:.bool(true))]))]))
        XCTAssertThrowsError(try ConversationEvaluation.apply(.object([]),prepared:prepared,source:changed,state:state))
        XCTAssertFalse(try ConversationEvaluation.isCurrent(prepared,source:changed,state:state))
        XCTAssertTrue(try ConversationEvaluation.isCurrent(prepared,source:source,state:state))
        XCTAssertEqual(try ConversationEvaluation.resultKey(source:source,chatID:"chat",nodeID:"assistant"),prepared.key)
        XCTAssertNil(try ConversationEvaluation.resultKey(source:source,chatID:"chat",nodeID:"missing"))
        EvaluationProtocol.requests = []
        let task = Task { try await ConversationEvaluation.run(prepared,client:client()) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled evaluation must not complete") }
        catch is CancellationError {} catch { XCTFail("Unexpected cancellation error: \(error)") }
        XCTAssertTrue(EvaluationProtocol.requests.isEmpty)
    }
    func testEvaluationStoreKeepsOriginalOnFailureAndRestartsAfterSuccess() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-eval-store-\(UUID().uuidString)")
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")) { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store)
        let flat = try json(#"{"version":3,"chats":[{"id":"store-chat","title":"Evaluation","config":{"model":"fake-model","max_tokens":100},"messages":[{"role":"user","content":[{"type":"text","text":"Prompt"}]},{"role":"assistant","content":[{"type":"text","text":"Response"}]}]}]}"#)
        try app.importWebData(flat.encoded())
        let snapshot = try app.publicationSnapshot()
        try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("xEvalRoot",with:.number("9007199254740993"))))
        let nodeID = try XCTUnwrap(app.conversation?.visibleMessages.last?.id)
        let draft = try app.evaluationDraft(nodeID:nodeID)
        EvaluationProtocol.reply = Data(#"{"choices":[{"message":{"content":"{\"scores\":{\"taskCompletion\":0.8}}"}}]}"#.utf8)
        let legacy = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:false),key:"FAKE")
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        for fail in [true,false] {
            reject = fail
            let completed = expectation(description:"evaluation finished")
            let subscription = app.$evaluationJobs.dropFirst().filter { $0.values.first?.busy == false }.first().sink { _ in completed.fulfill() }
            try app.startEvaluation(draft,dimension:"quality",scope:"single",omittedMode:"respect-omitted",record:legacy,client:client())
            await fulfillment(of:[completed],timeout:5)
            withExtendedLifetime(subscription) {}
            if fail {
                XCTAssertNotNil(app.evaluationJobs[.init(chatID:draft.chatID,nodeID:draft.nodeID)]?.error)
                XCTAssertEqual(try app.publicationSnapshot(),before)
                XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
            } else {
                XCTAssertNil(app.evaluationJobs[.init(chatID:draft.chatID,nodeID:draft.nodeID)]?.error)
                XCTAssertEqual(try app.evaluationResult(chatID:draft.chatID,nodeID:draft.nodeID)?["quality"]?["scores"]?["taskCompletion"],.number("0.8"))
                XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
                let exported = try OrderedJSON.decode(app.exportWebData())
                XCTAssertEqual(exported["evaluationResults"],try app.publicationSnapshot()["state"]?["evaluationResults"])
                XCTAssertEqual(try app.publicationSnapshot()["state"]?["xEvalRoot"],.number("9007199254740993"))
            }
        }
    }

}
