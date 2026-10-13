import CloudKit
import XCTest
@testable import WeaveletPilot

@MainActor final class CloudKitSyncTests: XCTestCase {
    private var root: URL { URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func corpus() throws -> OrderedJSON { try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))) }
    private func directory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cloudkit-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true); return dir
    }
    private func state(_ store: LocalStateStore) throws -> ChatState {
        let value = try corpus(), state = ChatState(store:store)
        try state.importWebData(value.required("exportV3").encoded()); try state.applySnapshot(value.required("syncSnapshot"))
        return state
    }
    private func remote(_ snapshot: OrderedJSON, time: Int64 = 100) throws -> CloudKitSnapshotRecord {
        let names = try CloudKitSnapshots.operation("constants")
        let record = CKRecord(recordType:try names.required("recordType").string("type"),recordID:.init(recordName:try names.required("recordName").string("name")))
        record["payload"] = try SyncCompression.compressCloudKit(String(decoding:snapshot.encoded(),as:UTF8.self)) as NSData
        record["snapshotVersion"] = NSNumber(value:18); record["updatedAt"] = NSNumber(value:time)
        record["deviceId"] = "FAKE test device" as NSString; record["unrelated"] = "retain" as NSString
        return try CloudKitSnapshotRecord(record)
    }
    func testDownloadFullWebSnapshotPreservesRawRootsAndRestart() async throws {
        let dir = try directory(), store = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), local = try state(store)
        var snapshot = try corpus().required("syncSnapshot")
        var currentRoots = try snapshot.required("state")
        for field in try corpus().required("currentPersistenceRoots").object("current roots") {
            currentRoots = currentRoots.replacing(field.key,with:field.value)
        }
        snapshot = snapshot.replacing("state",with:currentRoots)
        snapshot = try snapshot.replacing("state",with:snapshot.required("state").replacing("xLargeNumber",with:.number("9007199254740993")).replacing("theme",with:.string("FAKE cloud theme")))
        snapshot = snapshot.replacing("xWrapper",with:.number("9007199254740993"))
        let fake = FakeCloudKit(snapshot:try remote(snapshot)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE")
        let previousRoots = try local.publicationSnapshot().required("state").object("state").map(\.key)
        try await connection.connect(); try await connection.download()
        let received = try local.publicationSnapshot().required("state"), incoming = try snapshot.required("state")
        // Web mergeSyncDocumentSnapshot overlays roots: existing root positions stay, new roots append.
        let incomingKeys = try incoming.object("state").map(\.key)
        XCTAssertEqual(try received.object("state").map(\.key),previousRoots + incomingKeys.filter { !previousRoots.contains($0) })
        XCTAssertEqual(Set(try received.object("state").map { Data($0.key.text.utf8) }),Set(try incoming.object("state").map { Data($0.key.text.utf8) }))
        for field in try incoming.object("state") { XCTAssertEqual(received[field.key],field.value,field.key.text) }
        XCTAssertEqual(try local.publicationSnapshot()["xWrapper"],snapshot["xWrapper"])
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try local.publicationSnapshot())
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload),snapshot)
    }
    func testLoneUTF16KeysAndValuesSurviveCloudKitDecodeMergeAndRestart() async throws {
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at:dir) }
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), local = try state(store)
        let raw = try OrderedJSON.decode(Data(#"{"\ud800":"\udc00","\udc00":"\ud800","�":"replacement","number":9007199254740993}"#.utf8))
        let key = JSONString(utf16:[0x78,0xdc00])
        let before = try local.publicationSnapshot()
        let incoming = try before.replacing("state",with:before.required("state").replacing(key,with:raw)).replacing(key,with:raw)
        let fake = FakeCloudKit(snapshot:try remote(incoming))
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE")
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload),incoming)
        try await connection.download()
        XCTAssertEqual(try local.publicationSnapshot()["state"]?[key],raw)
        XCTAssertEqual(try local.publicationSnapshot()[key],raw)
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try local.publicationSnapshot())
    }

    func testUploadUsesCapturedConflictRecordAndTimestampOnce() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let server = try remote(local.publicationSnapshot(),time:50), fake = FakeCloudKit(snapshot:server)
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE",clock:{100})
        try await connection.upload()
        XCTAssertEqual(fake.attempts.count,2); XCTAssertNil(fake.attempts[0].expected)
        XCTAssertTrue(fake.attempts[1].expected?.record === server.record)
        XCTAssertEqual(fake.attempts.map(\.time),[100,100])
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload),try local.publicationSnapshot())
        XCTAssertEqual(fake.snapshot?.record["unrelated"] as? String,"retain")
    }
    func testServerWinsAppliesFullSnapshotWithoutRetryUpload() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let incoming = try local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE server wins")))
        let fake = FakeCloudKit(snapshot:try remote(incoming,time:200)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE",clock:{100})
        try await connection.upload()
        XCTAssertEqual(try local.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE server wins"))
        XCTAssertEqual(fake.attempts.count,1)
    }
    func testServerWinsCannotOverwriteLocalChangeDuringRead() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let fake = FakeCloudKit(snapshot:try remote(local.publicationSnapshot(),time:200))
        fake.onRead = { try local.applySnapshot(local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE in-flight edit")))) }
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE",clock:{100})
        do { try await connection.upload(); XCTFail("stale receive accepted") } catch {}
        XCTAssertEqual(try local.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE in-flight edit"))
        XCTAssertEqual(fake.attempts.count,1)
    }
    func testReceiveSaveFailurePreservesMemoryDiskAndRetry() async throws {
        let dir = try directory(), fault = CloudKitWriteFault(), url = dir.appendingPathComponent("local.json")
        let store = LocalStateStore(fileURL:url) { data,url in if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to:url,options:.atomic) }
        let local = try state(store), before = try local.publicationSnapshot(), disk = try Data(contentsOf:url)
        let incoming = try before.replacing("state",with:before.required("state").replacing("defaultSystemMessage",with:.string("FAKE remote edit")))
        let fake = FakeCloudKit(snapshot:try remote(incoming)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE")
        fault.reject = true
        do { try await connection.download(); XCTFail("failed save accepted") } catch {}
        XCTAssertEqual(try local.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:url),disk)
        fault.reject = false; try await connection.download()
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try local.publicationSnapshot())
        XCTAssertEqual(fake.attempts.count,0)
    }
    func testAutomaticSyncFlushAndCleanRestartReceiveRemote() async throws {
        let dir = try directory(), localStore = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), local = try state(localStore)
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")), fake = FakeCloudKit(snapshot:try remote(local.publicationSnapshot(),time:50))
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        try await connection.download(); try await connection.setAutomaticSync(true)
        let changed = try local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE automatic edit")))
        try local.applySnapshot(changed); try await connection.flushAutomaticSync()
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload)["state"]?["defaultSystemMessage"],.string("FAKE automatic edit"))
        let incoming = try local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE offline remote edit")))
        fake.snapshot = try remote(incoming,time:200)
        let restarted = ChatState(store:localStore), fresh = CloudKitSyncConnection(state:restarted,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        let writes = fake.attempts.count
        try await fresh.restoreAutomaticSync()
        XCTAssertEqual(try restarted.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE offline remote edit"))
        XCTAssertEqual(fake.attempts.count,writes)
        try fresh.disconnect(); try connection.disconnect()
    }
    func testDirtyRestartPublishesSavedLocalEditsInsteadOfReceivingOlderRemote() async throws {
        let dir = try directory(), localStore = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), local = try state(localStore)
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")), fake = FakeCloudKit(snapshot:try remote(local.publicationSnapshot(),time:50))
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        try await connection.download(); try await connection.setAutomaticSync(true)
        try local.applySnapshot(local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE saved offline edit"))))
        let restarted = ChatState(store:localStore), fresh = CloudKitSyncConnection(state:restarted,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        try await fresh.restoreAutomaticSync()
        XCTAssertEqual(try restarted.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE saved offline edit"))
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload)["state"]?["defaultSystemMessage"],.string("FAKE saved offline edit"))
        try connection.disconnect(); try fresh.disconnect()
    }
    func testDirtyRestartArchivesOlderVersionBeforeAnyConflictRetry() async throws {
        let dir = try directory(), localStore = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), local = try state(localStore)
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")), original = try local.publicationSnapshot()
        try syncStore.saveBaselineDigest(SyncRecords.digest(String(decoding:original.encoded(),as:UTF8.self)))
        try syncStore.saveEnabled(true)
        try local.applySnapshot(original.replacing("state",with:original.required("state").replacing("defaultSystemMessage",with:.string("FAKE dirty local"))))
        let legacy = original.replacing("version",with:.number("17")), fake = FakeCloudKit(snapshot:try remote(legacy,time:50))
        let connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        do { try await connection.restoreAutomaticSync(); XCTFail("legacy overwritten") } catch {}
        XCTAssertEqual(fake.attempts.count,1)
        XCTAssertEqual(try SyncCompression.decompressCloudKit(fake.snapshot!.payload),String(decoding:try legacy.encoded(),as:UTF8.self))
        XCTAssertEqual(try syncStore.load().legacyRemotes.count,1)
        try await connection.restoreAutomaticSync()
        XCTAssertEqual(fake.attempts.count,1)
        XCTAssertEqual(try local.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE dirty local"))
        try connection.disconnect()
    }
    func testDirtyRestartRetainsDestructiveShrinkGuardWithoutInMemoryMetrics() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json"))
        var seed: UInt64 = 17
        let text = String((0..<50_000).map { _ -> Character in
            seed = seed &* 6_364_136_223_846_793_005 &+ 1
            return Character(UnicodeScalar(32 + UInt32(seed >> 32) % 90)!)
        })
        let original = try local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("xShrink",with:.string(text)))
        try local.applySnapshot(original)
        try syncStore.saveBaselineDigest(SyncRecords.digest(String(decoding:original.encoded(),as:UTF8.self))); try syncStore.saveEnabled(true)
        try local.applySnapshot(original.replacing("state",with:original.required("state").replacing("xShrink",with:.string(""))))
        let fake = FakeCloudKit(snapshot:try remote(original,time:50)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{100})
        do { try await connection.restoreAutomaticSync(); XCTFail("destructive shrink uploaded") } catch { XCTAssertTrue(error.localizedDescription.contains("shrank")) }
        XCTAssertEqual(fake.attempts.count,1)
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload),original)
        try connection.disconnect()
    }
    func testAutomaticRestoreCanRecoverFromTemporaryAccountFailure() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")), snapshot = try local.publicationSnapshot()
        try syncStore.saveBaselineDigest(SyncRecords.digest(String(decoding:snapshot.encoded(),as:UTF8.self))); try syncStore.saveEnabled(true)
        let fake = FakeCloudKit(snapshot:try remote(snapshot)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE",clock:{200})
        fake.accountError = SyncSessionError.invalid("FAKE offline")
        do { try await connection.restoreAutomaticSync(); XCTFail("offline accepted") } catch {}
        fake.accountError = nil
        try await connection.restoreAutomaticSync()
        try local.applySnapshot(local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE after reconnect"))))
        try await connection.flushAutomaticSync()
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload)["state"]?["defaultSystemMessage"],.string("FAKE after reconnect"))
        try connection.disconnect()
    }
    func testLegacyArchiveSurvivesRestartAndFailedArchivePreservesPreviousData() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json"))), before = try local.publicationSnapshot()
        let syncStore = CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")), old = before.replacing("version",with:.number("17"))
        let fake = FakeCloudKit(snapshot:try remote(old)), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:syncStore,deviceID:"FAKE")
        do { try await connection.download(); XCTFail("old version applied") } catch {}
        let saved = try syncStore.load(), archive = try XCTUnwrap(saved.legacyRemotes.first)
        XCTAssertEqual(try OrderedJSON.decode(connection.archivedJSON(archive.id)),old)
        let disk = try Data(contentsOf:syncStore.fileURL)
        let failing = CloudKitSyncStore(fileURL:syncStore.fileURL) { _,_ in throw CocoaError(.fileWriteNoPermission) }
        fake.snapshot = try remote(old.replacing("xOtherArchive",with:.number("9007199254740993")))
        let fresh = CloudKitSyncConnection(state:local,transport:fake,syncStore:failing,deviceID:"FAKE")
        do { try await fresh.download(); XCTFail("archive save failed") } catch {}
        XCTAssertEqual(try Data(contentsOf:syncStore.fileURL),disk); XCTAssertEqual(try local.publicationSnapshot(),before)
        XCTAssertEqual(try OrderedJSON.decode(fresh.archivedJSON(archive.id)),old)
    }
    func testMissingCorruptAndDisconnectedReadNeverReplaceLocal() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json"))), before = try local.publicationSnapshot()
        let fake = FakeCloudKit(snapshot:nil), connection = CloudKitSyncConnection(state:local,transport:fake,syncStore:CloudKitSyncStore(fileURL:dir.appendingPathComponent("sync.json")),deviceID:"FAKE")
        do { try await connection.download(); XCTFail("missing accepted") } catch {}
        let bad = try remote(before).record; bad["payload"] = Data([255,255]) as NSData; fake.snapshot = try CloudKitSnapshotRecord(bad)
        do { try await connection.download(); XCTFail("corrupt accepted") } catch {}
        let older = before.replacing("version",with:.number("17")); fake.snapshot = try remote(older)
        do { try await connection.download(); XCTFail("different data version accepted") } catch {}
        let cyclic = OrderedJSON.object([.init(key:"f",value:.object([.init(key:"id",value:.string("f")),.init(key:"name",value:.string("f")),.init(key:"order",value:.number("0")),.init(key:"expanded",value:.bool(true)),.init(key:"parentId",value:.string("f"))]))])
        let invalidFolders = try before.replacing("state",with:before.required("state").replacing("folders",with:cyclic))
        fake.snapshot = try remote(invalidFolders)
        do { try await connection.download(); XCTFail("cyclic folders accepted") } catch {}
        fake.snapshot = try remote(before); fake.onRead = { try connection.disconnect() }
        do { try await connection.download(); XCTFail("disconnected receive accepted") } catch {}
        XCTAssertEqual(try local.publicationSnapshot(),before)
    }
}

@MainActor private final class CloudKitWriteFault { var reject = false }
@MainActor private final class FakeCloudKit: CloudKitTransporting {
    struct Attempt { let expected: CloudKitSnapshotRecord?; let time: Int64 }
    var snapshot: CloudKitSnapshotRecord?
    var attempts: [Attempt] = []
    var onRead: (() throws -> Void)?
    var accountError: Error?
    init(snapshot: CloudKitSnapshotRecord?) { self.snapshot = snapshot }
    func accountStatus() async throws -> CKAccountStatus { if let accountError { throw accountError }; return .available }
    func read(recordName: String, recordType: String) async throws -> CloudKitSnapshotRecord? { try onRead?(); return snapshot }
    func save(recordName: String, recordType: String, payload: Data, snapshotVersion: Int64, updatedAt: Int64, deviceId: String, expected: CloudKitSnapshotRecord?) async throws -> CloudKitSnapshotRecord {
        attempts.append(.init(expected:expected,time:updatedAt))
        if snapshot != nil && expected?.record !== snapshot?.record { throw CloudKitSnapshotConflictError(serverRecord:snapshot) }
        let record = expected.map { $0.record.copy() as! CKRecord } ?? CKRecord(recordType:recordType,recordID:.init(recordName:recordName))
        record["payload"] = payload as NSData; record["snapshotVersion"] = NSNumber(value:snapshotVersion)
        record["updatedAt"] = NSNumber(value:updatedAt); record["deviceId"] = deviceId as NSString
        let saved = try CloudKitSnapshotRecord(record); snapshot = saved; return saved
    }
}
