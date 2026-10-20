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
    func testOldCompressedWriterImportsAndRejectsDamagedContainersWithoutPublishing() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let url = root.appendingPathComponent("tests/fixtures/web-native/legacy-ios-sync-snapshot.wvlt")
        let bytes = try Data(contentsOf: url)
        let json = try Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/legacy-ios-sync-snapshot.json"))
        XCTAssertEqual(Array(bytes.prefix(4)), [0x54, 0x4c, 0x56, 0x57])
        XCTAssertEqual(try OrderedJSON.decode(NativeLegacySnapshot.decode(bytes)), try OrderedJSON.decode(json))
        let store = try local(), state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: store.fileURL)
        let preview = try await state.prepareImport(data: bytes, filename: "old.wvlt")
        XCTAssertEqual(try state.publicationSnapshot(), before)
        var invalid = [Data(bytes.prefix(19)), bytes + Data([0])]
        let mutations: [(Int, UInt8)] = [(4, 2), (6, 2), (16, 1), (8, 0xff), (11, 0xff), (12, 0xff), (20, 0)]
        for (offset, value) in mutations {
            var changed = bytes; changed[offset] = value; invalid.append(changed)
        }
        // A second frame is rejected even if the outer compressed length includes it.
        var doubled = bytes + bytes.dropFirst(20)
        let length = UInt32(doubled.count - 20)
        for i in 0..<4 { doubled[12 + i] = UInt8(truncatingIfNeeded: length >> (8 * i)) }
        invalid.append(doubled)
        for bad in invalid {
            do { _ = try await state.prepareImport(data: bad, filename: "damaged.wvlt"); XCTFail("damaged old container accepted") } catch {}
            XCTAssertEqual(try state.publicationSnapshot(), before)
            XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        }
        try await state.commitImport(preview, mode: .replace, selectedChatIDs: preview.conversations.map(\.id), selectedFolderIDs: preview.folderRows.map(\.id), includeSettings: false)
        let result = try OrderedJSON.decode(state.exportWebData())
        XCTAssertEqual(result["deviceId"], .string("FAKE-LEGACY-DEVICE"))
        XCTAssertEqual(result["contentStore"]?["unreferenced"], try OrderedJSON.decode(json)["contentStore"]?["unreferenced"])
        XCTAssertEqual(try ChatState(store: store).exportWebData(), try state.exportWebData())
        XCTAssertEqual(try Data(contentsOf: url), bytes)
    }

    func testOldIOSWriterJSONUsesSharedImportWithoutLosingRawValues() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let opaque = try OrderedJSON.decode(Data(#"{"z":9007199254740993,"a":1.2300,"utf16":"\ud800"}"#.utf8))
        for name in ["legacy-ios-app-state", "legacy-ios-sync-snapshot"] {
            let url = root.appendingPathComponent("tests/fixtures/web-native/\(name).json")
            let original = try Data(contentsOf: url)
            var input = try OrderedJSON.decode(original)
            var chats = try input.required("chats").array("chats")
            let tree = try chats[0].required("branchTree"), nodes = try tree.required("nodes")
            XCTAssertNil(nodes["root"]?["parentId"])
            chats[0] = chats[0].replacing("branchTree", with: tree.replacing("nodes", with: nodes.replacing("root", with: try nodes.required("root").replacing("xRaw", with: opaque))))
            input = input.replacing("chats", with: .array(chats)).replacing("xRaw", with: opaque)
            let store = try local(), state = ChatState(store: store)
            try state.importWebData(fixture().encoded())
            let before = try state.publicationSnapshot(), disk = try Data(contentsOf: store.fileURL)
            let preview = try await state.prepareImport(data: input.encoded(), filename: name + ".json")
            XCTAssertEqual(try state.publicationSnapshot(), before)
            XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
            XCTAssertEqual(preview.conversations.count, 2)
            XCTAssertTrue(preview.unavailableContent.values.allSatisfy(\.isEmpty))
            let sourceChats = try preview.source.required("chats").array("chats")
            let importedNodes = try sourceChats[0].required("branchTree").required("nodes")
            XCTAssertEqual(importedNodes["root"]?["parentId"], .null)
            XCTAssertEqual(try importedNodes.required("root").required("xRaw").encoded(), try opaque.encoded())
            XCTAssertEqual(importedNodes["inactive"], nodes["inactive"])
            // Web normalization adds the config system body and flat body; original entries remain raw.
            let previewStore = try preview.source.required("contentStore")
            XCTAssertEqual(try previewStore.object("preview store").count, try input.required("contentStore").object("old store").count + 2)
            for entry in try input.required("contentStore").object("old store") {
                XCTAssertEqual(try previewStore.required(entry.key).encoded(), try entry.value.encoded())
            }
            let systemHash = try importedNodes.required("root").required("contentHash").string("system hash")
            let systemContent = OrderedJSON.array([.object([.init(key: "type", value: .string("text")), .init(key: "text", value: .string("system instruction"))])])
            XCTAssertNil(input["contentStore"]?[systemHash])
            XCTAssertEqual(previewStore[systemHash]?["content"], systemContent)
            XCTAssertEqual(previewStore[systemHash]?["refCount"], .number("1"))
            try await state.commitImport(preview, mode: .replace, selectedChatIDs: preview.conversations.map(\.id), selectedFolderIDs: preview.folderRows.map(\.id), includeSettings: false)
            let exported = try OrderedJSON.decode(state.exportWebData())
            XCTAssertEqual(try exported.required("xRaw").encoded(), try opaque.encoded())
            XCTAssertEqual(exported["currentChatID"], input["currentChatID"])
            for key in ["snapshotVersion", "updatedAt", "deviceId"] { XCTAssertEqual(exported[key], input[key]) }
            XCTAssertEqual(exported["folders"], input["folders"])
            let savedStore = try exported.required("contentStore")
            for entry in try input.required("contentStore").object("old store") {
                XCTAssertEqual(try savedStore.required(entry.key).encoded(), try entry.value.encoded())
            }
            let savedChats = try exported.required("chats").array("chats")
            XCTAssertEqual(savedChats[0]["collapsedNodes"], chats[0]["collapsedNodes"])
            XCTAssertEqual(savedChats[0]["omittedNodes"], chats[0]["omittedNodes"])
            XCTAssertEqual(savedChats[0]["protectedNodes"], chats[0]["protectedNodes"])
            XCTAssertEqual(savedChats[0]["branchTree"]?["nodes"]?["root"]?["xRaw"], opaque)
            // materializeActivePath constructs role then content; only the object key order changes.
            let flatMessages = try chats[1].required("messages").array("flat messages")
            let materialized = try flatMessages.map { message in
                OrderedJSON.object([.init(key: "role", value: try message.required("role")), .init(key: "content", value: try message.required("content"))])
            }
            XCTAssertEqual(savedChats[1]["messages"], .array(materialized))
            let flatTree = try savedChats[1].required("branchTree")
            let flatID = try XCTUnwrap(flatTree.required("activePath").array("flat path").first).string("flat ID")
            let flatHash = try flatTree.required("nodes").required(flatID).required("contentHash").string("flat hash")
            XCTAssertEqual(savedStore[flatHash]?["content"], flatMessages[0]["content"])
            XCTAssertEqual(try ChatState(store: store).exportWebData(), try state.exportWebData())
            XCTAssertEqual(try Data(contentsOf: url), original)
            if name == "legacy-ios-sync-snapshot" {
                let after = try state.publicationSnapshot(), saved = try Data(contentsOf: store.fileURL)
                for bad in [input.replacing("snapshotVersion", with: .number("2")), input.replacing("contentStore", with: .array([]))] {
                    do { _ = try await state.prepareImport(data: bad.encoded(), filename: "invalid.json"); XCTFail("invalid old data accepted") } catch {}
                    XCTAssertEqual(try state.publicationSnapshot(), after)
                    XCTAssertEqual(try Data(contentsOf: store.fileURL), saved)
                }
            }
        }
    }

    func testPreviewAppendKeepsRawExtensionsAndExistingStateAcrossRestartAndRejectsRepeatedCommit() async throws {
        let opaque = OrderedJSON.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300")),.init(key:"word",value:.string("e\u{301} 日本語"))])
        var input = try fixture(), chats = try input.required("chats").array("chats")
        let summary = try OrderedJSON.decode(Data(#"{"id":"summary","mode":"single","text":"Summary","useForSubmit":true,"sources":[],"generation":{"model":"fake","createdAt":1,"settings":{"temperature":0.7,"max_tokens":100,"reasoning_effort":"low","xRaw":9007199254740993}}}"#.utf8))
        chats[0] = chats[0].replacing("xRaw",with:opaque).replacing("summaries",with:.array([summary]))
        input = input.replacing("chats",with:.array(chats)).replacing("xFuture",with:opaque)
        let store = try local(), state = ChatState(store:store)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot()
        let preview = try await state.prepareImport(data:NativeGzip.compress(input.encoded()),filename:"incoming.json.gz")
        XCTAssertEqual(preview.conversations.count,chats.count)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        let selected = try XCTUnwrap(preview.conversations.first).id
        try await state.commitImport(preview,mode:.append,selectedChatIDs:[selected],selectedFolderIDs:[],includeSettings:false)
        let after = try state.publicationSnapshot(), savedChats = try after.required("state").required("chats").array("chats")
        XCTAssertEqual(savedChats.count,try before.required("state").required("chats").array("chats").count + 1)
        XCTAssertEqual(try savedChats[0].required("xRaw").encoded(),try opaque.encoded())
        XCTAssertEqual(try savedChats[0].required("summaries").encoded(), try OrderedJSON.array([summary]).encoded())
        XCTAssertNotEqual(savedChats[0]["id"],chats[0]["id"])
        XCTAssertNil(after["state"]?["xFuture"])
        XCTAssertEqual(try OrderedJSON.decode(state.exportWebData()).required("xFuture").encoded(),try opaque.encoded())
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
        do { try await state.commitImport(preview,mode:.append,selectedChatIDs:[selected],selectedFolderIDs:[],includeSettings:false); XCTFail("stale preview accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),after)
    }
    func testLoneUTF16MetadataAndKnownTextSurviveSharedImportSaveRestartAndExport() async throws {
        let raw = try OrderedJSON.decode(Data(#"{"\ud800":"\udc00","\udc00":"\ud800","�":"replacement","number":9007199254740993,"decimal":1.2300}"#.utf8))
        let rootKey = JSONString(utf16: [0x78, 0xd800])
        var input = try fixture(), chats = try input.required("chats").array("chats")
        chats[0] = chats[0].replacing("id",with:.utf16String([0xd800])).replacing("title",with:.utf16String([0x41,0xd800,0x42])).replacing("xUTF16",with:raw)
        input = input.replacing("chats",with:.array(chats)).replacing(rootKey,with:raw)
        let store = try local(), state = ChatState(store:store)
        let preview = try await state.prepareImport(data:input.encoded(),filename:"utf16.json")
        let first = try XCTUnwrap(preview.conversations.first)
        XCTAssertFalse(first.id.isEmpty)
        let previewChats = try preview.source.required("chats").array("chats")
        XCTAssertNotEqual(previewChats[0]["id"], .utf16String([0xd800]))
        XCTAssertEqual(try previewChats[0].required("id").string("shared normalized ID"), first.id)
        XCTAssertEqual(first.title, "A�B")
        XCTAssertEqual(previewChats[0]["title"], .utf16String([0x41,0xd800,0x42]))
        XCTAssertEqual(previewChats[0]["xUTF16"], raw)
        try await state.commitImport(preview,mode:.replace,selectedChatIDs:preview.conversations.map(\.id),selectedFolderIDs:[],includeSettings:true)
        let exported = try OrderedJSON.decode(state.exportWebData())
        XCTAssertEqual(exported[rootKey], raw)
        let exportedChats = try exported.required("chats").array("chats")
        XCTAssertEqual(exportedChats[0]["xUTF16"], raw)
        XCTAssertEqual(exportedChats[0]["title"], .utf16String([0x41,0xd800,0x42]))
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
        XCTAssertEqual(restarted.document?.v3RootOrder,state.document?.v3RootOrder)
        // Preview commits keep the base order; direct V3 import captures the exported raw root order.
        let directStore = try local(), direct = ChatState(store:directStore)
        try direct.importWebData(exported.encoded())
        XCTAssertEqual(try XCTUnwrap(direct.document).v3RootOrder, try exported.object("V3").map(\.key))
        XCTAssertTrue(try XCTUnwrap(direct.document).v3RootOrder.contains(rootKey))
        XCTAssertEqual(ChatState(store:directStore).document?.v3RootOrder,direct.document?.v3RootOrder)
        XCTAssertEqual(try ChatState(store:directStore).exportWebData(),try direct.exportWebData())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        do { _ = try await state.prepareImport(data:Data(#"{"version":3,"x":"\ud800\q"}"#.utf8),filename:"invalid.json"); XCTFail("invalid escape accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
    }

    func testLegacyPrepareUsesSharedConversionAndSaveFailureCanRetryWithoutPublishing() async throws {
        let store = try local(), state = ChatState(store:store)
        try state.importWebData(fixture().encoded())
        let legacy = try state.exportWebData(format:.v1,scope:.all).data
        let preview = try await state.prepareImport(data:legacy,filename:"legacy.json")
        let ids = preview.conversations.map(\.id), before = try state.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        try FileManager.default.removeItem(at:store.fileURL)
        try FileManager.default.createDirectory(at:store.fileURL,withIntermediateDirectories:false)
        do { try await state.commitImport(preview,mode:.replace,selectedChatIDs:ids,selectedFolderIDs:[],includeSettings:false); XCTFail("save failure published") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),before)
        try FileManager.default.removeItem(at:store.fileURL); try disk.write(to:store.fileURL)
        try await state.commitImport(preview,mode:.replace,selectedChatIDs:ids,selectedFolderIDs:[],includeSettings:false)
        XCTAssertEqual(state.conversations.count,ids.count)
        XCTAssertEqual(try ChatState(store:store).exportWebData(),try state.exportWebData())
    }
    func testSettingsReplacementUsesWebInitialStateAndRemovesUndefinedRoots() async throws {
        let state = ChatState(store: try local())
        try state.importWebData(fixture().encoded())
        let snapshot = try state.publicationSnapshot()
        let custom = try snapshot.required("state").replacing("theme", with: .string("custom")).replacing("apiKey", with: .string("FAKE ONLY")).replacing("xFuture", with: .number("9007199254740993"))
        try state.applySnapshot(snapshot.replacing("state", with: custom))
        let input = try state.exportWebData(format: .v1, scope: .all).data
        let preview = try await state.prepareImport(data: input, filename: "legacy.json")
        try await state.commitImport(preview, mode: .replace, selectedChatIDs: preview.conversations.map(\.id), selectedFolderIDs: preview.folderRows.map(\.id), includeSettings: true)
        let result = try state.publicationSnapshot().required("state"), defaults = try ChatImport.call("defaults")
        XCTAssertEqual(result["theme"], defaults["theme"])
        XCTAssertEqual(result["evaluationSettings"], defaults["evaluationSettings"])
        XCTAssertNil(result["apiKey"])
        XCTAssertEqual(result["xFuture"], .number("9007199254740993"))
    }

    func testDistinctUnicodeFolderIdentitiesCanBeSelectedIndependently() async throws {
        let state = ChatState(store: try local())
        let composed = "é", decomposed = "e\u{301}"
        func folder(_ id: String) -> OrderedJSON {
            .object([.init(key: "id", value: .string(id)), .init(key: "name", value: .string(id)), .init(key: "order", value: .number("0")), .init(key: "expanded", value: .bool(true))])
        }
        let source = ChatLibrary.emptySource.replacing("folders", with: .object([
            .init(key: composed, value: folder(composed)), .init(key: decomposed, value: folder(decomposed))]))
        let preview = try await state.prepareImport(data: source.encoded(), filename: "folders.json")
        XCTAssertEqual(Set(preview.folderRows.map(\.identity)).count, 2)
        let selected = Set([Data(decomposed.utf8)])
        let ids = preview.folderRows.filter { selected.contains($0.identity) }.map(\.id)
        XCTAssertEqual(ids.map { Data($0.utf8) }, [Data(decomposed.utf8)])
        try await state.commitImport(preview, mode: .append, selectedChatIDs: [], selectedFolderIDs: ids, includeSettings: false)
        let folders = try state.publicationSnapshot().required("state").required("folders").object("folders")
        XCTAssertEqual(folders.count, 2) // Import root plus the selected folder.
        XCTAssertEqual(try folders.filter { $0.value["parentId"] != nil }.map { try $0.value.required("name").string("name") }.map { Data($0.utf8) }, [Data(decomposed.utf8)])
    }

    func testNormalizationEquivalentMetadataChangeInvalidatesPreparedReplacement() async throws {
        let state = ChatState(store: try local())
        try state.importWebData(fixture().encoded())
        let snapshot = try state.publicationSnapshot()
        try state.applySnapshot(snapshot.replacing("state", with: snapshot.required("state").replacing("xUnicode", with: .string("é"))))
        let preview = try await state.prepareImport(data: fixture().encoded(), filename: "source.json")
        let current = try state.publicationSnapshot()
        try state.applySnapshot(current.replacing("state", with: current.required("state").replacing("xUnicode", with: .string("e\u{301}"))))
        let changed = try state.publicationSnapshot().encoded()
        do {
            try await state.commitImport(preview, mode: .replace, selectedChatIDs: preview.conversations.map(\.id), selectedFolderIDs: [], includeSettings: false)
            XCTFail("normalization-equivalent edit was overwritten")
        } catch {}
        XCTAssertEqual(try state.publicationSnapshot().encoded(), changed)
    }

    func testEmptyFileCannotAppendButExplicitReplacementPersistsEmptyLibrary() async throws {
        let store = try local(), state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        let before = try state.publicationSnapshot()
        let preview = try await state.prepareImport(data: ChatLibrary.emptySource.encoded(), filename: "empty.json")
        XCTAssertTrue(preview.conversations.isEmpty)
        do {
            try await state.commitImport(preview, mode: .append, selectedChatIDs: [], selectedFolderIDs: [], includeSettings: false)
            XCTFail("empty append accepted")
        } catch {}
        XCTAssertEqual(try state.publicationSnapshot(), before)
        try await state.commitImport(preview, mode: .replace, selectedChatIDs: [], selectedFolderIDs: [], includeSettings: false)
        XCTAssertTrue(state.conversations.isEmpty)
        XCTAssertTrue(try state.publicationSnapshot().required("state").required("folders").object("folders").isEmpty)
        XCTAssertEqual(try ChatState(store: store).exportWebData(), try state.exportWebData())
    }

    func testModelLessPlaygroundImportPreservesTopLevelSettings() async throws {
        let state = ChatState(store: try local())
        let input = Data(#"{"messages":[{"role":"user","content":"hello"}],"temperature":0.7,"max_tokens":123}"#.utf8)
        let preview = try await state.prepareImport(data: input, filename: "playground.json")
        let config = try XCTUnwrap(preview.source.required("chats").array("chats").first).required("config")
        XCTAssertEqual(try config.required("temperature").number("temperature"), 0.7)
        XCTAssertEqual(try config.required("max_tokens").number("max_tokens"), 123)
        XCTAssertEqual(preview.conversations.first?.visibleMessages.first?.parts, [.text("hello")])
    }

    func testFullSnapshotRootChangeRejectsPreparedImportAndNullOpenAIEntriesRemainSupported() async throws {
        let state = ChatState(store:try local()); try state.importWebData(fixture().encoded())
        let preview = try await state.prepareImport(data:fixture().encoded(),filename:"source.json")
        let snapshot = try state.publicationSnapshot()
        try state.applySnapshot(.object([.init(key:"version",value:snapshot.required("version")),.init(key:"state",value:.object([.init(key:"defaultSystemMessage",value:.string("changed outside chats"))]))]))
        let changed = try state.publicationSnapshot()
        do { try await state.commitImport(preview,mode:.append,selectedChatIDs:preview.conversations.map(\.id),selectedFolderIDs:[],includeSettings:false); XCTFail("root change accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),changed)
        let partial = Data(#"{"title":"OpenAI","mapping":{"root":{"id":"root","parent":null,"children":["empty"],"message":{"author":{"role":"user"},"content":{"parts":["hello"]}}},"empty":{"id":"empty","parent":"root","children":[],"message":null}},"current_node":"empty"}"#.utf8)
        // The existing Web converter skips null messages; this input does not require partial approval.
        let prepared = try await state.prepareImport(data:partial,filename:"partial.json")
        XCTAssertEqual(try state.publicationSnapshot(),changed)
        try await state.commitImport(prepared,mode:.append,selectedChatIDs:prepared.conversations.map(\.id),selectedFolderIDs:[],includeSettings:false)
        XCTAssertTrue(state.conversations.contains { $0.visibleMessages.contains { $0.parts.contains(.text("hello")) } })
    }

}
