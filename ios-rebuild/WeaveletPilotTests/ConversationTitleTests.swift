import XCTest
@testable import WeaveletPilot

private final class TitleResponseProtocol: URLProtocol {
    static var request: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.request = request
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(#"{"choices":[{"message":{"content":"  \"A Small Title\"  "}}]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
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
}
