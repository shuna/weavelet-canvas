import XCTest
@testable import WeaveletPilot

final class PromptLibraryTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-prompts-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func prompt(_ id: String, name: String, body: String) -> OrderedJSON {
        .object([.init(key: "id", value: .string(id)), .init(key: "name", value: .string(name)),
                 .init(key: "prompt", value: .string(body))])
    }
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }

    func testCSVBridgeRoundTripAndRawAttributes() throws {
        let source = OrderedJSON.array([prompt("old", name: "A,\"B\"", body: "line 1\nline 2")
            .replacing("xUnknown", with: .object([.init(key: "price", value: .number("1.2300"))]))])
        let csv = try PromptLibrary.csv(source)
        let rows = try PromptLibrary.parseCSV(csv)
        XCTAssertEqual(try rows.array("rows").count, 1)
        XCTAssertEqual(try rows.array("rows")[0]["name"], .string("A,\"B\""))
        XCTAssertEqual(try rows.array("rows")[0]["prompt"], .string("line 1\nline 2"))
        let appended = try PromptLibrary.apply(source, action: .object([
            .init(key: "type", value: .string("import")), .init(key: "mode", value: .string("append")),
            .init(key: "rows", value: rows), .init(key: "newIDs", value: .array([.string("fresh")]))
        ]))
        XCTAssertEqual(try appended.array("prompts").count, 2)
        XCTAssertEqual(try appended.array("prompts")[0]["xUnknown"], try source.array("prompts")[0]["xUnknown"])
        XCTAssertEqual(try appended.array("prompts")[1]["id"], .string("fresh"))
        XCTAssertNil(try appended.array("prompts")[1]["label"])
    }

    func testLoneUTF16CSVMatchesSharedWebUTF8OutputWithoutOpaqueMarkersOrJSONChanges() throws {
        let prompts = try OrderedJSON.decode(Data(#"[{"id":"p","name":"N\ud800","prompt":"P\udc00","label":"L\ud800","xRaw":{"\ud800":9007199254740993}}]"#.utf8))
        let before = try prompts.encoded()
        let shared = try SharedWebOperations.call("promptLibraryOperation",.object([.init(key:"operation",value:.string("exportCSV")),.init(key:"prompts",value:prompts)]))
        // The actual Web exporter gives CSV text to Blob, which repairs lone units when encoding UTF8.
        let expected = Data(try shared.required("csv").displayString("Web CSV").utf8)
        XCTAssertTrue(String(decoding:expected,as:UTF8.self).contains("N�"))
        XCTAssertTrue(String(decoding:expected,as:UTF8.self).contains("P�"))
        XCTAssertEqual(try PromptLibrary.exportCSV(prompts,gzip:false),expected)
        XCTAssertEqual(try NativeGzip.decompress(PromptLibrary.exportCSV(prompts,gzip:true)),expected)
        XCTAssertEqual(try prompts.encoded(),before)
        let edited = try PromptLibrary.apply(prompts,action:.object([.init(key:"type",value:.string("edit")),.init(key:"index",value:.number("0")),.init(key:"field",value:.string("label")),.init(key:"value",value:.string("system"))]))
        XCTAssertEqual(try edited.array("prompts")[0]["name"],.utf16String([0x4e,0xd800]))
        XCTAssertEqual(try edited.array("prompts")[0]["prompt"],.utf16String([0x50,0xdc00]))
        XCTAssertEqual(try edited.array("prompts")[0]["xRaw"],try prompts.array("prompts")[0]["xRaw"])
    }

    func testSaveFailureAndStaleDraftKeepSnapshotAndDisk() throws {
        let url = try directory().appendingPathComponent("state.json")
        let fault = PromptWriteFault()
        let store = LocalStateStore(fileURL: url) { bytes, file in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to: file, options: .atomic)
        }
        let state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        var draft = try state.promptLibraryDraft()
        draft.prompts = try PromptLibrary.apply(draft.prompts, action: .object([
            .init(key: "type", value: .string("add")), .init(key: "id", value: .string("new"))
        ]))
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: url)
        fault.reject = true
        XCTAssertThrowsError(try state.savePromptLibrary(draft))
        XCTAssertEqual(try state.publicationSnapshot(), before)
        XCTAssertEqual(try Data(contentsOf: url), disk)
        fault.reject = false
        try state.savePromptLibrary(draft)
        let savedState = try state.publicationSnapshot().required("state")
        XCTAssertEqual(try savedState.object("state").filter { $0.key != "prompts" },
                       try before.required("state").object("state").filter { $0.key != "prompts" })
        XCTAssertEqual(try ChatState(store: store).promptLibraryDraft().prompts, draft.prompts)
        XCTAssertThrowsError(try state.savePromptLibrary(draft))
    }

    func testAsyncPublicationRejectsCanceledOldDraftAndChangedSource() throws {
        let state = ChatState()
        let expected = try state.promptLibraryDraft()
        XCTAssertTrue(PromptLibrary.canPublish(expected: expected, current: expected,
                                               source: expected.snapshot, active: true))
        XCTAssertFalse(PromptLibrary.canPublish(expected: expected, current: expected,
                                                source: expected.snapshot, active: false))
        var changed = expected
        changed.prompts = .array([])
        XCTAssertFalse(PromptLibrary.canPublish(expected: expected, current: changed,
                                                source: expected.snapshot, active: true))
        XCTAssertFalse(PromptLibrary.canPublish(expected: expected, current: nil,
                                                source: expected.snapshot, active: true))
        XCTAssertFalse(PromptLibrary.canPublish(expected: expected, current: expected,
                                                source: .null, active: true))
    }
}

private final class PromptWriteFault { var reject = false }
