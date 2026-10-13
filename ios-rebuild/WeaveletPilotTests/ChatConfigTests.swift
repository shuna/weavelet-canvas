import XCTest
@testable import WeaveletPilot

final class ChatConfigTests: XCTestCase {
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
