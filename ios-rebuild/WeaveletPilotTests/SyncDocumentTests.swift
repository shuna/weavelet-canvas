import XCTest
@testable import WeaveletPilot

final class SyncDocumentTests: XCTestCase {
    private let now: Double = 1700000000123
    private func fixture(_ name: String, _ key: String) throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/\(name).json"))).required(key)
    }
    func testFullSnapshotUnknownValuesSidecarAndNullProjection() throws {
        let snapshot = try fixture("io-corpus", "syncSnapshot")
        let state = try snapshot.required("state").replacing("xHuge", with: .number("9007199254740993"))
        let raw = snapshot.replacing("state", with: state)
        let sidecar = OrderedJSON.object([.init(key: "theme", value: .string("V3-only")), .init(key: "xHuge", value: .number("1.234567890123456789"))])
        let document = try SyncDocument(snapshot: raw, v3Sidecar: sidecar)
        let projected = try document.uiProjection()
        let unchanged = try document.applyingV3Edits(projected, comparedTo: projected, now: now)
        XCTAssertEqual(try unchanged.snapshot.encoded(), try raw.encoded())
        XCTAssertEqual(try unchanged.v3Sidecar.encoded(), try sidecar.encoded())
        XCTAssertEqual(projected["theme"], .string("V3-only"))
        let nulls = try OrderedJSON.decode(Data("{\"version\":18,\"state\":{\"chats\":null,\"contentStore\":null,\"folders\":null}}".utf8))
        let nullDocument = try SyncDocument(snapshot: nulls)
        let ui = try nullDocument.uiProjection()
        XCTAssertEqual(ui["folders"], .object([]))
        XCTAssertEqual(try nullDocument.applyingV3Edits(ui, comparedTo: ui, now: now).snapshot, nulls)
    }
    func testRawIncomingReplacementAndV3NamespaceNeverUseParsedNumbers() throws {
        let initial = try SyncDocument(v3: fixture("io-corpus", "exportV3"))
        let incoming = try OrderedJSON.decode(Data("{\"version\":27,\"state\":{\"xHuge\":9007199254740993,\"theme\":null,\"xOrder\":{\"z\":1,\"a\":2}}}".utf8))
        let merged = try initial.mergingSnapshot(incoming)
        XCTAssertEqual(merged.snapshot["state"]?["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(merged.snapshot["state"]?["theme"], .null)
        XCTAssertEqual(merged.snapshot["state"]?["chats"], initial.snapshot["state"]?["chats"])
        let v3 = try OrderedJSON.decode(Data("{\"version\":3,\"theme\":9007199254740995}".utf8))
        let imported = try merged.importingV3(v3)
        XCTAssertEqual(imported.snapshot["version"], .number("27"))
        XCTAssertEqual(imported.snapshot["state"]?["theme"], .null)
        XCTAssertEqual(imported.v3Sidecar["theme"], .number("9007199254740995"))
        XCTAssertEqual(try OrderedJSON.decode(imported.exportData())["theme"], .number("9007199254740995"))
    }
    func testDeltaAndUnknownMetadataSurviveTitleEditAndChatReorderCloneDelete() throws {
        let raw = try fixture("content-entry-wire", "snapshot")
        var chats = try raw.required("state").required("chats").array("chats")
        chats[0] = chats[0].replacing("xHuge", with: .number("9007199254740993"))
        let document = try SyncDocument(snapshot: raw.replacing("state", with: raw.required("state").replacing("chats", with: .array(chats))))
        let before = try document.uiProjection()
        var editedChats = try before.required("chats").array("chats")
        editedChats[0] = editedChats[0].replacing("title", with: .string("編集"))
        let clone = editedChats[0].replacing("id", with: .string("clone"))
        editedChats.insert(clone, at: 0)
        let changed = try document.applyingV3Edits(before.replacing("chats", with: .array(editedChats)), comparedTo: before, now: now)
        XCTAssertEqual(changed.snapshot["state"]?["contentStore"], document.snapshot["state"]?["contentStore"])
        let savedChats = try changed.snapshot.required("state").required("chats").array("chats")
        XCTAssertEqual(savedChats[0]["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(savedChats[1]["xHuge"], .number("9007199254740993"))
        XCTAssertEqual(try savedChats[1].required("updatedAt").number("stamp"), now)
        XCTAssertEqual(try changed.snapshot.required("state").required("lastContentEditedAt").number("stamp"), now)
        let ui = try changed.uiProjection(), remaining = try ui.required("chats").array("chats").dropFirst()
        let deleted = try changed.applyingV3Edits(ui.replacing("chats", with: .array(Array(remaining))), comparedTo: ui, now: now)
        XCTAssertEqual(deleted.snapshot["state"]?["contentStore"], document.snapshot["state"]?["contentStore"])
    }
    func testRawDeltaAttributesResolveBeforeOpaqueProjectionAndEditedBodyBecomesFull() throws {
        let base = try fixture("raw-delta-attributes", "base")
        let patches = try fixture("raw-delta-attributes", "patches")
        let expected = try fixture("raw-delta-attributes", "expected")
        let store = OrderedJSON.object([
            .init(key: "base", value: .object([.init(key: "content", value: base), .init(key: "refCount", value: .number("1"))])),
            .init(key: "delta", value: .object([.init(key: "content", value: .array([])), .init(key: "refCount", value: .number("1")), .init(key: "delta", value: .object([.init(key: "baseHash", value: .string("base")), .init(key: "patches", value: patches)]))]))
        ])
        XCTAssertEqual(try SyncRecords.resolveContent(store, hash: "delta"), expected)
        XCTAssertEqual(try SyncRecords.resolveProjectedContent(store, hash: "delta"), expected)
        let snapshot = OrderedJSON.object([.init(key: "version", value: .number("18")), .init(key: "state", value: .object([.init(key: "chats", value: .array([])), .init(key: "contentStore", value: store), .init(key: "folders", value: .object([]))]))])
        let document = try SyncDocument(snapshot: snapshot), before = try document.uiProjection()
        XCTAssertEqual(try document.applyingV3Edits(before, comparedTo: before, now: now).snapshot, snapshot)
        var content = try expected.array("content")
        content[0] = content[0].replacing("text", with: .string("edited"))
        let projectedStore = try before.required("contentStore")
        let editedStore = try projectedStore.replacing("delta", with: projectedStore.required("delta").replacing("content", with: .array(content)))
        let edited = try document.applyingV3Edits(before.replacing("contentStore", with: editedStore), comparedTo: before, now: now)
        XCTAssertNil(edited.snapshot["state"]?["contentStore"]?["delta"]?["delta"])
        XCTAssertEqual(edited.snapshot["state"]?["contentStore"]?["base"], store["base"])
        let restarted = try SyncDocument(snapshot: edited.snapshot)
        XCTAssertEqual(try restarted.uiProjection()["contentStore"]?["delta"]?["content"], .array(content))
    }
    func testSyncChatInsertionAndReorderingRestoreRawUnknownValuesByIDAndAdoptRemoteChanges() throws {
        let original = try OrderedJSON.decode(Data(#"{"version":18,"state":{"chats":[{"id":"A","title":"old","messages":[],"xHuge":9007199254740993,"xAttrs":{"keep":1.234567890123456789,"change":"old"}}],"contentStore":{},"folders":{}}}"#.utf8))
        let document = try SyncDocument(snapshot:original)
        let received = try OrderedJSON.decode(Data(#"{"version":18,"state":{"chats":[{"id":"B","title":"new","messages":[]},{"id":"A","title":"old","messages":[],"xHuge":9007199254740992,"xAttrs":{"keep":1.2345678901234567,"change":"remote"}}],"contentStore":{},"folders":{}}}"#.utf8))
        let changed = try document.synchronizingSnapshot(received)
        let chats = try changed.snapshot.required("state").required("chats").array("chats")
        XCTAssertEqual(chats.map { $0["id"] },[.string("B"),.string("A")])
        XCTAssertEqual(chats[1]["xHuge"],.number("9007199254740993"))
        XCTAssertEqual(chats[1]["xAttrs"]?["keep"],.number("1.234567890123456789"))
        XCTAssertEqual(chats[1]["xAttrs"]?["change"],.string("remote"))
        let altered = received.replacing("state",with:try received.required("state").replacing("chats",with:.array([chats[0],chats[1].replacing("xHuge",with:.number("9007199254740996"))])))
        XCTAssertEqual(try document.synchronizingSnapshot(altered).snapshot.required("state").required("chats").array("chats")[1]["xHuge"],.number("9007199254740996"))
        let removed = received.replacing("state",with:try received.required("state").replacing("chats",with:.array([chats[0]])))
        XCTAssertEqual(try document.synchronizingSnapshot(removed).snapshot.required("state").required("chats").array("chats").map { $0["id"] },[.string("B")])
    }
    func testSyncExistingChatSwapKeepsDifferentRawNumbersThatAreEqualInJS() throws {
        let original = try OrderedJSON.decode(Data(#"{"version":18,"state":{"chats":[{"id":"A","title":"same","messages":[],"xHuge":9007199254740993},{"id":"B","title":"same","messages":[],"xHuge":9007199254740992}],"folders":{},"contentStore":{}}}"#.utf8))
        let received = try OrderedJSON.decode(Data(#"{"version":18,"state":{"chats":[{"id":"B","title":"same","messages":[],"xHuge":9007199254740992},{"id":"A","title":"same","messages":[],"xHuge":9007199254740992}],"folders":{},"contentStore":{}}}"#.utf8))
        let changed = try SyncDocument(snapshot:original).synchronizingSnapshot(received)
        let chats = try changed.snapshot.required("state").required("chats").array("chats")
        XCTAssertEqual(chats[0]["id"],.string("B")); XCTAssertEqual(chats[0]["xHuge"],.number("9007199254740992"))
        XCTAssertEqual(chats[1]["id"],.string("A")); XCTAssertEqual(chats[1]["xHuge"],.number("9007199254740993"))
    }
    @MainActor func testDepth256SharedRootPersistsRestartsAndExportsExactRawValue() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fullstate-depth-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStateStore(fileURL: directory.appendingPathComponent("state.json"))
        // Root -> folders -> folder -> 253 arrays -> scalar reaches depth 256.
        let v3 = try fixture("io-corpus", "exportV3").replacing("evaluationResults", with: .object([]))
        // evaluationResults accepts object values only; use the shared folders root,
        // whose unknown field is mechanically retained by the existing UI boundary.
        let folder = try v3.required("folders").object("folders").first
        var shallow = v3
        if let folder {
            var value = OrderedJSON.number("9007199254740993")
            for _ in 0..<253 { value = .array([value]) }
            shallow = try v3.replacing("folders", with: v3.required("folders").replacing(folder.key, with: folder.value.replacing("xDepth", with: value)))
        } else {
            XCTFail("fixture requires a folder"); return
        }
        let source = try OrderedJSON.decode(shallow.encoded())
        let wrapped = OrderedJSON.object([.init(key: "version", value: .number("18")), .init(key: "state", value: .object(try source.object("source").filter { $0.key != "version" }))])
        XCTAssertThrowsError(try OrderedJSON.decode(wrapped.encoded()))
        let state = ChatState(store: store)
        try state.importWebData(source.encoded())
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(try restored.exportWebData(), try state.exportWebData())
        XCTAssertEqual(try OrderedJSON.decode(restored.exportWebData()).required("folders").encoded(), try source.required("folders").encoded())
    }
    @MainActor func testV1ReadV2AtomicSaveRestartAndSnapshotFailureKeepsPublishedDocument() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fullstate-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path); try? FileManager.default.removeItem(at: directory) }
        let store = LocalStateStore(fileURL: directory.appendingPathComponent("state.json"))
        let state = ChatState(store: store)
        try state.importWebData(fixture("io-corpus", "exportV3").encoded())
        let v2 = try OrderedJSON.decode(Data(contentsOf: store.fileURL))
        let legacy = OrderedJSON.object(try v2.object("save").filter { !["snapshot", "v3Sidecar", "v3RootOrder"].contains($0.key) }).replacing("version", with: .number("1")).replacing("source", with: .string(String(decoding: try state.exportWebData(), as: UTF8.self)))
        try legacy.encoded().write(to: store.fileURL, options: .atomic)
        XCTAssertNil(ChatState(store: store).persistenceError)
        let full = try fixture("io-corpus", "syncSnapshot")
        try state.applySnapshot(full)
        let saved = try Data(contentsOf: store.fileURL), restored = ChatState(store: store)
        let published = try state.publicationSnapshot()
        for field in try full.required("state").object("state") {
            XCTAssertEqual(try restored.publicationSnapshot().required("state").required(field.key).encoded(), try field.value.encoded())
        }
        XCTAssertEqual(try restored.publicationSnapshot().encoded(), try published.encoded())
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        XCTAssertThrowsError(try state.applySnapshot(full.replacing("version", with: .number("99"))))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try published.encoded())
        XCTAssertEqual(try Data(contentsOf: store.fileURL), saved)
    }
}
