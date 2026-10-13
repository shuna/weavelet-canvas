import XCTest
@testable import WeaveletPilot

private final class ModerationProtocol: URLProtocol {
    static var fail = false
    static var requests = 0
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.openai.com" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests += 1
        if Self.fail { client?.urlProtocol(self,didFailWithError:URLError(.cannotConnectToHost)); return }
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(#"{"results":[{"flagged":false,"categories":{},"category_scores":{}}]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class NativeLocalModerationTests: XCTestCase {
    private final class Fault { var reject = false }
    private struct Fixture {
        let app: ChatState
        let source: OrderedJSON
        let state: OrderedJSON
        let prepared: ConversationEvaluation.AutoPrepared
        let modelRoot: URL
        let fault: Fault
        let store: LocalStateStore
    }
    private func fixture(engine: String = "hybrid", remoteOnSafe: Bool = false) throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("local-moderation-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        let fault = Fault()
        let store = LocalStateStore(fileURL:root.appendingPathComponent("state.json")) { bytes,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store)
        try app.importWebData(Data(#"{"version":3,"chats":[{"id":"chat","title":"Fixture","config":{"model":"fake"},"messages":[{"role":"user","content":[{"type":"text","text":"日本語🙂"}]},{"role":"assistant","content":[{"type":"text","text":"response"}]}]}]}"#.utf8))
        try app.ensureBranchTreeForEditor(chatID:"chat")
        let model = try OrderedJSON.decode(Data(#"{"id":"moderator","engine":"transformers.js","origin":"fixture/trusted","tasks":["moderation"],"manifest":{"kind":"multi-file","entrypoint":"onnx/model.onnx","requiredFiles":["config.json","onnx/model.onnx"]},"unknown":9007199254740993}"#.utf8))
        var snapshot = try app.publicationSnapshot()
        var state = try snapshot.required("state")
        let settings = try ConversationEvaluation.autoSettings(state).replacing("safetyPreSend",with:.string("auto"))
            .replacing("safetyEngine",with:.string(engine)).replacing("hybridRemoteOnSafe",with:.bool(remoteOnSafe))
        state = state.replacing("evaluationSettings",with:settings).replacing("localModelEnabled",with:.bool(true))
            .replacing("activeLocalModels",with:.object([.init(key:"moderation",value:.string("moderator"))]))
            .replacing("localModels",with:.array([model])).replacing("xRaw",with:.number("9007199254740993"))
        snapshot = snapshot.replacing("state",with:state)
        try app.applySnapshot(snapshot)
        let modelRoot = try app.localModelFiles.directoryURL(modelID:"moderator")
        try FileManager.default.createDirectory(at:modelRoot.appendingPathComponent("onnx"),withIntermediateDirectories:true)
        try Data("config".utf8).write(to:modelRoot.appendingPathComponent("config.json"))
        try Data([0,1,2]).write(to:modelRoot.appendingPathComponent("onnx/model.onnx"))
        let source = try XCTUnwrap(app.exchange?.source)
        let nodeID = try source.required("chats").array("chats")[0].required("branchTree").required("activePath").array("path").last!.string("id")
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source,state:state,chatID:"chat",nodeID:nodeID,
            phase:"pre-send",userContent:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("日本語🙂"))])]),
            legacy:RemoteCredentialRecord(),files:app.localModelFiles,readProviderCredential:{ _ in XCTFail("Preparation must stay lazy"); return nil }))
        return Fixture(app:app,source:source,state:state,prepared:prepared,modelRoot:modelRoot,fault:fault,store:store)
    }
    private func client() -> RemoteClient {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ModerationProtocol.self]
        return RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
    }
    private func credential(_ id: String) -> RemoteCredentialRecord? {
        XCTAssertEqual(id,"openai")
        return RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://api.openai.com/v1/chat/completions",model:"fake",stream:false),key:"FAKE")
    }
    private func publish(_ fixture: Fixture, _ dimension: String, _ result: OrderedJSON) throws {
        let snapshot = try fixture.app.publicationSnapshot()
        let updated = try ConversationEvaluation.autoApply(result,dimension:dimension,prepared:fixture.prepared,source:fixture.source,state:snapshot.required("state"))
        try fixture.app.applySnapshot(snapshot.replacing("state",with:updated))
    }
    func testBundledClassifierRunsThroughAutoSafetyAndPersistsAcrossRestartAndRecords() async throws {
        let setup = try fixture(engine:"local")
        let bundled = try XCTUnwrap(Bundle(for: Self.self).url(forResource:"ClassifierFixtureResources",withExtension:nil))
        let paths = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
        for path in paths {
            let bytes = try Data(contentsOf:bundled.appendingPathComponent(path))
            if path.hasSuffix(".onnx") { XCTAssertEqual(bytes.count,299) }
            try bytes.write(to:setup.modelRoot.appendingPathComponent(path))
        }
        let manifest = OrderedJSON.object([.init(key:"kind",value:.string("multi-file")),
            .init(key:"entrypoint",value:.string("onnx/model_quantized.onnx")),.init(key:"requiredFiles",value:.array(paths.map(OrderedJSON.string)))])
        let model = try setup.state.required("localModels").array("models")[0].replacing("manifest",with:manifest)
        let state = setup.state.replacing("localModels",with:.array([model]))
        try setup.app.applySnapshot(setup.app.publicationSnapshot().replacing("state",with:state))
        let source = try XCTUnwrap(setup.app.exchange?.source)
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source,state:state,chatID:setup.prepared.chatID,
            nodeID:setup.prepared.nodeID,phase:setup.prepared.phase,userContent:setup.prepared.userContent,
            requestPath:setup.prepared.requestPath,legacy:RemoteCredentialRecord(),files:setup.app.localModelFiles,
            readProviderCredential:{ _ in XCTFail("Local preparation must not read credentials"); return nil }))
        let fixture = Fixture(app:setup.app,source:source,state:state,prepared:prepared,modelRoot:setup.modelRoot,fault:setup.fault,store:setup.store)
        let before = try fixture.app.publicationSnapshot()
        ModerationProtocol.requests = 0
        var dimensions: [String] = []
        try await ConversationEvaluation.runAutoSafety(prepared,state:state,files:fixture.app.localModelFiles,client:client(),
            readProviderCredential:{ _ in XCTFail("Successful Local must not read credentials, including block-candidate"); return nil },
            classifier:nil,isCurrent:{ (try? ConversationEvaluation.autoIsCurrent(prepared,source:source,state:fixture.app.publicationSnapshot().required("state"))) == true },
            onResult:{ dimension,result in dimensions.append(dimension); try self.publish(fixture,dimension,result) })
        XCTAssertEqual(dimensions,["localSafety"])
        XCTAssertEqual(ModerationProtocol.requests,0)
        let saved = try fixture.app.publicationSnapshot()
        let evaluation = try saved.required("state").required("evaluationResults").required(prepared.key)
        XCTAssertEqual(evaluation["phase"],.string("pre-send"))
        XCTAssertNil(evaluation["safety"])
        let local = try evaluation.required("localSafety")
        XCTAssertEqual(local["screening"],.string("block-candidate"))
        XCTAssertEqual(local["source"],.string("local"))
        XCTAssertGreaterThan(try local.required("timestamp").number("timestamp"),0)
        let scores = try local.required("rawScores").array("scores")
        XCTAssertEqual(try scores.map { try $0.required("label").string("label") },["FIXTURE_TWO","FIXTURE_ZERO"])
        XCTAssertEqual(try scores[0].required("score").number("score"),0.8807970881462097,accuracy:0.0000001)
        XCTAssertEqual(try scores[1].required("score").number("score"),0.1192029193043709,accuracy:0.0000001)
        let restarted = ChatState(store:fixture.store)
        XCTAssertEqual(try restarted.publicationSnapshot(),saved)
        for field in try before.required("state").object("state") where field.key != "evaluationResults" {
            XCTAssertEqual(saved["state"]?[field.key],field.value)
        }
        for field in try source.object("source") where field.key != "evaluationResults" {
            XCTAssertEqual(restarted.exchange?.source[field.key],field.value)
        }
        XCTAssertEqual(saved["state"]?["xRaw"],.number("9007199254740993"))
        XCTAssertEqual(try saved.required("state").required("localModels").array("models")[0]["unknown"],.number("9007199254740993"))
        let records = try SyncRecords.toRecords(restarted.publicationSnapshot())
        let received = try SyncRecords.fromRecords(records)
        XCTAssertEqual(received["state"]?["evaluationResults"]?[prepared.key],evaluation)
        // Record JSON uses the existing Web Number conversion; local persistence above remains exact.
        XCTAssertEqual(received["state"]?["xRaw"],.number("9007199254740992"))
        XCTAssertEqual(try received.required("state").required("localModels").array("models")[0]["unknown"],.number("9007199254740992"))
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(received)),try SyncRecords.canonical(records))
    }
    func testSafeLocalResultSavesWithoutReadingRemoteCredential() async throws {
        let fixture = try fixture()
        let original = try fixture.app.publicationSnapshot()
        try await ConversationEvaluation.runAutoSafety(fixture.prepared,state:fixture.state,files:fixture.app.localModelFiles,client:client(),
            readProviderCredential:{ _ in XCTFail("Safe Hybrid must not read Keychain"); return nil },classifier:{ origin,files,text in
                XCTAssertEqual(origin,"fixture/trusted"); XCTAssertEqual(text,"日本語🙂")
                XCTAssertEqual(files.last?.data,Data([0,1,2])); return [("safe",0.99)]
            },isCurrent:{ true },onResult:{ try self.publish(fixture,$0,$1) })
        let after = try fixture.app.publicationSnapshot()
        XCTAssertEqual(after["state"]?["evaluationResults"]?[fixture.prepared.key]?["localSafety"]?["screening"],.string("safe"))
        XCTAssertNil(after["state"]?["evaluationResults"]?[fixture.prepared.key]?["safety"])
        XCTAssertEqual(after["state"]?["localModels"],original["state"]?["localModels"])
        XCTAssertEqual(after["state"]?["xRaw"],.number("9007199254740993"))
        for field in try fixture.source.object("source") where field.key != "evaluationResults" {
            XCTAssertEqual(fixture.app.exchange?.source[field.key],field.value)
        }
    }
    func testLocalFailureUsesSharedPolicyAndRemoteFallback() async throws {
        let fixture = try fixture(engine:"local")
        ModerationProtocol.fail = false; ModerationProtocol.requests = 0
        var reads = 0
        try await ConversationEvaluation.runAutoSafety(fixture.prepared,state:fixture.state,files:fixture.app.localModelFiles,client:client(),
            readProviderCredential:{ id in reads += 1; return self.credential(id) },classifier:{ _,_,_ in throw URLError(.cannotDecodeContentData) },
            isCurrent:{ true },onResult:{ try self.publish(fixture,$0,$1) })
        XCTAssertEqual(reads,1); XCTAssertEqual(ModerationProtocol.requests,1)
        let results = try fixture.app.publicationSnapshot()["state"]?["evaluationResults"]?[fixture.prepared.key]
        XCTAssertNotNil(results?["safety"]); XCTAssertNil(results?["localSafety"])
    }
    func testRemoteFailureRetainsAlreadySavedLocalResult() async throws {
        let fixture = try fixture(remoteOnSafe:true)
        ModerationProtocol.fail = true; defer { ModerationProtocol.fail = false }
        do {
            try await ConversationEvaluation.runAutoSafety(fixture.prepared,state:fixture.state,files:fixture.app.localModelFiles,client:client(),
                readProviderCredential:credential,classifier:{ _,_,_ in [("safe",0.99)] },isCurrent:{ true },onResult:{ try self.publish(fixture,$0,$1) })
            XCTFail("Remote error must remain visible")
        } catch {}
        XCTAssertEqual(try fixture.app.publicationSnapshot()["state"]?["evaluationResults"]?[fixture.prepared.key]?["localSafety"]?["screening"],.string("safe"))
    }
    func testCancelledAndStaleInferenceCannotFallbackOrSave() async throws {
        for mode in ["task", "stale", "revision"] {
            let fixture = try fixture()
            let before = try fixture.app.publicationSnapshot()
            var current = true
            let entered = expectation(description:"classifier entered")
            var release: CheckedContinuation<Void,Never>?
            let task = Task {
                try await ConversationEvaluation.runAutoSafety(fixture.prepared,state:fixture.state,files:fixture.app.localModelFiles,client:client(),
                    readProviderCredential:{ _ in XCTFail("Stale local must not fall back"); return nil },classifier:{ _,_,_ in
                        await withCheckedContinuation { release = $0; entered.fulfill() }
                        return [("safe",0.99)]
                    },isCurrent:{ current },onResult:{ _,_ in XCTFail("Late result must not save") })
            }
            await fulfillment(of:[entered],timeout:5)
            if mode == "task" { task.cancel() }
            else if mode == "stale" { current = false }
            else { try Data([3,4,5,6]).write(to:fixture.modelRoot.appendingPathComponent("onnx/model.onnx")) }
            release?.resume()
            switch await task.result {
            case .success: XCTFail("Cancelled/stale inference succeeded")
            case .failure(let error): XCTAssertTrue(error is CancellationError)
            }
            XCTAssertEqual(try fixture.app.publicationSnapshot(),before)
        }
    }
    func testSaveFailurePublishesNothingAndDoesNotStartRemote() async throws {
        let fixture = try fixture(remoteOnSafe:true)
        let before = try fixture.app.publicationSnapshot()
        fixture.fault.reject = true
        do {
            try await ConversationEvaluation.runAutoSafety(fixture.prepared,state:fixture.state,files:fixture.app.localModelFiles,client:client(),
                readProviderCredential:{ _ in XCTFail("Failed save must stop before remote"); return nil },classifier:{ _,_,_ in [("safe",0.99)] },
                isCurrent:{ true },onResult:{ try self.publish(fixture,$0,$1) })
            XCTFail("Failed save must throw")
        } catch {}
        XCTAssertEqual(try fixture.app.publicationSnapshot(),before)
    }
}
