import XCTest
@testable import WeaveletPilot

final class ChatImportTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/message-editing.json"))).required("cases").array("cases")[0].required("input")
    }
    private func local() throws -> LocalStateStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("import-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        return LocalStateStore(fileURL:root.appendingPathComponent("state.json"))
    }
    func testPreviewAppendKeepsRawExtensionsAndExistingStateAcrossRestartAndRejectsRepeatedCommit() async throws {
        let opaque = OrderedJSON.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300")),.init(key:"word",value:.string("e\u{301} 日本語"))])
        var input = try fixture(), chats = try input.required("chats").array("chats")
        chats[0] = chats[0].replacing("xRaw",with:opaque)
        input = input.replacing("chats",with:.array(chats)).replacing("xFuture",with:opaque)
        let store = try local(), state = ChatState(store:store)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot()
        let preview = try await state.prepareImport(data:NativeGzip.compress(input.encoded()),filename:"incoming.json.gz")
        XCTAssertEqual(preview.conversations.count,chats.count)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        let selected = try chats[0].required("id").string("id")
        try await state.commitImport(preview,mode:.append,selectedChatIDs:[selected],selectedFolderIDs:[],includeSettings:false,allowPartialImport:false)
        let after = try state.publicationSnapshot(), savedChats = try after.required("state").required("chats").array("chats")
        XCTAssertEqual(savedChats.count,try before.required("state").required("chats").array("chats").count + 1)
        XCTAssertEqual(try savedChats[0].required("xRaw").encoded(),try opaque.encoded())
        XCTAssertNotEqual(savedChats[0]["id"],chats[0]["id"])
        XCTAssertNil(after["state"]?["xFuture"])
        XCTAssertEqual(try OrderedJSON.decode(state.exportWebData()).required("xFuture").encoded(),try opaque.encoded())
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
        do { try await state.commitImport(preview,mode:.append,selectedChatIDs:[selected],selectedFolderIDs:[],includeSettings:false,allowPartialImport:false); XCTFail("stale preview accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),after)
    }
    func testLegacyPrepareUsesSharedConversionAndSaveFailureCanRetryWithoutPublishing() async throws {
        let store = try local(), state = ChatState(store:store)
        try state.importWebData(fixture().encoded())
        let legacy = try state.exportWebData(format:.v1,scope:.all).data
        let preview = try await state.prepareImport(data:legacy,filename:"legacy.json")
        let ids = preview.conversations.map(\.id), before = try state.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        try FileManager.default.removeItem(at:store.fileURL)
        try FileManager.default.createDirectory(at:store.fileURL,withIntermediateDirectories:false)
        do { try await state.commitImport(preview,mode:.replace,selectedChatIDs:ids,selectedFolderIDs:[],includeSettings:false,allowPartialImport:false); XCTFail("save failure published") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),before)
        try FileManager.default.removeItem(at:store.fileURL); try disk.write(to:store.fileURL)
        try await state.commitImport(preview,mode:.replace,selectedChatIDs:ids,selectedFolderIDs:[],includeSettings:false,allowPartialImport:false)
        XCTAssertEqual(state.conversations.count,ids.count)
        XCTAssertEqual(try ChatState(store:store).exportWebData(),try state.exportWebData())
    }
    func testFullSnapshotRootChangeRejectsPreparedImportAndPartialDecisionRequiresApproval() async throws {
        let state = ChatState(store:try local()); try state.importWebData(fixture().encoded())
        let preview = try await state.prepareImport(data:fixture().encoded(),filename:"source.json")
        let snapshot = try state.publicationSnapshot()
        try state.applySnapshot(.object([.init(key:"version",value:snapshot.required("version")),.init(key:"state",value:.object([.init(key:"defaultSystemMessage",value:.string("changed outside chats"))]))]))
        let changed = try state.publicationSnapshot()
        do { try await state.commitImport(preview,mode:.append,selectedChatIDs:preview.conversations.map(\.id),selectedFolderIDs:[],includeSettings:false,allowPartialImport:false); XCTFail("root change accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),changed)
        let partial = Data(#"{"title":"OpenAI","mapping":{"root":{"id":"root","parent":null,"children":["empty"],"message":{"author":{"role":"user"},"content":{"parts":["hello"]}}},"empty":{"id":"empty","parent":"root","children":[],"message":null}},"current_node":"empty"}"#.utf8)
        do { _ = try await state.prepareImport(data:partial,filename:"partial.json"); XCTFail("approval skipped") }
        catch let decision as ChatImportDecisionRequired { XCTAssertEqual(decision.kind,"partial-import") }
        XCTAssertEqual(try state.publicationSnapshot(),changed)
        let approved = try await state.prepareImport(data:partial,filename:"partial.json",allowPartialImport:true)
        XCTAssertTrue(approved.partialImportAccepted)
        try await state.commitImport(approved,mode:.append,selectedChatIDs:approved.conversations.map(\.id),selectedFolderIDs:[],includeSettings:false,allowPartialImport:false)
        XCTAssertTrue(state.conversations.contains { $0.visibleMessages.contains { $0.content == "hello" } })
    }

}
