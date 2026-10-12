import Foundation
import CryptoKit
import CommonCrypto
import Security

struct SyncKeyEnvelope: Codable, Equatable {
    var format: String
    var version: Int
    var salt: [Int]
    var iterations: Int
    var wrappedKey: [Int]
}

enum SyncCrypto {
    static let iterations = 600_000

    // The random source is injectable only to verify frozen cross-platform vectors.
    static func createKeyEnvelope(password: String, dataset: String,
                                  randomBytes: (Int) throws -> Data = secureRandomBytes) throws -> (key: SymmetricKey, envelope: SyncKeyEnvelope) {
        guard password.utf16.count >= 12 else { throw SyncCryptoError.shortPassword }
        let salt = try randomBytes(16)
        var raw = try randomBytes(32)
        defer { raw.resetBytes(in: 0..<raw.count) }
        guard salt.count == 16, raw.count == 32 else { throw SyncCryptoError.invalidKey }
        let key = SymmetricKey(data: raw)
        let wrappingKey = try passwordKey(password, salt: salt)
        let wrapped = try encrypt(key: wrappingKey, bytes: raw, context: "\(dataset):key", randomBytes: randomBytes)
        return (key, SyncKeyEnvelope(format: "weavelet-encrypted-sync", version: 1, salt: salt.map(Int.init), iterations: iterations, wrappedKey: wrapped.map(Int.init)))
    }

    static func unlockKey(_ envelope: SyncKeyEnvelope, password: String, dataset: String) throws -> SymmetricKey {
        guard envelope.format == "weavelet-encrypted-sync", envelope.version == 1, envelope.iterations == iterations,
              envelope.salt.count == 16, envelope.wrappedKey.count == 60,
              (envelope.salt + envelope.wrappedKey).allSatisfy({ (0...255).contains($0) }) else {
            throw SyncCryptoError.invalidEnvelope
        }
        let wrappingKey = try passwordKey(password, salt: Data(envelope.salt.map(UInt8.init)))
        var raw = try decrypt(key: wrappingKey, bytes: Data(envelope.wrappedKey.map(UInt8.init)), context: "\(dataset):key")
        defer { raw.resetBytes(in: 0..<raw.count) }
        guard raw.count == 32 else { throw SyncCryptoError.invalidKey }
        return SymmetricKey(data: raw)
    }

    static func encrypt(key: SymmetricKey, bytes: Data, context: String,
                        randomBytes: (Int) throws -> Data = secureRandomBytes) throws -> Data {
        guard key.bitCount == 256 else { throw SyncCryptoError.invalidKey }
        let iv = try randomBytes(12)
        guard iv.count == 12 else { throw SyncCryptoError.invalidCiphertext }
        let sealed = try AES.GCM.seal(bytes, using: key, nonce: AES.GCM.Nonce(data: iv), authenticating: Data(context.utf8))
        guard let combined = sealed.combined else { throw SyncCryptoError.invalidCiphertext }
        return combined
    }

    static func decrypt(key: SymmetricKey, bytes: Data, context: String) throws -> Data {
        guard key.bitCount == 256 else { throw SyncCryptoError.invalidKey }
        guard bytes.count >= 28 else { throw SyncCryptoError.invalidCiphertext }
        do {
            return try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: key, authenticating: Data(context.utf8))
        } catch {
            throw SyncCryptoError.decryptionFailed
        }
    }

    private static func passwordKey(_ password: String, salt: Data) throws -> SymmetricKey {
        var passwordBytes = password.utf8CString
        var derived = Data(count: 32)
        defer {
            for index in passwordBytes.indices { passwordBytes[index] = 0 }
            derived.resetBytes(in: 0..<derived.count)
        }
        let status = derived.withUnsafeMutableBytes { output in
            passwordBytes.withUnsafeBufferPointer { password in
                salt.withUnsafeBytes { saltBytes in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password.baseAddress, password.count - 1,
                                        saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
                                        output.baseAddress?.assumingMemoryBound(to: UInt8.self), output.count)
                }
            }
        }
        guard status == kCCSuccess else { throw SyncCryptoError.derivationFailed }
        return SymmetricKey(data: derived)
    }

    private static func secureRandomBytes(_ count: Int) throws -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        guard status == errSecSuccess else { throw SyncCryptoError.randomFailed }
        return data
    }
}

enum SyncCryptoError: LocalizedError {
    case shortPassword, invalidEnvelope, invalidKey, invalidCiphertext, decryptionFailed, derivationFailed, randomFailed
    var errorDescription: String? {
        switch self {
        case .shortPassword: return "同期パスフレーズには12文字以上必要です。"
        case .invalidEnvelope: return "未対応の暗号化同期形式です。"
        case .invalidKey: return "暗号鍵の長さが不正です。"
        case .invalidCiphertext: return "暗号化同期データの長さが不正です。"
        case .decryptionFailed: return "同期データを復号できません。パスフレーズまたはデータを確認してください。"
        case .derivationFailed: return "同期用の暗号鍵を導出できません。"
        case .randomFailed: return "暗号化用の乱数を生成できません。"
        }
    }
}
