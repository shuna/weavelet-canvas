import XCTest
@testable import WeaveletPilot

final class ChatExportTests: XCTestCase {
    private func input() throws -> OrderedJSON {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/message-editing.json")))
        return try fixture.required("cases").array("cases")[0].required("input")
    }
    private func store() throws -> LocalStateStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("export-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        return LocalStateStore(fileURL:root.appendingPathComponent("local.json"))
    }
    func testAllV3GzipKeepsRawBytesAndImportsThroughAtomicSaveRestart() throws {
        let future = OrderedJSON.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300")),.init(key:"word",value:.string("e\u{301} 日本語🌿"))])
        let source = try input().replacing("xFuture",with:future).replacing("20",with:future).replacing("3",with:.string("raw root order"))
        let local = try store(), state = ChatState(store:local); try state.importWebData(source.encoded())
        let raw = try state.exportWebData(), snapshot = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        let artifact = try state.exportWebData(format:.v3,scope:.all,compressed:true)
        XCTAssertTrue(NativeGzip.isCompressed(artifact.data)); XCTAssertEqual(artifact.contentType,.gzip)
        XCTAssertEqual(try NativeGzip.decompress(artifact.data),raw)
        let importedStore = try store(), imported = ChatState(store:importedStore)
        try imported.importWebData(artifact.data)
        XCTAssertEqual(try imported.exportWebData(),raw)
        let restarted = ChatState(store:importedStore)
        XCTAssertEqual(try restarted.exportWebData(),raw)
        XCTAssertEqual(try OrderedJSON.decode(restarted.exportWebData()).required("xFuture").encoded(),try future.encoded())
        XCTAssertEqual(try state.publicationSnapshot(),snapshot); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
    }
    func testSharedScopedFormatsUseVisiblePathModelImageAndRawEvaluationValues() throws {
        var source = try input(), chats = try source.required("chats").array("chats")
        chats[0] = chats[0].replacing("folder",with:.string("folder-a")); source = source.replacing("chats",with:.array(chats))
        let evaluation = OrderedJSON.object([.init(key:"phase",value:.string("pre-send")),.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300"))])
        source = source.replacing("evaluationResults",with:.object([.init(key:"target:test",value:evaluation),.init(key:"other:test",value:evaluation)]))
        let state = ChatState(store:try store()); try state.importWebData(source.encoded())
        let markdown = try state.exportWebData(format:.markdown,scope:.chat)
        let text = String(decoding:markdown.data,as:UTF8.self)
        XCTAssertTrue(text.contains("Original")); XCTAssertTrue(text.contains("https://example.invalid/a.png"))
        XCTAssertFalse(text.contains("Reason")); XCTAssertFalse(text.contains("Result"))
        let all = try OrderedJSON.decode(state.exportWebData(format:.v1,scope:.all).data)
        XCTAssertEqual(all["version"],.number("1")); XCTAssertNil(try all.required("chats").array("chats")[0]["branchTree"])
        let single = try OrderedJSON.decode(state.exportWebData(format:.v3,scope:.chat).data)
        XCTAssertEqual(try single.required("chats").array("chats").count,1); XCTAssertNil(try single.required("chats").array("chats")[0]["folder"])
        XCTAssertEqual(single["folders"],.object([]))
        XCTAssertEqual(try single.required("evaluationResults").required("target:test").encoded(),try evaluation.encoded()); XCTAssertNil(single["evaluationResults"]?["other:test"])
        let openAI = try OrderedJSON.decode(state.exportWebData(format:.openAI,scope:.chat).data).array("OpenAI")[0]
        XCTAssertEqual(openAI["mapping"]?["middle"]?["message"]?["metadata"]?["model_slug"],.string("gpt-4"))
        let router = try OrderedJSON.decode(state.exportWebData(format:.openRouter,scope:.chat).data)
        XCTAssertEqual(router["version"],.string("orpg.3.0"))
        XCTAssertEqual(try router.required("characters").object("characters")[0].value["model"],.string("gpt-4"))
        let studio = try OrderedJSON.decode(state.exportWebData(format:.lmStudio,scope:.chat).data)
        XCTAssertFalse(try studio.required("messages").array("messages").isEmpty)
        try state.navigate(chatID:"target",nodeID:"hidden",source:.branchSwitch)
        let branch = try OrderedJSON.decode(state.exportWebData(format:.v3,scope:.branch).data)
        XCTAssertEqual(try branch.required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes").map(\.key),["system","hidden"])
        let branchAI = try OrderedJSON.decode(state.exportWebData(format:.openAI,scope:.branch).data).array("OpenAI")[0]
        XCTAssertNotNil(branchAI["mapping"]?["hidden"]); XCTAssertNil(branchAI["mapping"]?["middle"])
        XCTAssertThrowsError(try state.exportWebData(format:.openRouter,scope:.branch))
        XCTAssertThrowsError(try state.exportWebData(format:.markdown,scope:.all))
    }
    func testStandardNodeGzipFixtureAndCRCTruncationRejectionKeepSavedState() throws {
        // Node node:zlib gzipSync(Buffer.from(raw, 'utf8')); fixed standard gzip member.
        let encoded = "H4sIAAAAAAAAE22POwoCMRCG7zL1IlFXJDmAtbilWITdUQNrgslkfSx7A3sb0cpGvIO3EUuPYHyBwlbz+Obn/6eEAq1TRoNoR5BOJTkQw1FojSbUlJCxCKKsIhibPAu37wELmXtJQZggkdKT5x6cHCOt+hYT1BkImEntZQ7RFxhHA0xRFfgL56GoWtmX1On+QgzQ+Zw+2ZY9T/6VGtYgOGPdJuetTtyNGefhSwmi2Wi1GYtgYezT8Lo9Xnfn22l/P2wuUFUPGWa0XBYBAAA="
        let compressed = try XCTUnwrap(Data(base64Encoded:encoded))
        let raw = Data("{\"version\":3,\"chats\":[],\"contentStore\":{},\"folders\":{},\"evaluationSettings\":{\"safetyPreSend\":\"manual\",\"safetyPostReceive\":\"manual\",\"qualityPreSend\":\"manual\",\"qualityPostReceive\":\"manual\"},\"evaluationResults\":{},\"xFuture\":{\"z\":9007199254740993,\"a\":1.2300,\"word\":\"日本語🌿\"}}".utf8)
        XCTAssertEqual(try NativeGzip.decompress(compressed),raw)
        let local = try store(), state = ChatState(store:local); try state.importWebData(compressed)
        XCTAssertEqual(try state.exportWebData(),try OrderedJSON.decode(raw).encoded())
        let snapshot = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        var damaged = compressed; damaged[damaged.count - 8] ^= 1
        for data in [damaged,Data(compressed.dropLast(5))] {
            XCTAssertThrowsError(try state.importWebData(data))
            XCTAssertEqual(try state.publicationSnapshot(),snapshot); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        }
    }
}
