import XCTest
@testable import WeaveletPilot

final class ChatLibraryTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/library-operations.json")))
    }
    private func defaults() throws -> ChatDefaults {
        let defaults = try fixture().required("defaults")
        return try ChatDefaults(config: defaults.required("config"), imageDetail: defaults.required("imageDetail").string("imageDetail"))
    }
    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-library-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            try? FileManager.default.removeItem(at: directory)
        }
        return LocalStateStore(fileURL: directory.appendingPathComponent("local-state.json"))
    }
    private func assertEquivalent(_ actual: OrderedJSON, _ expected: OrderedJSON, name: String) throws {
        XCTAssertEqual(try SyncRecords.canonical(actual), try SyncRecords.canonical(expected), name)
        let actualChats = try actual.required("chats").array("chats")
        let expectedChats = try expected.required("chats").array("chats")
        XCTAssertEqual(actualChats.count, expectedChats.count, name)
        for (actualChat, expectedChat) in zip(actualChats, expectedChats) {
            if let tree = expectedChat["branchTree"] {
                XCTAssertEqual(try actualChat.required("branchTree").required("nodes").object("nodes").map { Data($0.key.utf8) },
                               try tree.required("nodes").object("nodes").map { Data($0.key.utf8) }, name)
            }
        }
    }

    func testSharedOperationsPersistRestartAndExportAllExpectedData() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture["fixtureVersion"], .number("1"))
        let cases = try fixture.required("cases").array("cases")
        XCTAssertEqual(cases.count, 8)
        for test in cases {
            let name = try test.required("name").string("name")
            let input = try test.required("input")
            let store = try store()
            let state = ChatState(store: store)
            try state.importWebData(input.encoded())
            switch try test.required("operation").string("operation") {
            case "create": try state.createChat(defaults: defaults(), id: "new-created")
            case "rename": try state.renameChat(id: "chat-a", title: "Renamed")
            case "duplicate": try state.duplicateChat(id: "chat-a", newID: "new-copy")
            case "delete": try state.deleteChats(ids: ["chat-a"], defaults: defaults())
            case "delete-flat": try state.deleteChats(ids: ["chat-b"], defaults: defaults())
            case "delete-all": try state.deleteChats(ids: ["chat-a", "chat-b"], defaults: defaults(), replacementID: "new-created")
            default: throw ExchangeError.invalid("fixture operation")
            }
            let expected = try test.required("expected")
            let selected = try test.required("selectedID").string("selectedID")
            XCTAssertEqual(state.selectedConversationID, selected, name)
            try assertEquivalent(XCTUnwrap(state.exchange).source, expected, name: name)
            let fresh = ChatState(store: store)
            XCTAssertNil(fresh.persistenceError, name)
            XCTAssertEqual(fresh.selectedConversationID, selected, name)
            let exported = try OrderedJSON.decode(XCTUnwrap(fresh.exchange).encoded())
            try assertEquivalent(exported, expected, name: "restart/export \(name)")
        }
    }

    func testRemainingViewingStatesAndStyleSurviveLibraryMutations() throws {
        let input = try fixture().required("cases").array("cases")[0].required("input")
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        state.style = .bubbles
        state.selectSibling("n-inactive", of: "n-assistant")
        try state.renameChat(id: "chat-a", title: "Renamed")
        try state.duplicateChat(id: "chat-a", newID: "copy-view")
        XCTAssertEqual(state.conversations[1].selectedLeafID, "n-inactive")
        XCTAssertEqual(state.conversations[0].selectedLeafID, "n-assistant")
        try state.deleteChats(ids: ["chat-b"], defaults: defaults())
        let fresh = ChatState(store: store)
        XCTAssertEqual(fresh.style, .bubbles)
        XCTAssertEqual(fresh.conversations.first { $0.id == "chat-a" }?.selectedLeafID, "n-inactive")
        XCTAssertEqual(fresh.conversations.first?.id, "copy-view")
    }

    func testOnlyExplicitCreationConvertsSamplesIntoSavedLibrary() throws {
        let store = try store()
        let state = ChatState(store: store)
        XCTAssertThrowsError(try state.renameChat(id: "sample-1", title: "Rename"))
        XCTAssertThrowsError(try state.duplicateChat(id: "sample-1"))
        XCTAssertThrowsError(try state.deleteChats(ids: ["sample-1"], defaults: .webInitial))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        try state.createChat(defaults: .webInitial, id: "sample-1")
        let fresh = ChatState(store: store)
        XCTAssertNil(fresh.persistenceError)
        XCTAssertEqual(fresh.conversations.map(\.id), ["sample-1"])
        XCTAssertTrue(fresh.conversations[0].nodes.isEmpty)
        XCTAssertEqual(fresh.conversation?.title, "New Chat 1")
    }

    func testSaveFailurePreservesSourceDiskAndSelectionsForEveryOperation() throws {
        let input = try fixture().required("cases").array("cases")[0].required("input")
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        state.selectSibling("n-inactive", of: "n-assistant")
        let before = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        XCTAssertThrowsError(try state.createChat(defaults: defaults()))
        XCTAssertThrowsError(try state.renameChat(id: "chat-a", title: "Fail"))
        XCTAssertThrowsError(try state.duplicateChat(id: "chat-a"))
        XCTAssertThrowsError(try state.deleteChats(ids: ["chat-a"], defaults: defaults()))
        XCTAssertThrowsError(try state.deleteChats(ids: ["chat-a", "chat-b"], defaults: defaults()))
        XCTAssertEqual(state.exchange?.source, input)
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertEqual(state.conversation?.selectedLeafID, "n-inactive")
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }


    func testConversationSelectionRecoversAfterSaveFailureAndPersistsFreshState() throws {
        let input = try fixture().required("cases").array("cases")[0].required("input")
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        let before = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        state.selectedConversationID = "chat-b"
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertNotNil(state.persistenceError)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        state.selectedConversationID = "chat-b"
        XCTAssertEqual(state.selectedConversationID, "chat-b")
        XCTAssertNil(state.persistenceError)
        let fresh = ChatState(store: store)
        XCTAssertEqual(fresh.selectedConversationID, "chat-b")
        XCTAssertNil(fresh.persistenceError)
        XCTAssertEqual(fresh.exchange?.source, input)
    }

    func testReferenceUnderflowAndInvalidIdentitiesAreRejectedWithoutMutation() throws {
        let input = try fixture().required("cases").array("cases")[0].required("input")
        let store = try store()
        let state = ChatState(store: store)
        let bodyStore = try input.required("contentStore")
        let system = try bodyStore.required("system").replacing("refCount", with: .number("0"))
        let corrupt = input.replacing("contentStore", with: bodyStore.replacing("system", with: system))
        try state.importWebData(corrupt.encoded())
        let before = try Data(contentsOf: store.fileURL)
        XCTAssertThrowsError(try state.deleteChats(ids: ["chat-a"], defaults: defaults()))
        XCTAssertThrowsError(try state.duplicateChat(id: "chat-a", newID: "chat-b"))
        XCTAssertThrowsError(try state.deleteChats(ids: ["chat-a", "chat-a"], defaults: defaults()))
        XCTAssertThrowsError(try state.renameChat(id: "missing", title: "Ignored"))
        XCTAssertEqual(state.exchange?.source, corrupt)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }
}
