import XCTest
@testable import WeaveletPilot

@MainActor final class GoogleSyncControllerTests: XCTestCase {
    private let password = "FAKE TEST ONLY session passphrase"
    private var root: URL { URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent() }
    private func fixture(_ name: String, _ key: String) throws -> OrderedJSON {
        try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/\(name).json"))).required(key)
    }
    private func directory() throws -> URL {
        let value = FileManager.default.temporaryDirectory.appendingPathComponent("sync-controller-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:value,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:value) }; return value
    }
    private func state(_ store: LocalStateStore) throws -> ChatState {
        let state = ChatState(store:store)
        try state.importWebData(fixture("io-corpus","exportV3").encoded())
        let full = try fixture("io-corpus","syncSnapshot")
        let raw = try full.required("state").replacing("theme",with:.string("LOCAL_THEME"))
            .replacing("xRaw",with:.number("9007199254740993"))
        try state.applySnapshot(full.replacing("state",with:raw))
        return state
    }
    func testCreateManualSyncDisconnectRestoreKeyDownloadPreserveAllLocalRootsAndRawValues() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json"))
        let state = try state(local), drive = FakeSyncDrive(), keys = TestSyncKeys()
        let controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        let before = try state.publicationSnapshot()
        try await controller.create(password:password,folderName:"FAKE folder")
        XCTAssertEqual(controller.status,.ready)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["xRaw"],.number("9007199254740993"))
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["theme"],.string("LOCAL_THEME"))
        XCTAssertNil(try cache.publication(dataset:XCTUnwrap(controller.dataset)))
        let count = await drive.putCount(); try await controller.synchronize()
        let afterCount = await drive.putCount(); XCTAssertEqual(afterCount,count)
        let dataset = try XCTUnwrap(controller.dataset)
        try await controller.disconnect()
        XCTAssertNil(try cache.selectedDataset())
        try await controller.open(dataset:dataset)
        XCTAssertEqual(controller.status,.locked)
        let restored = try await controller.restoreKey(); XCTAssertTrue(restored)
        try await controller.download()
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["theme"],before["state"]?["theme"])
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["xRaw"],before["state"]?["xRaw"])
        XCTAssertNil(try cache.publication(dataset:dataset))
        let fresh = GoogleSyncController(chatState:ChatState(store:local),drive:drive,store:SyncStateStore(fileURL:cache.fileURL),keyStore:keys)
        XCTAssertEqual(fresh.dataset,dataset); XCTAssertEqual(fresh.status,.locked)
    }
    func testWebDriveDownloadLocalSaveFailureRestartRetriesPublicationWithoutReupload() async throws {
        let dir = try directory(), fault = ControllerWriteFault()
        let local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")) { bytes,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let state = try state(local), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")), keys = TestSyncKeys()
        let drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password)
        fault.reject = true
        do { try await controller.download(); XCTFail("save must fail") } catch {}
        XCTAssertEqual(controller.status,.recoveryRequired)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        XCTAssertNotNil(try cache.publication(dataset:"fake1")?.received)
        fault.reject = false
        let restartedState = ChatState(store:local)
        let restarted = GoogleSyncController(chatState:restartedState,drive:drive,store:SyncStateStore(fileURL:cache.fileURL),keyStore:keys)
        let keyRestored = try await restarted.restoreKey(); XCTAssertTrue(keyRestored)
        let count = await drive.putCount(); try await restarted.recover()
        let afterCount = await drive.putCount(); XCTAssertEqual(afterCount,count)
        XCTAssertNil(try cache.publication(dataset:"fake1"))
        XCTAssertEqual(restarted.status,.ready)
        XCTAssertEqual(try restartedState.publicationSnapshot()["state"]?["theme"],.string("LOCAL_THEME"))
    }
    func testBaselineSaveFailureAfterLocalSaveAndRestartAcceptsOnlyPublishedTarget() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), fault = ControllerWriteFault()
        let cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")) { bytes,url in
            if fault.reject, let root = try? OrderedJSON.decode(bytes), let state = root["datasets"]?["fake1"], let accepted = state["accepted"], let publication = state["publication"], publication["received"] != nil {
                // The receive journal is saved before the accepted/baseline transaction.
                if accepted != fault.previousAccepted { throw CocoaError(.fileWriteNoPermission) }
            }
            try bytes.write(to:url,options:.atomic)
        }
        let state = try state(local), drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), keys = TestSyncKeys()
        let controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password)
        fault.previousAccepted = try cache.dataset("fake1")["accepted"]; fault.reject = true
        do { try await controller.download(); XCTFail("baseline save must fail") } catch {}
        XCTAssertEqual(controller.status,.recoveryRequired)
        let published = try state.publicationSnapshot()
        XCTAssertEqual(try cache.publication(dataset:"fake1")?.target,published)
        fault.reject = false
        let fresh = GoogleSyncController(chatState:ChatState(store:local),drive:drive,store:cache,keyStore:keys)
        let keyRestored = try await fresh.restoreKey(); XCTAssertTrue(keyRestored); try await fresh.recover()
        XCTAssertNil(try cache.publication(dataset:"fake1"))
        XCTAssertEqual(try cache.acceptedSnapshot(dataset:"fake1"),published)
    }
    func testNewLocalEditWhileReceivedSaveIsPendingCannotBeReplacedAndExplicitMergeUsesSharedSession() async throws {
        let dir = try directory(), localFault = ControllerWriteFault()
        let local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")) { bytes,url in
            if localFault.reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let state = try state(local), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")), drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), keys = TestSyncKeys()
        let controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password)
        localFault.reject = true
        do { try await controller.download() } catch {}
        localFault.reject = false
        let before = try state.publicationSnapshot()
        try state.applySnapshot(before.replacing("state",with:before.required("state").replacing("defaultSystemMessage",with:.string("NEW LOCAL EDIT"))))
        let edited = try state.publicationSnapshot()
        do { try await controller.recover(); XCTFail("stale receive must not overwrite edits") } catch {}
        XCTAssertEqual(try state.publicationSnapshot(),edited)
        XCTAssertEqual(controller.status,.recoveryRequired)
        try await controller.resolve(.merge)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("NEW LOCAL EDIT"))
        XCTAssertNil(try cache.publication(dataset:"fake1"))
        XCTAssertEqual(controller.status,.ready)
    }
    func testConflictLocalAndCloudChoicesUseSharedProtocolAndPreserveDeviceSettings() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")), drive = FakeSyncDrive(), keys = TestSyncKeys()
        let state = try state(local), controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.create(password:password)
        let dataset = try XCTUnwrap(controller.dataset), remote = try SyncSession(drive:drive,store:SyncStateStore(fileURL:dir.appendingPathComponent("remote.json")),keyStore:keys)
        try await remote.open(dataset:dataset); let remoteKeyRestored = try await remote.restoreKey(); XCTAssertTrue(remoteKeyRestored)
        let downloaded = try await remote.receiveAndSave()
        try await remote.push(downloaded.replacing("state",with:downloaded.required("state").replacing("defaultSystemMessage",with:.string("REMOTE EDIT"))))
        let before = try state.publicationSnapshot()
        try state.applySnapshot(before.replacing("state",with:before.required("state").replacing("defaultSystemMessage",with:.string("LOCAL EDIT"))))
        do { try await controller.synchronize(); XCTFail("concurrent settings must conflict") } catch {}
        XCTAssertEqual(controller.status,.conflict); XCTAssertFalse(controller.conflictKeys.isEmpty)
        try await controller.resolve(.local)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("LOCAL EDIT"))
        let cloud = try await remote.receiveAndSave()
        try await remote.push(cloud.replacing("state",with:cloud.required("state").replacing("defaultSystemMessage",with:.string("CLOUD CHOICE"))))
        try await controller.resolve(.cloud)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("CLOUD CHOICE"))
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["theme"],.string("LOCAL_THEME"))
    }
    func testCancelInterruptedUploadRetainsNewestLocalEditAndDurableRetryUsesFakeDrive() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")), drive = FakeSyncDrive(), keys = TestSyncKeys()
        let state = try state(local), controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.create(password:password)
        let before = try state.publicationSnapshot()
        try state.applySnapshot(before.replacing("state",with:before.required("state").replacing("defaultSystemMessage",with:.string("UPLOAD INPUT"))))
        await drive.pauseUpload(kind:"commit")
        let operation = Task { try await controller.synchronize() }
        await drive.waitUntilPaused()
        let input = try state.publicationSnapshot()
        try state.applySnapshot(input.replacing("state",with:input.required("state").replacing("defaultSystemMessage",with:.string("EDIT DURING UPLOAD"))))
        controller.cancel(); _ = await operation.result
        XCTAssertEqual(controller.status,.recoveryRequired)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("EDIT DURING UPLOAD"))
        XCTAssertFalse(controller.isBusy); XCTAssertTrue(controller.isUnlocked)
        // Recovery preserves its original input; a later edit requires explicit resolution.
        do { try await controller.recover(); XCTFail("changed input must require resolution") } catch {}
        XCTAssertEqual(controller.status,.recoveryRequired)
        try await controller.resolve(.merge)
        XCTAssertEqual(controller.status,.ready)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("EDIT DURING UPLOAD"))
        XCTAssertNil(try cache.publication(dataset:XCTUnwrap(controller.dataset)))
    }

    func testFreshSamplesDownloadUsesSharedEmptySnapshotAndCorruptLoadCannotBeClearedByAlert() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), keys = TestSyncKeys(), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json"))
        let state = ChatState(store:local)
        XCTAssertNil(state.document)
        XCTAssertEqual(try state.syncInputSnapshot().required("state").required("chats"),.array([]))
        let controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password); try await controller.download()
        XCTAssertNotNil(state.document)
        XCTAssertFalse(state.conversations.contains { $0.id.hasPrefix("sample-") })
        let corrupt = Data("broken local document".utf8); try corrupt.write(to:local.fileURL,options:.atomic)
        let broken = ChatState(store:local); XCTAssertNotNil(broken.persistenceError); broken.persistenceError = nil
        let locked = GoogleSyncController(chatState:broken,drive:drive,store:cache,keyStore:keys)
        let restored = try await locked.restoreKey(); XCTAssertTrue(restored)
        do { try await locked.download(); XCTFail("load failure must remain protected") } catch {}
        XCTAssertEqual(try Data(contentsOf:local.fileURL),corrupt)
        XCTAssertNil(broken.document)
        try broken.importWebData(fixture("io-corpus","exportV3").encoded())
        XCTAssertNoThrow(try broken.syncInputSnapshot())
    }

    func testInterruptedDownloadWithoutReceivedResultRequiresResolutionAfterNewEdit() async throws {
        let dir = try directory(), local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json")), drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), keys = TestSyncKeys()
        let state = try state(local), controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password)
        let input = try state.publicationSnapshot()
        let pending = SyncStateStore.Publication(input:input,received:nil,target:nil,mode:"download",replace:false)
        try cache.savePublication(dataset:"fake1",pending)
        try state.applySnapshot(input.replacing("state",with:input.required("state").replacing("defaultSystemMessage",with:.string("EDIT AFTER INTERRUPTED DOWNLOAD"))))
        let edited = try state.publicationSnapshot(), saved = try Data(contentsOf:local.fileURL)
        do { try await controller.recover(); XCTFail("download recovery must not overwrite a later edit") } catch {}
        XCTAssertEqual(controller.status,.recoveryRequired)
        XCTAssertEqual(try state.publicationSnapshot(),edited)
        XCTAssertEqual(try Data(contentsOf:local.fileURL),saved)
        XCTAssertEqual(try cache.publication(dataset:"fake1")?.input,input)
        try await controller.resolve(.merge)
        XCTAssertEqual(try state.publicationSnapshot()["state"]?["defaultSystemMessage"],.string("EDIT AFTER INTERRUPTED DOWNLOAD"))
    }

    func testActiveGenerationIsNeverStoppedByPendingSyncPublication() async throws {
        let dir = try directory(), fault = ControllerWriteFault()
        let local = LocalStateStore(fileURL:dir.appendingPathComponent("local.json")) { bytes,url in
            if fault.reject { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let state = try state(local), drive = try FakeSyncDrive(capture:fixture("google-session-wire","small")), keys = TestSyncKeys(), cache = SyncStateStore(fileURL:dir.appendingPathComponent("sync.json"))
        let controller = GoogleSyncController(chatState:state,drive:drive,store:cache,keyStore:keys)
        try await controller.open(dataset:"fake1"); try await controller.unlock(password:password)
        fault.reject = true; do { try await controller.download() } catch {}; fault.reject = false
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [HeldControllerGeneration.self]
        let client = RemoteClient(session:URLSession(configuration:configuration))
        let record = RemoteCredentialRecord(settings:RemoteSettings(endpoint:"https://fixture.invalid/v1/chat/completions",model:"fake-model",stream:true),key:"FAKE")
        try state.startGeneration(input:"still generating",record:record,client:client,nodeIDs:["generation-user"])
        let generation = try XCTUnwrap(state.generation)
        let snapshot = try state.publicationSnapshot()
        XCTAssertThrowsError(try state.navigate(chatID: state.selectedConversationID, source: .search))
        XCTAssertThrowsError(try state.moveNavigation(.back))
        let options = try state.nodeOptionsDraft(nodeID: XCTUnwrap(state.conversation?.visibleMessages.first?.id))
        XCTAssertThrowsError(try state.saveNodeOptions(options))
        do { try await controller.recover(); XCTFail("active generation must be preserved") } catch {}
        XCTAssertEqual(state.generation?.id,generation.id)
        XCTAssertEqual(try state.publicationSnapshot(),snapshot)
        XCTAssertNotNil(try cache.publication(dataset:"fake1"))
        state.stopGeneration()
    }

}
private final class ControllerWriteFault: @unchecked Sendable {
    var reject = false
    var previousAccepted: OrderedJSON?
}

private final class HeldControllerGeneration: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {}
    override func stopLoading() {}
}
