import XCTest
import Combine
@testable import WeaveletPilot

private final class CountingResponseProtocol: URLProtocol {
    static var requests: [OrderedJSON] = []
    static var observed = false
    override class func canInit(with request: URLRequest) -> Bool { ["fixture.invalid","openrouter.ai"].contains(request.url?.host ?? "") }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if let body = RemoteRequest.fixtureBody(request), let json = try? OrderedJSON.decode(body) { Self.requests.append(json) }
        let response = Self.observed
            ? #"{"choices":[{"message":{"content":"Answer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":19,"completion_tokens":23}}"#
            : #"{"choices":[{"message":{"content":"Answer"},"finish_reason":"stop"}]}"#
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(response.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class NativeTokenCountingTests: XCTestCase {
    private final class Fault { var reject = false }
    private func setup(counting: NativeTokenCounting, enabled: Bool = true) throws -> (ChatState, LocalStateStore, Fault) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("native-tokens-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        let fault = Fault(), store = LocalStateStore(fileURL:root.appendingPathComponent("state.json")) { bytes,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store,tokenCounting:counting)
        try app.importWebData(Data(#"{"version":3,"chats":[{"id":"chat","title":"Before","config":{"model":"gpt-4o","max_tokens":100,"temperature":1,"stream":false},"messages":[{"role":"user","content":[{"type":"text","text":"Previous","xRaw":9007199254740993},{"type":"reasoning","text":"Prior reasoning","xRaw":1.234567890123456789}]},{"role":"assistant","content":[{"type":"text","text":"Prior answer"}]}]}]}"#.utf8))
        let snapshot = try app.publicationSnapshot()
        try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("countTotalTokens",with:.bool(enabled)).replacing("xRaw",with:.number("9007199254740993"))))
        return (app,store,fault)
    }
    private func client() -> RemoteClient {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [CountingResponseProtocol.self]
        return RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
    }
    private func record(observed: Bool = false) -> RemoteCredentialRecord {
        RemoteCredentialRecord(settings:RemoteSettings(endpoint:observed ? "https://openrouter.ai/api/v1/chat/completions" : "https://fixture.invalid/v1/chat/completions",model:"gpt-4o",stream:false),key:"FAKE SECRET NEVER SENT TO TOKENIZER")
    }
    private func wait(_ app: ChatState) async throws {
        let deadline = Date().addingTimeInterval(10)
        while app.generation?.running == true && Date() < deadline { try await Task.sleep(nanoseconds:10_000_000) }
        XCTAssertNotEqual(app.generation?.running,true)
    }
    func testFallbackSelectionPreservesOriginalRawPartsAndCancellationDoesNotFallback() async throws {
        let messages = try OrderedJSON.decode(Data(#"[{"role":"user","content":[{"type":"text","text":"long first"}]},{"role":"assistant","content":[{"type":"image_url","image_url":{"url":"data:abc"},"future":9007199254740993},{"type":"text","text":"a","extra":1.234567890123456789},{"type":"future","raw":9007199254740993}]}]"#.utf8))
        let counting = NativeTokenCounting(count:{ _,_ in throw URLError(.cannotDecodeContentData) },limit:{ _,_,_ in throw URLError(.cannotDecodeContentData) })
        defer { counting.shutdown() }
        let limited = try await counting.limit(messages:messages,model:"gpt-4o",limit:7)
        XCTAssertEqual(limited,.array([try messages.array("messages")[1]]))
        let expected = try SharedWebOperations.call("tokenizerOperation",.object([.init(key:"operation",value:.string("fallbackCount")),.init(key:"messages",value:messages)]))
        let fallbackCount = try await counting.count(messages:messages,model:"gpt-4o")
        XCTAssertEqual(fallbackCount,try expected.nativeTokenInteger("count"))
        let cancelled = NativeTokenCounting(count:{ _,_ in throw CancellationError() })
        do { _ = try await cancelled.count(messages:messages,model:"gpt-4o"); XCTFail("Cancellation must not return fallback") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
    func testCancellingOneCountDoesNotInvalidateConcurrentCount() async throws {
        let entered = expectation(description: "both counts entered")
        entered.expectedFulfillmentCount = 2
        var releases: [CheckedContinuation<Void, Never>] = []
        let counting = NativeTokenCounting(count: { _, _ in
            await withCheckedContinuation { releases.append($0); entered.fulfill() }
            return 7
        })
        defer { counting.shutdown() }
        let messages: OrderedJSON = .array([])
        let cancelled = Task { try await counting.count(messages: messages, model: "gpt-4o") }
        let surviving = Task { try await counting.count(messages: messages, model: "gpt-4o") }
        await fulfillment(of: [entered], timeout: 5)
        cancelled.cancel()
        releases.forEach { $0.resume() }
        switch await cancelled.result {
        case .success: XCTFail("Cancelled count must fail")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        let result = try await surviving.value
        XCTAssertGreaterThanOrEqual(result, 0)
    }
    func testLimitedRemoteRequestAndCachedUsageSurviveSaveRetryWithoutDoubleCounting() async throws {
        var countCalls = 0
        let counting = NativeTokenCounting(count:{ messages,model in
            XCTAssertEqual(model,"gpt-4o"); countCalls += 1
            let values = try messages.array("messages")
            XCTAssertNil(try messages.encoded().range(of:Data("FAKE SECRET".utf8)))
            return values.first?["role"] == .string("assistant") ? 11 : 7
        },limit:{ messages,model,limit in
            XCTAssertEqual(model,"gpt-4o"); XCTAssertGreaterThan(limit,0)
            return .array(Array(try messages.array("messages").suffix(1)))
        })
        defer { counting.shutdown() }
        let (app,store,fault) = try setup(counting:counting)
        let initial = try app.publicationSnapshot()
        CountingResponseProtocol.requests = []; CountingResponseProtocol.observed = false
        try app.startGeneration(input:"New input",record:record(),client:client())
        let reserved = try Data(contentsOf:store.fileURL)
        fault.reject = true
        try await wait(app)
        XCTAssertNotNil(app.generation)
        XCTAssertEqual(app.generation?.tokenCounts,.object([.init(key:"promptTokens",value:.number("7")),.init(key:"completionTokens",value:.number("11"))]))
        XCTAssertEqual(try Data(contentsOf:store.fileURL),reserved)
        let calls = countCalls
        fault.reject = false; try app.saveGenerationResult()
        XCTAssertEqual(countCalls,calls)
        let saved = try app.publicationSnapshot()
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["promptTokens"],.number("7"))
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["completionTokens"],.number("11"))
        XCTAssertEqual(saved["state"]?["xRaw"],.number("9007199254740993"))
        let old = try initial.required("state").required("chats").array("chats")[0].required("messages").array("messages")[0]
        XCTAssertEqual(try saved.required("state").required("chats").array("chats")[0].required("messages").array("messages")[0],old)
        let sent = try XCTUnwrap(CountingResponseProtocol.requests.first).required("messages").array("messages")
        XCTAssertEqual(sent.count,1)
        XCTAssertEqual(try sent[0]["content"]?.array("parts").first?["text"],.string("New input"))
        XCTAssertThrowsError(try app.saveGenerationResult())
        XCTAssertEqual(try app.publicationSnapshot(),saved)
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),saved)
    }
    func testObservedOpenRouterUsageWinsOverNativeCounts() async throws {
        let counting = NativeTokenCounting(count:{ _,_ in 7 },limit:{ messages,_,_ in messages })
        defer { counting.shutdown() }
        let (app,_,_) = try setup(counting:counting)
        CountingResponseProtocol.requests = []; CountingResponseProtocol.observed = true
        defer { CountingResponseProtocol.observed = false }
        try app.startGeneration(input:"New input",record:record(observed:true),client:client())
        try await wait(app)
        XCTAssertNil(app.generation)
        let totals = try app.publicationSnapshot()["state"]?["totalTokenUsed"]?["gpt-4o"]
        XCTAssertEqual(totals?["promptTokens"],.number("19"))
        XCTAssertEqual(totals?["completionTokens"],.number("23"))
    }
    func testCancelledOrReplacedBudgetNeverSendsLateRequest() async throws {
        for replace in [false,true] {
            let entered = expectation(description:"limiter entered")
            var release: CheckedContinuation<Void,Never>?
            let counting = NativeTokenCounting(count:{ _,_ in 7 },limit:{ messages,_,_ in
                await withCheckedContinuation { release = $0; entered.fulfill() }; return messages
            })
            let (app,_,_) = try setup(counting:counting,enabled:false)
            CountingResponseProtocol.requests = []
            try app.startGeneration(input:"New input",record:record(),client:client())
            await fulfillment(of:[entered],timeout:5)
            app.stopGeneration()
            if replace { try app.createChat(id:"replacement") }
            let before = try app.publicationSnapshot()
            release?.resume()
            try await Task.sleep(nanoseconds:50_000_000)
            XCTAssertTrue(CountingResponseProtocol.requests.isEmpty)
            XCTAssertEqual(try app.publicationSnapshot(),before)
            counting.shutdown()
        }
    }
    func testTitleAndSummaryCallersUseMeasuredCountsAndSharedNormalization() async throws {
        let counting = NativeTokenCounting(count:{ messages,model in
            XCTAssertEqual(model,"gpt-4o")
            return try messages.array("messages").first?["role"] == .string("assistant") ? 11 : 7
        },limit:{ messages,_,_ in messages })
        defer { counting.shutdown() }
        let (app,store,_) = try setup(counting:counting)
        let snapshot = try app.publicationSnapshot()
        try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("autoTitle",with:.bool(true)).replacing("titleModel",with:.string("gpt-4o"))))
        CountingResponseProtocol.requests = []; CountingResponseProtocol.observed = false
        app.startAutomaticTitle(chatID:"chat",legacy:record(),client:client())
        let titleDeadline = Date().addingTimeInterval(5)
        while app.conversations.first?.title != "Answer" && Date() < titleDeadline { try await Task.sleep(nanoseconds:10_000_000) }
        XCTAssertEqual(app.conversations.first?.title,"Answer")
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"]?["gpt-4o"]?["promptTokens"],.number("7"))
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"]?["gpt-4o"]?["completionTokens"],.number("11"))
        let nodeID = try XCTUnwrap(app.conversations.first?.nodes.last?.id)
        let draft = try app.summaryDraft(nodeID:nodeID)
        try app.startSummary(draft,sourceNodeIDs:[nodeID],mode:"single",format:nil,record:record(),client:client())
        let summaryDeadline = Date().addingTimeInterval(5)
        while app.summaryJob(chatID:"chat",nodeID:nodeID)?.busy == true && Date() < summaryDeadline { try await Task.sleep(nanoseconds:10_000_000) }
        XCTAssertNil(app.summaryJob(chatID:"chat",nodeID:nodeID)?.error)
        let saved = try app.publicationSnapshot()
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["promptTokens"],.number("14"))
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["completionTokens"],.number("22"))
        XCTAssertEqual(try saved.required("state").required("chats").array("chats")[0]["summaries"]?.array("summaries").first?["text"],.string("Answer"))
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),saved)
    }
    func testEvaluationPickerActionsPersistAndPreserveUnknownFieldsOnSaveFailure() throws {
        let counting = NativeTokenCounting(count:{ _,_ in 7 },limit:{ messages,_,_ in messages })
        let (app,store,fault) = try setup(counting:counting)
        var snapshot = try app.publicationSnapshot()
        let opaque = try OrderedJSON.decode(Data(#"{"number":1.234567890123456789,"large":9007199254740993,"list":[null,false,"opaque"]}"#.utf8))
        let settings = try app.evaluationSettings().replacing("safetyEngine",with:.string("hybrid"))
            .replacing("hybridRemoteOnSafe",with:.bool(true)).replacing("xOpaque",with:opaque)
        snapshot = try snapshot.replacing("state",with:snapshot.required("state").replacing("evaluationSettings",with:settings))
        try app.applySnapshot(snapshot)
        XCTAssertEqual(try app.evaluationSettings(),settings)
        let unknown = try snapshot.replacing("state",with:snapshot.required("state").replacing("evaluationSettings",with:settings.replacing("safetyEngine",with:.string("future-engine"))))
        let originalBytes = try Data(contentsOf:store.fileURL)
        XCTAssertThrowsError(try app.applySnapshot(unknown))
        XCTAssertEqual(try app.publicationSnapshot(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),originalBytes)
        XCTAssertThrowsError(try app.saveEvaluationSetting("safetyEngine",value:.string("unrecognized")))
        XCTAssertEqual(try app.publicationSnapshot(),snapshot)
        for engine in ["remote","local","hybrid"] {
            try app.saveEvaluationSetting("safetyEngine",value:.string(engine))
            XCTAssertEqual(try app.evaluationSettings()["safetyEngine"],.string(engine))
        }
        try app.saveEvaluationSetting("hybridRemoteOnSafe",value:.bool(false))
        XCTAssertEqual(try app.evaluationSettings()["hybridRemoteOnSafe"],.bool(false))
        XCTAssertEqual(try app.evaluationSettings()["xOpaque"],opaque)
        let saved = try app.publicationSnapshot(), bytes = try Data(contentsOf:store.fileURL)
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),saved)
        for field in try snapshot.required("state").object("state") where field.key != "evaluationSettings" {
            XCTAssertEqual(saved["state"]?[field.key],field.value)
        }
        fault.reject = true
        XCTAssertThrowsError(try app.saveEvaluationSetting("safetyEngine",value:.string("remote")))
        XCTAssertThrowsError(try app.saveEvaluationSetting("hybridRemoteOnSafe",value:.bool(true)))
        XCTAssertEqual(try app.publicationSnapshot(),saved)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),bytes)
        XCTAssertEqual(try app.evaluationSettings()["xOpaque"],opaque)
    }
    func testRealWorkerCountsReachSavedGenerationUsage() async throws {
        let counting = NativeTokenCounting(); defer { counting.shutdown() }
        let (app,store,_) = try setup(counting:counting)
        CountingResponseProtocol.requests = []; CountingResponseProtocol.observed = false
        try app.startGeneration(input:"hello 日本語🙂",record:record(),client:client())
        try await wait(app)
        XCTAssertNil(app.generation)
        let saved = try app.publicationSnapshot()
        let chat = try saved.required("state").required("chats").array("chats")[0]
        let target = try chat.required("branchTree").required("activePath").array("path").last!
        let plan = try SharedWebOperations.call("generationUsagePlan",.object([.init(key:"chat",value:chat),.init(key:"targetNodeId",value:target)]))
        let expected = try await counting.counts(plan:plan)
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["promptTokens"],expected["promptTokens"])
        XCTAssertEqual(saved["state"]?["totalTokenUsed"]?["gpt-4o"]?["completionTokens"],expected["completionTokens"])
        XCTAssertTrue(counting.isReady)
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),saved)
    }
}
