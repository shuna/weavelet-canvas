import XCTest
@testable import WeaveletPilot

final class BranchEditorTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }

    func testInputUsesSelectedTreeAndResolvedStoreAndGraphRejectsStaleResult() throws {
        let state = ChatState()
        try state.importWebData(fixture().encoded())
        let key = BranchLayoutKey(state: state)
        let input = try key.input(requestID: 42)
        XCTAssertEqual(try input.required("entries").array("entries")[0].required("chatId"), .string("chat-a"))
        XCTAssertEqual(try input.required("entries").array("entries")[0].required("nodes"), try fixture().required("chats").array("chats")[0].required("branchTree").required("nodes"))
        XCTAssertEqual(input["contentStore"], state.exchange?.source["contentStore"])
        let output = try SharedWebOperations.call("branchLayout", input)
        let graph = try BranchGraph(output, requestID: 42)
        XCTAssertTrue(graph.nodes.contains { $0.id == "n-inactive" && !$0.active && !$0.preview.isEmpty })
        XCTAssertThrowsError(try BranchGraph(output, requestID: 41))
    }

    func testViewModePersistsSeparatelyFromBubbleStyleAndFailedSaveKeepsState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-branch-view-\(UUID().uuidString)")
        let url = directory.appendingPathComponent("state.json")
        var shouldFail = false
        let store = LocalStateStore(fileURL: url, write: { data, path in
            if shouldFail { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: path, options: .atomic)
        })
        defer { try? FileManager.default.removeItem(at: directory) }
        let state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        state.style = .bubbles
        try state.setChatActiveView(.splitVertical)
        XCTAssertEqual(ChatState(store: store).chatActiveView, .splitVertical)
        XCTAssertEqual(ChatState(store: store).style, .bubbles)
        let before = try Data(contentsOf: url)
        shouldFail = true
        XCTAssertThrowsError(try state.setChatActiveView(.branchEditor))
        XCTAssertEqual(state.chatActiveView, .splitVertical)
        XCTAssertEqual(try Data(contentsOf: url), before)
        XCTAssertEqual(state.exchange?.source["chats"], try fixture().required("chats"))
        XCTAssertEqual(state.exchange?.source["contentStore"], try fixture().required("contentStore"))
    }

    func testNodeSelectionUsesSharedNavigationAndHistory() throws {
        let state = ChatState()
        try state.importWebData(fixture().encoded())
        try state.setChatActiveView(.branchEditor)
        try state.navigate(chatID: "chat-a", nodeID: "n-inactive", source: .branchEditor)
        XCTAssertEqual(state.conversation?.visibleMessages.last?.id, "n-inactive")
        XCTAssertTrue(state.canNavigateBack)
    }

    func testFlatChatUsesSharedConversionBeforeLayout() throws {
        let state = ChatState()
        try state.importWebData(fixture().encoded())
        state.selectedConversationID = "chat-b"
        XCTAssertNil(BranchLayoutKey(state: state).tree)
        try state.ensureBranchTreeForEditor(now: 1000)
        let key = BranchLayoutKey(state: state)
        XCTAssertNotNil(key.tree)
        XCTAssertEqual(try key.input(requestID: 9).required("entries").array("entries")[0].required("activePath").array("activePath").count, 1)
        XCTAssertEqual(state.conversation?.visibleMessages.count, 1)
    }
}
