import XCTest
@testable import WeaveletPilot

final class LocalStateStoreTests: XCTestCase {
    private func store() throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-local-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            try? FileManager.default.removeItem(at: directory)
        }
        return LocalStateStore(fileURL: directory.appendingPathComponent("local-state.json"))
    }
    private func source() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }

    func testFreshInstanceRestoresAllSourceAndViewingState() throws {
        let store = try store()
        let source = try source()
        let state = ChatState(store: store)
        XCTAssertNil(state.persistenceError)
        try state.importWebData(source.encoded())
        state.style = .bubbles
        state.selectSibling("n-inactive", of: "n-assistant")
        state.selectedConversationID = "chat-b"
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(restored.exchange?.source, try corpusSelectingInactive(source))
        XCTAssertEqual(restored.style, .bubbles)
        XCTAssertEqual(restored.selectedConversationID, "chat-b")
        XCTAssertEqual(restored.conversations[0].visibleMessages.map(\.id), ["n-system", "n-user", "n-inactive"])
        XCTAssertEqual(restored.conversations[0].visibleMessages.last?.parts, [.text("別分岐の本文")])
        XCTAssertEqual(restored.conversations[1].visibleMessages, state.conversations[1].visibleMessages)
        XCTAssertEqual(try XCTUnwrap(restored.exchange).encoded(), try corpusSelectingInactive(source).encoded())
    }

    func testExplicitPathAndEmptyExportRestore() throws {
        let store = try store()
        let state = ChatState(store: store)
        let source = try source()
        try state.importWebData(source.encoded())
        XCTAssertEqual(ChatState(store: store).conversations[0].displayedPathIDs, ["n-system", "n-user", "n-assistant"])
        let empty = source.replacing("chats", with: .array([]))
        try state.importWebData(empty.encoded())
        let restored = ChatState(store: store)
        XCTAssertNil(restored.conversation)
        XCTAssertEqual(restored.exchange?.source, empty)
        XCTAssertNil(restored.persistenceError)
    }


    func testBoundaryDepthSourceSurvivesLocalEnvelopeAndFreshInstance() throws {
        let store = try store()
        var nested = OrderedJSON.string("depth boundary preserved")
        for _ in 0..<255 { nested = .array([nested]) }
        let deep = try source().replacing("xBoundaryDepth", with: nested)
        let state = ChatState(store: store)
        try state.importWebData(deep.encoded())
        let before = try Data(contentsOf: store.fileURL)
        let restored = ChatState(store: store)
        XCTAssertNil(restored.persistenceError)
        XCTAssertEqual(restored.exchange?.source, deep)
        let tooDeep = deep.replacing("xBoundaryDepth", with: .array([nested]))
        XCTAssertThrowsError(try state.importWebData(tooDeep.encoded()))
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }

    func testSampleActionsDoNotCreateStorage() throws {
        let store = try store()
        let state = ChatState(store: store)
        state.style = .bubbles
        state.selectedConversationID = "sample-2"
        state.selectedConversationID = "sample-1"
        state.selectSibling("10", of: "2")
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
        XCTAssertNil(state.exchange)
        XCTAssertNil(state.persistenceError)
    }

    func testSaveFailurePreservesDiskAndEveryMemorySelection() throws {
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(source().encoded())
        let before = try Data(contentsOf: store.fileURL)
        let directory = store.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        state.style = .bubbles
        state.selectedConversationID = "chat-b"
        state.selectSibling("n-inactive", of: "n-assistant")
        let replacement = try source().replacing("chats", with: .array([]))
        XCTAssertThrowsError(try state.importWebData(replacement.encoded()))
        XCTAssertEqual(state.style, .stream)
        XCTAssertEqual(state.selectedConversationID, "chat-a")
        XCTAssertEqual(state.conversation?.selectedLeafID, "n-assistant")
        XCTAssertEqual(state.exchange?.source, try source())
        XCTAssertNotNil(state.persistenceError)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), before)
    }

    func testMalformedSaveIsReportedAndNeverAutomaticallyOverwritten() throws {
        let store = try store()
        for malformed in [Data("not JSON".utf8), try OrderedJSON.object([JSONField(key: "version", value: .number("999"))]).encoded()] {
            try malformed.write(to: store.fileURL, options: .atomic)
            let state = ChatState(store: store)
            XCTAssertNotNil(state.persistenceError)
            XCTAssertNil(state.exchange)
            state.persistenceError = nil
            state.style = .bubbles
            state.selectSibling("10", of: "2")
            XCTAssertThrowsError(try state.importWebData(Data("invalid import".utf8)))
            XCTAssertThrowsError(try state.createChat(defaults:.webInitial()))
            XCTAssertThrowsError(try state.applyFolder(.create(id:"must-not-replace-unread-file")))
            let snapshot = try SyncDocument(v3:source()).snapshot
            XCTAssertThrowsError(try state.applySnapshot(snapshot))
            XCTAssertEqual(try Data(contentsOf: store.fileURL), malformed)
            XCTAssertNil(state.exchange)
            try state.importWebData(source().encoded())
            try state.createChat(defaults:.webInitial(),id:"after-explicit-replacement")
            XCTAssertEqual(ChatState(store:store).selectedConversationID,"after-explicit-replacement")
        }
    }

    func testInvalidSavedViewIsNotSilentlyRepairedOrWritten() throws {
        let store = try store()
        let state = ChatState(store: store)
        try state.importWebData(source().encoded())
        let saved = try OrderedJSON.decode(Data(contentsOf: store.fileURL)).replacing("selectedChatID", with: .string("absent-chat"))
        let malformed = try saved.encoded()
        try malformed.write(to: store.fileURL, options: .atomic)
        let restored = ChatState(store: store)
        XCTAssertNil(restored.exchange)
        XCTAssertNotNil(restored.persistenceError)
        restored.selectedConversationID = "sample-2"
        XCTAssertEqual(try Data(contentsOf: store.fileURL), malformed)
    }

    func testRecoveryExportKeepsLiveRawStateAndLocalFileBytesWithoutWriting() throws {
        let store = try store()
        let bytes = Data(#"{"version":2,"opaque":9007199254740993}"#.utf8)
        try bytes.write(to: store.fileURL, options: .atomic)
        let live = try OrderedJSON.decode(Data(#"{"state":{"opaque":1.2300,"lone":"\ud800","ordered":{"z":2,"a":1}}}"#.utf8))
        let journal = NativeProxyRecoveryStore(libraryURL:store.fileURL)
        let journalBytes = Data([0xff,0x7b,0x00])
        try journalBytes.write(to:journal.fileURL,options:.atomic)
        XCTAssertThrowsError(try journal.upsert(.object([.init(key:"requestId",value:.string("new"))])))
        let exported = try NativeRecoveryExport.make(liveSnapshot: live, fileURL: store.fileURL, exportedAt: "2026-10-17T00:00:00Z")
        let payload = try OrderedJSON.decode(exported)
        XCTAssertEqual(payload["version"], .number("1"))
        XCTAssertEqual(payload["exportedAt"], .string("2026-10-17T00:00:00Z"))
        let sources = try payload.required("sources")
        XCTAssertEqual(try sources.required("liveStore").required("available"), .bool(true))
        for key in ["zustandPersist", "legacyLocalStorageChats", "indexedDb"] {
            XCTAssertEqual(try sources.required(key), .object([.init(key: "available", value: .bool(false))]))
        }
        XCTAssertEqual(try sources.required("liveStore").required("data").encoded(), try live.required("state").encoded())
        let local = try sources.required("nativeLocalState")
        XCTAssertEqual(try local.required("available"), .bool(true))
        XCTAssertEqual(try local.required("data").required("filename"), .string(store.fileURL.lastPathComponent))
        XCTAssertEqual(try local.required("data").required("encoding"), .string("base64"))
        XCTAssertEqual(Data(base64Encoded: try local.required("data").required("bytes").string("bytes")), bytes)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), bytes)
        let recovery = try sources.required("nativeStreamRecovery")
        XCTAssertEqual(Data(base64Encoded:try recovery.required("data").required("bytes").string("bytes")),journalBytes)
        XCTAssertEqual(try Data(contentsOf:journal.fileURL),journalBytes)
    }

    func testRecoveryExportReadsMalformedNonUTF8SaveWithoutNormalLoadOrWriting() async throws {
        let store = try store()
        let malformed = Data([0xff, 0x00, 0xfe, 0x7b, 0x7d])
        try malformed.write(to: store.fileURL, options: .atomic)
        XCTAssertThrowsError(try store.load())
        let state = ChatState(store: store)
        XCTAssertNotNil(state.persistenceError)
        XCTAssertThrowsError(try state.createChat(defaults: .webInitial()))
        let payload = try OrderedJSON.decode(await state.recoveryExport(exportedAt: Date(timeIntervalSince1970: 0)))
        let sources = try payload.required("sources")
        XCTAssertEqual(try sources.required("liveStore").required("available"), .bool(false))
        let local = try sources.required("nativeLocalState")
        XCTAssertEqual(try local.required("available"), .bool(true))
        XCTAssertEqual(Data(base64Encoded: try local.required("data").required("bytes").string("bytes")), malformed)
        XCTAssertEqual(try Data(contentsOf: store.fileURL), malformed)

        let missing = try OrderedJSON.decode(NativeRecoveryExport.make(liveSnapshot: nil,
            fileURL: store.fileURL.deletingLastPathComponent().appendingPathComponent("not-created"), exportedAt: "now"))
        XCTAssertEqual(try missing.required("sources").required("nativeLocalState").required("available"), .bool(false))
        let unreadable = try OrderedJSON.decode(NativeRecoveryExport.make(liveSnapshot: nil,
            fileURL: store.fileURL.deletingLastPathComponent(), exportedAt: "now"))
        let failed = try unreadable.required("sources").required("nativeLocalState")
        XCTAssertEqual(try failed.required("available"), .bool(true))
        XCTAssertFalse(try failed.required("error").string("read error").isEmpty)
    }
}
