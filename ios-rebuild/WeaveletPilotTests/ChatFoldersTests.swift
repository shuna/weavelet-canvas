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
        try state.applyFolder(.move(chatIDs: ["chat-a", "chat-c"], folderID: "f-b"), now: 1700000000123)
        try state.applyFolder(.remove(id: "f-b"), now: 1700000000123)
        let before = try XCTUnwrap(state.exchange?.source), saved = try Data(contentsOf: store.fileURL)
        XCTAssertEqual(try before.required("chats").array("chats").count, 3)
        for chat in try before.required("chats").array("chats") { XCTAssertNil(chat["folder"]) }
        XCTAssertEqual(before["contentStore"], input["contentStore"])
        XCTAssertEqual(try state.publicationSnapshot().required("state").required("lastContentEditedAt").number("stamp"), 1700000000123)
        for chat in try before.required("chats").array("chats") {
            XCTAssertEqual(try chat.required("updatedAt").number("stamp"), 1700000000123)
        }
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
    func testSharedHierarchyRemovalReparentsChildrenAndMovingExpandsAncestors() throws {
        var input = try fixture().required("input"), folders = try input.required("folders")
        folders = folders.replacing("f-a", with: try folders.required("f-a").replacing("expanded", with: .bool(false)))
            .replacing("f-b", with: try folders.required("f-b").replacing("parentId", with: .string("f-a")))
            .replacing("f-c", with: try folders.required("f-c").replacing("parentId", with: .string("f-b")))
        var chats = try input.required("chats").array("chats")
        chats[0] = chats[0].replacing("folder", with: .string("f-b"))
        chats[1] = chats[1].replacing("folder", with: .string("f-c"))
        input = input.replacing("folders", with: folders).replacing("chats", with: .array(chats))
        let removed = try ChatFolders.apply(in: input, operation: .remove(id: "f-b"))
        XCTAssertNil(removed["folders"]?["f-b"])
        XCTAssertEqual(removed["folders"]?["f-c"]?["parentId"], .string("f-a"))
        XCTAssertEqual(try removed.required("chats").array("chats")[0]["folder"], .string("f-a"))
        let moved = try ChatFolders.apply(in: removed, operation: .move(chatIDs: ["chat-c"], folderID: "f-c"))
        XCTAssertEqual(moved["folders"]?["f-a"]?["expanded"], .bool(true))
        XCTAssertEqual(moved["folders"]?["f-c"]?["expanded"], .bool(true))
        XCTAssertEqual(moved["folders"]?["f-c"]?["xFolder"], input["folders"]?["f-c"]?["xFolder"])
        XCTAssertEqual(moved["contentStore"], input["contentStore"])
        XCTAssertEqual(moved["xRoot"], input["xRoot"])
    }

    func testNestedRowProjectionAndRevealSelectedFolder() throws {
        let input = try fixture().required("input")
        let folders = try input.required("folders")
            .replacing("f-a", with: input.required("folders").required("f-a").replacing("expanded", with: .bool(false)))
            .replacing("f-b", with: input.required("folders").required("f-b").replacing("parentId", with: .string("f-a")))
            .replacing("f-c", with: input.required("folders").required("f-c").replacing("parentId", with: .string("f-b")))
        let source = input.replacing("folders", with: folders)
        let rows = try ChatFolders.rows(in: source)
        XCTAssertEqual(rows.map(\.id), ["f-a", "f-b", "f-c"])
        XCTAssertEqual(rows.map(\.depth), [0, 1, 2])
        XCTAssertEqual(rows.map(\.visible), [true, false, false])
        XCTAssertEqual(rows[2].displayParentID, "f-b")
        let revealed = try ChatFolders.apply(in: source, operation: .move(chatIDs: [], folderID: "f-c"))
        XCTAssertEqual(revealed["chats"], source["chats"])
        XCTAssertEqual(try ChatFolders.rows(in: revealed).map(\.visible), [true, true, true])
    }

    func testInvalidOperationLeavesOriginalDocumentUnchanged() throws {
        let input = try fixture().required("input"), before = try input.encoded()
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .create(id: "f-a")))
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .move(chatIDs: ["missing"], folderID: "f-a")))
        XCTAssertThrowsError(try ChatFolders.apply(in: input, operation: .remove(id: "missing")))
        XCTAssertEqual(try input.encoded(), before)
    }
}
