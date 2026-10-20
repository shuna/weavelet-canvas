import XCTest
@testable import WeaveletPilot

final class BranchNavigationTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }
    private func store(writer: ((Data, URL) throws -> Void)? = nil) throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("branch-editor-focus-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json")
        return writer.map { LocalStateStore(fileURL: file, write: $0) } ?? LocalStateStore(fileURL: file)
    }
    func testAnyNodeSiblingAndLegacyViewingPathUseSharedTargetsAndRetainUnknownRawFields() throws {
        let original=try fixture(), store=try original.required("contentStore"), inactive=try store.required("inactive")
        var parts=try inactive.required("content").array("parts")
        parts[0]=parts[0].replacing("xHuge",with:.number("9007199254740993"))
        let source=original.replacing("xHuge",with:.number("9007199254740993")).replacing("contentStore",with:store.replacing("inactive",with:inactive.replacing("content",with:.array(parts))))
        let target=try BranchNavigation.navigate(in:source,chatID:"chat-a",nodeID:"n-user")
        XCTAssertEqual(target.status,.reached); XCTAssertEqual(target.path,["n-system","n-user","n-inactive"])
        XCTAssertEqual(target.source["xHuge"],.number("9007199254740993")); XCTAssertEqual(target.source["contentStore"],source["contentStore"])
        let displayed=try target.source.required("chats").array("chats")[0].required("messages").array("messages")
        XCTAssertEqual(try displayed.last?.required("content").array("parts")[0]["xHuge"],.number("9007199254740993"))
        let searched=try BranchNavigation.navigate(in:source,chatID:"chat-a",nodeID:"n-user",source:.search,viewingPath:["n-system","n-user","n-inactive"])
        XCTAssertEqual(searched.path,["n-system","n-user","n-inactive"])
        XCTAssertEqual(try searched.source.required("chats").array("chats")[0].required("branchTree")["activePath"],.array(searched.path.map(OrderedJSON.string)))
        XCTAssertEqual(try BranchNavigation.navigate(in:source,chatID:"absent").status,.chatMissing)
        XCTAssertEqual(try BranchNavigation.navigate(in:source,chatID:"chat-b",nodeID:"message-0").status,.nodeMissing)
    }
    func testAllNodeCandidateBatchUsesExactUnicodeIDsAndSiblingOrder() throws {
        let source=try fixture(), candidates=try BranchNavigation.candidates(in:source)
        let chat=try XCTUnwrap(candidates.first { $0.chatID == "chat-a" })
        XCTAssertEqual(chat.candidates(for:"n-assistant")?.siblingIDs,["n-inactive","n-assistant"])
        XCTAssertEqual(chat.candidates(for:"n-assistant")?.selectedIndex,1)
        let unicodeIDs=["é","e\u{301}"]
        let nodes=OrderedJSON.object(unicodeIDs.map { id in .init(key:id,value:.object([.init(key:"id",value:.string(id)),.init(key:"parentId",value:.null),.init(key:"createdAt",value:.number("1"))])) })
        let unicode=OrderedJSON.object([.init(key:"chats",value:.array([.object([.init(key:"id",value:.string("unicode")),.init(key:"branchTree",value:.object([.init(key:"nodes",value:nodes),.init(key:"activePath",value:.array([.string("é")]))]))])]))])
        let result=try XCTUnwrap(BranchNavigation.candidates(in:unicode).first)
        XCTAssertEqual(result.candidates(for:"e\u{301}")?.selectedIndex,1)
        XCTAssertEqual(result.nodeIDs.map { Data($0.utf8) },unicodeIDs.map { Data($0.utf8) })
    }
    func testSharedHistoryBackForwardAndInvalidRestorePath() throws {
        let source=try fixture()
        var history=try BranchNavigation.emptyHistory()
        let initialized=try BranchNavigation.history(history,action:.initialize,in:source,chatID:"chat-a",view:"chat",key:"first")
        history=initialized.history
        let second=try BranchNavigation.navigate(in:source,chatID:"chat-b",source:.chatSwitch)
        let anchor=OrderedJSON.object([.init(key:"firstVisibleItemIndex",value:.number("2")),.init(key:"offsetWithinItem",value:.number("123")),.init(key:"wasAtBottom",value:.bool(false))])
        history=try BranchNavigation.history(history,action:.capture,in:source,scrollAnchor:anchor).history
        let pushed=try BranchNavigation.history(history,action:.push,in:source,target:second,view:"chat",navigationSource:.chatSwitch,key:"second")
        XCTAssertTrue(pushed.canBack); XCTAssertFalse(pushed.canForward)
        let back=try BranchNavigation.history(pushed.history,action:.back,in:source)
        XCTAssertEqual(back.entry?["chatId"],.string("chat-a")); XCTAssertTrue(back.canForward)
        XCTAssertEqual(back.entry?["scrollAnchor"],anchor)
        let forward=try BranchNavigation.history(back.history,action:.forward,in:source)
        XCTAssertEqual(forward.entry?["chatId"],.string("chat-b"))
        let invalid=OrderedJSON.object([.init(key:"chatId",value:.string("chat-a")),.init(key:"activePath",value:.array([.string("n-user"),.string("n-system")]))])
        XCTAssertEqual(try BranchNavigation.restore(in:source,entry:invalid).source,source)
    }
    func testSwipeDirectionUsesActualSharedWebResolver() throws {
        XCTAssertEqual(try BranchNavigation.swipeDirection(distance: -44, preference: "left-next"), "next")
        XCTAssertEqual(try BranchNavigation.swipeDirection(distance: 44, preference: "left-next"), "previous")
        XCTAssertEqual(try BranchNavigation.swipeDirection(distance: -44, preference: "right-next"), "previous")
        XCTAssertEqual(try BranchNavigation.swipeDirection(distance: 44, preference: "right-next"), "next")
    }
    func testChatToBranchFocusIsInactiveOutsideSplitOrWhenLinkIsOff() throws {
        let local = try store(), state = ChatState(store: local)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        try state.focusBranchEditor(nodeID: "n-user")
        XCTAssertNil(state.branchEditorFocus)
        XCTAssertFalse(state.canNavigateBack)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)

        try state.setChatActiveView(.splitHorizontal)
        state.branchEditorSyncEnabled = false
        let split = try state.publicationSnapshot(), splitDisk = try Data(contentsOf: local.fileURL)
        try state.focusBranchEditor(nodeID: "n-user")
        XCTAssertNil(state.branchEditorFocus)
        XCTAssertFalse(state.canNavigateBack)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try split.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), splitDisk)
        XCTAssertTrue(ChatState(store: local).branchEditorSyncEnabled)
    }
    func testChatToBranchFocusUsesSharedHistoryWithoutSavingContent() throws {
        let local = try store(), state = ChatState(store: local)
        try state.importWebData(fixture().encoded())
        try state.setChatActiveView(.splitVertical)
        let source = try XCTUnwrap(state.exchange?.source), disk = try Data(contentsOf: local.fileURL)
        let snapshot = try state.publicationSnapshot()
        try state.focusBranchEditor(nodeID: "n-user")
        let first = try XCTUnwrap(state.branchEditorFocus)
        XCTAssertEqual(first.chatID, state.selectedConversationID)
        XCTAssertEqual(first.nodeID, "n-user")
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertFalse(state.canNavigateForward)
        XCTAssertEqual(state.exchange?.source, source)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)

        try state.focusBranchEditor(nodeID: "n-user")
        let second = try XCTUnwrap(state.branchEditorFocus)
        XCTAssertNotEqual(second.token, first.token)
        state.consumeBranchEditorFocus(first.token)
        XCTAssertEqual(state.branchEditorFocus, second)
        state.consumeBranchEditorFocus(second.token)
        XCTAssertNil(state.branchEditorFocus)
        try state.moveNavigation(.back)
        XCTAssertTrue(state.canNavigateForward)
        XCTAssertNil(ChatState(store: local).branchEditorFocus)
    }
    func testBranchNodeDetailMovesOnlyOtherPathWithoutFocusAndKeepsFailedSaveAtomic() throws {
        var rejects = false
        let local = try store { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        var source = try fixture(), chats = try source.required("chats").array("chats")
        chats.append(chats[0].replacing("id", with: .string("other-tree")))
        source = source.replacing("chats", with: .array(chats))
        let state = ChatState(store: local)
        try state.importWebData(source.encoded())
        try state.setChatActiveView(.splitVertical)
        let prior = try XCTUnwrap(ChatSearch.results(in: source, query: "別分岐の本文", mode: .nodes, chatIDs: ["chat-a"]).first)
        try state.navigateBranchSearch(prior)
        XCTAssertEqual(state.branchEditorFocus?.chatID, "chat-a")
        let before = try state.publicationSnapshot(), beforeSource = try XCTUnwrap(state.exchange?.source)
        let disk = try Data(contentsOf: local.fileURL)
        rejects = true
        XCTAssertThrowsError(try state.openBranchNodeDetail(chatID: "other-tree", nodeID: "n-inactive"))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(state.exchange?.source, beforeSource)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertEqual(state.branchEditorFocus?.chatID, "chat-a")
        rejects = false

        try state.openBranchNodeDetail(chatID: "other-tree", nodeID: "n-inactive")
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertEqual(state.chatActiveView, .splitVertical)
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertNil(state.branchEditorFocus)
        let changed = try XCTUnwrap(state.exchange?.source)
        XCTAssertEqual(try changed.required("chats").array("chats")[0], try beforeSource.required("chats").array("chats")[0])
        XCTAssertEqual(try changed.required("chats").array("chats")[2]["branchTree"]?["activePath"], .array(["n-system", "n-user", "n-inactive"].map(OrderedJSON.string)))
        XCTAssertEqual(ChatState(store: local).exchange?.source, changed)
        let records = try SyncRecords.toRecords(state.publicationSnapshot())
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(SyncRecords.fromRecords(records))), try SyncRecords.canonical(records))
    }

    func testBranchSearchMovesOtherChatWithoutSelectingItAndKeepsFailedSaveAtomic() throws {
        var rejects = false
        let local = try store { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        var source = try fixture(), chats = try source.required("chats").array("chats")
        chats.append(chats[0].replacing("id", with: .string("other-tree")))
        source = source.replacing("chats", with: .array(chats))
        let state = ChatState(store: local)
        try state.importWebData(source.encoded())
        try state.setChatActiveView(.branchEditor)
        state.branchEditorSyncEnabled = false
        let result = try XCTUnwrap(ChatSearch.results(in: source, query: "別分岐の本文", mode: .nodes, chatIDs: ["other-tree"]).first)
        XCTAssertEqual(result.chatID, "other-tree")
        XCTAssertEqual(result.nodeID, "n-inactive")
        let before = try state.publicationSnapshot(), beforeSource = try XCTUnwrap(state.exchange?.source)
        let disk = try Data(contentsOf: local.fileURL)
        rejects = true
        XCTAssertThrowsError(try state.navigateBranchSearch(result))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(state.exchange?.source, beforeSource)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertNil(state.branchEditorFocus)
        rejects = false

        try state.navigateBranchSearch(result)
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertEqual(state.chatActiveView, .branchEditor)
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertEqual(state.branchEditorFocus?.chatID, "other-tree")
        XCTAssertEqual(state.branchEditorFocus?.nodeID, "n-inactive")
        let updated = try XCTUnwrap(state.exchange?.source).required("chats").array("chats")
        XCTAssertEqual(updated[0], try beforeSource.required("chats").array("chats")[0])
        XCTAssertEqual(updated[2]["branchTree"]?["activePath"], .array(["n-system", "n-user", "n-inactive"].map(OrderedJSON.string)))
        XCTAssertEqual(ChatState(store: local).exchange?.source, state.exchange?.source)
    }

}
