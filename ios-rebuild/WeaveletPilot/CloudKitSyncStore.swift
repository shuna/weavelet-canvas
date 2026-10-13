import Foundation

struct CloudKitSyncStore {
    struct LegacyRemoteArchive: Equatable {
        let id: String
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
        let legacyRemotes: [LegacyRemoteArchive]
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
        let legacyRemotes = try (root["legacyRemotes"]?.array("legacyRemotes") ?? []).map { archive in
            _ = try archive.object("legacyRemote")
            let encoded = try archive.required("payloadBase64").string("payloadBase64")
            guard let payload = Data(base64Encoded: encoded) else { throw ExchangeError.invalid("legacyRemote payload") }
            return try LegacyRemoteArchive(
                id: archive.required("id").string("id"),
                payload: payload,
                snapshotVersion: integer(archive.required("snapshotVersion"), "snapshotVersion"),
                recordName: archive.required("recordName").string("recordName"),
                recordType: archive.required("recordType").string("recordType"),
                updatedAt: integer(archive.required("updatedAt"), "updatedAt"),
                deviceId: archive.required("deviceId").string("deviceId")
            )
        }
        return State(enabled: enabled, baselineDigest: baselineDigest, legacyRemotes: legacyRemotes)
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
        var archives = try root["legacyRemotes"]?.array("legacyRemotes") ?? []
        if try archives.contains(where: { Data(base64Encoded: try $0.required("payloadBase64").string("payloadBase64")) == record.payload }) { return }
        archives.append(.object([
            .init(key: "id", value: .string(UUID().uuidString)),
            .init(key: "payloadBase64", value: .string(record.payload.base64EncodedString())),
            .init(key: "snapshotVersion", value: .number(String(record.snapshotVersion))),
            .init(key: "recordName", value: .string(record.recordName)),
            .init(key: "recordType", value: .string(record.recordType)),
            .init(key: "updatedAt", value: .number(String(record.updatedAt))),
            .init(key: "deviceId", value: .string(record.deviceId))
        ]))
        try save(root.replacing("legacyRemotes", with: .array(archives)))
    }
}
