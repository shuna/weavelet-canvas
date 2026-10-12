import XCTest
import CryptoKit
@testable import WeaveletPilot

final class SyncCompressionTests: XCTestCase {
    private struct Fixture: Decodable {
        let fixtureVersion: Int
        let packageVersion: String
        let sourceSHA256: String
        let vectors: [Vector]
        struct Vector: Decodable {
            let name: String
            let plaintext: String
            let googleHex: String
            let cloudKitBase64: String
        }
    }
    private var root: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }
    private func fixture() throws -> Fixture {
        try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("ios-rebuild/WeaveletPilotTests/Fixtures/lz-wire.json")))
    }
    private func hex(_ text: String) -> Data {
        let chars = Array(text)
        return Data(stride(from: 0, to: chars.count, by: 2).map { UInt8(String(chars[$0...($0 + 1)]), radix: 16)! })
    }

    func testFrozenWebVectorsForBothWires() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture.fixtureVersion, 1)
        XCTAssertEqual(fixture.vectors.count, 6)
        for vector in fixture.vectors {
            let google = try SyncCompression.compressGoogle(vector.plaintext)
            let cloudKit = try SyncCompression.compressCloudKit(vector.plaintext)
            XCTAssertEqual(google, hex(vector.googleHex), vector.name)
            XCTAssertEqual(cloudKit.base64EncodedString(), vector.cloudKitBase64, vector.name)
            XCTAssertEqual(Data(try SyncCompression.decompressGoogle(hex(vector.googleHex)).utf8), Data(vector.plaintext.utf8), vector.name)
            XCTAssertEqual(Data(try SyncCompression.decompressCloudKit(XCTUnwrap(Data(base64Encoded: vector.cloudKitBase64))).utf8), Data(vector.plaintext.utf8), vector.name)
        }
    }

    func testBundledSourceMatchesFrozenInstalledVersion() throws {
        let fixture = try fixture()
        XCTAssertEqual(fixture.packageVersion, "1.5.0")
        let expectedHash = "95f4d1cbf099f57161b664bc048426ec3df92637801a4c79116e83315aa787e7"
        XCTAssertEqual(fixture.sourceSHA256, expectedHash)
        let bundled = try XCTUnwrap(Bundle.main.url(forResource: "lz-string.min", withExtension: "js"))
        for url in [bundled, root.appendingPathComponent("shared/vendor/lz-string/1.5.0/lz-string.min.js")] {
            let hash = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(hash, expectedHash)
        }
    }

    func testCloudKitCompressedSurrogateUnitsAreRetainedAsBytes() throws {
        var containsSurrogate = false
        for vector in try fixture().vectors {
            let bytes = try XCTUnwrap(Data(base64Encoded: vector.cloudKitBase64))
            for offset in stride(from: 0, to: bytes.count, by: 2) {
                let unit = UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
                if (0xD800...0xDFFF).contains(unit) { containsSurrogate = true }
            }
            XCTAssertEqual(try SyncCompression.compressCloudKit(vector.plaintext), bytes)
        }
        XCTAssertTrue(containsSurrogate, "Frozen compressed vectors must cover arbitrary UTF-16 code units")
    }

    func testCorpusAfterDecompressionMatchesSharedSnapshot() throws {
        let vector = try XCTUnwrap(fixture().vectors.first { $0.name == "sync-corpus" })
        let corpus = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json")))
        let google = try SyncCompression.decompressGoogle(hex(vector.googleHex))
        let cloudKit = try SyncCompression.decompressCloudKit(XCTUnwrap(Data(base64Encoded: vector.cloudKitBase64)))
        XCTAssertEqual(try OrderedJSON.decode(Data(google.utf8)), corpus["syncSnapshot"])
        XCTAssertEqual(try OrderedJSON.decode(Data(cloudKit.utf8)), corpus["syncSnapshot"])
    }

    func testDecompressionFailuresThrow() {
        for invalid in [Data(), Data([255]), Data([255, 255])] {
            XCTAssertThrowsError(try SyncCompression.decompressGoogle(invalid))
            XCTAssertThrowsError(try SyncCompression.decompressCloudKit(invalid))
        }
    }
}
