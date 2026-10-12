import Foundation
import CryptoKit
import Security
import Darwin

// One atomic envelope keeps the accepted state, cursor/baseline and durable outbox together.
// shortcut: each save rewrites the envelope; use incremental storage if measured sync volume makes it expensive.
final class SyncStateStore: @unchecked Sendable {
    let fileURL: URL
    private let write: (Data, URL) throws -> Void
    private let lock = NSLock()
    init(fileURL: URL, write: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) {
        self.fileURL = fileURL; self.write = write
    }
    static var applicationStore: SyncStateStore {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return SyncStateStore(fileURL: root.appendingPathComponent("com.weavelet.nativepilot/google-sync-state.json"))
    }
    private func load() throws -> OrderedJSON {
        do {
            let root = try OrderedJSON.decode(Data(contentsOf: fileURL))
            guard try root.required("version").number("version") == 1 else { throw SyncSessionError.invalid("local sync state version") }
            for field in try root.required("datasets").object("datasets") {
                _ = try field.value.object("dataset state")
                if let cache = field.value["cache"] { _ = try cache.syncData() }
                if let entries = field.value["entries"] {
                    for entry in try entries.object("entries") { _ = try entry.value.syncData() }
                }
                if let accepted = field.value["accepted"] { _ = try OrderedJSON.decode(Data(accepted.string("accepted snapshot").utf8)) }
            }
            return root
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return .object([JSONField(key: "version", value: .number("1")), JSONField(key: "datasets", value: .object([]))])
        }
    }
    private func locked<T>(_ exclusive: Bool, _ work: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let descriptor = Darwin.open(fileURL.path + ".lock", O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw SyncSessionError.invalid("Unable to open local sync lock") }
        defer { Darwin.close(descriptor) }
        guard flock(descriptor, exclusive ? LOCK_EX : LOCK_SH) == 0 else { throw SyncSessionError.invalid("Unable to lock local sync state") }
        defer { flock(descriptor, LOCK_UN) }
        return try work()
    }
    func dataset(_ id: String) throws -> OrderedJSON {
        try locked(false) { try load().required("datasets")[id] ?? .object([]) }
    }
    func acceptedSnapshot(dataset id: String) throws -> OrderedJSON? {
        guard let source = try dataset(id)["accepted"] else { return nil }
        return try OrderedJSON.decode(Data(source.string("accepted snapshot").utf8))
    }
    func transaction(dataset id: String, expectedCache: OrderedJSON, cache: OrderedJSON?,
                     entries: [JSONField], remove: [String], accepted: OrderedJSON?) throws {
        try locked(true) {
            let root = try load()
            var datasets = try root.required("datasets")
            var state = datasets[id] ?? .object([])
            guard (state["cache"] ?? .null) == expectedCache else { throw SyncSessionError.invalid("Another session changed the sync state") }
            var storedEntries = state["entries"] ?? .object([])
            _ = try storedEntries.object("entries")
            for entry in entries { storedEntries = storedEntries.replacing(entry.key, with: entry.value) }
            if !remove.isEmpty { storedEntries = .object(try storedEntries.object("entries").filter { field in !remove.contains { $0.utf8.elementsEqual(field.key.utf8) } }) }
            state = state.replacing("entries", with: storedEntries)
            if let cache { state = state.replacing("cache", with: cache) }
            if let accepted { state = state.replacing("accepted", with: .string(String(decoding: try accepted.encoded(), as: UTF8.self))) }
            datasets = datasets.replacing(id, with: state)
            let bytes = try root.replacing("datasets", with: datasets).encoded()
            try write(bytes, fileURL)
        }
    }
}

protocol SyncKeyStore: Sendable {
    func load(dataset: String) throws -> SymmetricKey?
    func save(_ key: SymmetricKey, dataset: String) throws
}

struct KeychainSyncKeyStore: SyncKeyStore {
    private let service = "com.weavelet.nativepilot.google-sync-key"
    func load(dataset: String) throws -> SymmetricKey? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: dataset, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data, bytes.count == 32 else { throw SyncSessionError.invalid("Keychain read failed (\(status))") }
        return SymmetricKey(data: bytes)
    }
    func save(_ key: SymmetricKey, dataset: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: dataset]
        let bytes = key.withUnsafeBytes { Data($0) }
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw SyncSessionError.invalid("Keychain update failed (\(updated))") }
        var addition = query; addition[kSecValueData as String] = bytes
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(addition as CFDictionary, nil)
        guard status == errSecSuccess else { throw SyncSessionError.invalid("Keychain save failed (\(status))") }
    }
}

extension OrderedJSON {
    static func syncBytes(_ bytes: Data) -> OrderedJSON { .array(bytes.map { .number(String($0)) }) }
    func syncData() throws -> Data {
        try Data(array("bytes").map { item in
            let number = try item.number("byte")
            guard number >= 0, number <= 255, number.rounded() == number else { throw SyncSessionError.invalid("Invalid byte") }
            return UInt8(number)
        })
    }
}
