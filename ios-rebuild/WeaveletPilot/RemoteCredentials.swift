import Foundation
import Security

struct RemoteCredentialRecord: Codable, Equatable {
    var settings = RemoteSettings()
    var key = ""
}

// Interim native storage; global Web settings remain untouched until the full-state sync bridge.
enum RemoteCredentials {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.weavelet.nativepilot.remote", kSecAttrAccount as String: "openai-compatible"] }
    static func load() throws -> RemoteCredentialRecord {
        #if DEBUG
        if RemoteFixture.enabled {
            if let data = UserDefaults(suiteName: "com.weavelet.nativepilot.debug.remote")!.data(forKey: "record"), let record = try? JSONDecoder().decode(RemoteCredentialRecord.self, from: data) { return record }
            return RemoteCredentialRecord(settings: RemoteSettings(endpoint: "https://fixture.invalid/v1/chat/completions", model: "fake-model", stream: true), key: "FAKE")
        }
        #endif
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return RemoteCredentialRecord() }
        guard status == errSecSuccess, let data = value as? Data else { throw ExchangeError.invalid("Keychain読み込み \(status)") }
        return try JSONDecoder().decode(RemoteCredentialRecord.self, from: data)
    }
    static func save(_ record: RemoteCredentialRecord) throws {
        #if DEBUG
        if RemoteFixture.enabled {
            var fake = record; fake.key = "FAKE"
            UserDefaults(suiteName: "com.weavelet.nativepilot.debug.remote")!.set(try JSONEncoder().encode(fake), forKey: "record")
            return
        }
        #endif
        let data = try JSONEncoder().encode(record)
        let attributes = [kSecValueData as String: data]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw ExchangeError.invalid("Keychain更新 \(updated)") }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw ExchangeError.invalid("Keychain保存 \(status)") }
    }
}
