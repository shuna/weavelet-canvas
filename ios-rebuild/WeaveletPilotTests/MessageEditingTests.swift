import XCTest
@testable import WeaveletPilot

final class MessageEditingTests: XCTestCase {
    private func cases() throws -> [OrderedJSON] {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/message-editing.json")))
        XCTAssertEqual(fixture["fixtureVersion"], .number("1"))
        return try fixture.required("cases").array("cases")
    }
    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-edit-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            try? FileManager.default.removeItem(at: directory)
        }
        return LocalStateStore(fileURL: directory.appendingPathComponent("local-state.json"))
    }
    private func snapshot(_ source: OrderedJSON) throws -> OrderedJSON {
        let store = try source.required("contentStore")
        let chats = try source.required("chats").array("chats").map { chat -> OrderedJSON in
            guard let tree = chat["branchTree"] else { return chat }
            let fields = try tree.required("nodes").object("nodes").map { field -> JSONField in
                let hash = try field.value.required("contentHash").string("hash")
                let body = try store.required(hash).required("content")
                let node = try field.value.object("node").filter { $0.key != "contentHash" }
                return JSONField(key: field.key, value: OrderedJSON.object(node).replacing("content", with: body))
            }
            return chat.replacing("branchTree", with: tree.replacing("nodes", with: .object(fields)))
        }
        return try .object(source.object("source").filter { $0.key != "contentStore" }).replacing("chats", with: .array(chats))
    }
    private func assertSnapshot(_ source: OrderedJSON, _ expected: OrderedJSON, name: String) throws {
        let actual = try snapshot(source)
        XCTAssertEqual(try SyncRecords.canonical(actual), try SyncRecords.canonical(expected), name)
        let nodes = try actual.required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes")
        let expectedNodes = try expected.required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes")
        XCTAssertEqual(nodes.map { Data($0.key.utf8) }, expectedNodes.map { Data($0.key.utf8) }, name)
    }
    private func currentExpected(_ test: OrderedJSON) throws -> OrderedJSON {
        var expected = try test.required("expected")
        if test["name"] == .string("no-op") { return expected }
        let id: String
        if test["mode"] == .string("branch") || test["mode"] == .string("append") { id = "new-node" }
        else if test["name"] == .string("flat-overwrite") { id = "converted" }
        else { id = try test.required("nodeID").string("nodeID") }
        var chats = try expected.required("chats").array("chats"), chat = chats[0]
        let tree = try chat.required("branchTree"), nodes = try tree.required("nodes")
        chat = chat.replacing("branchTree", with: tree.replacing("nodes", with: nodes.replacing(id, with: try nodes.required(id).replacing("updatedAt", with: .number("1000")))))
            .replacing("updatedAt", with: .number("1000"))
        chats[0] = chat
        expected = expected.replacing("chats", with: .array(chats))
        return expected
    }

    func testSharedEditsAtomicSaveRestartAndExport() throws {
        let tests = try cases()
        XCTAssertEqual(tests.count, 15)
        for test in tests {
            let input = try test.required("input")
            let store = try store()
            let state = ChatState(store: store)
            try state.importWebData(input.encoded())
            let nodeID: String? = test["nodeID"] == .null ? nil : try test.required("nodeID").string("nodeID")
            var draft = try state.messageDraft(nodeID: nodeID)
            draft.role = try test.required("role").string("role")
            let parts = try test.required("parts").array("parts")
            draft.text = try parts.first(where: { $0["type"] == .string("text") })!.required("text").string("text")
            let mode: MessageSaveMode
            switch try test.required("mode").string("mode") {
            case "branch": mode = .branch
            case "append": mode = .append
            default: mode = .overwrite
            }
            try state.saveMessage(draft, mode: mode, newIDs: test.required("newIDs").array("newIDs").map { try $0.string("ID") }, now: test.required("now").number("now"))
            let name = try test.required("name").string("name")
            let source = try XCTUnwrap(state.exchange).source
            try assertSnapshot(source, currentExpected(test), name: name)
            // Storage representation can differ, but old extensions and unrelated entries cannot be lost.
            for field in try input.required("contentStore").object("store") {
                XCTAssertEqual(source["contentStore"]?[field.key]?["xEntry"], field.value["xEntry"], name)
            }
            XCTAssertEqual(source["contentStore"]?["unreferenced"], input["contentStore"]?["unreferenced"], name)
            let fresh = ChatState(store: store)
            XCTAssertNil(fresh.persistenceError, name)
            XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), state.conversation?.visibleMessages.map(\.id), name)
            let exported = try OrderedJSON.decode(XCTUnwrap(fresh.exchange).encoded())
            try assertSnapshot(exported, currentExpected(test), name: "restart/export \(name)")
            XCTAssertEqual(exported, source, name)
        }
    }
    func testSavedDraftUsesSharedTextReplacementAndPreservesRawPartMetadataOrder() throws {
        let input = try cases()[0].required("input")
        let parts = try OrderedJSON.decode(Data(#"[{"type":"reasoning","text":"reason"},{"type":"text","text":"old","xBig":9007199254740993},{"type":"text","text":"second","xRaw":1.234567890123456789}]"#.utf8))
        XCTAssertEqual(try MessageEditing.textValue(of: parts), "old")
        let changed = try MessageEditing.save(in: input, chatID: "target", nodeID: "middle", viewingPath: ["system", "middle", "last"], role: "assistant", parts: parts, editedText: "edited", mode: .overwrite, newIDs: [], now: 1000)
        let chat = try changed.required("chats").array("chats")[0]
        let node = try chat.required("branchTree").required("nodes").required("middle")
        let actual = try changed.required("contentStore").required(node.required("contentHash").string("hash")).required("content")
        var expected = try parts.array("parts")
        expected[1] = expected[1].replacing("text", with: .string("edited"))
        XCTAssertEqual(try actual.encoded(), try OrderedJSON.array(expected).encoded())
        XCTAssertEqual(try MessageEditing.textValue(of: .array([.object([.init(key: "type", value: .string("reasoning")), .init(key: "text", value: .string("reason"))])])), "")
    }

    func testSharedEditingPreservesOpaqueNumbersWhenCopiedToNewBranchAndContent() throws {
        var input = try cases()[0].required("input")
        var chats = try input.required("chats").array("chats"), chat = chats[0]
        var tree = try chat.required("branchTree"), store = try input.required("contentStore")
        let path = try tree.required("activePath").array("path")
        let id = try path[1].string("id"), node = try tree.required("nodes").required(id)
        let hash = try node.required("contentHash").string("hash")
        var body = try store.required(hash).required("content").array("content")
        body[0] = body[0].replacing("xHuge", with: .number("9007199254740993")).replacing("content", with: .object([.init(key: "opaqueRef", value: .number("0"))]))
        store = store.replacing(hash, with: try store.required(hash).replacing("content", with: .array(body)).replacing("xHuge", with: .number("1.234567890123456789")))
        let attributes = OrderedJSON.object([.init(key: "xHuge", value: .number("9007199254740993"))])
        tree = tree.replacing("messageAttributesV1", with: .object([.init(key: "version", value: .number("1")), .init(key: "byNode", value: .object([.init(key: id, value: attributes)]))]))
        var messages = try chat.required("messages").array("messages")
        messages[1] = messages[1].replacing("content", with: .array(body)).replacing("xHuge", with: .number("9007199254740993"))
        chat = chat.replacing("branchTree", with: tree).replacing("messages", with: .array(messages))
        chats[0] = chat
        input = input.replacing("chats", with: .array(chats)).replacing("contentStore", with: store).replacing("xHuge", with: .number("9007199254740993"))
        let before = try input.encoded()
        body[0] = body[0].replacing("text", with: .string("Edited body"))
        let result = try MessageEditing.save(in: input, chatID: chat.required("id").string("id"), nodeID: id, viewingPath: path.map { try $0.string("id") }, role: "assistant", parts: .array(body), mode: .branch, newIDs: ["new-meta"], now: 1000)
        let changed = try result.required("chats").array("chats")[0], newTree = try changed.required("branchTree")
        XCTAssertEqual(newTree["messageAttributesV1"]?["byNode"]?["new-meta"], attributes)
        XCTAssertNil(newTree["nodes"]?["new-meta"]?["xNode"])
        let newHash = try newTree.required("nodes").required("new-meta").required("contentHash").string("hash")
        XCTAssertEqual(try SyncRecords.resolveContent(result.required("contentStore"), hash: newHash), .array(body))
        let exported = try OrderedJSON.decode(WebExchange(source: result).encoded())
        let messagesAfterExport = try exported.required("chats").array("chats")[0].required("messages").array("messages")
        XCTAssertEqual(messagesAfterExport[1]["content"], .array(body))
        XCTAssertEqual(messagesAfterExport[1]["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(result["contentStore"]?[hash]?["xHuge"], .number("1.234567890123456789"))
        XCTAssertEqual(result["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(try input.encoded(), before)
    }

    func testLongSharedBodyEditRestoresOpaqueAttributesBeforeSaving() throws {
        let test = try XCTUnwrap(cases().first { $0["name"] == .string("last-overwrite") })
        var input = try test.required("input")
        var chats = try input.required("chats").array("chats"), chat = chats[0]
        var tree = try chat.required("branchTree"), nodes = try tree.required("nodes")
        let hash = try nodes.required("last").required("contentHash").string("hash")
        let text = String(repeating: "Long text ", count: 300)
        let body = OrderedJSON.array([.object([.init(key: "type", value: .string("text")), .init(key: "text", value: .string(text)),
            .init(key: "xFuture", value: .number("9007199254740993"))])])
        nodes = nodes.replacing("inactive", with: try nodes.required("last").replacing("id", with: .string("inactive")).replacing("parentId", with: .null))
        tree = tree.replacing("nodes", with: nodes)
        chat = chat.replacing("branchTree", with: tree); chats[0] = chat
        var contentStore = try input.required("contentStore")
        contentStore = contentStore.replacing(hash, with: .object([.init(key: "content", value: body), .init(key: "refCount", value: .number("2"))]))
        input = input.replacing("chats", with: .array(chats)).replacing("contentStore", with: contentStore)
        let disk = try store(), state = ChatState(store: disk)
        try state.importWebData(input.encoded())
        var draft = try state.messageDraft(nodeID: "last")
        draft.text = text + "Edited"
        try state.saveMessage(draft, mode: .overwrite, newIDs: [], now: 1000)
        let restored = ChatState(store: disk)
        XCTAssertNil(restored.persistenceError)
        let source = try XCTUnwrap(restored.exchange).source
        let editedChat = try source.required("chats").array("chats")[0]
        let newHash = try editedChat.required("branchTree").required("nodes").required("last").required("contentHash").string("hash")
        let entry = try source.required("contentStore").required(newHash)
        XCTAssertNil(entry["delta"])
        let parts = try entry.required("content").array("content")
        XCTAssertEqual(parts[0]["text"], .string(text + "Edited"))
        XCTAssertEqual(parts[0]["xFuture"], .number("9007199254740993"))
        XCTAssertEqual(source["contentStore"]?[hash]?["content"], body)
        XCTAssertEqual(try OrderedJSON.decode(restored.exportWebData()), source)
    }

    func testOpaqueReferencesKeepDifferentRawOrderAndNumberSpellingDistinct() throws {
        let first = OrderedJSON.object([.init(key: "a", value: .number("1.0")), .init(key: "b", value: .string("B"))])
        let second = OrderedJSON.object([.init(key: "b", value: .string("B")), .init(key: "a", value: .number("1e0"))])
        var projection = SharedWebProjection()
        XCTAssertEqual(try projection.reference(.null), .null)
        XCTAssertTrue(projection.opaque.isEmpty)
        let firstRef = try projection.reference(first), secondRef = try projection.reference(second)
        XCTAssertNotEqual(firstRef, secondRef)
        XCTAssertEqual(try projection.reference(first), firstRef)
        let patch = OrderedJSON.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: secondRef)])])
        let copied = try OrderedJSONChanges.apply(patch, to: .null, opaque: projection.opaque)
        XCTAssertEqual(try copied.encoded(), try second.encoded())
        XCTAssertEqual(try copied.object("object").map(\.key), ["b", "a"])
        XCTAssertEqual(copied["a"], .number("1e0"))
    }

    func testLeafChangesPreserveNullArrayOrderAndUntouchedOpaqueValues() throws {
        let source = OrderedJSON.object([.init(key: "array", value: .array([.number("9007199254740993"), .string("old")])), .init(key: "x", value: .null), .init(key: "opaqueRef", value: .number("0"))])
        let changes = try OrderedJSON.decode(Data("[{\"op\":\"set\",\"path\":[\"array\",1],\"value\":null},{\"op\":\"set\",\"path\":[\"array\",2],\"value\":\"new\"},{\"op\":\"remove\",\"path\":[\"x\"]},{\"op\":\"keys\",\"path\":[],\"keys\":[\"opaqueRef\",\"array\"]}]".utf8))
        let result = try OrderedJSONChanges.apply(changes, to: source)
        XCTAssertEqual(try result.object("root").map(\.key), ["opaqueRef", "array"])
        XCTAssertEqual(result["array"], .array([.number("9007199254740993"), .null, .string("new")]))
        XCTAssertEqual(result["opaqueRef"], .number("0"))
        XCTAssertNil(result["x"])
    }

    func testProtectedOverwriteAndRoleAreRejectedButBranchPreservesOriginal() throws {
        var input = try cases()[0].required("input")
        var chats = try input.required("chats").array("chats")
        chats[0] = chats[0].replacing("protectedNodes", with: .object([JSONField(key: "middle", value: .bool(true))]))
        input = input.replacing("chats", with: .array(chats))
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        var draft = try state.messageDraft(nodeID: "middle")
        XCTAssertTrue(draft.isProtected)
        draft.role = "assistant"
        let before = try Data(contentsOf: store.fileURL)
        XCTAssertThrowsError(try state.saveMessage(draft, mode: .overwrite))
        draft.text = "Branch"
        XCTAssertThrowsError(try state.saveMessage(draft, mode: .overwrite))
        XCTAssertEqual(state.exchange?.source, input)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
        try state.saveMessage(draft, mode: .branch, newIDs: ["new-node"], now: 1000)
        let source = try XCTUnwrap(state.exchange).source
        XCTAssertEqual(try source.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["middle"], try input.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["middle"])
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "new-node"])
        XCTAssertEqual(state.conversation?.visibleMessages.last?.role, "assistant")
    }
    func testFailureKeepsDraftSourceDiskAndViewThenRetryPublishesNewPath() throws {
        let input = try cases()[0].required("input")
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        state.style = .bubbles
        var draft = try state.messageDraft(nodeID: "middle")
        draft.text = "Retry body"
        let before = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        XCTAssertThrowsError(try state.saveMessage(draft, mode: .branch, newIDs: ["retry-node"], now: 1000))
        XCTAssertEqual(draft.text, "Retry body")
        XCTAssertEqual(state.exchange?.source, input)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try state.saveMessage(draft, mode: .branch, newIDs: ["retry-node"], now: 1000)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "retry-node"])
        XCTAssertEqual(state.conversations[1].visibleMessages.map(\.id), ["message-0"])
        let fresh = ChatState(store: store)
        XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), ["system", "retry-node"])
        XCTAssertEqual(fresh.style, .bubbles)
    }
    func testCancelDoesNotPublishDraftAndEmptyAppendIsRejected() throws {
        let input = try cases().last!.required("input")
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(input.encoded())
        let before = try Data(contentsOf: store.fileURL)
        var draft = try state.messageDraft(nodeID: nil)
        draft.text = "Discarded"
        // Explicit cancel dismisses this value without calling saveMessage.
        draft = try state.messageDraft(nodeID: nil)
        XCTAssertEqual(draft.text, "")
        XCTAssertThrowsError(try state.saveMessage(draft, mode: .append))
        XCTAssertEqual(state.exchange?.source, input)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }
    func testNativePreservesExistingMessageMetadataWithoutClaimingWebParity() throws {
        var input = try cases()[0].required("input")
        var chats = try input.required("chats").array("chats")
        var messages = try chats[0].required("messages").array("messages")
        messages[1] = messages[1].replacing("xMessage", with: .object([JSONField(key: "keep", value: .bool(true))]))
        chats[0] = chats[0].replacing("messages", with: .array(messages))
        input = input.replacing("chats", with: .array(chats))
        let state = ChatState(store: try store())
        try state.importWebData(input.encoded())
        var draft = try state.messageDraft(nodeID: "middle")
        draft.text = "Edited metadata"
        try state.saveMessage(draft, mode: .overwrite)
        let result = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("messages").array("messages")
        XCTAssertEqual(result[1]["xMessage"], messages[1]["xMessage"])
        // Web materializeActivePath currently drops message-level extensions; not a shared expected case.
    }
    func testMissingConfigHeadEditBranchAndSystemRoleChangesPersist() throws {
        let fixture = try cases().first { $0["name"] == .string("head-role-to-system") }!
        let original = try fixture.required("input")
        var chats = try original.required("chats").array("chats")
        chats[0] = try .object(chats[0].object("chat").filter { $0.key != "config" })
        let input = original.replacing("chats", with: .array(chats))
        for mode in [MessageSaveMode.overwrite, .branch] {
            for role in ["user", "system"] {
                let store = try store()
                let state = ChatState(store: store)
                try state.importWebData(input.encoded())
                var draft = try state.messageDraft(nodeID: "system")
                draft.text = "Edited head"
                draft.role = role
                try state.saveMessage(draft, mode: mode, newIDs: ["new-head"], now: 1000)
                let source = try XCTUnwrap(state.exchange).source
                let chat = try source.required("chats").array("chats")[0]
                if role == "system" {
                    XCTAssertEqual(chat["config"], .object([JSONField(key: "systemPrompt", value: .string("Edited head"))]))
                } else { XCTAssertNil(chat["config"]) }
                XCTAssertEqual(state.conversation?.visibleMessages.first?.role, role)
                if mode == .branch {
                    XCTAssertEqual(chat["branchTree"]?["nodes"]?["system"], chats[0]["branchTree"]?["nodes"]?["system"])
                }
                let fresh = ChatState(store: store)
                XCTAssertNil(fresh.persistenceError)
                XCTAssertEqual(fresh.exchange?.source, source)
                XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(fresh.exchange).encoded()), source)
            }
        }
        // A head system node can also exist without config; changing away clears the prompt safely.
        var systemChat = chats[0]
        let tree = try systemChat.required("branchTree")
        let nodes = try tree.required("nodes")
        let head = try nodes.required("system").replacing("role", with: .string("system"))
        systemChat = systemChat.replacing("branchTree", with: tree.replacing("nodes", with: nodes.replacing("system", with: head)))
        chats[0] = systemChat
        let state = ChatState(store: try store())
        try state.importWebData(original.replacing("chats", with: .array(chats)).encoded())
        var draft = try state.messageDraft(nodeID: "system")
        draft.role = "user"
        try state.saveMessage(draft, mode: .overwrite)
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]["config"], .object([]))
    }

    func testRootMiddleAndFlatInsertionSaveRestartExportAndSharedRecords() throws {
        let tests=try cases(), branch=try tests[0].required("input"), flat=try XCTUnwrap(tests.first { $0["name"] == .string("flat-overwrite") }).required("input")
        let cases:[(OrderedJSON,String,[String],[String],String,String)] = [
            (branch,"system",["insert-root"],["insert-root","system","middle","last"],"system",""),
            (branch,"middle",["insert-middle"],["system","insert-middle","middle","last"],"assistant","Inserted middle"),
            (flat,"message-0",["flat-original","insert-flat"],["insert-flat","flat-original"],"user","Inserted flat")
        ]
        for (input,target,ids,path,role,text) in cases {
            let store=try store(), state=ChatState(store:store)
            try state.importWebData(input.replacing("xHuge",with:.number("9007199254740993")).encoded())
            let before=try XCTUnwrap(state.exchange).source
            var draft=try state.messageInsertionDraft(beforeNodeID:target)
            XCTAssertTrue(draft.isInsertion); XCTAssertEqual(draft.beforeNodeID,target); XCTAssertEqual(draft.source,before)
            draft.role=role; draft.text=text
            try state.saveMessage(draft,mode:.insert,newIDs:ids,now:1700000000123)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),path)
            let inserted=try XCTUnwrap(state.conversation?.nodes.first { $0.id == ids.last! })
            XCTAssertEqual(inserted.role,role); XCTAssertEqual(inserted.parts,[.text(text)])
            let after=try XCTUnwrap(state.exchange).source
            XCTAssertEqual(after["xHuge"],.number("9007199254740993"))
            XCTAssertEqual(try after.required("chats").array("chats")[1],try before.required("chats").array("chats")[1])
            for field in try before.required("contentStore").object("store") {
                XCTAssertEqual(try after.required("contentStore").required(field.key).encoded(),try field.value.encoded())
            }
            let fresh=ChatState(store:store)
            XCTAssertNil(fresh.persistenceError); XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id),path)
            XCTAssertEqual(try fresh.publicationSnapshot().encoded(),try state.publicationSnapshot().encoded())
            let exported=try OrderedJSON.decode(fresh.exportWebData())
            XCTAssertEqual(try WebExchange(source:exported).conversations[0].visibleMessages.map(\.id),path)
            XCTAssertEqual(exported["xHuge"],.number("9007199254740993"))
            let records=try SyncRecords.toRecords(fresh.publicationSnapshot()), roundtrip=try SyncRecords.fromRecords(records)
            XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(roundtrip)),try SyncRecords.canonical(records))
        }
    }
    func testInsertionSaveFailureKeepsDraftSnapshotViewHistoryDiskThenRetryAndStaleDraftRejectsEveryMode() throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("insert-save-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:root) }
        let fault=InsertionWriteFault(), store=LocalStateStore(fileURL:root.appendingPathComponent("local.json")) { data,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to:url,options:.atomic)
        }
        let state=ChatState(store:store); try state.importWebData(cases()[0].required("input").encoded())
        var draft=try state.messageInsertionDraft(beforeNodeID:"middle"); draft.text="Retry insertion"
        let before=try state.publicationSnapshot(), disk=try Data(contentsOf:store.fileURL), path=state.conversation?.visibleMessages.map(\.id), focus=state.navigationFocus, canBack=state.canNavigateBack
        fault.reject=true
        XCTAssertThrowsError(try state.saveMessage(draft,mode:.insert,newIDs:["retry-insert"],now:1000))
        XCTAssertEqual(try state.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),path); XCTAssertEqual(state.navigationFocus,focus); XCTAssertEqual(state.canNavigateBack,canBack)
        XCTAssertEqual(draft.text,"Retry insertion")
        fault.reject=false; try state.saveMessage(draft,mode:.insert,newIDs:["retry-insert"],now:1000)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["system","retry-insert","middle","last"])
        var stale=try state.messageDraft(nodeID:"middle"); stale.text="Old window draft"
        try state.renameChat(id:stale.chatID,title:"Another window edit",now:2000)
        let changed=try state.publicationSnapshot(), changedDisk=try Data(contentsOf:store.fileURL)
        for mode in [MessageSaveMode.overwrite,.branch,.append,.insert] {
            XCTAssertThrowsError(try state.saveMessage(stale,mode:mode,newIDs:["stale-new"],now:3000))
            XCTAssertEqual(try state.publicationSnapshot(),changed); XCTAssertEqual(try Data(contentsOf:store.fileURL),changedDisk)
        }
    }
    func testRemovalReparentsSuccessorsAndRootThenFlatEmptyChatRestartExportRecords() throws {
        for (caseName, nodeID, expectedPath, ids) in [("branch", "middle", ["system", "last"], [String]()), ("branch", "system", ["middle", "last"], [String]()), ("flat-overwrite", "message-0", [String](), ["converted"])] {
            let fixtures = try cases()
            let fixture = caseName == "branch" ? fixtures[0] : fixtures.first { $0["name"] == .string(caseName) }!
            let local = try store(), state = ChatState(store: local)
            let input = try fixture.required("input").replacing("xHuge", with: .number("9007199254740993"))
            try state.importWebData(input.encoded())
            let before = try XCTUnwrap(state.exchange).source
            try state.saveNodeRemoval(state.nodeRemovalDraft(nodeID: nodeID), newIDs: ids, now: 1000)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), expectedPath)
            let after = try XCTUnwrap(state.exchange).source, chat = try after.required("chats").array("chats")[0]
            XCTAssertNil(chat["branchTree"]?["nodes"]?[nodeID])
            if nodeID == "middle" { XCTAssertEqual(chat["branchTree"]?["nodes"]?["last"]?["parentId"], .string("system")) }
            if nodeID == "system" { XCTAssertEqual(chat["branchTree"]?["nodes"]?["middle"]?["parentId"], .null); XCTAssertEqual(chat["branchTree"]?["nodes"]?["hidden"]?["parentId"], .null) }
            if expectedPath.isEmpty { XCTAssertEqual(chat["branchTree"]?["rootId"], .string("")); XCTAssertEqual(chat["messages"], .array([])); XCTAssertEqual(try chat.required("branchTree").required("nodes").object("nodes").count, 0) }
            XCTAssertEqual(after["xHuge"], before["xHuge"])
            XCTAssertEqual(try after.required("chats").array("chats")[1], try before.required("chats").array("chats")[1])
            let fresh = ChatState(store: local)
            XCTAssertNil(fresh.persistenceError); XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), expectedPath)
            XCTAssertEqual(try fresh.publicationSnapshot().encoded(), try state.publicationSnapshot().encoded())
            let exported = try OrderedJSON.decode(fresh.exportWebData())
            XCTAssertEqual(exported["xHuge"], .number("9007199254740993"))
            XCTAssertEqual(try WebExchange(source: exported).conversations[0].visibleMessages.map(\.id), expectedPath)
            let records = try SyncRecords.toRecords(fresh.publicationSnapshot())
            XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(SyncRecords.fromRecords(records))), try SyncRecords.canonical(records))
        }
    }

    func testPruneRetainsPinnedDescendantsProtectedNodesAndRawValuesButRemovesUnpinnedHidden() throws {
        for (pin, protect, remaining) in [(false, false, ["system", "middle", "last"]), (true, false, ["system", "middle", "hidden", "last", "hidden-child"]), (false, true, ["system", "middle", "hidden", "last"])] {
            var input = try cases()[0].required("input"), chats = try input.required("chats").array("chats"), chat = chats[0]
            var tree = try chat.required("branchTree"), nodes = try tree.required("nodes")
            let hidden = try nodes.required("hidden").replacing("pinned", with: .bool(pin)).replacing("xHuge", with: .number("9007199254740993"))
            nodes = nodes.replacing("hidden", with: hidden).replacing("hidden-child", with: hidden.replacing("id", with: .string("hidden-child")).replacing("parentId", with: .string("hidden")).replacing("pinned", with: .bool(false)))
            tree = tree.replacing("nodes", with: nodes)
            chat = chat.replacing("branchTree", with: tree).replacing("protectedNodes", with: .object([.init(key: "hidden", value: .bool(protect))]))
            chats[0] = chat; input = input.replacing("chats", with: .array(chats))
            let contentStore = try input.required("contentStore")
            input = input.replacing("contentStore", with: contentStore.replacing("h-hidden", with: try contentStore.required("h-hidden").replacing("refCount", with: .number("2"))))
            let local = try store(), state = ChatState(store: local); try state.importWebData(input.encoded())
            try state.saveNodeRemoval(state.pruneHiddenDraft(), now: 1000)
            let result = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("branchTree").required("nodes")
            XCTAssertEqual(try result.object("nodes").map(\.key), remaining)
            if pin || protect { XCTAssertEqual(result["hidden"]?["xHuge"], .number("9007199254740993")) }
            XCTAssertEqual(ChatState(store: local).conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
            let exported = try OrderedJSON.decode(state.exportWebData())
            if pin || protect { XCTAssertEqual(try exported.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["hidden"]?["xHuge"], .number("9007199254740993")) }
        }
        let flat = try cases().first { $0["name"] == .string("flat-overwrite") }!.required("input")
        let unchanged = try MessageEditing.remove(in: flat, chatID: "target", nodeID: nil, viewingPath: ["message-0"], operation: .pruneHidden, newIDs: [], now: 1000)
        XCTAssertEqual(unchanged, flat)
    }

    func testRemovalProtectionSaveFailureRetryAndStalePreparationKeepState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("removal-fault-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fault = InsertionWriteFault(), local = LocalStateStore(fileURL: directory.appendingPathComponent("local.json")) { data, url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to: url, options: .atomic)
        }
        let state = ChatState(store: local); try state.importWebData(cases()[0].required("input").encoded())
        let removal = try state.nodeRemovalDraft(nodeID: "middle"), prune = try state.pruneHiddenDraft()
        let snapshot = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL), path = state.conversation?.visibleMessages.map(\.id), focus = state.navigationFocus
        fault.reject = true
        for draft in [removal, prune] {
            XCTAssertThrowsError(try state.saveNodeRemoval(draft, now: 1000))
            XCTAssertEqual(try state.publicationSnapshot(), snapshot); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path); XCTAssertEqual(state.navigationFocus, focus)
        }
        fault.reject = false; try state.saveNodeRemoval(removal, now: 1000)
        let changed = try state.publicationSnapshot(), changedDisk = try Data(contentsOf: local.fileURL)
        for draft in [removal, prune] { XCTAssertThrowsError(try state.saveNodeRemoval(draft)); XCTAssertEqual(try state.publicationSnapshot(), changed); XCTAssertEqual(try Data(contentsOf: local.fileURL), changedDisk) }
        var protectedInput = try cases()[0].required("input"), chats = try protectedInput.required("chats").array("chats")
        chats[0] = chats[0].replacing("protectedNodes", with: .object([.init(key: "middle", value: .bool(true))]))
        protectedInput = protectedInput.replacing("chats", with: .array(chats)); try state.importWebData(protectedInput.encoded())
        let protectedSnapshot = try state.publicationSnapshot(), protectedDisk = try Data(contentsOf: local.fileURL)
        XCTAssertThrowsError(try state.saveNodeRemoval(state.nodeRemovalDraft(nodeID: "middle")))
        XCTAssertEqual(try state.publicationSnapshot(), protectedSnapshot); XCTAssertEqual(try Data(contentsOf: local.fileURL), protectedDisk)
    }

    func testHistoryUndoRedoForEachMessageModeAndRemovalPrunePreservesRawIO() throws {
        for mode in [MessageSaveMode.overwrite, .branch, .append, .insert] {
            let local = try store(), state = ChatState(store: local)
            var input = try cases()[0].required("input").replacing("xHuge", with: .number("9007199254740993"))
            var chats = try input.required("chats").array("chats"), chat = chats[0], tree = try chat.required("branchTree"), nodes = try tree.required("nodes")
            nodes = nodes.replacing("middle", with: try nodes.required("middle").replacing("xOpaque", with: .object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300"))])))
            tree = tree.replacing("nodes", with: nodes); chat = chat.replacing("branchTree", with: tree); chats[0] = chat; input = input.replacing("chats", with: .array(chats))
            try state.importWebData(input.encoded())
            let original = try XCTUnwrap(state.exchange).source
            var draft = try mode == .insert ? state.messageInsertionDraft(beforeNodeID: "middle") : state.messageDraft(nodeID: mode == .append ? nil : "middle")
            draft.text = "History edited \(mode.rawValue)"
            try state.saveMessage(draft, mode: mode, newIDs: ["history-new"], now: 1000)
            XCTAssertTrue(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
            let editedPath = state.conversation?.visibleMessages.map(\.id)
            try state.undoMessageEdit(now: 2000)
            XCTAssertFalse(state.canUndoMessageEdit); XCTAssertTrue(state.canRedoMessageEdit)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
            let undone = try XCTUnwrap(state.exchange).source
            XCTAssertEqual(try undone.required("chats").array("chats")[0].required("branchTree").required("nodes").required("middle").required("xOpaque").encoded(), try nodes.required("middle").required("xOpaque").encoded())
            XCTAssertEqual(undone["xHuge"], original["xHuge"])
            XCTAssertEqual(try undone.required("chats").array("chats")[1].encoded(), try original.required("chats").array("chats")[1].encoded())
            try state.redoMessageEdit(now: 3000)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), editedPath)
            XCTAssertTrue(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
            let fresh = ChatState(store: local)
            XCTAssertFalse(fresh.canUndoMessageEdit); XCTAssertFalse(fresh.canRedoMessageEdit)
            XCTAssertEqual(try fresh.publicationSnapshot().encoded(), try state.publicationSnapshot().encoded())
            XCTAssertEqual(try OrderedJSON.decode(fresh.exportWebData())["xHuge"], .number("9007199254740993"))
            let records = try SyncRecords.toRecords(fresh.publicationSnapshot())
            XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(SyncRecords.fromRecords(records))), try SyncRecords.canonical(records))
        }
        for operation in [NodeRemovalOperation.remove, .pruneHidden] {
            let state = ChatState(store: try store()); try state.importWebData(cases()[0].required("input").encoded())
            let draft = try operation == .remove ? state.nodeRemovalDraft(nodeID: "middle") : state.pruneHiddenDraft()
            try state.saveNodeRemoval(draft, now: 1000)
            let removed = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("branchTree").required("nodes")
            XCTAssertNil(removed[operation == .remove ? "middle" : "hidden"])
            try state.undoMessageEdit(now: 2000)
            let restored = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("branchTree").required("nodes")
            XCTAssertNotNil(restored[operation == .remove ? "middle" : "hidden"])
            try state.redoMessageEdit(now: 3000)
            XCTAssertNil(try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0].required("branchTree").required("nodes")[operation == .remove ? "middle" : "hidden"])
        }
    }

    func testHistoryKeepsOriginalDeltaAndOpaqueBodyThroughUndoRedo() throws {
        var source = try cases()[0].required("input"), chats = try source.required("chats").array("chats"), chat = chats[0]
        var tree = try chat.required("branchTree"), nodes = try tree.required("nodes"), contentStore = try source.required("contentStore")
        let body = OrderedJSON.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Original delta")),
            .init(key:"xMetadata",value:.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300"))]))])])
        let delta = OrderedJSON.object([.init(key:"baseHash",value:.string("h-last")),.init(key:"patches",value:.string(""))])
        contentStore = contentStore.replacing("h-last", with: try contentStore.required("h-last").replacing("content", with: body))
        contentStore = contentStore.replacing("history-delta", with: .object([.init(key:"content",value:.array([])),.init(key:"refCount",value:.number("1")),.init(key:"delta",value:delta)]))
        nodes = nodes.replacing("last", with: try nodes.required("last").replacing("contentHash", with: .string("history-delta")))
        tree = tree.replacing("nodes", with: nodes); chat = chat.replacing("branchTree", with: tree)
        var messages = try chat.required("messages").array("messages"); messages[2] = messages[2].replacing("content", with: body)
        chat = chat.replacing("messages", with: .array(messages)); chats[0] = chat
        source = source.replacing("chats", with: .array(chats)).replacing("contentStore", with: contentStore)
        // Delta patch text is defined against the Web JSON.stringify base;
        // full-entry raw number spellings remain a separate I/O guarantee.
        let resolvedBefore = try SyncRecords.resolveContent(contentStore, hash: "history-delta")
        let expectedDeltaBody = OrderedJSON.array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Original delta")),
            .init(key:"xMetadata",value:.object([.init(key:"z",value:.number("9007199254740992")),.init(key:"a",value:.number("1.23"))]))])])
        XCTAssertEqual(try resolvedBefore.encoded(), try expectedDeltaBody.encoded())
        let rawBase = try contentStore.required("h-last").encoded()
        var history: MessageEditing.HistoryState?
        let edited = try MessageEditing.save(in: source, chatID: "target", nodeID: "last", viewingPath: ["system","middle","last"], role: "assistant", parts: body,
            editedText: "Edited delta", mode: .overwrite, newIDs: [], now: 1000, onHistory: { history = $0 })
        let captured = try XCTUnwrap(history)
        let undone = try MessageEditing.moveHistory("undo", in: edited, history: captured, now: 2000)
        XCTAssertEqual(try SyncRecords.resolveContent(undone.source.required("contentStore"), hash: "history-delta").encoded(), try resolvedBefore.encoded())
        XCTAssertEqual(try undone.source.required("contentStore").required("h-last").encoded(), rawBase)
        XCTAssertEqual(undone.source["contentStore"]?["history-delta"]?["delta"], delta)
        let redone = try MessageEditing.moveHistory("redo", in: undone.source, history: undone.history, now: 3000)
        XCTAssertEqual(try redone.source.required("contentStore").required("h-last").encoded(), rawBase)
        let hash = try redone.source.required("chats").array("chats")[0].required("branchTree").required("nodes").required("last").required("contentHash").string("hash")
        XCTAssertEqual(try SyncRecords.resolveContent(redone.source.required("contentStore"), hash: hash).array("content")[0]["xMetadata"], try body.array("body")[0]["xMetadata"])
    }

    func testHistoryFlatPreparedBaseNodeOptionsAndGlobalSelection() throws {
        let state = ChatState(store: try store()), fixture = try cases().first { $0["name"] == .string("flat-overwrite") }!
        try state.importWebData(fixture.required("input").encoded())
        var insertion = try state.messageInsertionDraft(beforeNodeID: "message-0"); insertion.text = "Inserted"
        try state.saveMessage(insertion, mode: .insert, newIDs: ["original", "inserted"], now: 1000)
        try state.undoMessageEdit(now: 2000)
        // Web history starts after legacy flat-to-tree preparation.
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["original"])
        XCTAssertNotNil(try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]["branchTree"])
        try state.redoMessageEdit(now: 3000)
        var options = try state.nodeOptionsDraft(nodeID: "inserted"); options.value.label = "Undo label"; options.value.starred = true
        try state.saveNodeOptions(options, now: 4000)
        XCTAssertEqual(state.conversation?.nodes.first { $0.id == "inserted" }?.options.label, "Undo label")
        try state.undoMessageEdit(now: 5000)
        XCTAssertEqual(state.conversation?.nodes.first { $0.id == "inserted" }?.options.label, "")
        XCTAssertEqual(state.conversation?.nodes.first { $0.id == "inserted" }?.options.starred, false)
        try state.redoMessageEdit(now: 6000)
        var map = try state.nodeOptionsDraft(nodeID: "inserted"); map.value.collapsed = true
        try state.saveNodeOptions(map, now: 7000)
        try state.navigate(chatID: "other", source: .chatSwitch)
        try state.undoMessageEdit(now: 8000)
        XCTAssertEqual(state.selectedConversationID, "other")
        let target = try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]
        XCTAssertNil(target["branchTree"]?["nodes"]?["inserted"]?["label"])
        XCTAssertEqual(target["collapsedNodes"]?["inserted"], .bool(true))
        try state.redoMessageEdit(now: 9000)
        XCTAssertEqual(state.selectedConversationID, "other")
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["inserted"]?["label"], .string("Undo label"))
    }

    func testGlobalUndoRedoRefreshesAffectedChatPathWhileAnotherChatStaysSelected() throws {
        let local = try store(), state = ChatState(store: local)
        try state.importWebData(cases()[0].required("input").encoded())
        try state.saveNodeRemoval(state.nodeRemovalDraft(nodeID: "last"), now: 1000)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle"])
        try state.navigate(chatID: "other", source: .chatSwitch)
        try state.undoMessageEdit(now: 2000)
        XCTAssertEqual(state.selectedConversationID, "other")
        XCTAssertEqual(state.conversations.first { $0.id == "target" }?.visibleMessages.map(\.id), ["system", "middle", "last"])
        try state.navigate(chatID: "target", source: .chatSwitch)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
        XCTAssertEqual(try XCTUnwrap(state.exchange).source.required("chats").array("chats")[0]["branchTree"]?["activePath"], .array(["system", "middle", "last"].map(OrderedJSON.string)))
        try state.navigate(chatID: "other", source: .chatSwitch)
        try state.redoMessageEdit(now: 3000)
        XCTAssertEqual(state.selectedConversationID, "other")
        XCTAssertEqual(state.conversations.first { $0.id == "target" }?.visibleMessages.map(\.id), ["system", "middle"])
        try state.navigate(chatID: "target", source: .chatSwitch)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle"])
        let fresh = ChatState(store: local)
        XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), ["system", "middle"])
        XCTAssertEqual(try fresh.publicationSnapshot().encoded(), try state.publicationSnapshot().encoded())
    }

    func testHistorySaveFailureKeepsStacksSourceDiskThenRetryAndExternalUpdateInvalidates() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("history-fault-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fault = InsertionWriteFault(), local = LocalStateStore(fileURL: directory.appendingPathComponent("local.json")) { data,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to: url, options: .atomic)
        }
        let state = ChatState(store: local); try state.importWebData(cases()[0].required("input").encoded())
        var draft = try state.messageDraft(nodeID: "middle"); draft.text = "Undo failure"
        try state.saveMessage(draft, mode: .overwrite, newIDs: ["unused"], now: 1000)
        var snapshot = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        fault.reject = true; XCTAssertThrowsError(try state.undoMessageEdit(now: 2000))
        XCTAssertTrue(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        XCTAssertEqual(try state.publicationSnapshot(), snapshot); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        fault.reject = false; try state.undoMessageEdit(now: 2000)
        snapshot = try state.publicationSnapshot(); disk = try Data(contentsOf: local.fileURL)
        fault.reject = true; XCTAssertThrowsError(try state.redoMessageEdit(now: 3000))
        XCTAssertFalse(state.canUndoMessageEdit); XCTAssertTrue(state.canRedoMessageEdit)
        XCTAssertEqual(try state.publicationSnapshot(), snapshot); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        var freshDraft = try state.messageDraft(nodeID: "middle"); freshDraft.text = "Failed replacement"
        XCTAssertThrowsError(try state.saveMessage(freshDraft, mode: .overwrite, newIDs: ["unused"], now: 4000))
        XCTAssertTrue(state.canRedoMessageEdit); XCTAssertFalse(state.canUndoMessageEdit)
        fault.reject = false; try state.redoMessageEdit(now: 3000)
        var replacement = try cases()[0].required("input"), chats = try replacement.required("chats").array("chats")
        chats[0] = chats[0].replacing("branchTree", with: try chats[0].required("branchTree").replacing("activePath", with: .array([.string("system"), .string("hidden")])))
        replacement = replacement.replacing("chats", with: .array(chats))
        let preImport = try state.publicationSnapshot(), preImportDisk = try Data(contentsOf: local.fileURL)
        fault.reject = true; XCTAssertThrowsError(try state.importWebData(replacement.encoded()))
        XCTAssertTrue(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        XCTAssertEqual(try state.publicationSnapshot(), preImport); XCTAssertEqual(try Data(contentsOf: local.fileURL), preImportDisk)
        fault.reject = false; try state.importWebData(replacement.encoded())
        XCTAssertFalse(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        var newDraft = try state.messageDraft(nodeID: "hidden"); newDraft.text = "Sync update invalidates"
        try state.saveMessage(newDraft, mode: .overwrite, newIDs: ["unused"], now: 5000)
        XCTAssertTrue(state.canUndoMessageEdit)
        let incoming = try SyncDocument(v3: cases()[0].required("input")).snapshot
        let preSync = try state.publicationSnapshot(), preSyncDisk = try Data(contentsOf: local.fileURL)
        fault.reject = true; XCTAssertThrowsError(try state.applySynchronizedSnapshot(incoming, expected: state.syncInputSnapshot()))
        XCTAssertTrue(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        XCTAssertEqual(try state.publicationSnapshot(), preSync); XCTAssertEqual(try Data(contentsOf: local.fileURL), preSyncDisk)
        fault.reject = false; try state.applySynchronizedSnapshot(incoming, expected: state.syncInputSnapshot())
        XCTAssertFalse(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
    }

    private func assertTransformIO(_ state: ChatState, local: LocalStateStore, path: [String]) throws {
        let fresh = ChatState(store: local)
        XCTAssertNil(fresh.persistenceError); XCTAssertEqual(fresh.conversation?.visibleMessages.map(\.id), path)
        XCTAssertEqual(try fresh.publicationSnapshot().encoded(), try state.publicationSnapshot().encoded())
        let exported = try OrderedJSON.decode(fresh.exportWebData())
        XCTAssertEqual(try WebExchange(source: exported).conversations[0].visibleMessages.map(\.id), path)
        let records = try SyncRecords.toRecords(fresh.publicationSnapshot())
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(SyncRecords.fromRecords(records))), try SyncRecords.canonical(records))
    }

    func testTreeMoveBothDirectionsFlatPreparationNoOpAndRawIOUndoRedo() throws {
        let local = try store(), state = ChatState(store: local)
        let input = try cases()[0].required("input").replacing("xHuge", with: .number("9007199254740993"))
        try state.importWebData(input.encoded())
        let original = try XCTUnwrap(state.exchange).source, disk = try Data(contentsOf: local.fileURL)
        for (node, direction) in [("system", NodeMoveDirection.down), ("middle", .up), ("last", .down)] {
            let result = try state.saveNodeTransform(state.nodeMoveDraft(nodeID: node, direction: direction), newIDs: [], now: 1000)
            XCTAssertEqual(result.status, "unchanged")
            XCTAssertEqual(try XCTUnwrap(state.exchange).source.encoded(), try original.encoded()); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
            XCTAssertFalse(state.canUndoMessageEdit)
        }
        for (node, direction) in [("middle", NodeMoveDirection.down), ("last", .up)] {
            XCTAssertEqual(try state.saveNodeTransform(state.nodeMoveDraft(nodeID: node, direction: direction), newIDs: [], now: 1000).status, "updated")
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "last", "middle"])
            let source = try XCTUnwrap(state.exchange).source
            XCTAssertEqual(source["xHuge"], .number("9007199254740993"))
            XCTAssertEqual(try source.required("chats").array("chats")[1].encoded(), try original.required("chats").array("chats")[1].encoded())
            XCTAssertEqual(source["contentStore"], original["contentStore"])
            try assertTransformIO(state, local: local, path: ["system", "last", "middle"])
            try state.undoMessageEdit(now: 2000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
            try state.redoMessageEdit(now: 3000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "last", "middle"])
            try state.undoMessageEdit(now: 4000)
        }
        var flat = try cases().first { $0["name"] == .string("flat-overwrite") }!.required("input"), chats = try flat.required("chats").array("chats")
        var messages = try chats[0].required("messages").array("messages")
        messages[0] = messages[0].replacing("xHuge", with: .number("9007199254740993"))
        messages.append(messages[0].replacing("role", with: .string("assistant")).replacing("content", with: .array([.object([.init(key:"type",value:.string("text")),.init(key:"text",value:.string("Second"))])])).replacing("xHuge", with: .number("9007199254740992")))
        chats[0] = chats[0].replacing("messages", with: .array(messages)); flat = flat.replacing("chats", with: .array(chats))
        try state.importWebData(flat.encoded())
        XCTAssertEqual(try state.saveNodeTransform(state.nodeMoveDraft(nodeID: "message-0", direction: .down), newIDs: ["flat-first","flat-second"], now: 5000).status, "updated")
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["flat-second", "flat-first"])
        let exported = try OrderedJSON.decode(state.exportWebData()).required("chats").array("chats")[0].required("messages").array("messages")
        XCTAssertEqual(exported[0]["xHuge"], .number("9007199254740992")); XCTAssertEqual(exported[1]["xHuge"], .number("9007199254740993"))
        try assertTransformIO(state, local: local, path: ["flat-second", "flat-first"])
        try state.undoMessageEdit(now: 6000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["flat-first", "flat-second"])
    }

    func testReplaceAndPruneBodyAndFollowingProtectionWithHistoryAndRawIO() throws {
        for protectTarget in [false, true] {
            for protectFollowing in [false, true] {
                var input = try cases()[0].required("input"), chats = try input.required("chats").array("chats")
                chats[0] = chats[0].replacing("protectedNodes", with: .object([.init(key:"middle",value:.bool(protectTarget)),.init(key:"last",value:.bool(protectFollowing))]))
                input = input.replacing("chats", with: .array(chats)).replacing("xHuge", with: .number("9007199254740993"))
                let local = try store(), state = ChatState(store: local); try state.importWebData(input.encoded())
                let before = try XCTUnwrap(state.exchange).source, disk = try Data(contentsOf: local.fileURL)
                var draft = try state.messageReplacementDraft(nodeID: "middle"); draft.text = "Replacement"; draft.removeCount = 1
                let result = try state.saveMessageReplacingAndPruning(draft, newIDs: [], now: 1000)
                if protectTarget {
                    XCTAssertEqual(result.status, "protected"); XCTAssertEqual(result.blockedNodeIDs, ["middle"])
                    XCTAssertEqual(try XCTUnwrap(state.exchange).source.encoded(), try before.encoded()); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk); XCTAssertFalse(state.canUndoMessageEdit)
                    continue
                }
                XCTAssertEqual(result.status, "updated")
                XCTAssertEqual(result.removedNodeIDs, protectFollowing ? [] : ["last"])
                XCTAssertEqual(result.pruneBlockedBy, protectFollowing ? ["last"] : [])
                let path = protectFollowing ? ["system", "middle", "last"] : ["system", "middle"]
                XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path)
                let node = try XCTUnwrap(state.conversation?.nodes.first { $0.id == "middle" })
                XCTAssertEqual(node.parts.first, .text("Replacement"))
                XCTAssertEqual(Array(node.parts.dropFirst()), Array(try XCTUnwrap(WebExchange(source: before).conversations[0].nodes.first { $0.id == "middle" }).parts.dropFirst()))
                let after = try XCTUnwrap(state.exchange).source
                XCTAssertEqual(after["xHuge"], before["xHuge"]); XCTAssertEqual(try after.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["hidden"], try before.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["hidden"])
                try assertTransformIO(state, local: local, path: path)
                try state.undoMessageEdit(now: 2000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
                try state.redoMessageEdit(now: 3000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path)
            }
        }
    }

    func testDeleteBranchProtectedDescendantPinnedRootAndFlatAreSharedAndUndoable() throws {
        for (target, protect, path) in [("middle", false, ["system", "hidden"]), ("system", false, [String]()), ("middle", true, ["system", "middle", "last"])] {
            var input = try cases()[0].required("input"), chats = try input.required("chats").array("chats")
            chats[0] = chats[0].replacing("protectedNodes", with: .object([.init(key:"last",value:.bool(protect)),.init(key:"hidden",value:.bool(target == "middle"))]))
            input = input.replacing("chats", with: .array(chats))
            let local = try store(), state = ChatState(store: local); try state.importWebData(input.encoded())
            let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
            let result = try state.saveNodeTransform(state.branchDeletionDraft(nodeID: target), newIDs: [], now: 1000)
            XCTAssertEqual(result.status, protect ? "protected" : "updated")
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path)
            if protect {
                XCTAssertEqual(result.blockedNodeIDs, ["last"]); XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
                XCTAssertFalse(state.canUndoMessageEdit)
            } else {
                try assertTransformIO(state, local: local, path: path)
                try state.undoMessageEdit(now: 2000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle", "last"])
                try state.redoMessageEdit(now: 3000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path)
            }
        }
        let local = try store(), state = ChatState(store: local), flat = try cases().first { $0["name"] == .string("flat-overwrite") }!.required("input")
        try state.importWebData(flat.encoded())
        XCTAssertEqual(try state.saveNodeTransform(state.branchDeletionDraft(nodeID: "message-0"), newIDs: ["flat-only"], now: 1000).status, "updated")
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), [])
        try assertTransformIO(state, local: local, path: [])
        try state.undoMessageEdit(now: 2000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["flat-only"])
    }

    func testTreeTransformSaveFailureAndStaleDraftsKeepSourceHistoryAndDisk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tree-edit-fault-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fault = InsertionWriteFault(), local = LocalStateStore(fileURL: directory.appendingPathComponent("local.json")) { data,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to: url, options: .atomic)
        }
        let state = ChatState(store: local); try state.importWebData(cases()[0].required("input").encoded())
        let move = try state.nodeMoveDraft(nodeID: "middle", direction: .down), deletion = try state.branchDeletionDraft(nodeID: "middle")
        var replacement = try state.messageReplacementDraft(nodeID: "middle"); replacement.text = "Retry replacement"
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL), path = state.conversation?.visibleMessages.map(\.id)
        fault.reject = true
        for operation in BranchClipboardOperation.allCases {
            var draft = clipboardDraft; draft.operation = operation
            XCTAssertThrowsError(try state.saveBranchClipboard(draft,newIDs:[],now:1000))
        }
        XCTAssertThrowsError(try state.saveMessageReplacingAndPruning(replacement, newIDs: [], now: 1000))
        for draft in [move, deletion] { XCTAssertThrowsError(try state.saveNodeTransform(draft, newIDs: [], now: 1000)) }
        XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: local.fileURL), disk); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), path)
        XCTAssertFalse(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        fault.reject = false; XCTAssertEqual(try state.saveMessageReplacingAndPruning(replacement, newIDs: [], now: 1000).status, "updated")
        let changed = try state.publicationSnapshot(), changedDisk = try Data(contentsOf: local.fileURL)
        XCTAssertThrowsError(try state.saveMessageReplacingAndPruning(replacement, newIDs: [], now: 2000))
        for draft in [move, deletion] { XCTAssertThrowsError(try state.saveNodeTransform(draft, newIDs: [], now: 2000)) }
        XCTAssertEqual(try state.publicationSnapshot(), changed); XCTAssertEqual(try Data(contentsOf: local.fileURL), changedDisk); XCTAssertTrue(state.canUndoMessageEdit)
        try state.undoMessageEdit(now: 3000); XCTAssertFalse(state.canUndoMessageEdit)
    }

    func testClipboardCopyRestartPasteKeepsPersistedMapsOpaqueMetadataAndRawRoots() throws {
        var input = try cases()[0].required("input"), chats = try input.required("chats").array("chats"), chat = chats[0], tree = try chat.required("branchTree"), nodes = try tree.required("nodes")
        let rawMetadata = OrderedJSON.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.number("1.2300"))])
        nodes = nodes.replacing("middle",with:try nodes.required("middle").replacing("xOpaque",with:rawMetadata))
        tree = tree.replacing("nodes",with:nodes); chat = chat.replacing("branchTree",with:tree)
        for key in ["collapsedNodes","omittedNodes","protectedNodes"] { chat = chat.replacing(key,with:.object([.init(key:"middle",value:.bool(true)),.init(key:"last",value:.bool(false))])) }
        chats[0] = chat; input = input.replacing("chats",with:.array(chats)).replacing("xHuge",with:.number("9007199254740993"))
        let local = try store(), state = ChatState(store:local); try state.importWebData(input.encoded())
        var copy = try state.branchClipboardDraft(nodeID:"middle"); copy.toNodeID = "last"
        XCTAssertEqual(try state.saveBranchClipboard(copy,newIDs:[],now:1000).status,"copied")
        XCTAssertTrue(state.hasBranchClipboard); XCTAssertFalse(state.canUndoMessageEdit)
        let saved = try state.publicationSnapshot(), clipboard = try saved.required("state").required("branchClipboard")
        XCTAssertEqual(clipboard["nodeIds"],.array([.string("middle"),.string("last")]))
        XCTAssertEqual(try clipboard.required("nodes").required("middle").required("xOpaque").encoded(),try rawMetadata.encoded())
        for key in ["collapsedNodes","omittedNodes","protectedNodes"] { XCTAssertEqual(clipboard[key]?["middle"],.bool(true)); XCTAssertEqual(clipboard[key]?["last"],.bool(false)) }
        let fresh = ChatState(store:local)
        XCTAssertTrue(fresh.hasBranchClipboard); XCTAssertEqual(try fresh.publicationSnapshot().encoded(),try saved.encoded())
        let futureClipboard = clipboard.replacing("xFuture",with:rawMetadata)
        try fresh.applySnapshot(.object([.init(key:"version",value:saved.required("version")),.init(key:"state",value:.object([.init(key:"branchClipboard",value:futureClipboard)]))]))
        var paste = try fresh.branchClipboardDraft(nodeID:"middle",operation:.paste); paste.targetChatID = "other"; paste.afterNodeID = "message-0"
        let result = try fresh.saveBranchClipboard(paste,newIDs:["other-root","pasted-middle","pasted-last"],now:2000)
        XCTAssertEqual(result.status,"pasted"); XCTAssertEqual(result.nodeIDs,["pasted-middle","pasted-last"])
        XCTAssertEqual(fresh.selectedConversationID,"target")
        let other = try XCTUnwrap(fresh.conversations.first { $0.id == "other" })
        XCTAssertEqual(other.visibleMessages.map(\.id),["other-root","pasted-middle","pasted-last"])
        let pasted = try XCTUnwrap(other.nodes.first { $0.id == "pasted-middle" })
        XCTAssertTrue(pasted.options.collapsed); XCTAssertTrue(pasted.options.omitted); XCTAssertTrue(pasted.options.protected); XCTAssertTrue(pasted.options.pinned)
        XCTAssertEqual(pasted.parts,try XCTUnwrap(state.conversation?.nodes.first { $0.id == "middle" }).parts)
        let source = try XCTUnwrap(fresh.exchange).source
        XCTAssertEqual(try source.required("chats").array("chats")[1].required("branchTree").required("nodes").required("pasted-middle").required("xOpaque").encoded(),try rawMetadata.encoded())
        XCTAssertEqual(source["xHuge"],.number("9007199254740993"))
        XCTAssertEqual(try fresh.publicationSnapshot().required("state").required("branchClipboard").encoded(),try futureClipboard.encoded())
        let restarted = ChatState(store:local)
        XCTAssertEqual(try restarted.publicationSnapshot().encoded(),try fresh.publicationSnapshot().encoded())
        let exported = try OrderedJSON.decode(restarted.exportWebData())
        XCTAssertEqual(exported["xHuge"],.number("9007199254740993")); XCTAssertNil(exported["branchClipboard"])
        let records = try SyncRecords.toRecords(restarted.publicationSnapshot())
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(SyncRecords.fromRecords(records))),try SyncRecords.canonical(records))
        try fresh.undoMessageEdit(now:3000); XCTAssertEqual(fresh.conversations.first { $0.id == "other" }?.visibleMessages.map(\.id),["other-root"])
        XCTAssertEqual(try fresh.publicationSnapshot().required("state").required("branchClipboard").encoded(),try futureClipboard.encoded())
        try fresh.redoMessageEdit(now:4000); XCTAssertEqual(fresh.conversations.first { $0.id == "other" }?.visibleMessages.map(\.id),["other-root","pasted-middle","pasted-last"])
    }

    func testClipboardCutAndCrossChatMoveRetainOutsideBranchesAndUndoBothChats() throws {
        for operation in [BranchClipboardOperation.cut,.move] {
            let local = try store(), state = ChatState(store:local); try state.importWebData(cases()[0].required("input").encoded())
            var draft = try state.branchClipboardDraft(nodeID:"middle",operation:operation); draft.toNodeID = "last"; draft.targetChatID = "other"; draft.afterNodeID = "message-0"
            let result = try state.saveBranchClipboard(draft,newIDs:operation == .move ? ["other-root","moved-middle","moved-last"] : [],now:1000)
            XCTAssertEqual(result.status,operation == .cut ? "cut" : "moved")
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["system"])
            let source = try XCTUnwrap(state.exchange).source, target = try source.required("chats").array("chats")[0]
            XCTAssertNotNil(target["branchTree"]?["nodes"]?["hidden"]); XCTAssertNil(target["branchTree"]?["nodes"]?["middle"])
            XCTAssertTrue(state.hasBranchClipboard)
            if operation == .move { XCTAssertEqual(state.conversations.first { $0.id == "other" }?.visibleMessages.map(\.id),["other-root","moved-middle","moved-last"]) }
            let persisted = try state.publicationSnapshot(), clipboard = try persisted.required("state").required("branchClipboard")
            XCTAssertEqual(try ChatState(store:local).publicationSnapshot().encoded(),try persisted.encoded())
            try state.undoMessageEdit(now:2000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["system","middle","last"])
            if operation == .move { XCTAssertEqual(state.conversations.first { $0.id == "other" }?.visibleMessages.map(\.id),["other-root"]) }
            XCTAssertEqual(try state.publicationSnapshot().required("state").required("branchClipboard").encoded(),try clipboard.encoded())
            try state.redoMessageEdit(now:3000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["system"])
        }
        let local = try store(), state = ChatState(store:local), flat = try cases().first { $0["name"] == .string("flat-overwrite") }!.required("input")
        try state.importWebData(flat.encoded())
        XCTAssertEqual(try state.saveBranchClipboard(state.branchClipboardDraft(nodeID:"message-0"),newIDs:["flat-copied"],now:1000).status,"copied")
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["flat-copied"]); XCTAssertTrue(ChatState(store:local).hasBranchClipboard); XCTAssertFalse(state.canUndoMessageEdit)
        XCTAssertEqual(try state.saveBranchClipboard(state.branchClipboardDraft(nodeID:"flat-copied",operation:.cut),newIDs:[],now:2000).status,"cut")
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),[]); XCTAssertTrue(ChatState(store:local).hasBranchClipboard)
        try state.undoMessageEdit(now:3000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["flat-copied"])
        let paste = try state.branchClipboardDraft(nodeID:"flat-copied",operation:.paste)
        XCTAssertEqual(try state.saveBranchClipboard(paste,newIDs:["flat-pasted"],now:4000).status,"pasted")
        try assertTransformIO(state,local:local,path:["flat-copied","flat-pasted"])
    }

    func testClipboardProtectedInvalidRangeAndTargetDoNotReplaceStoredClipboard() throws {
        let local = try store(), state = ChatState(store:local); try state.importWebData(cases()[0].required("input").encoded())
        _ = try state.saveBranchClipboard(state.branchClipboardDraft(nodeID:"hidden"),newIDs:[],now:1000)
        var input = try cases()[0].required("input"), chats = try input.required("chats").array("chats")
        chats[0] = chats[0].replacing("protectedNodes",with:.object([.init(key:"last",value:.bool(true))])); input = input.replacing("chats",with:.array(chats))
        try state.importWebData(input.encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        for operation in [BranchClipboardOperation.cut,.move] {
            var blocked = try state.branchClipboardDraft(nodeID:"middle",operation:operation); blocked.toNodeID = "last"; blocked.targetChatID = "other"; blocked.afterNodeID = "message-0"
            let result = try state.saveBranchClipboard(blocked,newIDs:[],now:2000)
            XCTAssertEqual(result.status,"protected"); XCTAssertEqual(result.blockedNodeIDs,["last"])
        }
        var invalid = try state.branchClipboardDraft(nodeID:"last"); invalid.toNodeID = "middle"
        XCTAssertEqual(try state.saveBranchClipboard(invalid,newIDs:[],now:2000).status,"not-ancestor")
        var move = try state.branchClipboardDraft(nodeID:"middle",operation:.move); move.toNodeID = "middle"; move.afterNodeID = "middle"
        XCTAssertEqual(try state.saveBranchClipboard(move,newIDs:[],now:2000).status,"invalid-target")
        XCTAssertEqual(try state.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
    }

    func testClipboardAtomicSaveFailuresRetryAndClipboardOnlyStaleDraft() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("clipboard-fault-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        let fault = InsertionWriteFault(), local = LocalStateStore(fileURL:directory.appendingPathComponent("local.json")) { data,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to:url,options:.atomic)
        }
        let state = ChatState(store:local); try state.importWebData(cases()[0].required("input").encoded())
        let copy = try state.branchClipboardDraft(nodeID:"middle"), stale = try state.branchClipboardDraft(nodeID:"hidden")
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        fault.reject = true; XCTAssertThrowsError(try state.saveBranchClipboard(copy,newIDs:[],now:1000))
        XCTAssertFalse(state.hasBranchClipboard); XCTAssertFalse(state.canUndoMessageEdit)
        XCTAssertEqual(try state.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        fault.reject = false; XCTAssertEqual(try state.saveBranchClipboard(copy,newIDs:[],now:1000).status,"copied")
        let copied = try state.publicationSnapshot(), copiedDisk = try Data(contentsOf:local.fileURL), source = try XCTUnwrap(state.exchange).source
        XCTAssertEqual(source,stale.source)
        for operation in BranchClipboardOperation.allCases {
            var draft = stale; draft.operation = operation
            XCTAssertThrowsError(try state.saveBranchClipboard(draft,newIDs:[],now:2000))
            XCTAssertEqual(try state.publicationSnapshot(),copied); XCTAssertEqual(try Data(contentsOf:local.fileURL),copiedDisk)
        }
        for operation in [BranchClipboardOperation.cut,.paste,.move] {
            var draft = try state.branchClipboardDraft(nodeID:"middle",operation:operation); draft.afterNodeID = "system"
            fault.reject = true; XCTAssertThrowsError(try state.saveBranchClipboard(draft,newIDs:["clipboard-retry"],now:3000))
            XCTAssertEqual(try state.publicationSnapshot(),copied); XCTAssertEqual(try Data(contentsOf:local.fileURL),copiedDisk); XCTAssertFalse(state.canUndoMessageEdit)
        }
        fault.reject = false
        let cut = try state.branchClipboardDraft(nodeID:"middle",operation:.cut)
        XCTAssertEqual(try state.saveBranchClipboard(cut,newIDs:[],now:3000).status,"cut")
        XCTAssertTrue(state.canUndoMessageEdit); XCTAssertTrue(state.hasBranchClipboard)
        try state.undoMessageEdit(now:4000); XCTAssertEqual(state.conversation?.visibleMessages.map(\.id),["system","middle","last"])
    }

    @MainActor func testEveryMessageSaveModeRejectsActiveGenerationWithoutDiscardingPartialOutput() async throws {
        let store=try store(), state=ChatState(store:store)
        try state.importWebData(cases()[0].required("input").encoded())
        var draft=try state.messageInsertionDraft(beforeNodeID:"middle"); draft.text="Must not save"
        let removal = try state.nodeRemovalDraft(nodeID: "middle"), prune = try state.pruneHiddenDraft()
        let move = try state.nodeMoveDraft(nodeID: "middle", direction: .down), deletion = try state.branchDeletionDraft(nodeID: "middle")
        var replacement = try state.messageReplacementDraft(nodeID: "middle"); replacement.text = "Blocked replacement"
        let clipboardDraft = try state.branchClipboardDraft(nodeID:"middle")
        let config=URLSessionConfiguration.ephemeral; config.protocolClasses=[HeldInsertionProtocol.self]
        let client=RemoteClient(session:URLSession(configuration:config))
        let record=RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"FAKE-model",stream:true),key:"FAKE")
        try state.startGeneration(input:"Generating",record:record,client:client,nodeIDs:["generation-input"])
        for _ in 0..<300 {
            if state.generation?.output.text == "Partial insertion guard" { break }
            try await Task.sleep(nanoseconds:5_000_000)
        }
        let generation=try XCTUnwrap(state.generation)
        XCTAssertEqual(generation.output.text,"Partial insertion guard")
        let before=try state.publicationSnapshot(), disk=try Data(contentsOf:store.fileURL)
        for mode in [MessageSaveMode.overwrite,.branch,.append,.insert] {
            XCTAssertThrowsError(try state.saveMessage(draft,mode:mode,newIDs:["blocked"],now:1000))
            XCTAssertEqual(state.generation?.id,generation.id); XCTAssertEqual(state.generation?.output.text,generation.output.text)
            XCTAssertEqual(try state.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        }
        for draft in [removal, prune] {
            XCTAssertThrowsError(try state.saveNodeRemoval(draft, now: 1000))
            XCTAssertEqual(state.generation?.id, generation.id); XCTAssertEqual(state.generation?.output.text, generation.output.text)
            XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        }
        XCTAssertThrowsError(try state.saveMessageReplacingAndPruning(replacement, newIDs: [], now: 1000))
        for draft in [move, deletion] { XCTAssertThrowsError(try state.saveNodeTransform(draft, newIDs: [], now: 1000)) }
        XCTAssertFalse(state.canUndoMessageEdit); XCTAssertFalse(state.canRedoMessageEdit)
        XCTAssertThrowsError(try state.undoMessageEdit(now: 1000)); XCTAssertThrowsError(try state.redoMessageEdit(now: 1000))
        XCTAssertEqual(state.generation?.id, generation.id); XCTAssertEqual(state.generation?.output.text, generation.output.text)
        XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        state.stopGeneration()
    }

}

private final class InsertionWriteFault { var reject=false }
private final class HeldInsertionProtocol: URLProtocol {
    override class func canInit(with request:URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request:URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"text/event-stream"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data("data: {\"choices\":[{\"delta\":{\"content\":\"Partial insertion guard\"}}]}\n\n".utf8))
    }
    override func stopLoading() {}
}
