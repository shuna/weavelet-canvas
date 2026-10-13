import XCTest
@testable import WeaveletPilot

final class ChatConfigTests: XCTestCase {
    @MainActor
    func testSavedDefaultsSurviveFileIORestartEncryptedSyncAndCreateReplacement() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("defaults-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:dir) }
        let raw = try OrderedJSON.decode(Data(#"{"z":9007199254740993,"a":1.2300,"opaqueRef":0}"#.utf8))
        let initial = try ChatDefaults.webInitial()
        let config = initial.config.replacing("model",with:.string("saved-model")).replacing("modelSource",with:.string("remote"))
            .replacing("providerId",with:.string("openrouter")).replacing("max_tokens",with:.number("4000")).replacing("temperature",with:.number("0.2300")).replacing("xUnknown",with:raw)
            .replacing("systemPrompt",with:.string("old config prompt"))
        let settings = OrderedJSON.object([]).replacing("defaultChatConfig",with:config)
            .replacing("defaultSystemMessage",with:.string("保存された指示 e\u{301}"))
            .replacing("defaultImageDetail",with:.string("high"))
            .replacing("providerModelCache",with:try OrderedJSON.decode(Data(#"{"openrouter":[{"id":"saved-model","name":"fake","providerId":"openrouter","contextLength":10000,"maxCompletionTokens":3200,"streamSupport":false}]}"#.utf8)))
        let senderStore = LocalStateStore(fileURL:dir.appendingPathComponent("sender.json")), sender = ChatState(store:senderStore)
        try sender.importWebData(ChatLibrary.emptySource.replacing("xUntouched",with:raw).encoded())
        // Web V3 files carry chats; these global defaults belong to the full persisted/sync snapshot.
        let baseline = try sender.publicationSnapshot()
        var roots = try baseline.required("state")
        for field in try settings.object("settings") { roots = roots.replacing(field.key,with:field.value) }
        try sender.applySnapshot(baseline.replacing("state",with:roots))
        try sender.createChat(id:"created",now:1)
        let created = try XCTUnwrap(sender.exchange).source.required("chats").array("chats")[0]
        XCTAssertEqual(created["config"]?["model"],.string("saved-model"))
        XCTAssertEqual(created["config"]?["max_tokens"],.number("3200"))
        XCTAssertEqual(created["config"]?["stream"],.bool(false))
        XCTAssertEqual(created["config"]?["systemPrompt"],settings["defaultSystemMessage"])
        XCTAssertEqual(created["imageDetail"],.string("high"))
        XCTAssertEqual(try created.required("config").required("xUnknown").encoded(),try raw.encoded())
        XCTAssertEqual(try created.required("config").required("temperature").encoded(),Data("0.2300".utf8))
        XCTAssertEqual(try sender.defaultChatConfigDraft().config.encoded(),try config.encoded())
        let restarted = ChatState(store:senderStore)
        XCTAssertEqual(try restarted.exportWebData(),try sender.exportWebData())
        let drive = FakeSyncDrive(), keys = TestSyncKeys()
        let publisher = GoogleSyncController(chatState:restarted,drive:drive,store:SyncStateStore(fileURL:dir.appendingPathComponent("publish.json")),keyStore:keys)
        try await publisher.create(password:"FAKE TEST ONLY default settings")
        try await publisher.synchronize()
        let receiverStore = LocalStateStore(fileURL:dir.appendingPathComponent("receiver.json")), receiver = ChatState(store:receiverStore)
        let subscriber = GoogleSyncController(chatState:receiver,drive:drive,store:SyncStateStore(fileURL:dir.appendingPathComponent("receive.json")),keyStore:keys)
        try await subscriber.open(dataset:XCTUnwrap(publisher.dataset))
        let unlocked = try await subscriber.restoreKey(); XCTAssertTrue(unlocked)
        try await subscriber.download()
        let received = ChatState(store:receiverStore)
        for key in ["defaultChatConfig","defaultSystemMessage","defaultImageDetail"] {
            // Match the existing Web records JSON number/key-order semantics; file I/O above stays byte-exact.
            XCTAssertEqual(try SyncRecords.canonical(XCTUnwrap(received.publicationSnapshot()["state"]?[key])),
                try SyncRecords.canonical(XCTUnwrap(restarted.publicationSnapshot()["state"]?[key])))
        }
        try received.deleteChats(ids:received.conversations.map(\.id),replacementID:"replacement",now:2)
        let replacement = try XCTUnwrap(received.exchange).source.required("chats").array("chats")[0]
        XCTAssertEqual(replacement["id"],.string("replacement"))
        XCTAssertEqual(replacement["config"]?["model"],.string("saved-model"))
        XCTAssertEqual(replacement["config"]?["systemPrompt"],settings["defaultSystemMessage"])
        XCTAssertEqual(replacement["imageDetail"],.string("high"))
        XCTAssertEqual(try SyncRecords.canonical(replacement.required("config").required("xUnknown")),try SyncRecords.canonical(raw))
        XCTAssertEqual(try OrderedJSON.decode(restarted.exportWebData()).required("xUntouched").encoded(),try raw.encoded())
    }

    func testFreshDefaultSettingsSaveFailureStaleGuardAndEmptySystemMessage() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("default-edit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer { try? FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:dir.path); try? FileManager.default.removeItem(at:dir) }
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json")), state = ChatState(store:store)
        var initial = try state.defaultChatConfigDraft()
        initial.config = initial.config.replacing("model",with:.string("default-edited"))
        initial.defaultSettings = ("initial system", "low")
        try state.saveDefaultChatConfig(initial)
        try state.createChat(id:"prior")
        let prior = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]
        var edited = try state.defaultChatConfigDraft()
        edited.config = edited.config.replacing("systemPrompt",with:.string("must be cleared on create"))
        edited.defaultSettings = ("", "auto")
        let before = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:dir.path)
        XCTAssertThrowsError(try state.saveDefaultChatConfig(edited))
        XCTAssertEqual(try state.publicationSnapshot().encoded(),before); XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:dir.path)
        try state.saveDefaultChatConfig(edited)
        XCTAssertThrowsError(try state.saveDefaultChatConfig(initial))
        let restored = ChatState(store:store)
        XCTAssertEqual(try restored.exportWebData(),try state.exportWebData())
        try restored.createChat(id:"after-settings")
        let config = try XCTUnwrap(restored.exchange).source.required("chats").array("chats")[0].required("config")
        XCTAssertEqual(config["model"],.string("default-edited")); XCTAssertNil(config["systemPrompt"])
        let kept = try XCTUnwrap(restored.exchange).source.required("chats").array("chats").first { $0["id"] == .string("prior") }
        XCTAssertEqual(try XCTUnwrap(kept).encoded(),try prior.encoded())
    }

    func testSharedSwitchKeepsRawSavedAttributesAndAtomicFailureStaleGuard() throws {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        var source = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/remote-generation.json"))).required("cases").array("cases")[0].required("source")
        let raw = OrderedJSON.object([.init(key:"huge",value:.number("9007199254740993")),.init(key:"decimal",value:.number("1.2300")),.init(key:"marker",value:.object([.init(key:"opaqueRef",value:.number("0"))]))])
        var chats = try source.required("chats").array("chats")
        let oldKey = "[\"remote\",\"openai\",\"fake-model\"]", newKey = "[\"remote\",\"\",\"new-model\"]"
        let settings = OrderedJSON.object([.init(key:oldKey,value:.object([.init(key:"xOld",value:raw)])),.init(key:newKey,value:.object([.init(key:"max_tokens",value:.number("240")),.init(key:"temperature",value:.number("0.12300")),.init(key:"xTarget",value:raw)]))])
        chats[0] = chats[0].replacing("config",with:try chats[0].required("config").replacing("xConfig",with:raw).replacing("modelSettings",with:settings))
        source = source.replacing("chats",with:.array(chats))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("config-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path); try? FileManager.default.removeItem(at:directory) }
        let local = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")), state = ChatState(store:local)
        try state.importWebData(source.encoded())
        var draft = try state.chatConfigDraft()
        let before = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:local.fileURL)
        draft.config = try ChatConfig.switched(draft.config,model:"new-model",providerID:nil,modelState:draft.modelState)
        XCTAssertEqual(draft.config["model"],.string("new-model")); XCTAssertEqual(draft.config["max_tokens"],.number("240"))
        XCTAssertEqual(try draft.config.required("xTarget").encoded(),try raw.encoded())
        XCTAssertEqual(try draft.config.required("modelSettings").required(oldKey).required("xOld").encoded(),try raw.encoded())
        XCTAssertEqual(try draft.config.required("modelSettings").required(newKey).required("temperature").encoded(),Data("0.12300".utf8))
        try FileManager.default.setAttributes([.posixPermissions:0o500],ofItemAtPath:directory.path)
        XCTAssertThrowsError(try state.saveChatConfig(draft))
        XCTAssertEqual(try state.publicationSnapshot().encoded(),before); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        try state.saveChatConfig(draft)
        XCTAssertThrowsError(try state.saveChatConfig(draft))
        XCTAssertEqual(try ChatState(store:local).exportWebData(),try state.exportWebData())
        XCTAssertEqual(try state.chatConfigDraft().config.required("xTarget").encoded(),try raw.encoded())
        XCTAssertTrue(ChatConfigView.valuesDiffer("\u{00e9}","e\u{0301}"))
        var composed = try state.chatConfigDraft()
        composed.config = composed.config.replacing("xUnicode",with:.string("\u{00e9}"))
        try state.saveChatConfig(composed)
        var stale = try state.chatConfigDraft(), decomposed = stale
        decomposed.config = decomposed.config.replacing("xUnicode",with:.string("e\u{0301}"))
        try state.saveChatConfig(decomposed)
        XCTAssertEqual(try state.chatConfigDraft().config.required("xUnicode").encoded(),try OrderedJSON.string("e\u{0301}").encoded())
        stale.config = stale.config.replacing("temperature",with:.number("0.2"))
        XCTAssertThrowsError(try state.saveChatConfig(stale))
    }
}
