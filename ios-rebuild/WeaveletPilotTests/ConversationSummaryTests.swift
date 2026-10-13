import XCTest
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
        XCTAssertNil(try ConversationSummary.apply(response,prepared:prepared,source:changed,state:state))
    }
}
