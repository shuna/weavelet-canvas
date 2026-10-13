import XCTest
@testable import WeaveletPilot

final class MessageAttributesTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let result = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/message-attributes.json")))
        XCTAssertEqual(result["fixtureVersion"], .number("1"))
        return result
    }
    private func drop(_ key: String, from value: OrderedJSON) throws -> OrderedJSON {
        .object(try value.object("object").filter { !$0.key.text.utf8.elementsEqual(key.utf8) })
    }
    private func assertJSON(_ actual: OrderedJSON?, _ expected: OrderedJSON, file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertEqual(try SyncRecords.canonical(XCTUnwrap(actual, file: file, line: line)), try SyncRecords.canonical(expected), file: file, line: line)
    }
    private func export(_ state: OrderedJSON) -> OrderedJSON {
        state.replacing("version", with: .number("3")).replacing("folders", with: .object([]))
    }
    private func recordPath(_ parts: [String]) throws -> String {
        String(decoding: try OrderedJSON.array(parts.map(OrderedJSON.string)).encoded(), as: UTF8.self)
    }

    func testFlatBranchCopiesMessageAttributesWithoutInheritingNodePropertiesOrMutatingSource() throws {
        let f = try fixture(), chat = try f.required("flatChat")
        let input = OrderedJSON.object([JSONField(key: "version", value: .number("3")), JSONField(key: "chats", value: .array([chat])), JSONField(key: "contentStore", value: .object([])), JSONField(key: "folders", value: .object([]))])
        let before = try input.encoded()
        let result = try MessageEditing.save(in: input, chatID: "message-chat", nodeID: "message-0", viewingPath: [], role: "user", parts: f.required("expected").required("editedContent"), mode: .branch, newIDs: ["a", "b", "new-branch"], now: 1000)
        let saved = try result.required("chats").array("chats")[0], tree = try saved.required("branchTree")
        let byNode = try XCTUnwrap(MessageAttributes.read(tree))
        let expected = try f.required("expected").required("flatAttributes").array("attributes")
        try assertJSON(byNode["a"], expected[0]); try assertJSON(byNode["b"], expected[1]); try assertJSON(byNode["new-branch"], expected[0])
        let node = try tree.required("nodes").required("new-branch")
        for name in ["label", "starred", "pinned", "xNode", "xFuture"] { XCTAssertNil(node[name], name) }
        XCTAssertEqual(node["id"], .string("new-branch"))
        XCTAssertEqual(saved["omittedNodes"]?["a"], .bool(true)); XCTAssertEqual(saved["protectedNodes"]?["a"], .bool(true))
        XCTAssertEqual(saved["collapsedNodes"]?["b"], .bool(true)); XCTAssertEqual(saved["collapsedNodes"]?["FAKE-existing-uuid"], .bool(false)); XCTAssertEqual(saved["collapsedNodes"]?["01"], .bool(false))
        let encoded = try OrderedJSON.decode(WebExchange(source: result).encoded())
        let message = try encoded.required("chats").array("chats")[0].required("messages").array("messages")[0]
        try assertJSON(MessageAttributes.extras(message), expected[0]); try assertJSON(message["content"], f.required("expected").required("editedContent"))
        XCTAssertEqual(try input.encoded(), before)
    }

    func testBranchedCaptureEditingAndExportPreserveOnlyMessageAttributesInSidecar() throws {
        let f = try fixture(), state = try f.required("branchedSnapshot").required("state"), input = export(state)
        let before = try input.encoded()
        let exchange = try WebExchange(source: input)
        let captured = try exchange.source.required("chats").array("chats")[0]
        try assertJSON(MessageAttributes.read(captured.required("branchTree")), f.required("expected").required("branchedAttributes"))
        let result = try MessageEditing.save(in: exchange.source, chatID: "message-chat", nodeID: "b", viewingPath: ["a", "b"], role: "assistant", parts: f.required("expected").required("editedContent"), mode: .overwrite, newIDs: [], now: 1000)
        let chat = try result.required("chats").array("chats")[0]
        try assertJSON(MessageAttributes.read(chat.required("branchTree")), f.required("expected").required("branchedAttributes"))
        XCTAssertEqual(chat["branchTree"]?["nodes"]?["a"], try state.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["a"])
        let encoded = try OrderedJSON.decode(WebExchange(source: result).encoded())
        let messages = try encoded.required("chats").array("chats")[0].required("messages").array("messages")
        try assertJSON(MessageAttributes.extras(messages[0]), f.required("expected").required("branchedAttributes").required("a"))
        try assertJSON(MessageAttributes.extras(messages[1]), f.required("expected").required("branchedAttributes").required("b"))
        try assertJSON(messages[1]["content"], f.required("expected").required("editedContent"))
        XCTAssertEqual(try input.encoded(), before)
    }

    func testCompactMissingMessagesAndDeltaProjectionMatchWebReadBoundary() throws {
        let f = try fixture(), state = try f.required("branchedSnapshot").required("state")
        let original = try state.required("chats").array("chats")[0], store = try state.required("contentStore")
        let compact = try drop("messages", from: original)
        XCTAssertEqual(try MessageAttributes.capture(compact, store: store), compact)
        let nullProjection = compact.replacing("messages", with: .null)
        XCTAssertEqual(try MessageAttributes.capture(nullProjection, store: store), nullProjection)
        XCTAssertNoThrow(try SyncRecords.toRecords(f.required("branchedSnapshot").replacing("state", with: state.replacing("chats", with: .array([nullProjection])))))
        _ = try WebExchange(source: export(state.replacing("chats", with: .array([compact]))))
        let delta = OrderedJSON.object([JSONField(key: "baseHash", value: .string("base")), JSONField(key: "patches", value: .string(""))])
        let base = try store.required("first")
        let compressed = store.replacing("base", with: base).replacing("first", with: base.replacing("content", with: .array([])).replacing("delta", with: delta))
        let captured = try MessageAttributes.capture(original, store: compressed)
        try assertJSON(MessageAttributes.read(captured.required("branchTree")), f.required("expected").required("branchedAttributes"))
        for baseHash in ["absent", "first"] {
            let broken = compressed.replacing("first", with: base.replacing("content", with: .array([])).replacing("delta", with: delta.replacing("baseHash", with: .string(baseHash))))
            var messages = try original.required("messages").array("messages")
            messages[0] = messages[0].replacing("content", with: .array([]))
            XCTAssertNoThrow(try MessageAttributes.capture(original.replacing("messages", with: .array(messages)), store: broken))
            XCTAssertThrowsError(try SyncRecords.toRecords(f.required("branchedSnapshot").replacing("state", with: state.replacing("contentStore", with: broken))))
        }
    }

    func testAtomicNodeAndClipboardAttributeRecordsRoundTripUsingSharedExpectations() throws {
        let f = try fixture(), snapshot = try f.required("branchedSnapshot"), expected = try f.required("expected").required("branchedAttributes")
        let records = try SyncRecords.toRecords(snapshot)
        for id in ["a", "b"] {
            let key = try recordPath(["chats", "message-chat", "branchTree", "messageAttributesV1", "byNode", id])
            let value = try OrderedJSON.decode(Data(records.required(key).string("record").utf8))
            try assertJSON(value, expected.required(id))
            XCTAssertFalse(try records.object("records").contains { field in
                let path = try OrderedJSON.decode(Data(field.key.text.utf8)).array("path")
                return path.count > 6 && Array(path.prefix(6)) == [.string("chats"), .string("message-chat"), .string("branchTree"), .string("messageAttributesV1"), .string("byNode"), .string(id)]
            })
        }
        let restored = try SyncRecords.fromRecords(records), state = try restored.required("state")
        let tree = try state.required("chats").array("chats")[0].required("branchTree")
        try assertJSON(MessageAttributes.read(tree), expected)
        var clipboard = OrderedJSON.object([JSONField(key: "nodeIds", value: .array([.string("a"), .string("b")])), JSONField(key: "sourceChat", value: .string("message-chat")), JSONField(key: "nodes", value: try tree.required("nodes"))])
        clipboard = try MessageAttributes.copying(from: tree, nodeID: "a", to: clipboard, newID: "a")
        clipboard = try MessageAttributes.copying(from: tree, nodeID: "b", to: clipboard, newID: "b")
        let clipRecords = try SyncRecords.toRecords(restored.replacing("state", with: state.replacing("branchClipboard", with: clipboard)))
        for id in ["a", "b"] {
            let key = try recordPath(["state", "branchClipboard", "messageAttributesV1", "byNode", id])
            try assertJSON(OrderedJSON.decode(Data(clipRecords.required(key).string("record").utf8)), expected.required(id))
        }
        let clipped = try SyncRecords.fromRecords(clipRecords)
        try assertJSON(MessageAttributes.read(clipped.required("state").required("branchClipboard")), expected)
        try assertJSON(SyncRecords.toRecords(clipped), clipRecords)
    }

    func testProjectionDoesNotNormalizeUnicodeAttributeOrBodyValues() throws {
        let f = try fixture(), state = try f.required("branchedSnapshot").required("state")
        let original = try state.required("chats").array("chats")[0], originalTree = try original.required("branchTree")
        let store = try state.required("contentStore")
        var messages = try original.required("messages").array("messages")
        let namespace = try originalTree.required("messageAttributesV1")
        let byNode = try namespace.required("byNode")
        let attributes = try byNode.required("a").replacing("xUnicode", with: .string("é"))
        let tree = originalTree.replacing("messageAttributesV1", with: namespace.replacing("byNode", with: byNode.replacing("a", with: attributes)))
        messages[0] = messages[0].replacing("xUnicode", with: .string("e\u{301}"))
        let conflict = original.replacing("branchTree", with: tree).replacing("messages", with: .array(messages)), before = try conflict.encoded()
        XCTAssertThrowsError(try MessageAttributes.capture(conflict, store: store))
        XCTAssertEqual(try conflict.encoded(), before)
        let body = OrderedJSON.array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("é"))])])
        let projection = OrderedJSON.array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("e\u{301}"))])])
        messages = try original.required("messages").array("messages")
        messages[0] = messages[0].replacing("content", with: projection)
        let mismatched = original.replacing("messages", with: .array(messages))
        let changedStore = try store.replacing("first", with: store.required("first").replacing("content", with: body))
        XCTAssertThrowsError(try MessageAttributes.capture(mismatched, store: changedStore))
    }

    func testNamespaceMismatchDanglingNodeAndProjectionConflictsRejectWithoutMutation() throws {
        let f = try fixture(), snapshot = try f.required("branchedSnapshot"), state = try snapshot.required("state")
        let original = try state.required("chats").array("chats")[0], tree = try original.required("branchTree")
        let wrongs: [OrderedJSON] = [
            .object([JSONField(key: "futureUnknown", value: .string("FAKE occupied"))]),
            .object([JSONField(key: "version", value: .number("2")), JSONField(key: "byNode", value: .object([]))]),
            .object([JSONField(key: "version", value: .number("1")), JSONField(key: "byNode", value: .object([JSONField(key: "absent", value: .object([]))]))]),
            .object([JSONField(key: "version", value: .number("1")), JSONField(key: "byNode", value: .object([JSONField(key: "a", value: .object([JSONField(key: "id", value: .string("FAKE conflicting"))]))]))])
        ]
        for namespace in wrongs {
            let chat = original.replacing("branchTree", with: tree.replacing("messageAttributesV1", with: namespace)), before = try chat.encoded()
            XCTAssertThrowsError(try MessageAttributes.capture(chat, store: state.required("contentStore")))
            XCTAssertThrowsError(try SyncRecords.toRecords(snapshot.replacing("state", with: state.replacing("chats", with: .array([chat])))))
            XCTAssertThrowsError(try WebExchange(source: export(state.replacing("chats", with: .array([chat])))))
            XCTAssertEqual(try chat.encoded(), before)
        }
        let records = try SyncRecords.toRecords(snapshot)
        let version = try recordPath(["chats", "message-chat", "branchTree", "messageAttributesV1", "version"])
        XCTAssertThrowsError(try SyncRecords.fromRecords(records.replacing(version, with: .string("2"))))
        let byNode = try recordPath(["chats", "message-chat", "branchTree", "messageAttributesV1", "byNode", "a"])
        XCTAssertThrowsError(try SyncRecords.fromRecords(records.replacing(byNode, with: .string("{\"role\":\"user\"}"))))
        let absent = try recordPath(["chats", "message-chat", "branchTree", "messageAttributesV1", "byNode", "absent"])
        XCTAssertThrowsError(try SyncRecords.fromRecords(records.replacing(absent, with: .string("{}"))))
    }
}
