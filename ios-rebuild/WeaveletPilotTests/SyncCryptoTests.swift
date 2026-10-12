import XCTest
import CryptoKit
@testable import WeaveletPilot

final class SyncCryptoTests: XCTestCase {
    // Independently frozen Node pbkdf2Sync/createCipheriv vectors from the Web contract.
    private let password = "FAKE TEST ONLY long passphrase"
    private let dataset = "fake-dataset"
    private let context = "fake-dataset:commit:file-1"
    private let rawKey = Data((0..<32).map(UInt8.init))
    private let iv = Data((0..<12).map(UInt8.init))
    private let wrappedHex = "000102030405060708090a0b245b447cdbe818411d99c187cc4469f91587e6d7327173acf7a9b94fa7eab14f672551c99f33953d372639ed62a15485"
    private let cipherHex = "000102030405060708090a0b01439d5ee5b18748d961711c140fe4c16b7c19cf1a0a2e9e74ba8147749ed3f1bec212"

    private func data(_ hex: String) -> Data {
        let chars = Array(hex)
        return Data(stride(from: 0, to: chars.count, by: 2).map { UInt8(String(chars[$0...($0 + 1)]), radix: 16)! })
    }
    private var envelope: SyncKeyEnvelope {
        SyncKeyEnvelope(format: "weavelet-encrypted-sync", version: 1, salt: (0..<16).map { $0 }, iterations: 600_000, wrappedKey: data(wrappedHex).map(Int.init))
    }
    private func fixedRandom(_ count: Int) -> Data { Data((0..<count).map(UInt8.init)) }

    func testFixedWebEnvelopeAndCiphertext() throws {
        let created = try SyncCrypto.createKeyEnvelope(password: password, dataset: dataset, randomBytes: fixedRandom)
        XCTAssertEqual(created.envelope, envelope)
        let key = try SyncCrypto.unlockKey(envelope, password: password, dataset: dataset)
        XCTAssertEqual(key.withUnsafeBytes { Data($0) }, rawKey)
        let plaintext = Data("FAKE TEST 日本語".utf8)
        XCTAssertEqual(try SyncCrypto.encrypt(key: key, bytes: plaintext, context: context, randomBytes: fixedRandom), data(cipherHex))
        XCTAssertEqual(try SyncCrypto.decrypt(key: key, bytes: data(cipherHex), context: context), plaintext)
        let json = try JSONEncoder().encode(created.envelope)
        XCTAssertEqual(try JSONDecoder().decode(SyncKeyEnvelope.self, from: json), envelope)
    }

    func testWrongKeyContextAndDamagedCiphertextAreRejected() throws {
        let key = SymmetricKey(data: rawKey)
        let ciphertext = data(cipherHex)
        XCTAssertThrowsError(try SyncCrypto.decrypt(key: SymmetricKey(data: Data(repeating: 255, count: 32)), bytes: ciphertext, context: context))
        XCTAssertThrowsError(try SyncCrypto.decrypt(key: key, bytes: ciphertext, context: "wrong-fake-context"))
        for index in [0, 12, ciphertext.count - 1] {
            var damaged = ciphertext
            damaged[index] ^= 1
            XCTAssertThrowsError(try SyncCrypto.decrypt(key: key, bytes: damaged, context: context))
        }
        XCTAssertThrowsError(try SyncCrypto.decrypt(key: key, bytes: Data(repeating: 0, count: 27), context: context))
        XCTAssertThrowsError(try SyncCrypto.decrypt(key: SymmetricKey(size: .bits128), bytes: ciphertext, context: context))
        XCTAssertThrowsError(try SyncCrypto.unlockKey(envelope, password: password, dataset: "wrong-fake-dataset"))
        XCTAssertThrowsError(try SyncCrypto.unlockKey(envelope, password: "wrong fake passphrase", dataset: dataset))
    }

    func testEnvelopeBoundaryValidation() throws {
        var invalid = envelope
        invalid.iterations = 1
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.format = "wrong"
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.version = 2
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.salt.removeLast()
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.wrappedKey.removeLast()
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.salt[0] = -1
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        invalid = envelope; invalid.wrappedKey[0] = 256
        XCTAssertThrowsError(try SyncCrypto.unlockKey(invalid, password: password, dataset: dataset))
        XCTAssertThrowsError(try SyncCrypto.createKeyEnvelope(password: "short", dataset: dataset))
    }

    func testGeneratedEnvelopeAndEmptyUnicodePayloadRoundTrip() throws {
        // Six supplementary characters have 12 UTF-16 code units, matching JS length.
        let unicodePassword = "🙂🙂🙂🙂🙂🙂"
        let created = try SyncCrypto.createKeyEnvelope(password: unicodePassword, dataset: "合成データ")
        let unlocked = try SyncCrypto.unlockKey(created.envelope, password: unicodePassword, dataset: "合成データ")
        for payload in [Data(), Data("日本語\u{0}🙂".utf8)] {
            let ciphertext = try SyncCrypto.encrypt(key: created.key, bytes: payload, context: "合成データ:commit:偽file")
            XCTAssertEqual(ciphertext.count, 28 + payload.count)
            XCTAssertEqual(try SyncCrypto.decrypt(key: unlocked, bytes: ciphertext, context: "合成データ:commit:偽file"), payload)
        }
    }
}
