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

    @MainActor func testLegacyGoogleReadUsesSharedLocatorAndExistingPreviewWithoutChangingState() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = root.appendingPathComponent("tests/fixtures/web-native/legacy-ios-sync-snapshot.wvlt")
        let original = try Data(contentsOf: fixture)
        var raw = original, calls = 0
        let drive = transport { request in
            calls += 1
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.host, "www.googleapis.com")
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            if request.url?.path == "/drive/v3/files" {
                let definition = try ChatImport.call("legacyGoogleSource").required("parameters").object("parameters")
                for field in definition { XCTAssertEqual(query.first { field.key.matches($0.name) }?.value, try field.value.string("parameter")) }
                return (200, self.json("{\"files\":[{\"id\":\"FAKE-legacy\",\"name\":\"weavelet-canvas-sync.wvlt\"}]}"))
            }
            XCTAssertEqual(request.url?.path, "/drive/v3/files/FAKE-legacy")
            XCTAssertEqual(query.first { $0.name == "alt" }?.value, "media")
            return (200, raw)
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-google-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = LocalStateStore(fileURL: directory.appendingPathComponent("state.json")), state = ChatState(store: LocalStateStore(fileURL: directory.appendingPathComponent("state.json")))
        let web = try Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/message-editing.json"))
        try state.importWebData(OrderedJSON.decode(web).required("cases").array("cases")[0].required("input").encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: store.fileURL)
        let syncStore = SyncStateStore(fileURL: directory.appendingPathComponent("sync.json"))
        try syncStore.selectDataset("FAKE-canonical")
        try syncStore.transaction(dataset: "FAKE-canonical", expectedCache: .null, cache: .syncBytes(Data([1, 2, 255])), entries: [], remove: [], accepted: state.syncInputSnapshot())
        let syncDisk = try Data(contentsOf: syncStore.fileURL)
        let connection = GoogleSyncConnection(state: state, store: syncStore), dataset = connection.controller.dataset
        let preview = try await connection.prepareLegacyIOSImport(reader: drive)
        XCTAssertFalse(preview.conversations.isEmpty)
        XCTAssertEqual(connection.legacySnapshot, original)
        XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        XCTAssertEqual(connection.controller.dataset, dataset)
        XCTAssertEqual(try Data(contentsOf: syncStore.fileURL), syncDisk)
        raw = Data([0, 1, 2, 255])
        do { _ = try await connection.prepareLegacyIOSImport(reader: drive); XCTFail("Corrupt container accepted") } catch {}
        XCTAssertEqual(connection.legacySnapshot, raw)
        XCTAssertEqual(try state.publicationSnapshot(), before); XCTAssertEqual(try Data(contentsOf: store.fileURL), disk)
        XCTAssertEqual(connection.controller.dataset, dataset)
        XCTAssertEqual(try Data(contentsOf: syncStore.fileURL), syncDisk)
        XCTAssertEqual(calls, 4); XCTAssertEqual(try Data(contentsOf: fixture), original)
    }
    func testLegacyGoogleSkipsEmptyPagesAndRejectsRepeatedCursor() async throws {
        var calls = 0
        let drive = transport { request in
            calls += 1
            XCTAssertEqual(request.httpMethod, "GET")
            if calls == 1 { return (200, self.json("{\"files\":[],\"nextPageToken\":\"FAKE-next\"}")) }
            if calls == 2 {
                XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "pageToken" }?.value, "FAKE-next")
                return (200, self.json("{\"files\":[{\"id\":\"FAKE-first\",\"name\":\"weavelet-canvas-sync.wvlt\"}],\"nextPageToken\":\"more\"}"))
            }
            XCTAssertEqual(request.url?.path, "/drive/v3/files/FAKE-first")
            return (200, Data([0, 1, 255]))
        }
        let bytes = try await drive.readLegacyIOSSnapshot()
        XCTAssertEqual(bytes, Data([0, 1, 255])); XCTAssertEqual(calls, 3)
        let repeatPage = transport { _ in (200, self.json("{\"files\":[],\"nextPageToken\":\"same\"}")) }
        do { _ = try await repeatPage.readLegacyIOSSnapshot(); XCTFail("Repeated cursor accepted") }
        catch { XCTAssertEqual(error as? DriveTransportError, .invalidResponse) }
    }
    func testLegacyGoogleAbsentIncompleteAndCancelledReadsCannotDownloadOrWrite() async throws {
        for body in ["{\"files\":[]}", "{\"files\":[],\"incompleteSearch\":true}", "{\"files\":[{\"id\":\"wrong\",\"name\":\"other\"}]}"] {
            var calls = 0
            let drive = transport { request in
                calls += 1; XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.url?.path, "/drive/v3/files")
                return (200, self.json(body))
            }
            do { _ = try await drive.readLegacyIOSSnapshot(); XCTFail("Invalid/absent source accepted") } catch {}
            XCTAssertEqual(calls, 1)
        }
        let drive = transport { _ in XCTFail("Cancelled migration sent a request"); return (500, Data()) }
        let task = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await drive.readLegacyIOSSnapshot() }
        do { _ = try await task.value; XCTFail() } catch {}
    }

    func testStructuredInvalidFileIDCrossesNativeHTTPBoundaryWithoutExposingResponseText() async throws {
        for location in ["fileId", "parameter fileId", "parentId"] {
            let response = json("{\"error\":{\"message\":\"FAKE PRIVATE RESPONSE\",\"errors\":[{\"location\":\"\(location)\"}]}}")
            let drive = transport { _ in (400, response) }
            for (method, args) in [("metadata", [OrderedJSON.string("FAKE")]), ("put", [.string("FAKE"), .string("dataset"), .string("part"), .syncBytes(Data([1]))])] {
                do { _ = try await drive.call(method, args: args); XCTFail("HTTP error accepted") }
                catch let error as DriveTransportError {
                    XCTAssertEqual(error, location == "parentId" ? .http(400) : .invalidFileId)
                    XCTAssertFalse(error.localizedDescription.contains("FAKE PRIVATE RESPONSE"))
                }
            }
        }
    }

    func testDatasetListingUsesSharedQueryAndCompletePagination() async throws {
        var requests = 0
        let definition = try SharedWebOperations.call("driveListing", .array([.string("Weavelet encrypted sync"), .string("Weavelet encrypted sync (2)")]))
        XCTAssertEqual(try definition.required("suggestedName").string("name"), "Weavelet encrypted sync (3)")
        let drive = transport { request in
            requests += 1
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            for field in try definition.required("parameters").object("parameters") {
                XCTAssertEqual(query.first { field.key.matches($0.name) }?.value, try field.value.string(field.key.text))
            }
            if requests == 1 { return (200, self.json("{\"files\":[{\"id\":\"FAKE-a\"}],\"nextPageToken\":\"FAKE-next\"}")) }
            XCTAssertEqual(query.first { $0.name == "pageToken" }?.value, "FAKE-next")
            return (200, self.json("{\"files\":[{\"id\":\"FAKE-b\"}]}"))
        }
        let files = try await drive.listDatasets().array("files")
        XCTAssertEqual(files.count, 2); XCTAssertEqual(requests, 2)
        let incomplete = transport { _ in (200, self.json("{\"files\":[],\"incompleteSearch\":true}")) }
        do { _ = try await incomplete.listDatasets(); XCTFail("Incomplete list accepted") }
        catch { XCTAssertEqual(error as? DriveTransportError, .invalidResponse) }
    }

    func testRepeatedListingCursorIsRejected() async throws {
        let drive = transport { _ in (200, self.json("{\"files\":[],\"changes\":[],\"nextPageToken\":\"again\"}")) }
        for method in ["datasets", "commits", "changes"] {
            do {
                if method == "datasets" { _ = try await drive.listDatasets() }
                else { _ = try await drive.call(method, args: [.string("FAKE-start")]) }
                XCTFail("Repeated cursor accepted")
            } catch { XCTAssertEqual(error as? DriveTransportError, .invalidResponse) }
        }
    }

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
        let uploaded = try await drive.call("put", args: [.string("FAKE-id"), .string("FAKE dataset"), .string("commit"), .syncBytes(bytes)])
        XCTAssertEqual(uploaded, .bool(false))
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
