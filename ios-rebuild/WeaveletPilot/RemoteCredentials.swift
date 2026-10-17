import Foundation
import Security

struct RemoteCredentialRecord: Codable, Equatable {
    var settings = RemoteSettings()
    var key = ""
    var proxy: RemoteProxySettings?
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
        return try read(query) ?? RemoteCredentialRecord()
    }
    static func load(providerID: String) throws -> RemoteCredentialRecord? {
        #if DEBUG
        if RemoteFixture.enabled {
            guard let data = UserDefaults(suiteName:"com.weavelet.nativepilot.debug.remote")!.data(forKey:"provider:" + providerID) else { return nil }
            return try JSONDecoder().decode(RemoteCredentialRecord.self,from:data)
        }
        #endif
        return try read(providerQuery(providerID))
    }
    private static func providerQuery(_ id: String) -> [String:Any] {
        var selected = query; selected[kSecAttrAccount as String] = "provider:" + id; return selected
    }
    private static func read(_ query: [String:Any]) throws -> RemoteCredentialRecord? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary,&value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw ExchangeError.invalid("Keychain読み込み \(status)") }
        return try JSONDecoder().decode(RemoteCredentialRecord.self,from:data)
    }
    static func save(_ record: RemoteCredentialRecord) throws {
        #if DEBUG
        if RemoteFixture.enabled {
            var fake = record; fake.key = "FAKE"; if fake.proxy != nil { fake.proxy?.authToken = "FAKE" }
            UserDefaults(suiteName: "com.weavelet.nativepilot.debug.remote")!.set(try JSONEncoder().encode(fake), forKey: "record")
            return
        }
        #endif
        try write(record,query:query)
    }
    static func save(_ record: RemoteCredentialRecord, providerID: String) throws {
        #if DEBUG
        if RemoteFixture.enabled {
            var fake = record; fake.key = "FAKE"; if fake.proxy != nil { fake.proxy?.authToken = "FAKE" }
            UserDefaults(suiteName:"com.weavelet.nativepilot.debug.remote")!.set(try JSONEncoder().encode(fake),forKey:"provider:" + providerID)
            return
        }
        #endif
        try write(record,query:providerQuery(providerID))
    }
    private static func write(_ record: RemoteCredentialRecord, query: [String:Any]) throws {
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
