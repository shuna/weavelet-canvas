import XCTest
import CryptoKit
@testable import WeaveletPilot

final class DriveTransportTests: XCTestCase {
    private func transport(_ handler: @escaping (URLRequest) throws -> (Int, Data), token: @escaping @Sendable (Bool) async throws -> String = { _ in "FAKE TOKEN" }) -> DriveTransport {
        DriveURLProtocol.handler = handler
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [DriveURLProtocol.self]
        return DriveTransport(session: URLSession(configuration: config), token: token)
    }
    override func tearDown() { DriveURLProtocol.handler = nil; super.tearDown() }
    private func json(_ value: String) -> Data { Data(value.utf8) }

    func testSharedSessionOpenUnlockUsesNativeMetadataAndRejectsLegacyFoldersBeforeReadingKeys() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-drive-open-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let password = "FAKE TEST ONLY native metadata passphrase"
        let created = try SyncCrypto.createKeyEnvelope(password: password, dataset: "FAKE-dataset")
        let header = try JSONEncoder().encode(created.envelope)
        var metadata = "{\"id\":\"FAKE-dataset\",\"mimeType\":\"application/vnd.google-apps.folder\",\"appProperties\":{\"weaveletSync\":\"1\",\"headerId\":\"FAKE-header\"}}"
        var mediaReads = 0
        let drive = transport { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE TOKEN")
            if request.url?.path.hasSuffix("FAKE-header") == true {
                mediaReads += 1
                XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "alt" }?.value, "media")
                return (200, header)
            }
            XCTAssertEqual(request.url?.path, "/drive/v3/files/FAKE-dataset")
            return (200, self.json(metadata))
        }
        let keys = DriveTestKeys()
        let session = try SyncSession(drive: drive, store: SyncStateStore(fileURL: directory.appendingPathComponent("state.json")), keyStore: keys)
        try await session.open(dataset: "FAKE-dataset")
        try await session.unlock(password: password)
        XCTAssertEqual(mediaReads, 1)
        XCTAssertNotNil(try keys.load(dataset: "FAKE-dataset"))
        for invalid in [
            "{\"mimeType\":\"application/json\",\"appProperties\":{\"weaveletSync\":\"1\",\"headerId\":\"FAKE-header\"}}",
            "{\"mimeType\":\"application/vnd.google-apps.folder\",\"appProperties\":{\"headerId\":\"FAKE-header\"}}",
            "{\"mimeType\":\"application/vnd.google-apps.folder\",\"appProperties\":{\"weaveletSync\":\"1\"}}",
            "{\"trashed\":true,\"mimeType\":\"application/vnd.google-apps.folder\",\"appProperties\":{\"weaveletSync\":\"1\",\"headerId\":\"FAKE-header\"}}"
        ] {
            metadata = invalid
            try await session.open(dataset: "FAKE-dataset")
            do { try await session.unlock(password: password); XCTFail("Invalid folder accepted") } catch {}
            XCTAssertEqual(mediaReads, 1)
        }
    }
    func testTokenRefreshPaginationAndGeneratedIDsUseNativeRequests() async throws {
        let drive = transport({ request in
            XCTAssertEqual(request.url?.host, "www.googleapis.com")
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer FAKE EXPIRED" { return (401, Data()) }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE REFRESHED")
            let parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            if parts.path.hasSuffix("generateIds") { return (200, self.json("{\"ids\":[\"FAKE-id-a\",\"FAKE-id-b\"]}")) }
            let query = parts.queryItems?.first { $0.name == "q" }?.value
            XCTAssertTrue(query?.contains("kind' and value='commit") == true)
            if parts.queryItems?.contains(where: { $0.name == "pageToken" }) == true { return (200, self.json("{\"files\":[{\"id\":\"FAKE-second\"}]}")) }
            return (200, self.json("{\"nextPageToken\":\"FAKE-next\",\"files\":[{\"id\":\"FAKE-first\"}]}"))
        }, token: { force in force ? "FAKE REFRESHED" : "FAKE EXPIRED" })
        let ids = try await drive.call("ids", args: [.number("2")])
        XCTAssertEqual(ids, .array([.string("FAKE-id-a"), .string("FAKE-id-b")]))
        let commits = try await drive.call("commits", args: [.string("FAKE dataset")])
        XCTAssertEqual(commits, .array([.string("FAKE-first"), .string("FAKE-second")]))
    }
    func testLostUploadResponseCollisionVerificationAndDelete404() async throws {
        let bytes = Data([0, 1, 2, 255])
        let drive = transport { request in
            if request.httpMethod == "POST" {
                XCTAssertEqual(request.url?.host, "www.googleapis.com")
                XCTAssertEqual(request.url?.path, "/upload/drive/v3/files")
                let body = try XCTUnwrap(request.httpBody ?? request.httpBodyStream.map { stream in
                    stream.open(); defer { stream.close() }; var result = Data(); var buffer = [UInt8](repeating: 0, count: 1024)
                    while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count > 0 { result.append(buffer, count: count) } else { break } }; return result
                })
                XCTAssertTrue(body.range(of: Data("\"parents\":[\"FAKE dataset\"]".utf8)) != nil)
                XCTAssertTrue(body.range(of: bytes) != nil)
                return (409, Data())
            }
            if request.httpMethod == "DELETE" { return (404, Data()) }
            XCTAssertEqual(request.url?.path, "/drive/v3/files/FAKE-id")
            return (200, bytes)
        }
        _ = try await drive.call("put", args: [.string("FAKE-id"), .string("FAKE dataset"), .string("commit"), .syncBytes(bytes)])
        _ = try await drive.call("remove", args: [.string("FAKE-id")])
        let collision = transport { request in request.httpMethod == "POST" ? (409, Data()) : (200, Data([9])) }
        do { _ = try await collision.call("put", args: [.string("FAKE-id"), .string("FAKE dataset"), .string("part"), .syncBytes(bytes)]); XCTFail("Expected ciphertext collision") }
        catch { XCTAssertEqual(error as? DriveTransportError, .collision) }
    }
    func testIncompleteListingDuplicateIDsMissingFilesAndHTTPFailuresAreRejected() async throws {
        for (method, response, args) in [
            ("commits", "{\"incompleteSearch\":true,\"files\":[]}", [.string("FAKE dataset")]),
            ("ids", "{\"ids\":[\"FAKE-same\",\"FAKE-same\"]}", [.number("2")])
        ] as [(String, String, [OrderedJSON])] {
            let drive = transport { _ in (200, self.json(response)) }
            do { _ = try await drive.call(method, args: args); XCTFail("Expected invalid response") } catch {}
        }
        let missing = transport { _ in (404, Data()) }
        do { _ = try await missing.call("read", args: [.string("FAKE-missing")]); XCTFail("Expected missing file") }
        catch { XCTAssertEqual(error as? DriveTransportError, .notFound) }
        let failed = transport { _ in (403, Data()) }
        do { _ = try await failed.call("metadata", args: [.string("FAKE-id")]); XCTFail("Expected HTTP failure") }
        catch { XCTAssertEqual(error as? DriveTransportError, .http(403)) }
    }
}

private final class DriveURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, bytes) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: bytes); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private final class DriveTestKeys: SyncKeyStore, @unchecked Sendable {
    private let lock = NSLock()
    private var key: SymmetricKey?
    func load(dataset: String) throws -> SymmetricKey? { lock.lock(); defer { lock.unlock() }; return key }
    func save(_ key: SymmetricKey, dataset: String) throws { lock.lock(); defer { lock.unlock() }; self.key = key }
}
