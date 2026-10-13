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
        snapshot = try snapshot.replacing("state",with:snapshot.required("state").replacing("xLargeNumber",with:.number("9007199254740993")).replacing("theme",with:.string("FAKE cloud theme")))
        snapshot = snapshot.replacing("xWrapper",with:.number("9007199254740993"))
        let fake = FakeCloudKit(snapshot:try remote(snapshot)), connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE")
        let previousRoots = try local.publicationSnapshot().required("state").object("state").map(\.key)
        try await connection.connect(); try await connection.download()
        let received = try local.publicationSnapshot().required("state"), incoming = try snapshot.required("state")
        // Web mergeSyncDocumentSnapshot overlays roots: existing root positions stay, new roots append.
        XCTAssertEqual(try received.object("state").map(\.key),previousRoots + ["xLargeNumber"])
        XCTAssertEqual(Set(try received.object("state").map { Data($0.key.utf8) }),Set(try incoming.object("state").map { Data($0.key.utf8) }))
        for field in try incoming.object("state") { XCTAssertEqual(received[field.key],field.value,field.key) }
        XCTAssertEqual(try local.publicationSnapshot()["xWrapper"],snapshot["xWrapper"])
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try local.publicationSnapshot())
        XCTAssertEqual(try CloudKitSnapshots.decode(fake.snapshot!.payload),snapshot)
    }
    func testUploadUsesCapturedConflictRecordAndTimestampOnce() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let server = try remote(local.publicationSnapshot(),time:50), fake = FakeCloudKit(snapshot:server)
        let connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE",clock:{100})
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
        let fake = FakeCloudKit(snapshot:try remote(incoming,time:200)), connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE",clock:{100})
        try await connection.upload()
        XCTAssertEqual(try local.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE server wins"))
        XCTAssertEqual(fake.attempts.count,1)
    }
    func testServerWinsCannotOverwriteLocalChangeDuringRead() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json")))
        let fake = FakeCloudKit(snapshot:try remote(local.publicationSnapshot(),time:200))
        fake.onRead = { try local.applySnapshot(local.publicationSnapshot().replacing("state",with:local.publicationSnapshot().required("state").replacing("defaultSystemMessage",with:.string("FAKE in-flight edit")))) }
        let connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE",clock:{100})
        do { try await connection.upload(); XCTFail("stale receive accepted") } catch {}
        XCTAssertEqual(try local.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("FAKE in-flight edit"))
        XCTAssertEqual(fake.attempts.count,1)
    }
    func testReceiveSaveFailurePreservesMemoryDiskAndRetry() async throws {
        let dir = try directory(), fault = CloudKitWriteFault(), url = dir.appendingPathComponent("local.json")
        let store = LocalStateStore(fileURL:url) { data,url in if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try data.write(to:url,options:.atomic) }
        let local = try state(store), before = try local.publicationSnapshot(), disk = try Data(contentsOf:url)
        let incoming = try before.replacing("state",with:before.required("state").replacing("defaultSystemMessage",with:.string("FAKE remote edit")))
        let fake = FakeCloudKit(snapshot:try remote(incoming)), connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE")
        fault.reject = true
        do { try await connection.download(); XCTFail("failed save accepted") } catch {}
        XCTAssertEqual(try local.publicationSnapshot(),before); XCTAssertEqual(try Data(contentsOf:url),disk)
        fault.reject = false; try await connection.download()
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try local.publicationSnapshot())
        XCTAssertEqual(fake.attempts.count,0)
    }
    func testMissingCorruptAndDisconnectedReadNeverReplaceLocal() async throws {
        let dir = try directory(), local = try state(LocalStateStore(fileURL:dir.appendingPathComponent("local.json"))), before = try local.publicationSnapshot()
        let fake = FakeCloudKit(snapshot:nil), connection = CloudKitSyncConnection(state:local,transport:fake,deviceID:"FAKE")
        do { try await connection.download(); XCTFail("missing accepted") } catch {}
        let bad = try remote(before).record; bad["payload"] = Data([255,255]) as NSData; fake.snapshot = try CloudKitSnapshotRecord(bad)
        do { try await connection.download(); XCTFail("corrupt accepted") } catch {}
        let older = before.replacing("version",with:.number("17")); fake.snapshot = try remote(older)
        do { try await connection.download(); XCTFail("different data version accepted") } catch {}
        let cyclic = OrderedJSON.object([.init(key:"f",value:.object([.init(key:"id",value:.string("f")),.init(key:"name",value:.string("f")),.init(key:"order",value:.number("0")),.init(key:"expanded",value:.bool(true)),.init(key:"parentId",value:.string("f"))]))])
        let invalidFolders = try before.replacing("state",with:before.required("state").replacing("folders",with:cyclic))
        fake.snapshot = try remote(invalidFolders)
        do { try await connection.download(); XCTFail("cyclic folders accepted") } catch {}
        fake.snapshot = try remote(before); fake.onRead = { connection.disconnect() }
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
    init(snapshot: CloudKitSnapshotRecord?) { self.snapshot = snapshot }
    func accountStatus() async throws -> CKAccountStatus { .available }
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
