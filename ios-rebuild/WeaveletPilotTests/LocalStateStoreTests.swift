import XCTest
@testable import WeaveletPilot

final class LocalStateStoreTests: XCTestCase {
    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-local-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            try? FileManager.default.removeItem(at: directory)
        }
        return LocalStateStore(fileURL: directory.appendingPathComponent("local-state.json"))
    }
    private func source() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }

    func testFreshInstanceRestoresAllSourceAndViewingState() throws {
        let store = try store()
        let source = try source()
        let state = ChatState(store: store)
        XCTAssertNil(state.persistenceError)
        try state.importWebData(source.encoded())
        state.style = .bubbles
        state.selectSibling("n-inactive", of: "n-assistant")
        state.selectedConversationID = "chat-b"
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(restored.exchange?.source, source)
        XCTAssertEqual(restored.style, .bubbles)
        XCTAssertEqual(restored.selectedConversationID, "chat-b")
        XCTAssertEqual(restored.conversations[0].visibleMessages.map(\.id), ["n-system", "n-user", "n-inactive"])
        XCTAssertEqual(restored.conversations[0].visibleMessages.last?.parts, [.text("別分岐の本文")])
        XCTAssertEqual(restored.conversations[1].visibleMessages, state.conversations[1].visibleMessages)
        XCTAssertEqual(try XCTUnwrap(restored.exchange).encoded(), try source.encoded())
    }

    func testExplicitPathAndEmptyExportRestore() throws {
        let store = try store()
        let state = ChatState(store: store)
        let source = try source()
        try state.importWebData(source.encoded())
        XCTAssertEqual(ChatState(store: store).conversations[0].displayedPathIDs, ["n-system", "n-user", "n-assistant"])
        let empty = source.replacing("chats", with: .array([]))
        try state.importWebData(empty.encoded())
        let restored = ChatState(store: store)
        XCTAssertNil(restored.conversation)
        XCTAssertEqual(restored.exchange?.source, empty)
        XCTAssertNil(restored.persistenceError)
    }


    func testBoundaryDepthSourceSurvivesLocalEnvelopeAndFreshInstance() throws {
        let store = try store()
        var nested = OrderedJSON.string("depth boundary preserved")
        for _ in 0..<255 { nested = .array([nested]) }
        let deep = try source().replacing("xBoundaryDepth", with: nested)
        let state = ChatState(store: store)
        try state.importWebData(deep.encoded())
        let before = try Data(contentsOf: store.fileURL)
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(restored.exchange?.source, deep)
        let tooDeep = deep.replacing("xBoundaryDepth", with: .array([nested]))
        XCTAssertThrowsError(try state.importWebData(tooDeep.encoded()))
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }

    func testSampleActionsDoNotCreateStorage() throws {
        let store = try store()
        let state = ChatState(store: store)
        state.style = .bubbles
        state.selectedConversationID = "sample-2"
        state.selectedConversationID = "sample-1"
        state.selectSibling("10", of: "2")
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        XCTAssertNil(state.exchange)
        XCTAssertNil(state.persistenceError)
    }

    func testSaveFailurePreservesDiskAndEveryMemorySelection() throws {
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(source().encoded())
        let before = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        state.style = .bubbles
        state.selectedConversationID = "chat-b"
        state.selectSibling("n-inactive", of: "n-assistant")
        let replacement = try source().replacing("chats", with: .array([]))
        XCTAssertThrowsError(try state.importWebData(replacement.encoded()))
        XCTAssertEqual(state.style, .stream)
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertEqual(state.conversation?.selectedLeafID, "n-assistant")
        XCTAssertEqual(state.exchange?.source, try source())
        XCTAssertNotNil(state.persistenceError)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }

    func testMalformedSaveIsReportedAndNeverAutomaticallyOverwritten() throws {
        let store = try store()
        for malformed in [Data("not JSON".utf8), try OrderedJSON.object([JSONField(key: "version", value: .number("999"))]).encoded()] {
            try malformed.write(to: store.fileURL, options: .atomic)
            let state = ChatState(store: store)
            XCTAssertNotNil(state.persistenceError)
            XCTAssertNil(state.exchange)
            state.persistenceError = nil
            state.style = .bubbles
            state.selectSibling("10", of: "2")
            XCTAssertThrowsError(try state.importWebData(Data("invalid import".utf8)))
            XCTAssertEqual(try Data(contentsOf: store.fileURL), malformed)
        }
    }

    func testInvalidSavedViewIsNotSilentlyRepairedOrWritten() throws {
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(source().encoded())
        let saved = try OrderedJSON.decode(Data(contentsOf: store.fileURL)).replacing("selectedChatID", with: .string("absent-chat"))
        let malformed = try saved.encoded()
        try malformed.write(to: store.fileURL, options: .atomic)
        let restored = ChatState(store: store)
        XCTAssertNil(restored.exchange)
        XCTAssertNotNil(restored.persistenceError)
        restored.selectedConversationID = "sample-2"
        XCTAssertEqual(try Data(contentsOf: store.fileURL), malformed)
    }
}
