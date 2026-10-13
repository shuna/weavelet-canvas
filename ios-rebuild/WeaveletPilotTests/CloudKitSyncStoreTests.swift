import CloudKit
import XCTest
@testable import WeaveletPilot

final class CloudKitSyncStoreTests: XCTestCase {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("cloudkit.json")
    }

    private func record(payload: Data = Data([0, 255, 10])) throws -> CloudKitSnapshotRecord {
        let raw = CKRecord(recordType: "Snapshot", recordID: .init(recordName: "current"))
        raw["payload"] = payload as NSData
        raw["snapshotVersion"] = NSNumber(value: Int64(17))
        raw["updatedAt"] = NSNumber(value: Int64(9_007_199_254_740_993))
        raw["deviceId"] = "legacy-device" as NSString
        return try CloudKitSnapshotRecord(raw)
    }

    func testArchiveRetainsRawRemoteAfterRestartAndDisabling() throws {
        let url = location(), store = CloudKitSyncStore(fileURL: url)
        let remote = try record()
        try store.saveEnabled(true)
        try store.saveBaselineDigest("prior-sync")
        try store.archiveLegacyRemote(remote)
        try store.saveEnabled(false)

        let reopened = try CloudKitSyncStore(fileURL: url).load()
        XCTAssertFalse(reopened.enabled)
        XCTAssertEqual(reopened.baselineDigest, "prior-sync")
        XCTAssertEqual(reopened.legacyRemote?.payload, remote.payload)
        XCTAssertEqual(reopened.legacyRemote?.snapshotVersion, 17)
        XCTAssertEqual(reopened.legacyRemote?.updatedAt, 9_007_199_254_740_993)
        XCTAssertEqual(reopened.legacyRemote?.recordName, "current")
        XCTAssertEqual(reopened.legacyRemote?.recordType, "Snapshot")
        XCTAssertEqual(reopened.legacyRemote?.deviceId, "legacy-device")
    }

    func testFailedWriteKeepsExistingBytesAndUnknownFields() throws {
        let url = location(), store = CloudKitSyncStore(fileURL: url)
        try store.saveEnabled(true)
        let original = try OrderedJSON.decode(Data(contentsOf: url)).replacing("futureField", with: .number("9007199254740993"))
        try original.encoded().write(to: url, options: .atomic)
        let bytes = try Data(contentsOf: url)
        let failed = CloudKitSyncStore(fileURL: url) { _, _ in throw CocoaError(.fileWriteNoPermission) }
        XCTAssertThrowsError(try failed.archiveLegacyRemote(record()))
        XCTAssertEqual(try Data(contentsOf: url), bytes)

        try store.saveBaselineDigest("current")
        let updated = try OrderedJSON.decode(Data(contentsOf: url))
        XCTAssertEqual(updated["futureField"], .number("9007199254740993"))
    }

    func testCorruptStateCannotBeOverwritten() throws {
        let url = location()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bytes = Data("{broken".utf8)
        try bytes.write(to: url)
        let store = CloudKitSyncStore(fileURL: url)
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.saveEnabled(true))
        XCTAssertThrowsError(try store.saveBaselineDigest("digest"))
        XCTAssertThrowsError(try store.archiveLegacyRemote(record()))
        XCTAssertEqual(try Data(contentsOf: url), bytes)
    }
}
