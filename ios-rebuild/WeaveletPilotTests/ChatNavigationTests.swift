import XCTest
@testable import WeaveletPilot

// Navigation now persists the Web activePath and projected messages; every other raw field stays exact.
func corpusSelectingInactive(_ source: OrderedJSON) throws -> OrderedJSON {
    var chats = try source.required("chats").array("chats")
    let tree = try chats[0].required("branchTree").replacing("activePath", with: .array(["n-system", "n-user", "n-inactive"].map(OrderedJSON.string)))
    var messages = try chats[0].required("messages").array("messages")
    messages[2] = try messages[2].replacing("content", with: source.required("contentStore").required("inactive").required("content"))
    chats[0] = chats[0].replacing("branchTree", with: tree).replacing("messages", with: .array(messages))
    return source.replacing("chats", with: .array(chats))
}

final class ChatNavigationTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }
    private func store() throws -> LocalStateStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-navigation-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return LocalStateStore(fileURL: dir.appendingPathComponent("state.json"))
    }
    func testSearchReachSaveRestartHistoryAndEditUseSamePath() throws {
        let store = try store(), source = try fixture(), state = ChatState(store: store)
        try state.importWebData(source.encoded())
        let result = try XCTUnwrap(ChatSearch.results(in: source, query: "別分岐の本文", mode: .grep).first)
        try state.navigate(chatID: result.chatID, nodeID: result.nodeID, source: .grep)
        XCTAssertEqual(state.exchange?.source, try corpusSelectingInactive(source))
        XCTAssertEqual(state.navigationFocus?.nodeID, "n-inactive")
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertFalse(state.canNavigateForward)
        let fresh = ChatState(store: store)
        XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), ["n-system", "n-user", "n-inactive"])
        XCTAssertEqual(fresh.exchange?.source, state.exchange?.source)
        try state.moveNavigation(.back)
        XCTAssertEqual(state.exchange?.source, source)
        XCTAssertTrue(state.canNavigateForward)
        try state.moveNavigation(.forward)
        XCTAssertEqual(state.exchange?.source, try corpusSelectingInactive(source))
        var draft = try state.messageDraft(nodeID: "n-inactive")
        XCTAssertEqual(draft.path, ["n-system", "n-user", "n-inactive"])
        draft.text = "編集後の本文"
        try state.saveMessage(draft, mode: .overwrite, now: 500)
        XCTAssertEqual(state.conversation?.visibleMessages.last?.parts, [.text("編集後の本文")])
        XCTAssertEqual(try ChatState(store: store).messageDraft(nodeID: "n-inactive").text, "編集後の本文")
    }
    func testAnyDepthSiblingSelectsSharedNewestDescendant() throws {
        var source = try fixture(), chats = try source.required("chats").array("chats")
        let tree = try chats[0].required("branchTree")
        var nodes = try tree.required("nodes")
        let other = try nodes.required("n-user").replacing("id", with: .string("other-user")).replacing("createdAt", with: .number("10"))
        let child = try nodes.required("n-inactive").replacing("id", with: .string("other-child")).replacing("parentId", with: .string("other-user"))
        nodes = nodes.replacing("other-user", with: other).replacing("other-child", with: child)
        chats[0] = chats[0].replacing("branchTree", with: tree.replacing("nodes", with: nodes))
        source = source.replacing("chats", with: .array(chats))
        let state = ChatState()
        try state.importWebData(source.encoded())
        XCTAssertEqual(state.siblings(for: "n-user").map(\.id), ["n-user", "other-user"])
        state.selectSibling("other-user", of: "n-user")
        XCTAssertNil(state.persistenceError)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["n-system", "other-user", "other-child"])
        XCTAssertEqual(state.navigationFocus?.nodeID, "other-user")
        try state.moveNavigation(.back)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["n-system", "n-user", "n-assistant"])
    }
    func testCreationAndDuplicationParticipateInSharedHistory() throws {
        let state = ChatState()
        try state.importWebData(fixture().encoded())
        try state.navigate(chatID: "chat-b", source: .chatSwitch)
        try state.createChat(defaults: .webInitial(), id: "created")
        try state.navigate(chatID: "chat-a", source: .chatSwitch)
        try state.moveNavigation(.back)
        XCTAssertEqual(state.selectedConversationID, "created")
        try state.duplicateChat(id: "chat-a", newID: "duplicate")
        try state.navigate(chatID: "chat-b", source: .chatSwitch)
        try state.moveNavigation(.back)
        XCTAssertEqual(state.selectedConversationID, "duplicate")
    }
    func testFailedSaveLeavesDocumentFocusAndHistoryUntouched() throws {
        let store = try store(), state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        try state.navigate(chatID: "chat-a", nodeID: "n-inactive", source: .search)
        let source = state.exchange?.source, focus = state.navigationFocus, bytes = try Data(contentsOf: store.fileURL)
        let dir = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: dir.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path) }
        XCTAssertThrowsError(try state.moveNavigation(.back))
        XCTAssertThrowsError(try state.navigate(chatID: "chat-b", source: .chatSwitch))
        XCTAssertEqual(state.exchange?.source, source)
        XCTAssertEqual(state.navigationFocus, focus)
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertFalse(state.canNavigateForward)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
    }
}
