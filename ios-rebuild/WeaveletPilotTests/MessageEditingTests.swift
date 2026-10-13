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

}
