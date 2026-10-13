import XCTest
@testable import WeaveletPilot

private final class UsageLiveProtocol: URLProtocol {
    static var release: (() -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"text/event-stream"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data("data: {\"choices\":[{\"delta\":{\"content\":\"Live\"}}]}\n\n".utf8))
        Self.release = { [self] in client?.urlProtocol(self,didLoad:Data("data: [DONE]\n\n".utf8)); client?.urlProtocolDidFinishLoading(self) }
    }
    override func stopLoading() {}
}

@MainActor
final class UsageSettingsTests: XCTestCase {
    private func app(writer: ((Data, URL) throws -> Void)? = nil) throws -> (ChatState, LocalStateStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("usage-settings-\(UUID().uuidString)")
        let file = directory.appendingPathComponent("state.json")
        let store = writer.map { LocalStateStore(fileURL:file,write:$0) } ?? LocalStateStore(fileURL:file)
        let app = ChatState(store:store)
        let data = Data(#"{"version":3,"chats":[{"id":"usage","title":"Saved","config":{"model":"fake","providerId":"openai","max_tokens":100,"stream":true},"messages":[{"role":"user","content":[{"type":"text","text":"Hello"}]}]}],"xRoot":9007199254740993}"#.utf8)
        try app.importWebData(data)
        let snapshot = try app.publicationSnapshot()
        let catalog = try OrderedJSON.decode(Data(#"[{"modelId":"fake","providerId":"openai","promptPrice":2,"completionPrice":4,"imagePrice":0}]"#.utf8))
        let totals = try OrderedJSON.decode(Data(#"{"fake:::openai":{"promptTokens":1000000,"completionTokens":500000,"imageTokens":0,"future":9007199254740993}}"#.utf8))
        let roots = try snapshot.required("state").replacing("favoriteModels",with:catalog).replacing("totalTokenUsed",with:totals).replacing("xUsageRoot",with:.number("9007199254740993"))
        try app.applySnapshot(snapshot.replacing("state",with:roots))
        addTeardownBlock { try? FileManager.default.removeItem(at:directory) }
        return (app,store)
    }

    func testToggleAndResetPreserveOtherDataAndRestart() throws {
        let (app,store) = try app()
        let original = try app.publicationSnapshot()
        try app.saveUsageCounting(true)
        XCTAssertTrue(app.usageCountingEnabled)
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"],original["state"]?["totalTokenUsed"])
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["chats"],original["state"]?["chats"])
        let report = try app.usageCostReport()
        XCTAssertEqual(report["total"]?["display"],.string("4.00"))
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["xUsageRoot"],.number("9007199254740993"))
        try app.resetUsageTotals()
        XCTAssertTrue(app.usageCountingEnabled)
        XCTAssertEqual(try app.publicationSnapshot()["state"]?["totalTokenUsed"],.object([]))
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
    }

    func testSettingsSaveFailureDoesNotChangeMemoryOrDisk() throws {
        var reject = false
        let (app,store) = try app { bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let original = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        reject = true
        XCTAssertThrowsError(try app.saveUsageCounting(true))
        XCTAssertThrowsError(try app.resetUsageTotals())
        XCTAssertEqual(try app.publicationSnapshot(),original)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
    }

    func testLiveReportDoesNotPersistAndSettingsPreserveGeneration() async throws {
        let (app,store) = try app()
        try app.saveUsageCounting(true)
        let snapshot = try app.publicationSnapshot(), roots = try snapshot.required("state")
        let providers = try roots["providers"] ?? ChatImport.call("defaults").required("providers")
        let openai = try providers.required("openai").replacing("endpoint",with:.string("https://fixture.invalid/v1/chat/completions"))
        try app.applySnapshot(snapshot.replacing("state",with:roots.replacing("providers",with:providers.replacing("openai",with:openai))))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [UsageLiveProtocol.self]
        let session = URLSession(configuration:config)
        defer { app.stopGeneration(); UsageLiveProtocol.release = nil; session.invalidateAndCancel() }
        let credential = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake",stream:true),key:"FAKE")
        try app.startGeneration(input:"Question",record:credential,client:RemoteClient(session:session),readProviderCredential:{ _ in credential })
        let deadline = Date().addingTimeInterval(5)
        while app.generation?.output.text != "Live" && Date() < deadline { try await Task.sleep(nanoseconds:10_000_000) }
        XCTAssertEqual(app.generation?.output.text,"Live")
        let id = try XCTUnwrap(app.generation?.id)
        let baseline = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        let report = try app.usageCostReport()
        XCTAssertGreaterThan(try report.required("total").required("cost").number("cost"),4)
        XCTAssertEqual(try app.publicationSnapshot(),baseline)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        try app.saveUsageCounting(false)
        XCTAssertEqual(app.generation?.id,id); XCTAssertEqual(app.generation?.output.text,"Live")
        try app.resetUsageTotals()
        XCTAssertEqual(app.generation?.id,id)
        XCTAssertEqual(app.generation?.baseSource,app.exchange?.source)
    }
}
