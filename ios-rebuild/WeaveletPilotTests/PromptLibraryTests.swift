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
