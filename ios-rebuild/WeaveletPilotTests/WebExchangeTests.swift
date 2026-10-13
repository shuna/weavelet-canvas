import XCTest
@testable import WeaveletPilot

final class WebExchangeTests: XCTestCase {
    private func corpus() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json")))
    }

    private func changingFirstTree(_ export: OrderedJSON, _ transform: (OrderedJSON) throws -> OrderedJSON) throws -> OrderedJSON {
        var chats = try export.required("chats").array("chats")
        chats[0] = try chats[0].replacing("branchTree", with: transform(chats[0].required("branchTree")))
        return export.replacing("chats", with: .array(chats))
    }

    func testCorpusRoundTripAndTypedProjection() throws {
        let fixture = try corpus()
        XCTAssertEqual(fixture["fixtureVersion"], .number("1"))
        let source = try fixture.required("exportV3")
        let state = ChatState()
        try state.importWebData(source.encoded())
        let exchange = try XCTUnwrap(state.exchange)
        XCTAssertEqual(try OrderedJSON.decode(exchange.encoded()), source)
        XCTAssertEqual(exchange.conversations.count, 2)
        let branched = exchange.conversations[0]
        XCTAssertEqual(branched.nodes.count, 4)
        XCTAssertEqual(branched.visibleMessages.map(\.id), ["n-system", "n-user", "n-assistant"])
        XCTAssertEqual(branched.visibleMessages.map(\.role), ["system", "user", "assistant"])
        XCTAssertEqual(branched.visibleMessages[1].parts, [
            .text("本文\n日本語🙂"),
            .image(url: "data:image/png;base64,FAKE_TEST_IMAGE", detail: "high"),
            .reasoning("検討"),
            .toolCall(id: "FAKE-TEST-CALL", name: "fake_lookup", arguments: "{\"fake\":true,\"q\":\"日本語\"}"),
            .toolResult(callID: "FAKE-TEST-CALL", content: "FAKE TEST RESULT")
        ])
        XCTAssertFalse(exchange.conversations[1].visibleMessages.isEmpty)
        state.selectSibling("n-inactive", of: "n-assistant")
        XCTAssertEqual(state.conversation?.visibleMessages.last?.parts, [.text("別分岐の本文")])
        state.style = .bubbles
        XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(state.exchange).encoded()), try corpusSelectingInactive(source))
        XCTAssertNotNil(source["xFixtureExport"])
        XCTAssertNotNil(source["evaluationResults"])
        XCTAssertNotNil(source["contentStore"]?["unreferenced"])
    }

    func testSyncSnapshotOrderedRoundTripWithoutInterpretingProtocol() throws {
        let snapshot = try corpus().required("syncSnapshot")
        XCTAssertEqual(try snapshot.required("state").object("state").count, 56)
        XCTAssertEqual(try OrderedJSON.decode(snapshot.encoded()), snapshot)
    }

    func testMalformedFilesKeepCurrentState() throws {
        let valid = try corpus().required("exportV3")
        let state = ChatState()
        try state.importWebData(valid.encoded())
        let before = try XCTUnwrap(state.exchange).encoded()
        let cycle = try changingFirstTree(valid) { tree in
            let nodes = try tree.required("nodes")
            let system = try nodes.required("n-system").replacing("parentId", with: .string("n-inactive"))
            return tree.replacing("nodes", with: nodes.replacing("n-system", with: system))
        }
        let badPath = try changingFirstTree(valid) { $0.replacing("activePath", with: .array([.string("missing")])) }
        let badInactive = try changingFirstTree(valid) { tree in
            let nodes = try tree.required("nodes")
            let inactive = try nodes.required("n-inactive").replacing("contentHash", with: .string("missing"))
            return tree.replacing("nodes", with: nodes.replacing("n-inactive", with: inactive))
        }
        let badRole = try changingFirstTree(valid) { tree in
            let nodes = try tree.required("nodes")
            let user = try nodes.required("n-user").replacing("role", with: .string("tool"))
            return tree.replacing("nodes", with: nodes.replacing("n-user", with: user))
        }
        let store = try valid.required("contentStore")
        let malformedPart = try store.required("rich").replacing("content", with: .array([.object([
            JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .number("7"))
        ])]))
        let deltaEntry = try store.required("rich").replacing("delta", with: .object([]))
        let invalid = [valid.replacing("version", with: .number("2")), cycle, badPath, badInactive, badRole,
            valid.replacing("contentStore", with: store.replacing("rich", with: malformedPart)),
            valid.replacing("contentStore", with: store.replacing("rich", with: deltaEntry))]
        for payload in invalid {
            XCTAssertThrowsError(try state.importWebData(payload.encoded()))
            XCTAssertEqual(try XCTUnwrap(state.exchange).encoded(), before)
            XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["n-system", "n-user", "n-assistant"])
        }
    }

    func testOrphanForestAndExplicitActivePathArePreserved() throws {
        let source = try corpus().required("exportV3")
        let forest = try changingFirstTree(source) { tree in
            let nodes = try tree.required("nodes")
            let orphan = try nodes.required("n-inactive").replacing("parentId", with: .string("pruned-parent"))
            return tree.replacing("nodes", with: nodes.replacing("n-inactive", with: orphan))
                .replacing("rootId", with: .string("pruned-root"))
                .replacing("activePath", with: .array([.string("n-inactive"), .string("n-system")]))
        }
        let exchange = try WebExchange(source: forest)
        XCTAssertEqual(exchange.conversations[0].visibleMessages.map(\.id), ["n-inactive", "n-system"])
        XCTAssertEqual(try OrderedJSON.decode(exchange.encoded()), forest)
    }

    func testOrderedParserPreservesExactKeysNumbersAndRejectsMalformedJSON() throws {
        let source = Data(#"{"é":1,"e\u0301":2,"integer":123456789012345678901234567890,"negative":-0,"exponent":1E-10,"text":"日本語🙂"}"#.utf8)
        let parsed = try OrderedJSON.decode(source)
        let fields = try parsed.object("test")
        XCTAssertEqual(fields.count, 6)
        XCTAssertNotEqual(Data(fields[0].key.text.utf8), Data(fields[1].key.text.utf8))
        XCTAssertEqual(parsed["é"], .number("1"))
        XCTAssertEqual(parsed["e\u{0301}"], .number("2"))
        XCTAssertEqual(parsed["integer"], .number("123456789012345678901234567890"))
        XCTAssertEqual(try OrderedJSON.decode(parsed.encoded()), parsed)
        for invalid in ["", #"{"a":1,"a":2}"#, "[1,]", #"{"a":01}"#, #"{"a":"\uD80Z"}"#, "[true false]", "null trailing"] {
            XCTAssertThrowsError(try OrderedJSON.decode(Data(invalid.utf8)), invalid)
        }
        XCTAssertThrowsError(try OrderedJSON.decode(Data((String(repeating: "[", count: 258) + "0" + String(repeating: "]", count: 258)).utf8)))
    }

    func testLoneUTF16ValuesKeysPathsAndDuplicateValidationRemainLossless() throws {
        let input = #"{"\ud800":"\udc00","\udc00":"\ud800","�":"replacement","é":1,"e\u0301":2,"large":9007199254740993,"decimal":1.2300,"pair":"\ud800\udc00"}"#
        let raw = try OrderedJSON.decode(Data(input.utf8))
        let fields = try raw.object("raw")
        XCTAssertEqual(fields[0].key.utf16, [0xd800])
        XCTAssertEqual(fields[1].key.utf16, [0xdc00])
        XCTAssertEqual(Set(fields.map(\.key)).count, fields.count)
        XCTAssertEqual(raw[fields[0].key], .utf16String([0xdc00]))
        XCTAssertEqual(raw[fields[1].key], .utf16String([0xd800]))
        XCTAssertEqual(raw["�"], .string("replacement"))
        XCTAssertEqual(raw["pair"], .string("𐀀"))
        XCTAssertEqual(try OrderedJSON.decode(raw.encoded()), raw)
        let encoded = String(decoding: try raw.encoded(), as: UTF8.self)
        XCTAssertTrue(encoded.contains(#""\ud800":"\udc00""#))
        XCTAssertTrue(encoded.contains("9007199254740993"))
        XCTAssertTrue(encoded.contains("1.2300"))
        let change = try OrderedJSON.decode(Data(#"[{"op":"set","path":["\ud800"],"value":"changed"}]"#.utf8))
        let changed = try OrderedJSONChanges.apply(change, to: raw)
        XCTAssertEqual(changed[fields[0].key], .string("changed"))
        XCTAssertEqual(changed[fields[1].key], .utf16String([0xd800]))
        XCTAssertEqual(try ChatImport.value(at: .array([fields[1].key.json]), in: raw), .utf16String([0xd800]))
        let keys = OrderedJSON.array(fields.reversed().map { $0.key.json })
        let reorder = OrderedJSON.array([.object([.init(key:"op",value:.string("keys")),.init(key:"path",value:.array([])),.init(key:"keys",value:keys)])])
        XCTAssertEqual(try OrderedJSONChanges.apply(reorder,to:raw).object("raw").map(\.key), fields.reversed().map(\.key))
        XCTAssertThrowsError(try fields[0].key.native("OS key"))
        XCTAssertThrowsError(try raw.required(fields[0].key).string("native string"))
        for invalid in [#"{"\ud800":1,"\uD800":2}"#, #""\ud800\q""#, #""\ud800\u12""#, #""\ud800"#] {
            XCTAssertThrowsError(try OrderedJSON.decode(Data(invalid.utf8)), invalid)
        }
        XCTAssertThrowsError(try OrderedJSON.decode(Data([34, 0xed, 0xa0, 0x80, 34])))
    }

    func testOrderedEqualityDistinguishesCanonicalUnicodeInIDsAttributesAndKeys() throws {
        let composed = "\u{00E9}", decomposed = "e\u{0301}"
        let original = OrderedJSON.object([
            .init(key: "id", value: .string(composed)),
            .init(key: "attribute", value: .array([.string(composed)])),
            .init(key: composed, value: .number("1"))
        ])
        XCTAssertNotEqual(original, original.replacing("id", with: .string(decomposed)))
        XCTAssertNotEqual(original, original.replacing("attribute", with: .array([.string(decomposed)])))
        let changedKey = OrderedJSON.object([
            .init(key: "id", value: .string(composed)),
            .init(key: "attribute", value: .array([.string(composed)])),
            .init(key: decomposed, value: .number("1"))
        ])
        XCTAssertNotEqual(original, changedKey)
        XCTAssertEqual(try OrderedJSON.decode(original.encoded()), original)
        XCTAssertNotEqual(OrderedJSON.number("1"), .number("1.0"))
    }

    func testSyncRejectsStaleSnapshotWhenOnlyUnicodeNormalizationChanged() throws {
        let state = ChatState()
        try state.importWebData(corpus().required("exportV3").encoded())
        let first = try state.syncInputSnapshot()
        try state.applySnapshot(first.replacing("state", with: try first.required("state").replacing("xUnicode", with: .string("\u{00E9}"))))
        let expected = try state.syncInputSnapshot()
        try state.applySnapshot(expected.replacing("state", with: try expected.required("state").replacing("xUnicode", with: .string("e\u{0301}"))))
        let current = try state.syncInputSnapshot()
        XCTAssertNotEqual(current, expected)
        XCTAssertThrowsError(try state.applySynchronizedSnapshot(expected, expected: expected))
        XCTAssertEqual(try state.syncInputSnapshot().encoded(), try current.encoded())
    }

    func testEmptyExportClearsViewWithoutLosingSource() throws {
        let source = try corpus().required("exportV3").replacing("chats", with: .array([]))
        let state = ChatState()
        try state.importWebData(source.encoded())
        XCTAssertNil(state.conversation)
        XCTAssertEqual(try OrderedJSON.decode(XCTUnwrap(state.exchange).encoded()), source)
    }
}
