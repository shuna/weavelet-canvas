import XCTest
@testable import WeaveletPilot

@MainActor final class FolderSyncTests: XCTestCase {
    private let password = "FAKE TEST ONLY folder passphrase"
    private var root: URL { URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func directory() throws -> URL {
        let value = FileManager.default.temporaryDirectory.appendingPathComponent("native-folder-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:value,withIntermediateDirectories:true)
        return value
    }
    private func state(_ store: LocalStateStore) throws -> ChatState {
        let fixture = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json")))
        let state = ChatState(store:store)
        try state.importWebData(fixture.required("exportV3").encoded())
        try state.applySnapshot(fixture.required("syncSnapshot"))
        return state
    }
    func testFolderFilesCrossEncryptedSyncRestartAndRetainFullCorpus() async throws {
        let dir = try directory(), folder = dir.appendingPathComponent("sync")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let keys = TestSyncKeys(), senderStore = LocalStateStore(fileURL:dir.appendingPathComponent("sender.json"))
        let sender = try state(senderStore), syncStore = SyncStateStore(fileURL:dir.appendingPathComponent("sender-sync.json"))
        let files = try FolderSyncFiles(testingDirectoryURL:folder)
        let transport = FolderSyncTransport(files:files,store:syncStore)
        let publisher = GoogleSyncController(chatState:sender,drive:transport,store:syncStore,keyStore:keys,transportMode:.filesystem)
        let original = try sender.exportWebData()
        try await publisher.create(password:password)
        XCTAssertEqual(sender.diagnostics.entries["sync-folder"]?.status,"done")
        let dataset = try XCTUnwrap(publisher.dataset)
        XCTAssertEqual(try ChatState(store:senderStore).exportWebData(),try sender.exportWebData())
        XCTAssertEqual(try OrderedJSON.decode(original)["xFixtureExport"],try OrderedJSON.decode(sender.exportWebData())["xFixtureExport"])
        let receiverStore = LocalStateStore(fileURL:dir.appendingPathComponent("receiver.json")), receiver = ChatState(store:receiverStore)
        let receiverSync = SyncStateStore(fileURL:dir.appendingPathComponent("receiver-sync.json"))
        let readerFiles = try FolderSyncFiles(testingDirectoryURL:folder)
        let reader = GoogleSyncController(chatState:receiver,drive:FolderSyncTransport(files:readerFiles,store:receiverSync),store:receiverSync,keyStore:keys,transportMode:.filesystem)
        try await reader.open(dataset:dataset)
        let restored = try await reader.restoreKey(); XCTAssertTrue(restored)
        try await reader.download()
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(receiver.publicationSnapshot())),try SyncRecords.canonical(SyncRecords.toRecords(sender.publicationSnapshot())))
        XCTAssertEqual(try ChatState(store:receiverStore).exportWebData(),try receiver.exportWebData())
        var defaults = try receiver.defaultChatConfigDraft()
        defaults.defaultSettings?.systemMessage = "FAKE receiver changed defaults"
        try receiver.saveDefaultChatConfig(defaults)
        try await reader.synchronize()
        let restarted = GoogleSyncController(chatState:sender,drive:FolderSyncTransport(files:files,store:SyncStateStore(fileURL:syncStore.fileURL)),store:SyncStateStore(fileURL:syncStore.fileURL),keyStore:keys,transportMode:.filesystem)
        let unlocked = try await restarted.restoreKey(); XCTAssertTrue(unlocked)
        try await restarted.synchronize()
        XCTAssertEqual(try sender.publicationSnapshot().required("state")["defaultSystemMessage"],.string("FAKE receiver changed defaults"))
        // The actual Web caller will open these exact native ciphertext files in the interoperability check.
        let artifact = OrderedJSON.object([.init(key:"folder",value:.string(folder.path)),.init(key:"dataset",value:.string(dataset)),
            .init(key:"password",value:.string(password)),.init(key:"snapshot",value:try sender.publicationSnapshot()),
            .init(key:"syncStore",value:.string(syncStore.fileURL.path)),.init(key:"localStore",value:.string(senderStore.fileURL.path))])
        try artifact.encoded().write(to:URL(fileURLWithPath:"/private/tmp/weavelet-native-folder-sync-interop.json"),options:.atomic)
    }
    func testActualWebWrittenCiphertextIsAcceptedByNativeFolderSession() async throws {
        let wire = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/filesystem-native-web-wire.json")))
        let dir = try directory(); defer { try? FileManager.default.removeItem(at:dir) }
        let folder = dir.appendingPathComponent("sync"); try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        for file in try wire.required("files").array("files") {
            let name = try file.required("name").string("name")
            let bytes = try XCTUnwrap(Data(base64Encoded:file.required("base64").string("ciphertext")))
            try bytes.write(to:folder.appendingPathComponent(name),options:.atomic)
        }
        let store = SyncStateStore(fileURL:dir.appendingPathComponent("sync-state.json")), files = try FolderSyncFiles(testingDirectoryURL:folder)
        let session = try SyncSession(drive:FolderSyncTransport(files:files,store:store),store:store,keyStore:TestSyncKeys(),transportMode:.filesystem)
        try await session.open(dataset:wire.required("dataset").string("dataset"))
        try await session.unlock(password:wire.required("password").string("password"))
        let received = try await session.receiveAndSave()
        XCTAssertEqual(received["state"]?["defaultSystemMessage"],.string("FAKE actual Web folder update"))
        XCTAssertEqual(try SyncRecords.canonical(SyncRecords.toRecords(received)),try SyncRecords.canonical(wire.required("expectedRecords")))
    }
    func testMissingHistoryKeepsPublicationAndLocalState() async throws {
        let dir = try directory(); defer { try? FileManager.default.removeItem(at:dir) }
        let folder = dir.appendingPathComponent("sync"); try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let store = SyncStateStore(fileURL:dir.appendingPathComponent("sync-state.json")), files = try FolderSyncFiles(testingDirectoryURL:folder)
        let state = try state(LocalStateStore(fileURL:dir.appendingPathComponent("state.json"))), keys = TestSyncKeys()
        let transport = FolderSyncTransport(files:files,store:store)
        let controller = GoogleSyncController(chatState:state,drive:transport,store:store,keyStore:keys,transportMode:.filesystem)
        try await controller.create(password:password)
        let dataset = try XCTUnwrap(controller.dataset), before = try state.publicationSnapshot().encoded()
        let names = try await files.list()
        let commit = try XCTUnwrap(names.first { $0.name.hasSuffix(".commit.bin") })
        let bytes = try await files.read(name:commit.name)
        try FileManager.default.removeItem(at:folder.appendingPathComponent(commit.name))
        do { try await controller.synchronize(); XCTFail("missing immutable history accepted") } catch {}
        XCTAssertEqual(try state.publicationSnapshot().encoded(),before)
        XCTAssertNotNil(try store.publication(dataset:dataset))
        try bytes.write(to:folder.appendingPathComponent(commit.name),options:.atomic)
        try await controller.recover()
        XCTAssertNil(try store.publication(dataset:dataset))
        XCTAssertEqual(try state.publicationSnapshot().encoded(),before)
    }
    func testInitializationDoesNotReplaceHistoryArrivingBeforeFirstUpload() async throws {
        let dir = try directory(); defer { try? FileManager.default.removeItem(at:dir) }
        let folder = dir.appendingPathComponent("sync"); try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let files = try FolderSyncFiles(testingDirectoryURL:folder), keys = TestSyncKeys()
        let aStore = SyncStateStore(fileURL:dir.appendingPathComponent("a-sync.json")), transport = FolderSyncTransport(files:files,store:aStore)
        let session = try SyncSession(drive:transport,store:aStore,keyStore:keys,transportMode:.filesystem)
        let created = try await session.create(password:password), dataset = try created.required("id").string("id")
        let a = try state(LocalStateStore(fileURL:dir.appendingPathComponent("a.json")))
        let bStore = SyncStateStore(fileURL:dir.appendingPathComponent("b-sync.json"))
        let b = try SyncSession(drive:FolderSyncTransport(files:files,store:bStore),store:bStore,keyStore:keys,transportMode:.filesystem)
        try await b.open(dataset:dataset); try await b.unlock(password:password)
        var other = try a.publicationSnapshot()
        other = try other.replacing("state",with:other.required("state").replacing("defaultSystemMessage",with:.string("FAKE earlier remote upload")))
        _ = try await b.synchronizeForPublication(other,initializeIfEmpty:true)
        do { _ = try await session.synchronizeForPublication(a.publicationSnapshot(),initializeIfEmpty:true); XCTFail("existing history overwritten during initialization") } catch {}
        let remaining = try await b.pull()
        XCTAssertEqual(remaining["state"]?["defaultSystemMessage"],.string("FAKE earlier remote upload"))
    }
}
