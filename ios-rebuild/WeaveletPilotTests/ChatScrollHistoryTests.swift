import XCTest
@testable import WeaveletPilot

final class ChatScrollHistoryTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }

    private func store(writer: ((Data, URL) throws -> Void)? = nil) throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("chat-scroll-history-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json")
        return writer.map { LocalStateStore(fileURL: file, write: $0) } ?? LocalStateStore(fileURL: file)
    }

    private func anchor(_ offset: String) -> OrderedJSON {
        .object([.init(key:"firstVisibleItemIndex",value:.number("2")),.init(key:"offsetWithinItem",value:.number(offset)),.init(key:"wasAtBottom",value:.bool(false))])
    }

    func testScrollHistoryBackForwardRestoresCapturedAnchorWithoutPersistingIt() throws {
        let local = try store(), state = ChatState(store: local)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        // Viewport coordinates use Web JSON number serialization, independent of persisted raw data.
        let saved = anchor("123.5")

        try state.recordChatScrollNavigation(chatID: "chat-a", anchor: saved)
        XCTAssertTrue(state.canNavigateBack)
        XCTAssertNil(state.chatScrollRestoration)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)

        let afterScroll = anchor("456.25")
        state.captureChatScroll(chatID:"chat-a",anchor:afterScroll)
        try state.moveNavigation(.back)
        let back = try XCTUnwrap(state.chatScrollRestoration)
        XCTAssertEqual(back.chatID, "chat-a"); XCTAssertEqual(back.anchor, saved)
        state.completeChatScrollRestoration(id: back.id)
        try state.moveNavigation(.forward)
        let forward = try XCTUnwrap(state.chatScrollRestoration)
        XCTAssertEqual(forward.chatID, "chat-a"); XCTAssertEqual(forward.anchor, afterScroll)
        state.completeChatScrollRestoration(id: UUID())
        XCTAssertEqual(state.chatScrollRestoration, forward)
        state.completeChatScrollRestoration(id: forward.id)
        XCTAssertNil(state.chatScrollRestoration)
    }

    func testViewContextRestoresInSameAtomicNavigationSave() throws {
        var reject = false
        let local = try store { data,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to:url,options:.atomic)
        }
        let state = ChatState(store:local)
        try state.importWebData(fixture().encoded())
        try state.setChatActiveView(.chat)
        try state.recordChatScrollNavigation(chatID:"chat-a",anchor:anchor("10"))
        try state.setChatActiveView(.splitVertical)
        try state.recordChatScrollNavigation(chatID:"chat-a",anchor:anchor("20"))
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        reject = true
        XCTAssertThrowsError(try state.moveNavigation(.back))
        XCTAssertEqual(state.chatActiveView,.splitVertical)
        XCTAssertNil(state.chatScrollRestoration)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        reject = false
        try state.moveNavigation(.back)
        XCTAssertEqual(state.chatActiveView,.chat)
        let token = try XCTUnwrap(state.chatScrollRestoration).id
        state.completeChatScrollRestoration(id:token)
        try state.moveNavigation(.forward)
        XCTAssertEqual(state.chatActiveView,.splitVertical)
        XCTAssertEqual(try state.publicationSnapshot(),before)
    }

    func testUnicodeDistinctChatIDsKeepSeparateRuntimeScrollAnchors() throws {
        let local = try store(), state = ChatState(store: local)
        var source = try fixture(), chats = try source.required("chats").array("chats")
        chats[0] = chats[0].replacing("id", with: .string("é"))
        chats[1] = chats[1].replacing("id", with: .string("e\u{301}"))
        source = source.replacing("chats", with: .array(chats))
        try state.importWebData(source.encoded())
        let composed = "é", decomposed = "e\u{301}", saved = anchor("77")
        XCTAssertNotEqual(Data(composed.utf8), Data(decomposed.utf8))
        state.captureChatScroll(chatID: composed, anchor: saved)
        try state.navigate(chatID: decomposed, source: .chatSwitch)
        XCTAssertNil(state.chatScrollRestoration)
        let other = anchor("88")
        state.captureChatScroll(chatID: decomposed, anchor: other)
        try state.navigate(chatID: composed, source: .chatSwitch)
        XCTAssertEqual(state.chatScrollRestoration?.anchor, saved)
    }

    func testFailedNavigationDoesNotPublishScrollRestorationOrPersistRuntimeAnchor() throws {
        var rejects = false
        let local = try store { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        let state = ChatState(store: local)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot(), source = state.exchange?.source, disk = try Data(contentsOf: local.fileURL)
        state.captureChatScroll(chatID: "chat-a", anchor: anchor("45"))
        rejects = true
        XCTAssertThrowsError(try state.navigate(chatID: "chat-b", source: .chatSwitch))
        XCTAssertFalse(state.canNavigateBack)
        XCTAssertNil(state.chatScrollRestoration)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(state.exchange?.source, source)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
    }
}
