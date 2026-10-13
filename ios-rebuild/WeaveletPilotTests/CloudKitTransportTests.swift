import CloudKit
import XCTest
@testable import WeaveletPilot

final class CloudKitTransportTests: XCTestCase {
    func testSnapshotRequiresPayloadAndKeepsCloudKitRecord() throws {
        let record = CKRecord(recordType: "WeaveletSnapshot", recordID: CKRecord.ID(recordName: "test"))
        record["snapshotVersion"] = NSNumber(value: Int64(2))
        record["updatedAt"] = NSNumber(value: Int64(1_700_000_000_000))
        record["deviceId"] = "device" as NSString
        record["unrelated"] = "keep" as NSString

        XCTAssertThrowsError(try CloudKitSnapshotRecord(record)) { error in
            guard case CloudKitTransportError.invalidRecord = error else {
                return XCTFail("Unexpected error: \(error)")
            }
        }

        record["payload"] = Data([0, 1, 255]) as NSData
        let snapshot = try CloudKitSnapshotRecord(record)
        XCTAssertEqual(snapshot.payload, Data([0, 1, 255]))
        XCTAssertEqual(snapshot.snapshotVersion, 2)
        XCTAssertEqual(snapshot.updatedAt, 1_700_000_000_000)
        XCTAssertEqual(snapshot.deviceId, "device")
        XCTAssertEqual(snapshot.record["unrelated"] as? String, "keep")
    }
}
