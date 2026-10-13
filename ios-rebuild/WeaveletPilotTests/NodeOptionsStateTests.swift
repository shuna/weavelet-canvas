import XCTest
@testable import WeaveletPilot

final class NodeOptionsStateTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }
    private func directory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-node-options-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }
    func testOptionsPersistExportSyncAndAffectSearchEditingAndGeneration() throws {
        let store = LocalStateStore(fileURL: try directory().appendingPathComponent("state.json"))
        let state = ChatState(store: store), original = try fixture()
        try state.importWebData(original.encoded())
        var draft = try state.nodeOptionsDraft(nodeID: "n-user")
        draft.value.label = "属性の検索確認"
        draft.value.starred = false; draft.value.pinned = true
        draft.value.collapsed = true; draft.value.omitted = true; draft.value.protected = true
        try state.saveNodeOptions(draft, now: 1000)
        XCTAssertEqual(state.conversation?.nodes.first { $0.id == "n-user" }?.options, draft.value)
        XCTAssertTrue(try state.messageDraft(nodeID: "n-user").isProtected)
        XCTAssertEqual(try ChatSearch.results(in: XCTUnwrap(state.exchange).source, query: "属性の検索確認", mode: .nodes).map(\.nodeID), ["n-user"])
        var assistant = try state.nodeOptionsDraft(nodeID: "n-assistant")
        assistant.value.omitted = true
        try state.saveNodeOptions(assistant, now: 1001)
        let savedSource = try XCTUnwrap(state.exchange).source
        let settings = RemoteSettings(endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "fake", stream: false)
        // The I/O corpus intentionally combines order+sort and a non-Claude model with Claude caching.
        XCTAssertThrowsError(try RemoteRequest.make(source:savedSource,chatID:"chat-a",path:["n-system","n-user","n-assistant"],settings:settings,key:"FAKE"))
        // Check omitted-node behavior with a valid request-only config; persisted corpus stays untouched.
        let requestChats = try savedSource.required("chats").array("chats").map { chat in
            chat["id"] == .string("chat-a") ? chat.replacing("config",with:.object([
                .init(key:"model",value:.string("fake")),.init(key:"stream",value:.bool(false))
            ])) : chat
        }
        let request = try RemoteRequest.make(source:savedSource.replacing("chats",with:.array(requestChats)),chatID:"chat-a",path:["n-system","n-user","n-assistant"],settings:settings,key:"FAKE")
        let body = try OrderedJSON.decode(XCTUnwrap(request.httpBody))
        // Web retains omitted tool exchanges, while ordinary text is excluded.
        XCTAssertTrue(try body.required("messages").array("messages").contains { $0["role"] == .string("user") })
        XCTAssertFalse(try body.required("messages").array("messages").contains { $0["role"] == .string("assistant") })
        XCTAssertEqual(state.exchange?.source["contentStore"], original["contentStore"])
        XCTAssertEqual(state.exchange?.source["xFixtureExport"], original["xFixtureExport"])
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(try restored.nodeOptionsDraft(nodeID: "n-user").value, draft.value)
        let imported = ChatState()
        try imported.importWebData(state.exportWebData())
        XCTAssertEqual(try imported.nodeOptionsDraft(nodeID: "n-user").value, draft.value)
        let records = try SyncRecords.toRecords(state.publicationSnapshot())
        let received = try SyncDocument(snapshot: SyncRecords.fromRecords(records)).uiProjection()
        XCTAssertEqual(try NodeOptions.read(in: received, chatID: "chat-a", nodeID: "n-user"), draft.value)
    }

    @MainActor
    func testOptionsCrossSharedEncryptedDriveAndFreshReceiver() async throws {
        let dir = try directory(), drive = FakeSyncDrive(), keys = TestSyncKeys()
        let sender = ChatState(store: LocalStateStore(fileURL: dir.appendingPathComponent("sender.json")))
        try sender.importWebData(fixture().encoded())
        let publisher = GoogleSyncController(chatState: sender, drive: drive, store: SyncStateStore(fileURL: dir.appendingPathComponent("sender-sync.json")), keyStore: keys)
        try await publisher.create(password: "FAKE TEST ONLY node settings", folderName: "FAKE settings")
        var draft = try sender.nodeOptionsDraft(nodeID: "n-user")
        draft.value.label = "同期後の属性"; draft.value.starred = false; draft.value.pinned = true
        draft.value.collapsed = true; draft.value.omitted = true; draft.value.protected = true
        try sender.saveNodeOptions(draft, now: 3000)
        try await publisher.synchronize()
        let receiverStore = LocalStateStore(fileURL: dir.appendingPathComponent("receiver.json"))
        let receiver = ChatState(store: receiverStore)
        let subscriber = GoogleSyncController(chatState: receiver, drive: drive, store: SyncStateStore(fileURL: dir.appendingPathComponent("receiver-sync.json")), keyStore: keys)
        try await subscriber.open(dataset: XCTUnwrap(publisher.dataset))
        let unlocked = try await subscriber.restoreKey()
        XCTAssertTrue(unlocked)
        try await subscriber.download()
        XCTAssertEqual(try receiver.nodeOptionsDraft(nodeID: "n-user").value, draft.value)
        XCTAssertEqual(try ChatState(store: receiverStore).nodeOptionsDraft(nodeID: "n-user").value, draft.value)
    }

    func testSaveFailureAndStaleDraftKeepAllStateAndDisk() throws {
        let fault = NodeOptionWriteFault()
        let store = LocalStateStore(fileURL: try directory().appendingPathComponent("state.json")) { bytes, url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to: url, options: .atomic)
        }
        let state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        var draft = try state.nodeOptionsDraft(nodeID: "n-user")
        draft.value.label = "保存失敗"
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: store.fileURL)
        fault.reject = true
        XCTAssertThrowsError(try state.saveNodeOptions(draft))
        XCTAssertEqual(try state.publicationSnapshot(), before)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        XCTAssertEqual(try state.nodeOptionsDraft(nodeID: "n-user").value, draft.original)
        fault.reject = false
        try state.renameChat(id: "chat-a", title: "別の編集")
        let edited = try state.publicationSnapshot()
        XCTAssertThrowsError(try state.saveNodeOptions(draft))
        XCTAssertEqual(try state.publicationSnapshot(), edited)
    }

    func testFlatMapOnlyStaysFlatAndLabelConvertsSelectionOnce() throws {
        let state = ChatState()
        try state.importWebData(fixture().encoded())
        state.selectedConversationID = "chat-b"
        var draft = try state.nodeOptionsDraft(nodeID: "message-0")
        draft.value.omitted = true
        try state.saveNodeOptions(draft, now: 1000)
        XCTAssertEqual(state.conversation?.visibleMessages.first?.id, "message-0")
        let chat = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[1]
        XCTAssertNil(chat["branchTree"])
        XCTAssertEqual(chat["omittedNodes"]?["0"], .bool(true))
        draft = try state.nodeOptionsDraft(nodeID: "message-0")
        draft.value.label = "平坦な会話から変換"
        let count = state.conversation!.nodes.count
        let ids = (0..<count).map { "converted-\($0)" }
        try state.saveNodeOptions(draft, newIDs: ids, now: 2000)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ids)
        XCTAssertEqual(try state.nodeOptionsDraft(nodeID: "converted-0").value.label, "平坦な会話から変換")
        XCTAssertTrue(try state.nodeOptionsDraft(nodeID: "converted-0").value.omitted)
    }
}
private final class NodeOptionWriteFault { var reject = false }
