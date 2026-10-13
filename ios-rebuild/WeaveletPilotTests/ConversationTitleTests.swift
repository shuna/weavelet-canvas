import XCTest
import Combine
@testable import WeaveletPilot

private final class TitleResponseProtocol: URLProtocol {
    static var request: URLRequest?
    static var hold = false
    static var release: (() -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var captured = request
        captured.httpBody = RemoteRequest.fixtureBody(request)
        Self.request = captured
        let deliver = { [self] in
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(#"{"choices":[{"message":{"content":"  \"A Small Title\"  "}}]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
        }
        if Self.hold { Self.release = deliver } else { deliver() }
    }
    override func stopLoading() {}
}

@MainActor
final class ConversationTitleTests: XCTestCase {
    private let source = try! OrderedJSON.decode(Data(#"{"chats":[{"id":"first","title":"New Chat","titleSet":false,"config":{"model":"fake-model","max_tokens":100,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"What is a weavelet?"}]},{"role":"assistant","content":[{"type":"text","text":"A tiny weave."}]}]}]}"#.utf8))
    private let state = try! OrderedJSON.decode(Data(#"{"autoTitle":true,"favoriteModels":[],"providers":{},"countTotalTokens":false}"#.utf8))
    private let legacy = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE")

    func testNonstreamingTitleUsesSharedPlanAndIgnoresChangedPrompt() async throws {
        let prepared = try XCTUnwrap(ConversationTitle.prepare(source:source,state:state,chatID:"first",language:"English",legacy:legacy))
        XCTAssertFalse(try RemoteRequest.streaming(prepared.request))
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TitleResponseProtocol.self]
        let response = try await ConversationTitle.generate(prepared,client:RemoteClient(session:URLSession(configuration:config)))
        let updated = try XCTUnwrap(ConversationTitle.apply(response,prepared:prepared,source:source,state:state,language:"English",fallbackEndpoint:legacy.settings.endpoint))
        XCTAssertEqual(try updated.source.required("chats").array("chats")[0]["title"],.string("A Small Title"))
        XCTAssertEqual(try updated.source.required("chats").array("chats")[0]["titleSet"],.bool(true))
        XCTAssertNil(updated.tokenUsage)
        let chat = try source.required("chats").array("chats")[0]
        let changedMessages = try chat.required("messages").array("messages").map { message in
            message["role"] == .string("assistant") ? message.replacing("content",with:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("changed"))])])) : message
        }
        let changed = source.replacing("chats",with:.array([chat.replacing("messages",with:.array(changedMessages))]))
        XCTAssertNil(try ConversationTitle.apply(response,prepared:prepared,source:changed,state:state,language:"English",fallbackEndpoint:legacy.settings.endpoint))
    }

    func testChatIDsAndPromptSnapshotsUseExactUnicodeBytes() throws {
        let nfd = "cafe\u{301}", nfc = "café"
        let original = try source.required("chats").array("chats")[0]
        let other = original.replacing("id",with:.string(nfd)).replacing("title",with:.string("Other"))
        let targetMessages = try OrderedJSON.decode(Data(#"[{"role":"user","content":[{"type":"text","text":"Target"}]},{"role":"assistant","content":[{"type":"text","text":"Cafe\u0301"}]}]"#.utf8))
        let targetConfig = try original.required("config").replacing("future",with:.string(nfd))
        let target = original.replacing("id",with:.string(nfc)).replacing("messages",with:targetMessages).replacing("config",with:targetConfig)
        let both = source.replacing("chats",with:.array([other,target]))
        let prepared = try XCTUnwrap(ConversationTitle.prepare(source:both,state:state,chatID:nfc,language:"English",sourceConfig:targetConfig,legacy:legacy))
        let prompt = String(decoding:try prepared.promptMessage.encoded(),as:UTF8.self)
        XCTAssertTrue(prompt.contains("Target"))
        XCTAssertFalse(prompt.contains("What is a weavelet?"))
        let result = try XCTUnwrap(ConversationTitle.apply("A Small Title",prepared:prepared,source:both,state:state,language:"English",fallbackEndpoint:legacy.settings.endpoint))
        let chats = try result.source.required("chats").array("chats")
        XCTAssertEqual(chats[0]["title"],.string("Other"))
        XCTAssertEqual(chats[1]["title"],.string("A Small Title"))
        let changedMessages = try OrderedJSON.decode(Data(#"[{"role":"user","content":[{"type":"text","text":"Target"}]},{"role":"assistant","content":[{"type":"text","text":"Café"}]}]"#.utf8))
        let changed = both.replacing("chats",with:.array([other,target.replacing("messages",with:changedMessages)]))
        XCTAssertNil(try ConversationTitle.apply("A Small Title",prepared:prepared,source:changed,state:state,language:"English",fallbackEndpoint:legacy.settings.endpoint))
        let changedConfig = both.replacing("chats",with:.array([other,target.replacing("config",with:targetConfig.replacing("future",with:.string(nfc)))]))
        XCTAssertNil(try ConversationTitle.apply("A Small Title",prepared:prepared,source:changedConfig,state:state,language:"English",fallbackEndpoint:legacy.settings.endpoint))
    }
    func testAutomaticTitleAfterSavedGenerationPreservesSnapshotAndRestart() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-title-\(UUID().uuidString)")
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json")), app = ChatState(store:store)
        let rawChat = try source.required("chats").array("chats")[0]
        let chat = try rawChat.replacing("config",with:rawChat.required("config").replacing("stream",with:.bool(false)))
        try app.importWebData(source.replacing("version",with:.number("3")).replacing("chats",with:.array([chat])).encoded())
        let before = try app.publicationSnapshot()
        let oldUsage = OrderedJSON.object([.init(key:"untouched",value:.object([.init(key:"promptTokens",value:.number("9007199254740993")),.init(key:"xToken",value:.string("keep"))]))])
        let roots = try before.required("state").replacing("autoTitle",with:.bool(true)).replacing("titleModel",with:.string("fake-model")).replacing("countTotalTokens",with:.bool(true)).replacing("totalTokenUsed",with:oldUsage).replacing("xTitleRoot",with:.number("9007199254740993"))
        try app.applySnapshot(before.replacing("state",with:roots))
        let completed = expectation(description:"title saved after main response")
        let observer = app.$document.sink { document in
            if (try? document?.snapshot["state"]?.required("chats").array("chats"))?.first?["titleSet"] == .bool(true) { completed.fulfill() }
        }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [TitleResponseProtocol.self]
        let session = URLSession(configuration:config); defer { observer.cancel(); session.invalidateAndCancel() }
        try app.startGeneration(input:"FAKE next question",record:legacy,client:RemoteClient(session:session),nodeIDs:["old-user","old-assistant","next-user"])
        await fulfillment(of:[completed],timeout:5)
        let saved = try app.publicationSnapshot().required("state")
        XCTAssertEqual(saved["xTitleRoot"],.number("9007199254740993"))
        XCTAssertEqual(saved["totalTokenUsed"]?["untouched"],oldUsage["untouched"])
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
        XCTAssertTrue(try (saved["totalTokenUsed"]?["fake-model"]?["promptTokens"] ?? .number("0")).number("prompt") > 0)
        let sent = try OrderedJSON.decode(XCTUnwrap(TitleResponseProtocol.request?.httpBody))
        XCTAssertEqual(sent["stream"],.bool(false))
        XCTAssertTrue(String(decoding:try sent.required("messages").encoded(),as:UTF8.self).contains("Generate a title"))
    }
    func testRegenerateAndContinueDoNotStartAutomaticTitle() async throws {
        for operation in [MessageGenerationOperation.regenerate, .fromHere] {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-title-mode-\(UUID().uuidString)")
            let app = ChatState(store:LocalStateStore(fileURL:dir.appendingPathComponent("state.json")))
            let raw = try source.required("chats").array("chats")[0]
            let chat = try raw.replacing("config",with:raw.required("config").replacing("stream",with:.bool(false)))
            try app.importWebData(source.replacing("version",with:.number("3")).replacing("chats",with:.array([chat])).encoded())
            let snapshot = try app.publicationSnapshot()
            try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("autoTitle",with:.bool(true)).replacing("titleModel",with:.string("fake-model"))))
            let node = try XCTUnwrap(app.conversation?.visibleMessages.last?.id)
            let draft = try app.messageGenerationDraft(nodeID:node,operation:operation)
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [TitleResponseProtocol.self]
            let session = URLSession(configuration:config); defer { session.invalidateAndCancel() }
            try app.startGeneration(draft,record:legacy,client:RemoteClient(session:session),nodeIDs:["user","assistant","replacement"])
            let deadline = Date().addingTimeInterval(5)
            while app.generation != nil && Date() < deadline { try await Task.sleep(nanoseconds:10_000_000) }
            XCTAssertNil(app.generation); XCTAssertNil(app.generationError)
            XCTAssertEqual(try app.exchange!.source.required("chats").array("chats")[0]["titleSet"],.bool(false))
            XCTAssertFalse(String(decoding:try XCTUnwrap(TitleResponseProtocol.request?.httpBody),as:UTF8.self).contains("Generate a title"))
        }
    }

    func testImportCancelsInFlightTitleEvenWhenChatIDAndPromptMatch() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-title-cancel-\(UUID().uuidString)")
        let app = ChatState(store:LocalStateStore(fileURL:dir.appendingPathComponent("state.json")))
        let imported = source.replacing("version",with:.number("3"))
        try app.importWebData(imported.encoded())
        let snapshot = try app.publicationSnapshot()
        try app.applySnapshot(snapshot.replacing("state",with:snapshot.required("state").replacing("autoTitle",with:.bool(true)).replacing("titleModel",with:.string("fake-model"))))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [TitleResponseProtocol.self]
        let session = URLSession(configuration:config)
        TitleResponseProtocol.hold = true; TitleResponseProtocol.release = nil
        defer { TitleResponseProtocol.hold = false; TitleResponseProtocol.release = nil; session.invalidateAndCancel() }
        app.startAutomaticTitle(chatID:"first",legacy:legacy,client:RemoteClient(session:session))
        let deadline = Date().addingTimeInterval(5)
        while TitleResponseProtocol.release == nil && Date() < deadline { try await Task.sleep(nanoseconds:10_000_000) }
        XCTAssertNotNil(TitleResponseProtocol.release)
        let chat = try imported.required("chats").array("chats")[0].replacing("title",with:.string("Replacement"))
        try app.importWebData(imported.replacing("chats",with:.array([chat])).encoded())
        let saved = try app.publicationSnapshot()
        TitleResponseProtocol.release?()
        try await Task.sleep(nanoseconds:100_000_000)
        XCTAssertEqual(try app.publicationSnapshot(),saved)
        XCTAssertEqual(try app.exchange!.source.required("chats").array("chats")[0]["title"],.string("Replacement"))
    }

    func testTitleSaveFailureKeepsOriginalDataAndSettingsOnlyChangeThreeRoots() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-title-failure-\(UUID().uuidString)")
        let fault = TitleSaveFault(), store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json")) { bytes,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store)
        try app.importWebData(source.replacing("version",with:.number("3")).encoded())
        let original = try app.publicationSnapshot()
        try app.applySnapshot(original.replacing("state",with:original.required("state").replacing("autoTitle",with:.bool(true)).replacing("titleModel",with:.string("fake-model")).replacing("xTitleRoot",with:.number("9007199254740993"))))
        let snapshot = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        let prepared = try XCTUnwrap(ConversationTitle.prepare(source:app.exchange!.source,state:snapshot.required("state"),chatID:"first",language:"English",legacy:legacy))
        fault.reject = true
        XCTAssertThrowsError(try app.applyGeneratedTitle("Generated",prepared:prepared,language:"English",fallbackEndpoint:legacy.settings.endpoint))
        XCTAssertEqual(try app.publicationSnapshot(),snapshot); XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        fault.reject = false
        let withProvider = try app.publicationSnapshot()
        try app.applySnapshot(withProvider.replacing("state",with:withProvider.required("state").replacing("titleProviderId",with:.string("openai"))))
        let draft = try app.titleSettingsDraft()
        try app.saveTitleSettings(draft,value:.object([.init(key:"autoTitle",value:.bool(false)),.init(key:"titleModel",value:.string("changed-model"))]))
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["xTitleRoot"],.number("9007199254740993"))
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["chats"],snapshot["state"]?["chats"])
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["titleModel"],.string("changed-model"))
        XCTAssertNil(try app.publicationSnapshot()["state"]?["titleProviderId"])
    }

}

private final class TitleSaveFault { var reject = false }
