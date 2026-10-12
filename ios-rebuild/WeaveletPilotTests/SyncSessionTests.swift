import XCTest
import CryptoKit
@testable import WeaveletPilot

final class SyncSessionTests: XCTestCase {
    private var root: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func fixture() throws -> OrderedJSON { try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/google-session-wire.json"))) }
    private func store() -> SyncStateStore { SyncStateStore(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state.json")) }
    private func sameRecords(_ left: OrderedJSON, _ right: OrderedJSON) throws {
        XCTAssertEqual(Data(try SyncRecords.canonical(left).utf8), Data(try SyncRecords.canonical(right).utf8))
    }
    private func edit(_ snapshot: OrderedJSON, systemMessage: String) throws -> OrderedJSON {
        try snapshot.replacing("state", with: snapshot.required("state").replacing("defaultSystemMessage", with: .string(systemMessage)))
    }
    private func syncRecordsProjection(_ records: OrderedJSON) throws -> OrderedJSON {
        let policy = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/sync-local-settings-policy.json")))
        XCTAssertEqual(policy["fixtureVersion"], .number("1"))
        let keys = try policy.required("syncLocalSettings").array("policy").map { Data(try $0.string("key").utf8) }
        return .object(try records.object("records").filter { field in
            let path = try OrderedJSON.decode(Data(field.key.utf8)).array("record path")
            guard path.count >= 2, path[0] == .string("state") else { return true }
            return try !keys.contains(Data(path[1].string("root").utf8))
        })
    }
    private func editMetadata(_ snapshot: OrderedJSON, origin: String) throws -> OrderedJSON {
        let state = try snapshot.required("state")
        let node = try state.required("chats").array("chats")[0].required("branchTree").required("nodes").required("right")
        let hash = try node.required("contentHash").string("hash"), content = try state.required("contentStore")
        return snapshot.replacing("state", with: state.replacing("contentStore", with: try content.replacing(hash, with: content.required(hash).replacing("xFuture", with: .object([JSONField(key: "origin", value: .string(origin))])))))
    }

    func testAtomicStateStoreCoordinatesSeparateInstancesAndRejectsStaleBaseline() async throws {
        let fileURL = store().fileURL
        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<20 {
                group.addTask {
                    let store = SyncStateStore(fileURL: fileURL)
                    try store.transaction(dataset: "FAKE dataset \(index)", expectedCache: .null, cache: .syncBytes(Data([UInt8(index)])),
                                          entries: [], remove: [], accepted: .object([JSONField(key: "version", value: .number("1"))]))
                }
            }
            try await group.waitForAll()
        }
        let saved = try OrderedJSON.decode(Data(contentsOf: fileURL))
        XCTAssertEqual(try saved.required("datasets").object("datasets").count, 20)
        let first = SyncStateStore(fileURL: fileURL), second = SyncStateStore(fileURL: fileURL)
        let dataset = "FAKE dataset 0", original = try XCTUnwrap(first.dataset(dataset)["cache"])
        try first.transaction(dataset: dataset, expectedCache: original, cache: .syncBytes(Data([99])), entries: [], remove: [], accepted: nil)
        XCTAssertThrowsError(try second.transaction(dataset: dataset, expectedCache: original, cache: .syncBytes(Data([42])), entries: [], remove: [], accepted: .null))
        XCTAssertEqual(try second.dataset(dataset)["cache"], .syncBytes(Data([99])))
        XCTAssertEqual(try second.acceptedSnapshot(dataset: dataset), .object([JSONField(key: "version", value: .number("1"))]))
        let malformed = OrderedJSON.object([JSONField(key: "version", value: .number("1")), JSONField(key: "datasets", value: .object([JSONField(key: dataset, value: .array([]))]))])
        let corruptedBytes = try malformed.encoded(); try corruptedBytes.write(to: fileURL, options: .atomic)
        XCTAssertThrowsError(try first.dataset(dataset))
        XCTAssertThrowsError(try first.transaction(dataset: dataset, expectedCache: .null, cache: .syncBytes(Data([9])), entries: [], remove: [], accepted: nil))
        XCTAssertEqual(try Data(contentsOf: fileURL), corruptedBytes)
    }

    func testWebMultipartInlineHistoryNativePackPublicationAndRestart() async throws {
        let fixture = try fixture(), keys = TestSyncKeys(), drive = try FakeSyncDrive(capture: fixture.required("history")), store = store()
        let dataset = try fixture.required("dataset").string("dataset")
        let session = try SyncSession(drive: drive, store: store, keyStore: keys)
        try await session.open(dataset: dataset)
        try await session.unlock(password: fixture.required("password").string("password"))
        let received = try await session.receiveAndSave()
        try sameRecords(SyncRecords.toRecords(received), syncRecordsProjection(fixture.required("expectedRecords")))
        try sameRecords(SyncRecords.toRecords(XCTUnwrap(store.acceptedSnapshot(dataset: dataset))), syncRecordsProjection(fixture.required("expectedRecords")))
        let changed = try edit(received, systemMessage: "FAKE Native compacted system message")
        try await session.push(changed)
        let packs = try await drive.call("packs", args: [.string(dataset)]).array("packs")
        XCTAssertFalse(packs.isEmpty)
        let remainingCommits = try await drive.call("commits", args: [.string(dataset)]).array("commits")
        XCTAssertEqual(remainingCommits.count, 0)
        try await session.close()
        let resumed = try SyncSession(drive: drive, store: SyncStateStore(fileURL: store.fileURL), keyStore: keys)
        try await resumed.open(dataset: dataset)
        let restoredKey = try await resumed.restoreKey()
        XCTAssertTrue(restoredKey)
        let restored = try await resumed.receiveAndSave()
        try sameRecords(SyncRecords.toRecords(restored), SyncRecords.toRecords(changed))
        let count = await drive.putCount()
        try await resumed.push(restored)
        let afterCount = await drive.putCount()
        XCTAssertEqual(afterCount, count)
        let output = OrderedJSON.object([JSONField(key: "dataset", value: .string(dataset)), JSONField(key: "password", value: try fixture.required("password")),
            JSONField(key: "capture", value: await drive.capture()), JSONField(key: "expectedRecords", value: try SyncRecords.toRecords(restored))])
        try output.encoded().write(to: URL(fileURLWithPath: "/private/tmp/weavelet-native-session-pack-output.json"), options: .atomic)
    }

    func testNativeCreateLostResponseAndInterruptedUploadResumeSameCiphertext() async throws {
        let fixture = try fixture()
        for kind in ["part", "commit"] {
            let drive = FakeSyncDrive(), store = store(), keys = TestSyncKeys()
            let session = try SyncSession(drive: drive, store: store, keyStore: keys)
            let folder = try await session.create(password: fixture.required("password").string("password"), partBytes: 128)
            let dataset = try folder.required("id").string("dataset")
            await drive.loseResponse(kind: kind)
            do { try await session.push(fixture.required("snapshot"), replace: true); XCTFail("Expected response loss") } catch {}
            let before = await drive.capture()
            XCTAssertNotNil(try store.dataset(dataset)["cache"])
            let resumed = try SyncSession(drive: drive, store: SyncStateStore(fileURL: store.fileURL), keyStore: keys)
            try await resumed.open(dataset: dataset, partBytes: 128)
            let restoredKey = try await resumed.restoreKey()
        XCTAssertTrue(restoredKey)
            try await resumed.push(fixture.required("snapshot"), replace: true)
            let after = await drive.capture()
            for file in try before.required("files").array("files") {
                let id = try file.required("id").string("id")
                let stored = try XCTUnwrap(after.required("files").array("files").first { $0["id"] == .string(id) })
                XCTAssertEqual(stored["bytes"], file["bytes"], "Retry must preserve immutable ciphertext")
            }
            let retried = await drive.didRetryIdenticalUpload()
            XCTAssertTrue(retried)
            let restored = try await resumed.receiveAndSave()
            try sameRecords(SyncRecords.toRecords(restored), SyncRecords.toRecords(fixture.required("snapshot")))
            if kind == "commit" {
                let output = OrderedJSON.object([JSONField(key: "dataset", value: .string(dataset)), JSONField(key: "password", value: try fixture.required("password")),
                    JSONField(key: "capture", value: after), JSONField(key: "expectedRecords", value: try SyncRecords.toRecords(restored))])
                try output.encoded().write(to: URL(fileURLWithPath: "/private/tmp/weavelet-native-session-create-output.json"), options: .atomic)
            }
        }
    }

    func testCancellationPreservesDurableOutboxForRestart() async throws {
        let fixture = try fixture(), drive = FakeSyncDrive(), store = store(), keys = TestSyncKeys()
        let session = try SyncSession(drive: drive, store: store, keyStore: keys)
        let folder = try await session.create(password: fixture.required("password").string("password"), partBytes: 128)
        let dataset = try folder.required("id").string("dataset"), snapshot = try fixture.required("snapshot")
        await drive.pauseUpload(kind: "part")
        let upload = Task { try await session.push(snapshot, replace: true) }
        await drive.waitUntilPaused(); upload.cancel()
        do { try await upload.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("Expected native cancellation, received \(error)") }
        let cached = try store.dataset(dataset).required("cache").syncData()
        let key = try XCTUnwrap(keys.load(dataset: dataset))
        XCTAssertNotNil(try SyncRecords.decodeWire(SyncCrypto.decrypt(key: key, bytes: cached, context: "\(dataset):cache"))["pending"])
        let resumed = try SyncSession(drive: drive, store: SyncStateStore(fileURL: store.fileURL), keyStore: keys)
        try await resumed.open(dataset: dataset, partBytes: 128)
        let restoredKey = try await resumed.restoreKey(); XCTAssertTrue(restoredKey)
        try await resumed.push(snapshot, replace: true)
        let received = try await resumed.receiveAndSave()
        try sameRecords(SyncRecords.toRecords(received), SyncRecords.toRecords(snapshot))
    }

    func testWebMessageAttributesAndNativeConflictRemapPreserveOpaqueFields() async throws {
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/google-message-attributes-wire.json")))
        let drive = try FakeSyncDrive(capture: fixture.required("capture")), keys = TestSyncKeys()
        let dataset = try fixture.required("dataset").string("dataset")
        let a = try SyncSession(drive: drive, store: store(), keyStore: keys), bStore = store()
        let b = try SyncSession(drive: drive, store: bStore, keyStore: keys)
        for session in [a, b] { try await session.open(dataset: dataset); try await session.unlock(password: fixture.required("password").string("password")) }
        let left = try await a.receiveAndSave(), right = try await b.receiveAndSave()
        try sameRecords(SyncRecords.toRecords(left), syncRecordsProjection(fixture.required("expectedRecords")))
        let captured = try left.required("state").required("chats").array("chats")[0].required("branchTree").required("messageAttributesV1").required("byNode")
        try sameRecords(captured, fixture.required("expectedAttributes"))
        func changed(_ source: OrderedJSON, side: String) throws -> OrderedJSON {
            let state = try source.required("state"); var chats = try state.required("chats").array("chats")
            let tree = try chats[0].required("branchTree"), attributes = try tree.required("messageAttributesV1"), byNode = try attributes.required("byNode")
            let extra = try byNode.required("b").replacing("xNativeSide", with: .string(side))
            chats[0] = chats[0].replacing("branchTree", with: tree.replacing("messageAttributesV1", with: attributes.replacing("byNode", with: byNode.replacing("b", with: extra))))
            return source.replacing("state", with: state.replacing("chats", with: .array(chats)))
        }
        let local = try changed(left, side: "FAKE Local"), cloud = try changed(right, side: "FAKE Cloud")
        try await a.push(local)
        do { try await b.push(cloud); XCTFail("Expected message attributes conflict") }
        catch let error as SyncSessionError { XCTAssertFalse(error.conflictKeys.isEmpty) }
        let resolved = try await b.resolveAndSave(cloud, mode: "merge")
        let tree = try resolved.required("state").required("chats").array("chats")[0].required("branchTree")
        let remapped = try tree.required("messageAttributesV1").required("byNode").object("byNode")
        for side in ["FAKE Local", "FAKE Cloud"] {
            let attributes = try XCTUnwrap(remapped.first { $0.value["xNativeSide"] == .string(side) })
            XCTAssertNotNil(tree["nodes"]?[attributes.key])
            XCTAssertEqual(attributes.value["xFuture"], fixture["expectedAttributes"]?["b"]?["xFuture"])
            XCTAssertEqual(attributes.value["xNullable"], .null)
        }
        try sameRecords(SyncRecords.toRecords(XCTUnwrap(bStore.acceptedSnapshot(dataset: dataset))), SyncRecords.toRecords(resolved))
        let output = OrderedJSON.object([JSONField(key: "dataset", value: .string(dataset)), JSONField(key: "password", value: try fixture.required("password")),
            JSONField(key: "capture", value: await drive.capture()), JSONField(key: "expectedRecords", value: try SyncRecords.toRecords(resolved))])
        try output.encoded().write(to: URL(fileURLWithPath: "/private/tmp/weavelet-native-session-attributes-output.json"), options: .atomic)
    }

    func testConflictingMetadataKeepsBothBranchesAndAcceptedBaseline() async throws {
        let fixture = try fixture(), drive = try FakeSyncDrive(capture: fixture.required("small")), keys = TestSyncKeys()
        let dataset = try fixture.required("dataset").string("dataset")
        let aStore = store(), bStore = store()
        let a = try SyncSession(drive: drive, store: aStore, keyStore: keys), b = try SyncSession(drive: drive, store: bStore, keyStore: keys)
        for session in [a, b] { try await session.open(dataset: dataset); try await session.unlock(password: fixture.required("password").string("password")) }
        let aBase = try await a.receiveAndSave(), bBase = try await b.receiveAndSave()
        let local = try editMetadata(aBase, origin: "FAKE Local metadata"), cloud = try editMetadata(bBase, origin: "FAKE Cloud metadata")
        try await a.push(local)
        do { try await b.push(cloud); XCTFail("Expected conflict") }
        catch let error as SyncSessionError { XCTAssertFalse(error.conflictKeys.isEmpty) }
        let resolved = try await b.resolveAndSave(cloud, mode: "merge")
        let entries = try resolved.required("state").required("contentStore").object("store")
        XCTAssertTrue(entries.contains { $0.value["xFuture"]?["origin"] == .string("FAKE Local metadata") })
        XCTAssertTrue(entries.contains { $0.value["xFuture"]?["origin"] == .string("FAKE Cloud metadata") })
        try sameRecords(SyncRecords.toRecords(XCTUnwrap(bStore.acceptedSnapshot(dataset: dataset))), SyncRecords.toRecords(resolved))
        let before = await drive.putCount(); try await b.push(resolved)
        let after = await drive.putCount(); XCTAssertEqual(after, before)
    }

    func testResolutionFinalAcceptFailureKeepsInputBaselineAndRestartDoesNotUndoEdits() async throws {
        let fixture = try fixture(), drive = try FakeSyncDrive(capture: fixture.required("small")), keys = TestSyncKeys()
        let dataset = try fixture.required("dataset").string("dataset"), fault = SaveFault()
        let location = store().fileURL
        let resolverStore = SyncStateStore(fileURL: location) { bytes, url in
            if fault.rejectAccepted, String(decoding: bytes, as: UTF8.self).contains("FAKE cloud merged marker") { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to: url, options: .atomic)
        }
        let resolver = try SyncSession(drive: drive, store: resolverStore, keyStore: keys)
        let cloud = try SyncSession(drive: drive, store: store(), keyStore: keys)
        for session in [resolver, cloud] { try await session.open(dataset: dataset); try await session.unlock(password: fixture.required("password").string("password")) }
        let base = try await resolver.receiveAndSave(), cloudBase = try await cloud.receiveAndSave()
        let cloudEdit = try cloudBase.replacing("state", with: cloudBase.required("state").replacing("xCloud", with: .string("FAKE cloud merged marker")))
        try await cloud.push(cloudEdit)
        let input = try edit(base, systemMessage: "FAKE local resolution edit")
        fault.rejectAccepted = true
        do { _ = try await resolver.resolveAndSave(input, mode: "merge"); XCTFail("Expected final acceptance write failure") } catch {}
        let accepted = try XCTUnwrap(resolverStore.acceptedSnapshot(dataset: dataset))
        try sameRecords(SyncRecords.toRecords(accepted), SyncRecords.toRecords(input))
        let cache = try resolverStore.dataset(dataset).required("cache").syncData(), key = try XCTUnwrap(keys.load(dataset: dataset))
        let baseline = try SyncRecords.decodeWire(SyncCrypto.decrypt(key: key, bytes: cache, context: "\(dataset):cache")).required("baseline")
        let expected = try OrderedJSON.object(SyncRecords.toRecords(input).object("records").map { field in
            JSONField(key: field.key, value: .string(SyncRecords.digest(try field.value.string("record"))))
        })
        try sameRecords(baseline, expected)
        fault.rejectAccepted = false
        let restarted = try SyncSession(drive: drive, store: SyncStateStore(fileURL: location), keyStore: keys)
        try await restarted.open(dataset: dataset); let restoredKey = try await restarted.restoreKey(); XCTAssertTrue(restoredKey)
        let publications = await drive.putCount(); try await restarted.push(accepted)
        let afterPush = await drive.putCount(); XCTAssertEqual(afterPush, publications, "Restart must not publish an inverse edit")
        let remote = try await restarted.receiveAndSave()
        XCTAssertEqual(remote["state"]?["defaultSystemMessage"], .string("FAKE local resolution edit"))
        XCTAssertEqual(remote["state"]?["xCloud"], .string("FAKE cloud merged marker"))
    }

    func testReceiveSaveFailureKeepsPreviousStateAndBaselineThenRetries() async throws {
        let fixture = try fixture(), drive = try FakeSyncDrive(capture: fixture.required("small")), keys = TestSyncKeys()
        let dataset = try fixture.required("dataset").string("dataset"), fault = SaveFault()
        let location = store().fileURL
        let readerStore = SyncStateStore(fileURL: location) { bytes, url in
            if fault.rejectAccepted, String(decoding: bytes, as: UTF8.self).contains("FAKE remote changed") { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to: url, options: .atomic)
        }
        let reader = try SyncSession(drive: drive, store: readerStore, keyStore: keys)
        let writer = try SyncSession(drive: drive, store: store(), keyStore: keys)
        for session in [reader, writer] { try await session.open(dataset: dataset); try await session.unlock(password: fixture.required("password").string("password")) }
        let previous = try await reader.receiveAndSave(), base = try await writer.receiveAndSave()
        let oldCache = try XCTUnwrap(readerStore.dataset(dataset)["cache"]).syncData()
        let key = try XCTUnwrap(keys.load(dataset: dataset))
        let oldBaseline = try SyncRecords.decodeWire(SyncCrypto.decrypt(key: key, bytes: oldCache, context: "\(dataset):cache"))["baseline"]
        try await writer.push(edit(base, systemMessage: "FAKE remote changed"))
        fault.rejectAccepted = true
        do { _ = try await reader.receiveAndSave(); XCTFail("Expected atomic write failure") } catch {}
        XCTAssertEqual(try readerStore.acceptedSnapshot(dataset: dataset), previous)
        let cache = try XCTUnwrap(readerStore.dataset(dataset)["cache"]).syncData()
        XCTAssertEqual(try SyncRecords.decodeWire(SyncCrypto.decrypt(key: key, bytes: cache, context: "\(dataset):cache"))["baseline"], oldBaseline)
        fault.rejectAccepted = false
        let resumed = try SyncSession(drive: drive, store: readerStore, keyStore: keys)
        try await resumed.open(dataset: dataset); let restoredKey = try await resumed.restoreKey()
        XCTAssertTrue(restoredKey)
        let accepted = try await resumed.receiveAndSave()
        XCTAssertEqual(accepted["state"]?["defaultSystemMessage"], .string("FAKE remote changed"))
        let before = await drive.putCount(); try await resumed.push(accepted)
        let after = await drive.putCount(); XCTAssertEqual(after, before)
    }
}

private final class SaveFault: @unchecked Sendable { var rejectAccepted = false }
final class TestSyncKeys: SyncKeyStore, @unchecked Sendable {
    private let lock = NSLock(); private var values: [String: SymmetricKey] = [:]
    func load(dataset: String) throws -> SymmetricKey? { lock.lock(); defer { lock.unlock() }; return values[dataset] }
    func save(_ key: SymmetricKey, dataset: String) throws { lock.lock(); defer { lock.unlock() }; values[dataset] = key }
}

actor FakeSyncDrive: SyncDrive {
    private var next = 0
    private var files = OrderedJSON.object([])
    private var events: [OrderedJSON] = []
    private var lostKind: String?
    private var attempts: [String] = []
    private var identicalRetry = false
    private var pauseKind: String?
    private var hasPaused = false
    private var paused: CheckedContinuation<Void, Never>?
    init() {}
    init(capture: OrderedJSON) throws {
        next = Int(try capture.required("next").number("next"))
        for file in try capture.required("files").array("files") { files = try files.replacing(file.required("id").string("id"), with: file) }
        events = try capture.required("events").array("events")
    }
    func loseResponse(kind: String) { lostKind = kind }
    func pauseUpload(kind: String) { pauseKind = kind; hasPaused = false }
    func waitUntilPaused() async {
        if !hasPaused { await withCheckedContinuation { paused = $0 } }
    }
    func didRetryIdenticalUpload() -> Bool { identicalRetry }
    func putCount() -> Int { attempts.count }
    func capture() -> OrderedJSON { .object([JSONField(key: "next", value: .number(String(next))), JSONField(key: "files", value: .array((try! files.object("files")).map(\.value))), JSONField(key: "events", value: .array(events))]) }
    func call(_ method: String, args: [OrderedJSON]) async throws -> OrderedJSON {
        switch method {
        case "ids":
            return .array((0..<Int(try args[0].number("count"))).map { _ in next += 1; return .string("fake\(next)") })
        case "folder":
            let id = try args[0].string("id")
            let metadata = OrderedJSON.object([JSONField(key: "id", value: .string(id)), JSONField(key: "mimeType", value: .string("application/vnd.google-apps.folder")),
                JSONField(key: "appProperties", value: .object([JSONField(key: "weaveletSync", value: .string("1")), JSONField(key: "headerId", value: args[1])]))])
            files = files.replacing(id, with: .object([JSONField(key: "id", value: .string(id)), JSONField(key: "metadata", value: metadata), JSONField(key: "bytes", value: .array([]))])); return metadata
        case "metadata", "read":
            guard let file = try files[args[0].string("id")] else { throw DriveTransportError.notFound }
            return try file.required(method == "read" ? "bytes" : "metadata")
        case "put":
            let id = try args[0].string("id"), kind = try args[2].string("kind")
            attempts.append(id)
            if pauseKind == kind {
                pauseKind = nil; hasPaused = true; paused?.resume(); paused = nil
                try await Task.sleep(nanoseconds: 30_000_000_000)
            }
            if let old = files[id] {
                guard old["bytes"] == args[3] else { throw DriveTransportError.collision }
                identicalRetry = true; return .null
            }
            let metadata = OrderedJSON.object([JSONField(key: "id", value: args[0]), JSONField(key: "mimeType", value: .string("application/octet-stream")),
                JSONField(key: "appProperties", value: .object([JSONField(key: "dataset", value: args[1]), JSONField(key: "kind", value: args[2])]))])
            files = files.replacing(id, with: .object([JSONField(key: "id", value: args[0]), JSONField(key: "metadata", value: metadata), JSONField(key: "bytes", value: args[3])]))
            events.append(.object([JSONField(key: "fileId", value: args[0]), JSONField(key: "file", value: metadata)]))
            if lostKind == kind { lostKind = nil; throw URLError(.networkConnectionLost) }; return .null
        case "startToken": return .string(String(events.count))
        case "commits", "packs":
            let kind = method == "commits" ? "commit" : "pack"
            return .array(try files.object("files").filter { $0.value["metadata"]?["appProperties"]?["dataset"] == args[0] && $0.value["metadata"]?["appProperties"]?["kind"] == .string(kind) }.map { .string($0.key) })
        case "changes":
            let token = Int(try args[0].string("token"))!
            return .object([JSONField(key: "token", value: .string(String(events.count))), JSONField(key: "changes", value: .array(Array(events.dropFirst(token))))])
        case "remove":
            let id = try args[0].string("id")
            if files[id] != nil {
                files = .object(try files.object("files").filter { !$0.key.utf8.elementsEqual(id.utf8) })
                events.append(.object([JSONField(key: "fileId", value: .string(id)), JSONField(key: "removed", value: .bool(true))]))
            }; return .null
        default: throw DriveTransportError.invalidResponse
        }
    }
}
