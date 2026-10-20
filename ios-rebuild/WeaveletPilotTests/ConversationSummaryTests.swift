import XCTest
import Combine
@testable import WeaveletPilot

private final class SummaryResponseProtocol: URLProtocol {
    static var request: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.request = request
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(#"{"choices":[{"message":{"content":"Useful summary"},"finish_reason":"stop"}]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class ConversationSummaryTests: XCTestCase {
    private let source = try! OrderedJSON.decode(Data(#"{"chats":[{"id":"chat","title":"Chat","config":{"model":"fake-model","max_tokens":100,"temperature":1,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"Explain weavelets in detail."}]},{"role":"assistant","content":[{"type":"text","text":"A weavelet is a small unit of a weave."}]}],"branchTree":{"rootId":"u","activePath":["u","a"],"nodes":{"u":{"id":"u","parentId":null,"role":"user","contentHash":"u","createdAt":1},"a":{"id":"a","parentId":"u","role":"assistant","contentHash":"a","createdAt":2}}}}]}"#.utf8))
    private let state = try! OrderedJSON.decode(Data(#"{"favoriteModels":[],"providers":{},"countTotalTokens":false}"#.utf8))
    private let legacy = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE")

    func testSummaryProxyKeepsSharedNonstreamingPlanAndResponse() async throws {
        var credentials = legacy
        credentials.proxy = RemoteProxySettings(enabled:true,endpoint:"https://fixture.invalid/relay",authToken:"FAKE-PROXY")
        let prepared = try XCTUnwrap(ConversationSummary.prepare(source:source,state:state,chatID:"chat",sourceNodeIDs:["u"],mode:"single",originNodeID:"u",summaryID:"proxy-summary",now:1000,legacy:credentials))
        let envelope = try OrderedJSON.decode(XCTUnwrap(prepared.request.httpBody))
        XCTAssertEqual(prepared.request.url?.path,"/relay/api/request")
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-PROXY")
        XCTAssertEqual(envelope["body"]?["stream"],.bool(false))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SummaryResponseProtocol.self]
        let response = try await ConversationSummary.generate(prepared,client:RemoteClient(session:URLSession(configuration:config)))
        XCTAssertEqual(response.text,"Useful summary")
        XCTAssertNotNil(try ConversationSummary.apply(response,prepared:prepared,source:source,state:state))
    }

    func testSummaryRequestSavesOnlyCurrentSourceAndUsesNonstreamingTransport() async throws {
        let prepared = try XCTUnwrap(ConversationSummary.prepare(source:source,state:state,chatID:"chat",sourceNodeIDs:["u"],mode:"single",originNodeID:"u",summaryID:"summary",now:1000,legacy:legacy))
        XCTAssertFalse(try RemoteRequest.streaming(prepared.request))
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SummaryResponseProtocol.self]
        let response = try await ConversationSummary.generate(prepared,client:RemoteClient(session:URLSession(configuration:config)))
        XCTAssertEqual(response.text,"Useful summary")
        XCTAssertEqual(response.finishReason,"stop")
        let updated = try XCTUnwrap(ConversationSummary.apply(response,prepared:prepared,source:source,state:state))
        let summaries = try updated.source.required("chats").array("chats")[0].required("summaries").array("summaries")
        XCTAssertEqual(summaries.first?["text"],.string("Useful summary"))
        XCTAssertEqual(summaries.first?["id"],.string("summary"))
        let chat = try source.required("chats").array("chats")[0]
        var messages = try chat.required("messages").array("messages")
        messages[0] = messages[0].replacing("content",with:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Changed"))])]))
        let changed = source.replacing("chats",with:.array([chat.replacing("messages",with:.array(messages))]))
        let staleState = state.replacing("countTotalTokens",with:.bool(true))
        let stale = try XCTUnwrap(ConversationSummary.apply(response,prepared:prepared,source:changed,state:staleState))
        XCTAssertNil(stale.summary)
        XCTAssertNotNil(stale.error)
        XCTAssertNotNil(stale.tokenUsage)
        XCTAssertNil(try stale.source.required("chats").array("chats")[0]["summaries"])
    }

    func testFlatMessageIDsMapToLegacySummaryPathOnlyWithoutBranchTree() throws {
        let raw = try source.required("chats").array("chats")[0]
        let flat = source.replacing("chats",with:.array([.object(try raw.object("chat").filter { $0.key != "branchTree" })]))
        let description = try XCTUnwrap(ConversationSummary.describe(source:flat,chatID:"chat",nodeID:"message-0"))
        XCTAssertEqual(try description.required("sourceNodeIds").array("IDs"),[.string("message-0")])
        XCTAssertEqual(try description.required("path").array("path")[0]["nodeId"],.string("message-0"))
        let targeted = try ConversationSummary.mutate(source:flat,chatID:"chat",action:"target",nodeID:"message-0")
        XCTAssertEqual(try targeted.required("chats").array("chats")[0]["summaryTargets"]?["0"],.bool(true))
        let prepared = try XCTUnwrap(ConversationSummary.prepare(source:flat,state:state,chatID:"chat",sourceNodeIDs:["message-0"],mode:"single",originNodeID:"message-0",summaryID:"summary",now:1000,legacy:legacy))
        XCTAssertEqual(try prepared.summary.required("sources").array("sources")[0]["nodeId"],.string("0"))
    }
    func testUsageAndOpaqueAttributesSurviveFlatApplyAndCounterOverflowIsRejected() throws {
        let raw = try source.required("chats").array("chats")[0]
        let opaque = OrderedJSON.number("9007199254740993")
        let flat = source.replacing("chats",with:.array([.object(try raw.object("chat").filter { $0.key != "branchTree" }).replacing("future",with:opaque)]))
        let prepared = try XCTUnwrap(ConversationSummary.prepare(source:flat,state:state,chatID:"chat",sourceNodeIDs:["message-0"],mode:"single",originNodeID:"message-0",summaryID:"summary",now:1000,legacy:legacy))
        let result = try XCTUnwrap(ConversationSummary.apply(("Short",nil),prepared:prepared,source:flat,state:state))
        XCTAssertNotNil(result.tokenUsage)
        XCTAssertEqual(try result.source.required("chats").array("chats")[0]["future"],opaque)
        XCTAssertEqual(try ConversationSummary.sourceDisplayIDs(XCTUnwrap(result.summary),source:result.source,chatID:"chat"),["message-0"])
        let unsafe = state.replacing("totalTokenUsed",with:.object([.init(key:"fake-model",value:.object([.init(key:"promptTokens",value:opaque),.init(key:"completionTokens",value:.number("0")),.init(key:"imageTokens",value:.number("0"))]))]))
        XCTAssertThrowsError(try ConversationSummary.apply(("Short",nil),prepared:prepared,source:flat,state:unsafe))
    }

    func testSettingsRootRemovalAndFailedMutationKeepPersistedData() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-summary-\(UUID().uuidString)")
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")) { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        }
        let app = ChatState(store:store)
        let chat = try source.required("chats").array("chats")[0]
        let flat = source.replacing("chats",with:.array([.object(try chat.object("chat").filter { $0.key != "branchTree" })]))
        try app.importWebData(flat.replacing("version",with:.number("3")).encoded())
        let snapshot = try app.publicationSnapshot(), roots = try snapshot.required("state")
        try app.applySnapshot(snapshot.replacing("state",with:roots.replacing("xSummary",with:.number("9007199254740993")).replacing("bubbleSummaryConfig",with:try source.required("chats").array("chats")[0].required("config"))))
        let config = try app.publicationSnapshot().required("state")["bubbleSummaryConfig"]
        try app.saveSummaryConfig(nil,expected:config)
        XCTAssertNil(try app.publicationSnapshot().required("state")["bubbleSummaryConfig"])
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        reject = true
        XCTAssertThrowsError(try app.mutateSummary(chatID:"chat",action:"target",nodeID:try XCTUnwrap(app.conversation?.visibleMessages.first?.id)))
        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertEqual(try before.required("state")["xSummary"],.number("9007199254740993"))
    }

    func testSavedVersionsUseSharedDescriptionAndPreserveSelectionOnFailedSave() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-summary-versions-\(UUID().uuidString)")
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        var reject = false
        let store = LocalStateStore(fileURL: directory.appendingPathComponent("state.json")) { bytes, url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to: url, options: .atomic)
        }
        let chat = try source.required("chats").array("chats")[0]
        var value = source.replacing("chats", with: .array([.object(try chat.object("chat").filter { $0.key != "branchTree" })]))
        for (index, id) in ["summary-é", "summary-e\u{0301}"].enumerated() {
            // Web replaces matching mode/source/format; different modes retain separate saved candidates.
            let prepared = try XCTUnwrap(ConversationSummary.prepare(source:value,state:state,chatID:"chat",sourceNodeIDs:["message-0"],mode:index == 0 ? "single" : "through",originNodeID:"message-0",summaryID:id,now:Double(index + 1),legacy:legacy))
            value = try XCTUnwrap(ConversationSummary.apply(("Saved version \(index + 1)",nil),prepared:prepared,source:value,state:state)).source
        }
        let rawChat = try value.required("chats").array("chats")[0]
        let rawSurrogate = try OrderedJSON.decode(Data(#""\ud800""#.utf8))
        let enriched = try rawChat.required("summaries").array("summaries").map { summary in
            let sources = try summary.required("sources").array("sources").map { $0.replacing("xRaw",with:rawSurrogate) }
            return summary.replacing("xFuture",with:.number("9007199254740993")).replacing("sources",with:.array(sources))
        }
        value = value.replacing("chats",with:.array([rawChat.replacing("summaries",with:.array(enriched))]))
        let app = ChatState(store: store)
        try app.importWebData(value.replacing("version",with:.number("3")).encoded())
        let info = try XCTUnwrap(app.summaryInfo(chatID:"chat",nodeID:"message-0"))
        XCTAssertEqual(info["anchor"], .string("message-0"))
        let versions = try info.required("savedVersions").array("versions")
        XCTAssertEqual(versions.map { $0["id"] }, [.string("summary-é"), .string("summary-e\u{0301}")])
        XCTAssertEqual(versions.map { $0["label"] }, [.string("1件 · Saved version 1"), .string("1件 · Saved version 2")])
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        reject = true
        XCTAssertThrowsError(try app.mutateSummary(chatID:"chat",action:"use",summaryID:"summary-é",use:true))
        XCTAssertEqual(try app.publicationSnapshot(), before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL), disk)
        XCTAssertEqual(try app.summaryInfo(chatID:"chat",nodeID:"message-0"), info)
        reject = false
        try app.mutateSummary(chatID:"chat",action:"use",summaryID:"summary-é",use:true)
        XCTAssertEqual(try app.summaryInfo(chatID:"chat",nodeID:"message-0")?["summary"]?["id"], .string("summary-é"))
        try app.mutateSummary(chatID:"chat",action:"use",summaryID:"summary-é",use:false)
        try app.mutateSummary(chatID:"chat",action:"use",summaryID:"summary-e\u{0301}",use:false)
        XCTAssertEqual(try app.summaryInfo(chatID:"chat",nodeID:"message-0")?["tab"], .string("original"))
        XCTAssertEqual(try app.summaryInfo(chatID:"chat",nodeID:"message-0")?["summary"]?["id"], .string("summary-e\u{0301}"))
        XCTAssertEqual(try ChatState(store:store).exportWebData(), try app.exportWebData())
        try app.ensureBranchTreeForEditor(chatID:"chat")
        let treeNodeID = try XCTUnwrap(app.conversation?.visibleMessages.first?.id)
        XCTAssertNotEqual(treeNodeID, "message-0")
        let converted = try XCTUnwrap(app.summaryInfo(chatID:"chat",nodeID:treeNodeID))
        XCTAssertEqual(try converted.required("savedVersions").array("versions"), versions)
        XCTAssertEqual(converted["anchor"], .string(treeNodeID))
        XCTAssertEqual(converted["summary"]?["xFuture"], .number("9007199254740993"))
        XCTAssertEqual(try converted["summary"]?.required("sources").array("sources")[0]["xRaw"], rawSurrogate)
        let receiver = ChatState()
        try receiver.importWebData(app.exportWebData())
        XCTAssertEqual(try receiver.summaryInfo(chatID:"chat",nodeID:treeNodeID)?["savedVersions"], converted["savedVersions"])
    }

    func testGeneratedSummaryAppliesAndRestartsThroughTheNativeStore() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("native-summary-job-\(UUID().uuidString)")
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json"))
        let app = ChatState(store:store)
        let raw = try source.required("chats").array("chats")[0]
        var messages = try raw.required("messages").array("messages")
        messages[0] = messages[0].replacing("content",with:.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string(String(repeating:"Long original source. ",count:80)))])]))
        let flat = source.replacing("chats",with:.array([.object(try raw.object("chat").filter { $0.key != "branchTree" }).replacing("messages",with:.array(messages))]))
        try app.importWebData(flat.replacing("version",with:.number("3")).encoded())
        let nodeID = try XCTUnwrap(app.conversation?.visibleMessages.first?.id)
        let draft = try app.summaryDraft(nodeID:nodeID)
        let completed = expectation(description:"summary stored")
        let subscription = app.$summaryJobs.dropFirst().sink { jobs in
            if let job = jobs.values.first, !job.busy { completed.fulfill() }
        }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SummaryResponseProtocol.self]
        try app.startSummary(draft,sourceNodeIDs:[nodeID],mode:"single",format:nil,record:legacy,client:RemoteClient(session:URLSession(configuration:config)))
        await fulfillment(of:[completed],timeout:5)
        withExtendedLifetime(subscription) {}
        XCTAssertNil(app.summaryJob(chatID:"chat",nodeID:nodeID)?.error)
        let info = try XCTUnwrap(app.summaryInfo(chatID:"chat",nodeID:nodeID))
        XCTAssertEqual(info["tab"],.string("summary"))
        XCTAssertEqual(info["summary"]?["useForSubmit"],.bool(true))
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
    }

}
