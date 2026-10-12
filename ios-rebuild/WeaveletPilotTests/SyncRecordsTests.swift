import XCTest
import CryptoKit
@testable import WeaveletPilot

final class SyncRecordsTests: XCTestCase {
    private var root: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func fixture() throws -> OrderedJSON {
        try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/record-wire.json")))
    }
    // Policy is frozen separately and checked against actual Web constants by recordWire tests.
    private func syncProjection(_ snapshot: OrderedJSON) throws -> OrderedJSON {
        let policy = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/sync-local-settings-policy.json")))
        XCTAssertEqual(policy["fixtureVersion"], .number("1"))
        let keys = try policy.required("syncLocalSettings").array("policy").map { Data(try $0.string("key").utf8) }
        let state = try snapshot.required("state").object("state").filter { !keys.contains(Data($0.key.utf8)) }
        return snapshot.replacing("state", with: .object(state))
    }
    private func baseCase() throws -> OrderedJSON { try fixture().required("cases").array("cases")[0] }
    private func path(_ parts: [String]) throws -> String { String(decoding: try OrderedJSON.array(parts.map(OrderedJSON.string)).encoded(), as: UTF8.self) }
    private func compareRecords(_ actual: OrderedJSON, _ expected: OrderedJSON, name: String) throws {
        let actualFields = try actual.object("records")
        let expectedFields = try expected.object("records")
        XCTAssertEqual(actualFields.count, expectedFields.count, name)
        for field in expectedFields {
            let value = try XCTUnwrap(actual[field.key], name)
            XCTAssertEqual(Data(try value.string("value").utf8), Data(try field.value.string("value").utf8), "\(name): \(field.key)")
        }
    }

    func testAllFrozenWebRecordSetsAndRestoredSnapshots() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture["fixtureVersion"], .number("2"))
        let cases = try fixture.required("cases").array("cases")
        XCTAssertEqual(cases.count, 5)
        for test in cases {
            let name = try test.required("name").string("name")
            let input = try test.required("snapshot")
            let before = try input.encoded()
            let records = try test.required("records")
            XCTAssertEqual(try input.encoded(), before)
            let restored = try SyncRecords.fromRecords(records)
            XCTAssertEqual(restored, try syncProjection(test.required("restored")), name)
            let reversed = OrderedJSON.object(try records.object("records").reversed())
            let reversedSnapshot = try SyncRecords.fromRecords(reversed)
            let expectedChats = try restored.required("state").required("chats").array("chats")
            let actualChats = try reversedSnapshot.required("state").required("chats").array("chats")
            for (expected, actual) in zip(expectedChats, actualChats) {
                if let tree = expected["branchTree"] {
                    let expectedIDs = try tree.required("nodes").object("nodes").map { Data($0.key.utf8) }
                    let actualIDs = try actual.required("branchTree").required("nodes").object("nodes").map { Data($0.key.utf8) }
                    XCTAssertEqual(actualIDs, expectedIDs, name)
                }
            }
            if let clipboard = restored["state"]?["branchClipboard"] {
                let expectedIDs = try clipboard.required("nodes").object("nodes").map { Data($0.key.utf8) }
                let actualIDs = try reversedSnapshot.required("state").required("branchClipboard").required("nodes").object("nodes").map { Data($0.key.utf8) }
                XCTAssertEqual(actualIDs, expectedIDs, name)
            }
            let upgraded = try SyncRecords.toRecords(restored)
            try compareRecords(SyncRecords.toRecords(SyncRecords.fromRecords(upgraded)), upgraded, name: "upgraded \(name)")
        }
    }

    func testCanonicalNumbersUTF16SortAndHashes() throws {
        for vector in try fixture().required("canonicals").array("canonicals") {
            let input = try OrderedJSON.decode(Data(vector.required("sourceJSON").string("sourceJSON").utf8))
            let canonical = try SyncRecords.canonical(input)
            XCTAssertEqual(Data(canonical.utf8), Data(try vector.required("canonical").string("canonical").utf8))
            XCTAssertEqual(SyncRecords.digest(canonical), try vector.required("sha256").string("sha256"))
        }
    }

    func testCryptoCompressionRecordBoundaryRoundTrip() throws {
        let input = try baseCase().required("snapshot")
        let records = try SyncRecords.toRecords(input)
        let compressed = try SyncRecords.encodeWire(records)
        let created = try SyncCrypto.createKeyEnvelope(password: "FAKE TEST ONLY boundary passphrase", dataset: "fake-records")
        let cipher = try SyncCrypto.encrypt(key: created.key, bytes: compressed, context: "fake-records:commit:fake-file")
        let unlocked = try SyncCrypto.unlockKey(created.envelope, password: "FAKE TEST ONLY boundary passphrase", dataset: "fake-records")
        let restoredRecords = try SyncRecords.decodeWire(SyncCrypto.decrypt(key: unlocked, bytes: cipher, context: "fake-records:commit:fake-file"))
        try compareRecords(restoredRecords, records, name: "crypto/lz boundary")
        XCTAssertEqual(try SyncRecords.fromRecords(restoredRecords), try SyncRecords.fromRecords(records))
    }


    func testWirePacketsMatchActualWebEncodeBytesAndHashes() throws {
        let packets = try fixture().required("packets").array("packets")
        XCTAssertEqual(packets.count, 5)
        for packet in packets {
            let name = try packet.required("name").string("name")
            let value = try OrderedJSON.decode(Data(packet.required("valueJSON").string("valueJSON").utf8))
            let encoded = try SyncRecords.encodeWire(value)
            let hex = encoded.map { String(format: "%02x", $0) }.joined()
            let digest = SHA256.hash(data: encoded).map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(hex, try packet.required("googleHex").string("googleHex"), name)
            XCTAssertEqual(digest, try packet.required("sha256").string("sha256"), name)
            XCTAssertEqual(try SyncRecords.encodeWire(SyncRecords.decodeWire(encoded)), encoded, name)
        }
    }

    func testInvalidRootIdentityTypesAndReferencesAreRejected() throws {
        let records = try baseCase().required("records")
        let key = try path(["chats", "chat-a", "branchTree", "rootId"])
        for invalid in ["123", "true", "{}", "null", "\"missing-root\""] {
            XCTAssertThrowsError(try SyncRecords.fromRecords(records.replacing(key, with: .string(invalid))), invalid)
        }
    }

    func testInvalidRecordPathsReferencesAndCyclesAreRejected() throws {
        let original = try baseCase().required("records")
        let forbidden = try original.replacing(path(["state", "__proto__", "polluted"]), with: .string("true"))
        let conflict = try original.replacing(path(["state"]), with: .string("[]"))
        let cycle = try original.replacing(path(["chats", "chat-a", "branchTree", "nodes", "n-system", "parentId"]), with: .string("\"n-user\""))
        let orphan = try original.replacing(path(["chats", "chat-a", "branchTree", "nodes", "n-inactive", "parentId"]), with: .string("\"missing-parent\""))
        let orphanUnpinned = try orphan.replacing(path(["chats", "chat-a", "branchTree", "nodes", "n-inactive", "pinned"]), with: .string("false"))
        let badPath = try original.replacing(path(["chats", "chat-a", "branchTree", "activePath"]), with: .string("[\"missing\"]"))
        let badContent = try original.replacing(path(["chats", "chat-a", "branchTree", "nodes", "n-inactive", "contentHash"]), with: .string("\"missing\""))
        let missingAssets = OrderedJSON.object(try original.object("records").filter { !$0.key.hasPrefix("[\"assets\"") })
        let invalidPath = original.replacing("[]", with: .string("true"))
        let nonStringPath = original.replacing("[1]", with: .string("true"))
        for invalid in [forbidden, conflict, cycle, orphanUnpinned, badPath, badContent, missingAssets, invalidPath, nonStringPath] {
            XCTAssertThrowsError(try SyncRecords.fromRecords(invalid))
        }
    }

    func testInvalidContentAndDeltaDoNotPublishRepair() throws {
        let base = try baseCase().required("snapshot")
        let state = try base.required("state")
        let store = try state.required("contentStore")
        let missing = try store.required("system").replacing("delta", with: .object([JSONField(key: "baseHash", value: .string("absent")), JSONField(key: "patches", value: .string(""))]))
        let cyclic = try store.required("system").replacing("delta", with: .object([JSONField(key: "baseHash", value: .string("system")), JSONField(key: "patches", value: .string(""))]))
        let malformed = try store.required("system").replacing("delta", with: .object([JSONField(key: "baseHash", value: .string("rich")), JSONField(key: "patches", value: .string("not a patch"))]))
        for entry in [missing, cyclic, malformed] {
            let invalid = base.replacing("state", with: state.replacing("contentStore", with: store.replacing("system", with: entry)))
            XCTAssertThrowsError(try SyncRecords.toRecords(invalid))
        }
        let unsafe = base.replacing("state", with: state.replacing("__proto__", with: .bool(true)))
        XCTAssertThrowsError(try SyncRecords.toRecords(unsafe))
    }


    func testNodeOrderValidationRejectsMalformedMetadataAndExactDuplicateIDs() throws {
        let legacy = try fixture().required("legacyCases").array("cases")[0].required("records")
        let rootPath = try path(["nodeOrder"])
        let chatsPath = try path(["nodeOrder", "chats"])
        let chatPath = try path(["nodeOrder", "chats", "chat-a"])
        let clipboardPath = try path(["nodeOrder", "clipboard"])
        for (key, value) in [(rootPath, "null"), (rootPath, "[]"), (chatsPath, "null"), (chatsPath, "[]"),
                             (chatPath, "{}"), (chatPath, "[1]"), (chatPath, "[\"n-user\",\"n-user\"]"),
                             (clipboardPath, "[null]"), (clipboardPath, "[\"é\",\"é\"]")] {
            XCTAssertThrowsError(try SyncRecords.fromRecords(legacy.replacing(key, with: .string(value))))
        }
        let distinct = try legacy.replacing(chatPath, with: .string("[\"é\",\"e\\u0301\"]"))
        XCTAssertNoThrow(try SyncRecords.fromRecords(distinct))
    }

    func testNodeOrderIntegerKeysMissingAndUnlistedIDsAndNamespaceIsolation() throws {
        let source = try baseCase().required("snapshot")
        var state = try source.required("state")
        var chats = try state.required("chats").array("chats")
        var tree = try chats[0].required("branchTree")
        let template = try tree.required("nodes").required("n-inactive")
        let ids = ["é", "10", "e\u{0301}", "2", "01"]
        let nodes = OrderedJSON.object(ids.map { id in
            JSONField(key: id, value: template.replacing("id", with: .string(id)).replacing("parentId", with: .null))
        })
        let treeUnknown = OrderedJSON.object([JSONField(key: "keep", value: .string("tree metadata"))])
        let stateUnknown = OrderedJSON.object([JSONField(key: "keep", value: .string("state metadata"))])
        tree = tree.replacing("nodes", with: nodes).replacing("rootId", with: .string("2"))
            .replacing("activePath", with: .array([.string("2")])).replacing("nodeOrder", with: treeUnknown)
        chats[0] = chats[0].replacing("branchTree", with: tree)
        let clipboard = try state.required("branchClipboard").replacing("nodes", with: nodes)
        state = state.replacing("chats", with: .array(chats)).replacing("branchClipboard", with: clipboard).replacing("nodeOrder", with: stateUnknown)
        let records = try SyncRecords.toRecords(source.replacing("state", with: state))
        XCTAssertEqual(records[try path(["nodeOrder", "chats", "chat-a"])], .string("[\"2\",\"10\",\"é\",\"e\u{0301}\",\"01\"]"))
        let preferred = "[\"01\",\"deleted\",\"é\"]"
        let reordered = try records.replacing(path(["nodeOrder", "chats", "chat-a"]), with: .string(preferred))
            .replacing(path(["nodeOrder", "clipboard"]), with: .string(preferred))
        let restored = try SyncRecords.fromRecords(reordered)
        let restoredState = try restored.required("state")
        let restoredTree = try restoredState.required("chats").array("chats")[0].required("branchTree")
        let expected = ["2", "10", "01", "é", "e\u{0301}"].map { Data($0.utf8) }
        XCTAssertEqual(try restoredTree.required("nodes").object("nodes").map { Data($0.key.utf8) }, expected)
        XCTAssertEqual(try restoredState.required("branchClipboard").required("nodes").object("nodes").map { Data($0.key.utf8) }, expected)
        XCTAssertEqual(restoredTree["nodeOrder"], treeUnknown)
        XCTAssertEqual(restoredState["nodeOrder"], stateUnknown)
    }

    func testLegacyRecordSetsRemainReadable() throws {
        let cases = try fixture().required("legacyCases").array("legacyCases")
        XCTAssertEqual(cases.count, 5)
        for test in cases {
            let name = try test.required("name").string("name")
            XCTAssertEqual(try SyncRecords.fromRecords(test.required("records")), try syncProjection(test.required("restored")), name)
        }
    }

    func testNewOrderPreservationAndLegacyArrivalBehaviorRemainVisible() throws {
        let base = try baseCase()
        let source = try base.required("snapshot")
        let records = try SyncRecords.toRecords(source)
        let restored = try SyncRecords.fromRecords(records)
        XCTAssertEqual(try restored.required("state").required("contentStore").object("contentStore").count, try source.required("state").required("contentStore").object("contentStore").count)
        let entries = try restored.required("state").required("contentStore").object("contentStore")
        XCTAssertTrue(entries.contains { $0.value["xFixtureEntry"] != nil })
        let sorted = OrderedJSON.object(try records.object("records").sorted { $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) })
        let sortedSnapshot = try SyncRecords.fromRecords(sorted)
        let originalNodes = try restored.required("state").required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes").map(\.key)
        let sortedNodes = try sortedSnapshot.required("state").required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes").map(\.key)
        XCTAssertTrue(originalNodes.firstIndex(of: "n-inactive")! < originalNodes.firstIndex(of: "n-assistant")!)
        XCTAssertEqual(sortedNodes, originalNodes)
        let legacy = try fixture().required("legacyCases").array("cases")[0].required("records")
        let sortedLegacy = OrderedJSON.object(try legacy.object("records").sorted { $0.key.utf16.lexicographicallyPrecedes($1.key.utf16) })
        let legacySnapshot = try SyncRecords.fromRecords(sortedLegacy)
        let legacyNodes = try legacySnapshot.required("state").required("chats").array("chats")[0].required("branchTree").required("nodes").object("nodes").map(\.key)
        XCTAssertTrue(legacyNodes.firstIndex(of: "n-assistant")! < legacyNodes.firstIndex(of: "n-inactive")!)
    }

    private func entryFixture() throws -> OrderedJSON {
        try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/content-entry-wire.json")))
    }
    private let extensionNames = Set(["contentEntryFormat", "contentEntries", "contentEntryRefs", "retainedContentEntries"])
    private func removingRecords(_ records: OrderedJSON, where predicate: ([String]) -> Bool) throws -> OrderedJSON {
        .object(try records.object("records").filter { field in
            let parts = try OrderedJSON.decode(Data(field.key.utf8)).array("path").map { try $0.string("part") }
            return !predicate(parts)
        })
    }
    private func entryRecords() throws -> OrderedJSON { try SyncRecords.toRecords(entryFixture().required("snapshot")) }

    func testFrozenContentEntryExtensionPreservesMetadataBodiesAndReferences() throws {
        let fixture = try entryFixture()
        let source = try fixture.required("snapshot")
        let before = try source.encoded()
        let records = try SyncRecords.toRecords(source)
        let extensionRecords = try removingRecords(records) { !extensionNames.contains($0[0]) }
        try compareRecords(extensionRecords, fixture.required("expected").required("extensionRecords"), name: "fixed content entry extension")
        let restored = try SyncRecords.fromRecords(.object(try records.object("records").reversed()))
        let state = try restored.required("state")
        let store = try state.required("contentStore")
        let nodes = try state.required("chats").array("chats")[0].required("branchTree").required("nodes")
        XCTAssertEqual(try store.object("store").count, 4)
        for expected in try fixture.required("expected").required("entries").array("entries") {
            let key = try expected.required("sourceKey").string("sourceKey")
            let entry: OrderedJSON
            if key == "unused" {
                entry = try XCTUnwrap(store.object("store").first { $0.value["xFuture"]?["origin"] == .string("unused") }?.value)
            } else {
                entry = try store.required(nodes.required(key).required("contentHash").string("contentHash"))
            }
            XCTAssertEqual(Data(try SyncRecords.canonical(entry).utf8), Data(try SyncRecords.canonical(expected.required("metadata").replacing("content", with: expected.required("content")).replacing("refCount", with: expected.required("references"))).utf8))
            XCTAssertNil(entry["delta"])
        }
        XCTAssertNotEqual(nodes["left"]?["contentHash"], nodes["right"]?["contentHash"])
        XCTAssertEqual(state["branchClipboard"]?["nodes"]?["clip"]?["contentHash"], nodes["left"]?["contentHash"])
        try compareRecords(SyncRecords.toRecords(restored), records, name: "entry round trip")
        XCTAssertEqual(try source.encoded(), before)
    }

    func testContentEntryExtensionRejectsPartialDamagedAndInconsistentRecords() throws {
        let records = try entryRecords()
        let expected = try entryFixture().required("expected")
        let right = try expected.required("entryIds").required("right").string("entryId")
        let unused = try expected.required("entryIds").required("unused").string("entryId")
        let markerOnly = try removingRecords(records) { extensionNames.contains($0[0]) && $0[0] != "contentEntryFormat" }
        let refsOnly = try removingRecords(records) { $0[0] == "contentEntryFormat" }
        let missingRef = try removingRecords(records) { $0 == ["contentEntryRefs", "chats", "entry-chat", "right"] }
        let missingEntry = try removingRecords(records) { $0 == ["contentEntries", right] }
        let missingRetained = try removingRecords(records) { $0[0] == "retainedContentEntries" }
        let missingBody = try removingRecords(records) { $0[0] == "content" }
        let extraRef = try records.replacing(path(["contentEntryRefs", "chats", "entry-chat", "absent"]), with: .string("\"\(right)\""))
        let mismatch = try records.replacing(path(["contentEntryRefs", "chats", "entry-chat", "right"]), with: .string("\"\(unused)\""))
        let badVersion = try records.replacing(path(["contentEntryFormat"]), with: .string("2"))
        let badRetained = try records.replacing(path(["retainedContentEntries", unused]), with: .string("false"))
        let damaged = try records.replacing(path(["contentEntries", right]), with: .string("{\"contentId\":\"fake\",\"metadata\":{}}"))
        for invalid in [markerOnly, refsOnly, missingRef, missingEntry, missingRetained, missingBody, extraRef, mismatch, badVersion, badRetained, damaged] {
            XCTAssertThrowsError(try SyncRecords.fromRecords(invalid))
        }
    }

    func testNonemptyDeltaExpansionKeepsUnknownMetadata() throws {
        let source = try entryFixture().required("snapshot")
        let state = try source.required("state")
        let store = try state.required("contentStore")
        let patches = "@@ -1,41 +1,49 @@\n-%5B%7B%22type%22:%22text%22,%22text%22:%22FAKE%20TEST%20body%22%7D%5D\n+%5B%7B%22type%22:%22text%22,%22text%22:%22FAKE%20TEST%20edited%20delta%22%7D%5D\n"
        let entry = try store.required("delta").replacing("delta", with: .object([JSONField(key: "baseHash", value: .string("left")), JSONField(key: "patches", value: .string(patches))]))
            .replacing("xNull", with: .null).replacing("xArray", with: .array([.bool(true), .object([JSONField(key: "future", value: .string("FAKE"))])])).replacing("nodeOrder", with: .string("FAKE app attribute"))
        let restored = try SyncRecords.fromRecords(SyncRecords.toRecords(source.replacing("state", with: state.replacing("contentStore", with: store.replacing("delta", with: entry))))).required("state")
        let node = try restored.required("chats").array("chats")[0].required("branchTree").required("nodes").required("delta")
        let result = try restored.required("contentStore").required(node.required("contentHash").string("contentHash"))
        let expectedBody = OrderedJSON.array([.object([JSONField(key: "type", value: .string("text")), JSONField(key: "text", value: .string("FAKE TEST edited delta"))])])
        XCTAssertEqual(try SyncRecords.canonical(result.required("content")), try SyncRecords.canonical(expectedBody))
        XCTAssertEqual(result["xNull"], .null)
        XCTAssertEqual(result["xArray"], entry["xArray"])
        XCTAssertEqual(result["nodeOrder"], entry["nodeOrder"])
        XCTAssertEqual(result["xFuture"], entry["xFuture"])
        XCTAssertNil(result["delta"])
    }

    func testContentEntryLegacyReadAndGarbageCollectedImmutableEntries() throws {
        let records = try entryRecords()
        let legacy = try removingRecords(records) { extensionNames.contains($0[0]) }
        let legacyStore = try SyncRecords.fromRecords(legacy).required("state").required("contentStore").object("store")
        XCTAssertEqual(legacyStore.count, 1)
        XCTAssertTrue(legacyStore.allSatisfy { $0.value["xFuture"] == nil })
        let unused = try entryFixture().required("expected").required("entryIds").required("unused").string("entryId")
        let collected = try removingRecords(records) { $0 == ["retainedContentEntries", unused] }
        let restored = try SyncRecords.fromRecords(collected).required("state").required("contentStore").object("store")
        XCTAssertEqual(restored.count, 3)
        XCTAssertFalse(restored.contains { $0.value["xFuture"]?["origin"] == .string("unused") })
    }

    func testContentEntryUnsafeNestedMetadataIsRejectedAndUnicodeIsExact() throws {
        let source = try entryFixture().required("snapshot")
        let state = try source.required("state")
        let store = try state.required("contentStore")
        for key in ["constructor", "__proto__", "prototype"] {
            let entry = try store.required("left").replacing("xUnsafe", with: .array([.object([JSONField(key: key, value: .string("FAKE"))])]))
            XCTAssertThrowsError(try SyncRecords.toRecords(source.replacing("state", with: state.replacing("contentStore", with: store.replacing("left", with: entry)))))
        }
        var unicodeStore = store
        for (key, value) in [("left", "é"), ("right", "e\u{0301}")] {
            unicodeStore = try unicodeStore.replacing(key, with: store.required(key).replacing("xUnicode", with: .string(value)))
        }
        let records = try SyncRecords.toRecords(source.replacing("state", with: state.replacing("contentStore", with: unicodeStore)))
        let restored = try SyncRecords.fromRecords(records)
        try compareRecords(SyncRecords.toRecords(restored), records, name: "exact Unicode metadata")
        let entries = try restored.required("state").required("contentStore").object("store")
        let unicode = try entries.compactMap { entry -> Data? in
            guard let value = entry.value["xUnicode"] else { return nil }
            return Data(try value.string("xUnicode").utf8)
        }
        XCTAssertTrue(unicode.contains(Data("é".utf8)))
        XCTAssertTrue(unicode.contains(Data("e\u{0301}".utf8)))
    }
}
