import CloudKit
import Foundation

protocol CloudKitTransporting {
    func accountStatus() async throws -> CKAccountStatus
    func read(recordName: String, recordType: String) async throws -> CloudKitSnapshotRecord?
    func save(recordName: String, recordType: String, payload: Data, snapshotVersion: Int64,
              updatedAt: Int64, deviceId: String, expected: CloudKitSnapshotRecord?) async throws -> CloudKitSnapshotRecord
}

enum CloudKitTransportError: Error {
    case missingContainerIdentifier
    case invalidRecord
    case unexpectedSaveResult
}

struct CloudKitSnapshotRecord {
    let recordName: String
    let recordType: String
    let payload: Data
    let snapshotVersion: Int64
    let updatedAt: Int64
    let deviceId: String
    let record: CKRecord

    init(_ record: CKRecord) throws {
        guard let payload = record["payload"] as? Data,
              let snapshotVersion = record["snapshotVersion"] as? NSNumber,
              let updatedAt = record["updatedAt"] as? NSNumber,
              let deviceId = record["deviceId"] as? String else {
            throw CloudKitTransportError.invalidRecord
        }
        self.recordName = record.recordID.recordName
        self.recordType = record.recordType
        self.payload = payload
        self.snapshotVersion = snapshotVersion.int64Value
        self.updatedAt = updatedAt.int64Value
        self.deviceId = deviceId
        self.record = record
    }
}

struct CloudKitSnapshotConflictError: Error {
    let serverRecord: CloudKitSnapshotRecord?
}

final class CloudKitTransport: CloudKitTransporting {
    private let container: CKContainer

    init(bundle: Bundle = .main) throws {
        guard let identifier = bundle.object(forInfoDictionaryKey: "CloudKitContainerIdentifier") as? String,
              !identifier.isEmpty, !identifier.contains("$(") else {
            throw CloudKitTransportError.missingContainerIdentifier
        }
        container = CKContainer(identifier: identifier)
    }

    func accountStatus() async throws -> CKAccountStatus {
        try await container.accountStatus()
    }

    func read(recordName: String, recordType: String) async throws -> CloudKitSnapshotRecord? {
        do {
            let record = try await container.privateCloudDatabase.record(for: CKRecord.ID(recordName: recordName))
            guard record.recordType == recordType else { throw CloudKitTransportError.invalidRecord }
            return try CloudKitSnapshotRecord(record)
        } catch let error as CKError where error.code == .unknownItem {
            return nil
        }
    }

    func save(recordName: String, recordType: String, payload: Data, snapshotVersion: Int64,
              updatedAt: Int64, deviceId: String, expected: CloudKitSnapshotRecord?) async throws -> CloudKitSnapshotRecord {
        if let expected {
            guard expected.recordName == recordName, expected.recordType == recordType else {
                throw CloudKitTransportError.invalidRecord
            }
        }
        // Copy keeps the fetched system fields and every unrelated CloudKit field intact.
        let record = expected.map { $0.record.copy() as! CKRecord }
            ?? CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: recordName))
        record["payload"] = payload as NSData
        record["snapshotVersion"] = NSNumber(value: snapshotVersion)
        record["updatedAt"] = NSNumber(value: updatedAt)
        record["deviceId"] = deviceId as NSString

        do {
            let results = try await container.privateCloudDatabase.modifyRecords(
                saving: [record], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: true)
            guard let result = results.saveResults[record.recordID] else { throw CloudKitTransportError.unexpectedSaveResult }
            switch result {
            case .success(let saved): return try CloudKitSnapshotRecord(saved)
            case .failure(let error): throw try transportError(error)
            }
        } catch {
            throw try transportError(error)
        }
    }

    private func transportError(_ error: Error) throws -> Error {
        guard let cloudError = error as? CKError, cloudError.code == .serverRecordChanged else { return error }
        let serverRecord = try cloudError.serverRecord.map(CloudKitSnapshotRecord.init)
        return CloudKitSnapshotConflictError(serverRecord: serverRecord)
    }
}
