import Foundation

struct CloudKitSyncStore {
    struct LegacyRemoteArchive: Equatable {
        let payload: Data
        let snapshotVersion: Int64
        let recordName: String
        let recordType: String
        let updatedAt: Int64
        let deviceId: String
    }

    struct State: Equatable {
        let enabled: Bool
        let baselineDigest: String?
        let legacyRemote: LegacyRemoteArchive?
    }

    let fileURL: URL
    private let write: (Data, URL) throws -> Void

    init(fileURL: URL, write: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) {
        self.fileURL = fileURL
        self.write = write
    }

    static var applicationStore: CloudKitSyncStore {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let root = support.appendingPathComponent("com.weavelet.nativepilot", isDirectory: true)
        #if DEBUG
        if RemoteFixture.enabled {
            return CloudKitSyncStore(fileURL: root.appendingPathComponent("debug-remote-fixture/cloudkit-sync-state.json"))
        }
        #endif
        return CloudKitSyncStore(fileURL: root.appendingPathComponent("cloudkit-sync-state.json"))
    }

    private func read() throws -> OrderedJSON {
        do {
            let root = try OrderedJSON.decode(Data(contentsOf: fileURL))
            _ = try Self.state(root)
            return root
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return .object([.init(key: "version", value: .number("1"))])
        }
    }

    private static func integer(_ value: OrderedJSON, _ field: String) throws -> Int64 {
        guard case .number(let raw) = value, let number = Int64(raw) else { throw ExchangeError.invalid(field) }
        return number
    }

    private static func state(_ root: OrderedJSON) throws -> State {
        _ = try root.object("CloudKit sync state")
        guard try integer(root.required("version"), "version") == 1 else { throw ExchangeError.invalid("CloudKit sync state version") }
        let enabled = try root["enabled"]?.boolean("enabled") ?? false
        let baselineDigest = try root["baselineDigest"]?.string("baselineDigest")
        var legacyRemote: LegacyRemoteArchive?
        if let archive = root["legacyRemote"] {
            _ = try archive.object("legacyRemote")
            let encoded = try archive.required("payloadBase64").string("payloadBase64")
            guard let payload = Data(base64Encoded: encoded) else { throw ExchangeError.invalid("legacyRemote payload") }
            legacyRemote = try LegacyRemoteArchive(
                payload: payload,
                snapshotVersion: integer(archive.required("snapshotVersion"), "snapshotVersion"),
                recordName: archive.required("recordName").string("recordName"),
                recordType: archive.required("recordType").string("recordType"),
                updatedAt: integer(archive.required("updatedAt"), "updatedAt"),
                deviceId: archive.required("deviceId").string("deviceId")
            )
        }
        return State(enabled: enabled, baselineDigest: baselineDigest, legacyRemote: legacyRemote)
    }

    func load() throws -> State { try Self.state(read()) }

    private func save(_ root: OrderedJSON) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try write(root.encoded(), fileURL)
    }

    func saveEnabled(_ enabled: Bool) throws {
        try save(read().replacing("enabled", with: .bool(enabled)))
    }

    func saveBaselineDigest(_ digest: String?) throws {
        let root = try read()
        if let digest { try save(root.replacing("baselineDigest", with: .string(digest))) }
        else { try save(.object(root.object("CloudKit sync state").filter { $0.key != "baselineDigest" })) }
    }

    func archiveLegacyRemote(_ record: CloudKitSnapshotRecord) throws {
        let root = try read()
        var archive = root["legacyRemote"] ?? .object([])
        archive = archive.replacing("payloadBase64", with: .string(record.payload.base64EncodedString()))
            .replacing("snapshotVersion", with: .number(String(record.snapshotVersion)))
            .replacing("recordName", with: .string(record.recordName))
            .replacing("recordType", with: .string(record.recordType))
            .replacing("updatedAt", with: .number(String(record.updatedAt)))
            .replacing("deviceId", with: .string(record.deviceId))
        try save(root.replacing("legacyRemote", with: archive))
    }
}
