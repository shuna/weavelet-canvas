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
        XCTAssertEqual(try input.required("contentStore").required("inactive"), state.exchange?.source["contentStore"]?["inactive"])
        XCTAssertNil(input["contentStore"]?["unreferenced"])
        let output = try SharedWebOperations.call("branchLayout", input)
        let graph = try BranchGraph(output, requestID: 42)
        XCTAssertTrue(graph.nodes.contains { $0.id == "n-inactive" && !$0.active && !$0.preview.isEmpty })
        XCTAssertThrowsError(try BranchGraph(output, requestID: 41))
    }

    func testCanonicalEquivalentIDsRemainDistinctAndRequestIDIsJSSafe() throws {
        let composed = "é", decomposed = "e\u{301}"
        let content = OrderedJSON.object([.init(key: "body", value: .object([
            .init(key: "content", value: .array([.object([.init(key: "type", value: .string("text")), .init(key: "text", value: .string("本文"))])])),
            .init(key: "refCount", value: .number("2"))]))])
        let nodes = OrderedJSON.object([composed, decomposed].map { id in
            .init(key: id, value: .object([.init(key: "id", value: .string(id)), .init(key: "parentId", value: .null),
                .init(key: "role", value: .string("user")), .init(key: "contentHash", value: .string("body"))]))
        })
        let tree = OrderedJSON.object([.init(key: "nodes", value: nodes), .init(key: "activePath", value: .array([.string(composed)]))])
        let first = BranchLayoutKey(chatID: composed, chatIndex: 0, title: composed, tree: tree, contentStore: content)
        let second = BranchLayoutKey(chatID: decomposed, chatIndex: 0, title: composed, tree: tree, contentStore: content)
        let third = BranchLayoutKey(chatID: composed, chatIndex: 0, title: decomposed, tree: tree, contentStore: content)
        XCTAssertNotEqual(first, second)
        XCTAssertNotEqual(first, third)
        let requestID = Int(UInt32.max)
        let output = try SharedWebOperations.call("branchLayout", first.input(requestID: requestID))
        let graph = try BranchGraph(output, requestID: requestID)
        XCTAssertEqual(graph.positionsByID.count, 2)
        XCTAssertEqual(Set(graph.nodes.map(\.identity)).count, 2)
        XCTAssertThrowsError(try BranchGraph(output, requestID: requestID - 1))
    }

    func testPreviewResolvesOnlyReferencedDeltaWithoutChangingRawStore() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/raw-delta-attributes.json")))
        let rawStore = OrderedJSON.object([
            .init(key: "base", value: .object([.init(key: "content", value: try fixture.required("base")), .init(key: "refCount", value: .number("1"))])),
            .init(key: "delta", value: .object([.init(key: "content", value: .array([])), .init(key: "refCount", value: .number("1")),
                .init(key: "delta", value: .object([.init(key: "baseHash", value: .string("base")), .init(key: "patches", value: try fixture.required("patches"))]))]))
        ])
        let node = OrderedJSON.object([.init(key: "id", value: .string("n")), .init(key: "parentId", value: .null),
            .init(key: "role", value: .string("user")), .init(key: "contentHash", value: .string("delta"))])
        let tree = OrderedJSON.object([.init(key: "nodes", value: .object([.init(key: "n", value: node)])), .init(key: "activePath", value: .array([.string("n")]))])
        let key = BranchLayoutKey(chatID: "chat", chatIndex: 0, title: "chat", tree: tree, contentStore: rawStore)
        let input = try key.input(requestID: 7)
        XCTAssertNil(input["contentStore"]?["base"])
        XCTAssertEqual(try input.required("contentStore").required("delta").required("content"), try fixture.required("expected"))
        XCTAssertEqual(rawStore["delta"]?["content"], .array([]))
        XCTAssertNotNil(rawStore["delta"]?["delta"])
        let graph = try BranchGraph(SharedWebOperations.call("branchLayout", input), requestID: 7)
        XCTAssertFalse(try XCTUnwrap(graph.nodes.first).preview.isEmpty)
    }

    func testOldGraphCannotPublishOrSelectSameNodeIDInAnotherChat() throws {
        let original = try fixture()
        var chats = try original.required("chats").array("chats")
        chats[1] = chats[0].replacing("id", with: .string("chat-b")).replacing("title", with: .string("別の会話"))
        let state = ChatState()
        try state.importWebData(original.replacing("chats", with: .array(chats)).encoded())
        let oldKey = BranchLayoutKey(state: state)
        let oldGraph = try BranchGraph(SharedWebOperations.call("branchLayout", oldKey.input(requestID: 11)), requestID: 11)
        XCTAssertTrue(oldGraph.nodes.contains { $0.id == "n-inactive" })
        state.selectedConversationID = "chat-b"
        let before = state.exchange?.source
        XCTAssertFalse(oldKey.isCurrent(in: state))
        XCTAssertNotEqual(oldKey, BranchLayoutKey(state: state))
        XCTAssertFalse(try oldKey.select("n-inactive", in: state))
        XCTAssertEqual(state.selectedConversationID, "chat-b")
        XCTAssertEqual(state.exchange?.source, before)
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
