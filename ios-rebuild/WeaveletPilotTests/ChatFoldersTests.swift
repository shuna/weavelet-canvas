import XCTest
@testable import WeaveletPilot

final class ChatFoldersTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/folder-operations.json")))
    }
    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-folders-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path); try? FileManager.default.removeItem(at: directory) }
        return LocalStateStore(fileURL: directory.appendingPathComponent("state.json"))
    }
    func testSharedFolderRulesApplyOnlyKnownChangesAndMatchHandwrittenCases() throws {
        let f = try fixture()
        for item in try f.required("cases").array("cases") {
            let input = try item["input"] ?? f.required("input"), before = try input.encoded()
            let result = try ChatFolders.apply(in: input, operationJSON: item.required("operation"))
            let name = try item.required("name").string("name")
            XCTAssertEqual(try SyncRecords.canonical(result), try SyncRecords.canonical(item.required("expected")), name)
            XCTAssertEqual(try ChatFolders.rows(in: result).map { Data($0.id.utf8) }, try item.required("orderedIDs").array("ids").map { Data(try $0.string("id").utf8) })
            XCTAssertEqual(result["contentStore"], input["contentStore"])
            XCTAssertEqual(try input.encoded(), before)
        }
    }
    func testOpaqueNumbersAndUnknownMetadataNeverRoundTripThroughJS() throws {
        let input = try fixture().required("input").replacing("xHuge", with: .number("9007199254740993"))
        let folders = try input.required("folders"), folder = try folders.required("f-a").replacing("xHuge", with: .number("1.234567890123456789"))
        let source = input.replacing("folders", with: folders.replacing("f-a", with: folder))
        let result = try ChatFolders.apply(in: source, operation: .rename(id: "f-a", name: "e\u{301}"))
        XCTAssertEqual(result["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(result["folders"]?["f-a"]?["xHuge"], .number("1.234567890123456789"))
        XCTAssertEqual(result["folders"]?["f-a"]?["name"], .string("e\u{301}"))
        XCTAssertEqual(result["chats"], source["chats"])
    }
    @MainActor func testMembershipRemovalPersistenceRestartExportAndAtomicFailure() throws {
        let input = try fixture().required("input"), store = try store(), state = ChatState(store: store)
        try state.importWebData(input.encoded())
        try state.applyFolder(.move(chatIDs: ["chat-a", "chat-c"], folderID: "f-b"))
        try state.applyFolder(.remove(id: "f-b"))
        let before = try XCTUnwrap(state.exchange?.source), saved = try Data(contentsOf: store.fileURL)
        XCTAssertEqual(try before.required("chats").array("chats").count, 3)
        for chat in try before.required("chats").array("chats") { XCTAssertNil(chat["folder"]) }
        XCTAssertEqual(before["contentStore"], input["contentStore"])
        let fresh = ChatState(store: store)
        XCTAssertNil(fresh.persistenceError)
        XCTAssertEqual(fresh.exchange?.source, before)
        let exported = try OrderedJSON.decode(XCTUnwrap(fresh.exchange).encoded())
        XCTAssertEqual(exported["folders"], before["folders"])
        XCTAssertEqual(exported["xRoot"], input["xRoot"])
        XCTAssertEqual(try exported.required("chats").array("chats").map { $0["folder"] }, [nil, nil, nil])
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        XCTAssertThrowsError(try state.applyFolder(.create(id: "failed")))
        XCTAssertThrowsError(try state.applyFolder(.move(chatIDs: ["chat-a"], folderID: "f-a")))
        XCTAssertEqual(state.exchange?.source, before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), saved)
    }
    func testInvalidOperationLeavesOriginalDocumentUnchanged() throws {
        let input = try fixture().required("input"), before = try input.encoded()
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .create(id: "f-a")))
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .move(chatIDs: ["missing"], folderID: "f-a")))
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .remove(id: "missing")))
        XCTAssertEqual(try input.encoded(), before)
    }
}
