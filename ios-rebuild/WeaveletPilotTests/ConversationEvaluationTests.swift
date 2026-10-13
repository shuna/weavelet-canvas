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

private final class AutoEvaluationProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var generationDelay = 0.0
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var captured = request
        captured.httpBody = RemoteRequest.fixtureBody(request)
        Self.requests.append(captured)
        let streaming = (try? OrderedJSON.decode(captured.httpBody ?? Data()))?["stream"] == .bool(true)
        let response = streaming
            ? Data("data: {\"choices\":[{\"delta\":{\"content\":\"Answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".utf8)
            : Data(#"{"choices":[{"message":{"content":"{\"scores\":{\"taskCompletion\":0.8}}"}}]}"#.utf8)
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,
            headerFields:["Content-Type":streaming ? "text/event-stream" : "application/json"])!,cacheStoragePolicy:.notAllowed)
        let delay = streaming ? Self.generationDelay : 0.1
        if delay == 0 {
            client?.urlProtocol(self,didLoad:response)
            client?.urlProtocolDidFinishLoading(self)
        } else {
            DispatchQueue.main.asyncAfter(deadline:.now() + delay) { [self] in
                client?.urlProtocol(self,didLoad:response)
                client?.urlProtocolDidFinishLoading(self)
            }
        }
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
    private func request(_ prepared: ConversationEvaluation.Prepared) throws -> URLRequest {
        guard case .remote(let request) = prepared.execution else { throw ExchangeError.invalid("Expected remote evaluation") }
        return request
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

    func testAutoPlanAndPreSendGuardUseSharedRules() throws {
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let settings = defaults.replacing("safetyPreSend",with:.string("auto")).replacing("qualityPreSend",with:.string("auto"))
        let content = try json(#"[{"type":"text","text":"first"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}},{"type":"text","text":"second"}]"#)
        let plan = try ConversationEvaluation.autoPlan(userContent:content,phase:"pre-send",settings:settings)
        XCTAssertEqual(plan["userText"],.string("first\nsecond"))
        XCTAssertEqual(plan["safetyText"],.string("first\nsecond"))
        XCTAssertEqual(plan["shouldSafety"],.bool(true))
        XCTAssertEqual(plan["shouldQuality"],.bool(true))
        let chat = try source().required("chats").array("chats")[0]
        XCTAssertThrowsError(try ConversationEvaluation.enforcePreSendSafety(settings:settings,chat:chat))
        let local = settings.replacing("safetyEngine",with:.string("local"))
        XCTAssertNoThrow(try ConversationEvaluation.enforcePreSendSafety(settings:local,chat:chat))
        let imageOnly = try json(#"[{"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}}]"#)
        XCTAssertEqual(try ConversationEvaluation.autoPlan(userContent:imageOnly,phase:"pre-send",settings:settings)["shouldSafety"],.bool(false))
        XCTAssertThrowsError(try ConversationEvaluation.enforcePreSendSafety(settings:settings,chat:chat))
        XCTAssertNoThrow(try ConversationEvaluation.enforcePreSendSafety(settings:local,chat:chat))
    }

    func testAutoPreReceiveKeepsReservedTargetAndRejectsChangedUserOrConfig() throws {
        let source = try source()
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("qualityPreSend",with:.string("auto")))
            .replacing("evaluationResults",with:try json(#"{"chat:assistant:pre-send":{"phase":"pre-send","safety":{"xLarge":9007199254740993},"safetyContext":{"scope":"full-context"},"qualityContext":{"scope":"single"},"localSafety":{"screening":"safe"},"xFuture":1.234567890123456789},"chat:assistant:post-receive":{"phase":"post-receive","untouched":true}}"#))
        let content = try json(#"[{"type":"text","text":"質問"}]"#)
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source,state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:content,legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:read))
        XCTAssertNotNil(prepared.quality)
        XCTAssertTrue(try ConversationEvaluation.autoIsCurrent(prepared,source:source,state:state))
        let result = try json(#"{"kind":"quality","scores":{"taskCompletion":0.7},"future":9007199254740993}"#)
        let updated = try ConversationEvaluation.autoApply(result,dimension:"quality",prepared:prepared,source:source,state:state)
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["quality"]?["future"],.number("9007199254740993"))
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["safety"]?["xLarge"],.number("9007199254740993"))
        XCTAssertNil(updated["evaluationResults"]?[prepared.key]?["qualityContext"])
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["safetyContext"]?["scope"],.string("full-context"))
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["xFuture"],.number("1.234567890123456789"))
        let local = try json(#"{"screening":"warn","raw":9007199254740993}"#)
        let withLocal = try ConversationEvaluation.autoApply(local,dimension:"localSafety",prepared:prepared,source:source,state:updated)
        XCTAssertEqual(withLocal["evaluationResults"]?[prepared.key]?["localSafety"]?["raw"],.number("9007199254740993"))
        XCTAssertEqual(withLocal["evaluationResults"]?[prepared.key]?["quality"]?["future"],.number("9007199254740993"))
        XCTAssertEqual(updated["evaluationResults"]?["chat:assistant:post-receive"]?["untouched"],.bool(true))
        let modifiedStore = try source.required("contentStore").replacing("u",with:.object([.init(key:"content",value:try json(#"[{"type":"text","text":"changed"}]"#)),.init(key:"refCount",value:.number("1"))]))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:source.replacing("contentStore",with:modifiedStore),state:state))
        let changedChat = try source.required("chats").array("chats")[0].replacing("config",with:.object([.init(key:"model",value:.string("changed"))]))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:source.replacing("chats",with:.array([changedChat])),state:state))
        let omittedChat = try source.required("chats").array("chats")[0].replacing("omittedNodes",with:try json(#"{"user":true}"#))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:source.replacing("chats",with:.array([omittedChat])),state:state))
    }

    func testAutoTracksEveryTransmittedPathNodeIncludingEarlierMergedUser() throws {
        let source = try json(#"{"chats":[{"id":"chat","config":{"model":"fake-model"},"branchTree":{"activePath":["first","last","assistant"],"nodes":{"first":{"id":"first","parentId":null,"role":"user","contentHash":"f"},"last":{"id":"last","parentId":"first","role":"user","contentHash":"l"},"assistant":{"id":"assistant","parentId":"last","role":"assistant","contentHash":"a"}}},"omittedNodes":{}}],"contentStore":{"f":{"content":[{"type":"text","text":"first","xFuture":9007199254740993}],"refCount":1},"l":{"content":[{"type":"text","text":"last"}],"refCount":1},"a":{"content":[],"refCount":1}}}"#)
        let path = ["first","last"]
        let request = try RemoteRequest.make(source:source,chatID:"chat",path:path,
            settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:false),key:"FAKE")
        let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody))
        let sent = try XCTUnwrap(ConversationEvaluation.transmittedUserContent(body.required("messages")))
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("qualityPreSend",with:.string("auto")))
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source,state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:sent,requestPath:path,legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:read))
        XCTAssertTrue(try ConversationEvaluation.autoIsCurrent(prepared,source:source,state:state))
        let changedFirst = source.replacing("contentStore",with:try source.required("contentStore").replacing("f",with:json(#"{"content":[{"type":"text","text":"changed"}],"refCount":1}"#)))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:changedFirst,state:state))
        let changedNumber = source.replacing("contentStore",with:try source.required("contentStore").replacing("f",with:json(#"{"content":[{"type":"text","text":"first","xFuture":9007199254740994}],"refCount":1}"#)))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:changedNumber,state:state))
        let chat = try source.required("chats").array("chats")[0]
        let omitted = source.replacing("chats",with:.array([chat.replacing("omittedNodes",with:try json(#"{"last":true}"#))]))
        let omittedRequest = try RemoteRequest.make(source:omitted,chatID:"chat",path:path,
            settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:false),key:"FAKE")
        let omittedBody = try OrderedJSON.decode(XCTUnwrap(omittedRequest.httpBody))
        let omittedSent = try XCTUnwrap(ConversationEvaluation.transmittedUserContent(omittedBody.required("messages")))
        XCTAssertEqual(try ConversationEvaluation.autoPlan(userContent:omittedSent,phase:"pre-send",settings:state.required("evaluationSettings"))["userText"],.string("first"))
        let omittedPrepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:omitted,state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:omittedSent,requestPath:path,legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:read))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(omittedPrepared,source:omitted.replacing("contentStore",with:try omitted.required("contentStore").replacing("f",with:json(#"{"content":[{"type":"text","text":"changed"}],"refCount":1}"#))),state:state))
    }

    func testAutoDimensionPreparationFailuresDoNotSuppressOtherDimension() async throws {
        let source = try source()
        let chat = try source.required("chats").array("chats")[0]
        let safeSource = source.replacing("chats",with:.array([chat.replacing("config",with:try json(#"{"model":"fake-model","providerId":"openrouter"}"#))]))
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("safetyPreSend",with:.string("auto")).replacing("qualityPreSend",with:.string("auto")))
        let user = try json(#"[{"type":"text","text":"質問"}]"#)
        let safetyFails = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:safeSource,state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:user,legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:{ id in id == "openai" ? nil : self.read(id) }))
        XCTAssertNil(safetyFails.safety)
        XCTAssertNotNil(safetyFails.safetyError)
        let preparedQuality = try XCTUnwrap(safetyFails.quality)
        EvaluationProtocol.reply = Data(#"{"choices":[{"message":{"content":"{\"scores\":{\"taskCompletion\":0.8}}"}}]}"#.utf8)
        let quality = try await ConversationEvaluation.run(preparedQuality,client:client())
        XCTAssertEqual(quality["scores"]?["taskCompletion"],.number("0.8"))
        let qualitySaved = try ConversationEvaluation.autoApply(quality,dimension:"quality",prepared:safetyFails,source:safeSource,state:state)
        XCTAssertNotNil(qualitySaved["evaluationResults"]?[safetyFails.key]?["quality"])
        let qualityFails = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:safeSource,state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:user,legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:{ id in id == "openrouter" ? nil : self.read(id) }))
        let preparedSafety = try XCTUnwrap(qualityFails.safety)
        XCTAssertNil(qualityFails.quality)
        XCTAssertNotNil(qualityFails.qualityError)
        EvaluationProtocol.reply = Data(#"{"results":[{"flagged":false,"categories":{"violence":false},"category_scores":{"violence":0.12}}]}"#.utf8)
        let safety = try await ConversationEvaluation.run(preparedSafety,client:client())
        XCTAssertEqual(safety["flagged"],.bool(false))
        let safetySaved = try ConversationEvaluation.autoApply(safety,dimension:"safety",prepared:qualityFails,source:safeSource,state:state)
        XCTAssertNotNil(safetySaved["evaluationResults"]?[qualityFails.key]?["safety"])
    }

    func testAutomaticPreQualityRunsBesideGenerationAndPersistsOnReservedNode() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-auto-eval-\(UUID().uuidString)")
        let app = ChatState(store:LocalStateStore(fileURL:directory.appendingPathComponent("state.json")))
        try app.importWebData(json(#"{"version":3,"chats":[{"id":"auto-chat","title":"Auto","config":{"model":"fake-model","max_tokens":100,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"Previous"}]}]}]}"#).encoded())
        try app.saveEvaluationSetting("qualityPreSend",value:.string("auto"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AutoEvaluationProtocol.self]
        let client = RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE")
        AutoEvaluationProtocol.requests = []
        AutoEvaluationProtocol.generationDelay = 0
        try app.startGeneration(input:"Question",record:credential,client:client)
        let completed = expectation(description:"generation and automatic quality persisted")
        let subscription = app.$document.compactMap { $0?.snapshot["state"]?["evaluationResults"] }.sink { results in
            if (try? results.object("results"))?.contains(where: { $0.key.text.hasSuffix(":pre-send") && $0.value["quality"] != nil }) == true { completed.fulfill() }
        }
        await fulfillment(of:[completed],timeout:5)
        withExtendedLifetime(subscription) {}
        let nodes = app.conversation!.visibleMessages
        XCTAssertEqual(nodes.last?.role,"assistant")
        let target = try XCTUnwrap(nodes.last?.id)
        let resultKey = try XCTUnwrap(ConversationEvaluation.resultKey(source:app.exchange!.source,chatID:"auto-chat",nodeID:target))
        let preKey = resultKey.replacingOccurrences(of:":post-receive",with:":pre-send")
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["evaluationResults"]?[preKey]?["quality"]?["scores"]?["taskCompletion"],.number("0.8"))
        XCTAssertNil(app.automaticEvaluationError)
        XCTAssertEqual(AutoEvaluationProtocol.requests.count,2)
    }

    func testStoppingGenerationCancelsPendingAutomaticEvaluation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-auto-stop-\(UUID().uuidString)")
        let app = ChatState(store:LocalStateStore(fileURL:directory.appendingPathComponent("state.json")))
        try app.importWebData(json(#"{"version":3,"chats":[{"id":"auto-chat","title":"Auto","config":{"model":"fake-model","max_tokens":100,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"Previous"}]}]}]}"#).encoded())
        try app.saveEvaluationSetting("qualityPreSend",value:.string("auto"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AutoEvaluationProtocol.self]
        let client = RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
        AutoEvaluationProtocol.requests = []
        AutoEvaluationProtocol.generationDelay = 0.2
        defer { AutoEvaluationProtocol.generationDelay = 0 }
        try app.startGeneration(input:"Question",record:RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE"),client:client)
        app.stopGeneration()
        try await Task.sleep(for:.milliseconds(300))
        XCTAssertNil(app.generation)
        let results = try app.publicationSnapshot()["state"]?["evaluationResults"]
        XCTAssertTrue((try results?.object("results"))?.isEmpty ?? true)
    }

    func testAutomaticEvaluationDoesNotOverwriteStateAfterGenerationSaveFailure() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-auto-save-\(UUID().uuidString)")
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")) { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store)
        try app.importWebData(json(#"{"version":3,"chats":[{"id":"auto-chat","title":"Auto","config":{"model":"fake-model","max_tokens":100,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"Previous"}]}]}]}"#).encoded())
        try app.saveEvaluationSetting("qualityPreSend",value:.string("auto"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AutoEvaluationProtocol.self]
        let client = RemoteClient(session:URLSession(configuration:configuration,delegate:RemoteRedirectPolicy(),delegateQueue:nil))
        AutoEvaluationProtocol.generationDelay = 0.2
        defer { AutoEvaluationProtocol.generationDelay = 0 }
        try app.startGeneration(input:"Question",record:RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE"),client:client)
        let before = try Data(contentsOf:store.fileURL)
        reject = true
        let failedSave = expectation(description:"generation save failed")
        let subscription = app.$generation.dropFirst().filter { $0?.running == false }.first().sink { _ in failedSave.fulfill() }
        await fulfillment(of:[failedSave],timeout:5)
        withExtendedLifetime(subscription) {}
        XCTAssertNotNil(app.generation)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),before)
        XCTAssertTrue((try app.publicationSnapshot()["state"]?["evaluationResults"]?.object("results"))?.isEmpty ?? true)
        reject = false
        try app.saveGenerationResult()
        XCTAssertNil(app.generation)
    }

    func testAutoLocalSafetyDefersRemotePreparation() throws {
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("safetyPreSend",with:.string("auto"))
            .replacing("safetyEngine",with:.string("local")))
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source(),state:state,chatID:"chat",nodeID:"assistant",
            phase:"pre-send",userContent:json(#"[{"type":"text","text":"質問"}]"#),legacy:RemoteCredentialRecord(),files:nil,
            readProviderCredential:{ _ in XCTFail("Local safety must not read remote credential"); return nil }))
        XCTAssertEqual(prepared.localSafetyText,"質問")
        XCTAssertNil(prepared.safety)
        XCTAssertNil(prepared.quality)
    }

    func testAutoRemoteSafetyUsesDedicatedOpenAICredentialWithoutOpenRouterSettings() async throws {
        let source = try source()
        let chat = try source.required("chats").array("chats")[0]
        let safeSource = source.replacing("chats",with:.array([chat.replacing("config",with:try json(#"{"model":"fake-model","providerId":"openrouter"}"#))]))
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("safetyPostReceive",with:.string("auto")))
            .replacing("evaluationResults",with:try json(#"{"chat:assistant:post-receive":{"phase":"post-receive","safetyContext":{"scope":"single"},"future":9007199254740993}}"#))
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:safeSource,state:state,chatID:"chat",nodeID:"assistant",
            phase:"post-receive",userContent:json(#"[{"type":"text","text":"質問"}]"#),
            assistantContent:json(#"[{"type":"text","text":"回答"}]"#),legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:read))
        let safety = try XCTUnwrap(prepared.safety)
        XCTAssertEqual(try request(safety).url?.absoluteString,"https://api.openai.com/v1/moderations")
        XCTAssertEqual(try request(safety).value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-openai")
        XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(request(safety).httpBody))["input"],.string("回答"))
        EvaluationProtocol.reply = Data(#"{"results":[{"flagged":true,"categories":{"violence":true},"category_scores":{"violence":0.1234567890123456789}}]}"#.utf8)
        let result = try await ConversationEvaluation.run(safety,client:client())
        XCTAssertEqual(result["categoryScores"]?["violence"],.number("0.1234567890123456789"))
        let updated = try ConversationEvaluation.autoApply(result,dimension:"safety",prepared:prepared,source:safeSource,state:state)
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["safety"]?["categoryScores"]?["violence"],.number("0.1234567890123456789"))
        XCTAssertNil(updated["evaluationResults"]?[prepared.key]?["safetyContext"])
        XCTAssertEqual(updated["evaluationResults"]?[prepared.key]?["future"],.number("9007199254740993"))
    }

    func testAutoPostUsesFinalAssistantAndRejectsChangedAssistant() throws {
        let defaults = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("defaults"))])).required("evaluationSettings")
        let state = try state().replacing("evaluationSettings",with:defaults.replacing("qualityPostReceive",with:.string("auto")))
        let assistant = try json(#"[{"type":"text","text":"回答"}]"#)
        let prepared = try XCTUnwrap(ConversationEvaluation.prepareAuto(source:source(),state:state,chatID:"chat",nodeID:"assistant",
            phase:"post-receive",userContent:json(#"[{"type":"text","text":"質問"}]"#),assistantContent:assistant,
            legacy:RemoteCredentialRecord(),files:nil,readProviderCredential:read))
        XCTAssertEqual(prepared.quality?.context["assistantText"],.string("回答"))
        XCTAssertTrue(try ConversationEvaluation.autoIsCurrent(prepared,source:source(),state:state))
        let store = try source().required("contentStore").replacing("a",with:.object([.init(key:"content",value:json(#"[{"type":"text","text":"changed"}]"#)),.init(key:"refCount",value:.number("1"))]))
        XCTAssertFalse(try ConversationEvaluation.autoIsCurrent(prepared,source:source().replacing("contentStore",with:store),state:state))
    }

    func testQualityUsesSharedJudgeRequestAndPreservesOtherResultAndUnsafeNumbers() async throws {
        let source = try source(), state = try state(), before = try state.encoded()
        let prepared = try ConversationEvaluation.prepare(source:source,state:state,chatID:"chat",nodeID:"assistant",
            dimension:"quality",legacy:RemoteCredentialRecord(),readProviderCredential:read)
        XCTAssertEqual(prepared.key,"chat:assistant:post-receive")
        XCTAssertEqual(try request(prepared).url?.host,"openrouter.ai")
        XCTAssertEqual(try request(prepared).value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-openrouter")
        let body = try OrderedJSON.decode(XCTUnwrap(try request(prepared).httpBody))
        XCTAssertEqual(body["provider"]?["only"],.array([.string("provider-a")]))
        XCTAssertEqual(body["provider"]?["max_price"]?["xFuture"],.number("9007199254740993"))
        XCTAssertNil(try request(prepared).value(forHTTPHeaderField:"X-OpenRouter-Cache"))
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
        XCTAssertEqual(try request(prepared).url?.absoluteString,"https://api.openai.com/v1/moderations")
        XCTAssertEqual(try request(prepared).value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-openai")
        XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(try request(prepared).httpBody)).required("input"),.string("回答"))
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

    func testLocalAnalysisUsesInstalledGGUFWithoutReadingRemoteCredentialsAndPersistsProgress() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-local-eval-store-\(UUID().uuidString)")
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json"))
        let generator: LocalLlama.Generator = { _, _, onText in _ = try await onText("good") }
        let app = ChatState(store:store,localGenerate:generator)
        try app.importWebData(json(#"{"version":3,"chats":[{"id":"local-chat","title":"Local","config":{"model":"fake-model"},"messages":[{"role":"user","content":[{"type":"text","text":"Prompt"}]}]}]}"#).encoded())
        let snapshot = try app.publicationSnapshot(), roots = try snapshot.required("state")
        let models = try json(#"[{"id":"analysis-model","engine":"wllama","tasks":["analysis"],"manifest":{"kind":"single-file"},"xFuture":9007199254740993}]"#)
        try app.applySnapshot(snapshot.replacing("state",with:roots.replacing("localModelEnabled",with:.bool(true)).replacing("activeLocalModels",with:.object([.init(key:"analysis",value:.string("analysis-model"))])).replacing("localModels",with:models)))
        try FileManager.default.createDirectory(at:app.localModelFiles.directory,withIntermediateDirectories:true)
        try Data("GGUF".utf8).write(to:app.localModelFiles.url(modelID:"analysis-model"))
        let nodeID = try XCTUnwrap(app.conversation?.visibleMessages.first?.id)
        func noRemoteCredential() throws -> RemoteCredentialRecord { throw ExchangeError.invalid("Must not read remote credentials") }
        let prepared = try ConversationEvaluation.prepare(source:XCTUnwrap(app.exchange?.source),state:app.publicationSnapshot().required("state"),chatID:"local-chat",nodeID:nodeID,dimension:"quality",legacy:noRemoteCredential(),files:app.localModelFiles,readProviderCredential:{ _ in throw ExchangeError.invalid("Must not read provider credentials") })
        guard case .local = prepared.execution else { return XCTFail("Expected local execution") }
        let completed = expectation(description:"local evaluation saved")
        let subscription = app.$evaluationJobs.dropFirst().filter { $0.values.first?.busy == false }.first().sink { _ in completed.fulfill() }
        try app.startEvaluation(app.evaluationDraft(nodeID:nodeID),dimension:"quality",scope:"single",omittedMode:"respect-omitted",readProviderCredential:{ _ in throw ExchangeError.invalid("Must not read provider credentials") })
        await fulfillment(of:[completed],timeout:5)
        withExtendedLifetime(subscription) {}
        let job = try XCTUnwrap(app.evaluationJobs[.init(chatID:"local-chat",nodeID:nodeID)])
        XCTAssertNil(job.error)
        XCTAssertEqual(try job.progress.object("progress").count,5)
        XCTAssertTrue(try job.progress.object("progress").allSatisfy { $0.value == .string("done") })
        let result = try app.evaluationResult(chatID:"local-chat",nodeID:nodeID)
        XCTAssertEqual(result?["quality"]?["source"],.string("local"))
        XCTAssertEqual(result?["quality"]?["scores"]?["taskCompletion"],.number("0.65"))
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["localModels"],models)
    }

}
