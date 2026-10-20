import XCTest
import Foundation
@testable import WeaveletPilot

private final class CatalogDownloadProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    static var held: CatalogDownloadProtocol?
    static var hold = false
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "huggingface.co" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if Self.hold { Self.held = self; return }
        respond()
    }
    static func release() { let value = held; held = nil; value?.respond() }
    private func respond() {
        do {
            let (status,body) = try Self.handler?(request) ?? (500,Data())
            let response = HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Length":"\(body.count)"])!
            client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:body)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self,didFailWithError:error) }
    }
    override func stopLoading() {}
}

@MainActor final class LocalGenerationTests: XCTestCase {
    private func store() throws -> LocalStateStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-local-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:dir) }
        return LocalStateStore(fileURL:dir.appendingPathComponent("state.json"))
    }
    private func catalogState(_ store: LocalStateStore) throws -> ChatState {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CatalogDownloadProtocol.self]
        let state = ChatState(store:store,catalogDownloadConfiguration:config)
        try state.importWebData(ChatLibrary.emptySource.encoded())
        return state
    }
    private func state(_ store: LocalStateStore, generate: @escaping LocalLlama.Generator) throws -> ChatState {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/remote-generation.json")))
        var source = try fixture.required("cases").array("cases")[0].required("source")
        var chats = try source.required("chats").array("chats")
        let config = try chats[0].required("config").replacing("modelSource",with:.string("local")).replacing("model",with:.string("test-local"))
            .replacing("max_tokens",with:.number("8")).replacing("temperature",with:.number("0"))
        chats[0] = chats[0].replacing("config",with:config)
        source = source.replacing("chats",with:.array(chats))
        let state = ChatState(store:store,localGenerate:generate)
        try state.importWebData(source.encoded())
        return state
    }
    private func install(_ state: ChatState, store: LocalStateStore) throws {
        let source = store.fileURL.deletingLastPathComponent().appendingPathComponent("fixture.gguf")
        try Data("GGUFtest-only-engine-is-injected".utf8).write(to:source)
        try state.localModelFiles.install(source,modelID:"test-local")
    }
    private func wait(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 {
            if predicate() { return }
            try await Task.sleep(nanoseconds:5_000_000)
        }
        XCTFail("Local generation did not reach expected state")
    }
    private func waitForCatalogProtocol() async throws {
        for _ in 0..<200 {
            if CatalogDownloadProtocol.held != nil { return }
            try await Task.sleep(nanoseconds:5_000_000)
        }
        XCTFail("Catalog request did not start")
    }
    func testDeviceModelCopyPreservesOldFileOnInvalidImportAndSeparatesUTF8IDs() throws {
        let store = try store(), files = LocalModelFiles(directory:store.fileURL.deletingLastPathComponent().appendingPathComponent("models"))
        let source = store.fileURL.deletingLastPathComponent().appendingPathComponent("selected.gguf")
        let bytes = Data("GGUForiginal".utf8); try bytes.write(to:source)
        try files.install(source,modelID:"é")
        XCTAssertNotEqual(try files.url(modelID:"é"),try files.url(modelID:"e\u{301}"))
        try Data("bad".utf8).write(to:source)
        XCTAssertThrowsError(try files.install(source,modelID:"é"))
        XCTAssertEqual(try Data(contentsOf:files.installed(modelID:"é")),bytes)
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath:files.directory.path).contains { $0.hasSuffix(".part") })
    }
    func testLocalConnectionRequiresDeviceFileThenPersistsSharedOutputWithoutCredentials() async throws {
        let store = try store()
        let state = try state(store) { _, request, output in
            XCTAssertEqual(request.maxTokens,8)
            XCTAssertTrue(request.messages.contains { $0.content.contains("local input") })
            _ = try await output("<think>local text</think> answer")
        }
        let original = try state.exportWebData(), disk = try Data(contentsOf:store.fileURL)
        XCTAssertThrowsError(try state.startGeneration(input:"local input"))
        XCTAssertEqual(try state.exportWebData(),original); XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        try install(state,store:store)
        try state.startGeneration(input:"local input",readProviderCredential:{ _ in XCTFail("Local request read a provider credential"); return nil })
        try await wait { state.generation == nil }
        XCTAssertNil(state.generationError)
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
        XCTAssertEqual(restarted.conversation?.visibleMessages.last?.parts,[.text("<think>local text</think> answer")])
        let chat = try XCTUnwrap(restarted.conversation), node = try XCTUnwrap(chat.visibleMessages.last)
        XCTAssertEqual(try restarted.streamStatus(chatID:chat.id,nodeID:node.id)?["reason"],.string("completed"))
        let after = try XCTUnwrap(state.exchange).source
        let before = try OrderedJSON.decode(original)
        XCTAssertEqual(after["xRoot"],before["xRoot"])
        XCTAssertEqual(try after.required("chats").array("chats")[0]["config"],try before.required("chats").array("chats")[0]["config"])
    }
    func testPrefillUsesSharedKeysAndOutputAndStaysOutOfSavedState() async throws {
        let store = try store()
        let state = try state(store) { _, request, output in
            XCTAssertEqual(request.assistantPrefix,"seed:")
            XCTAssertTrue(try XCTUnwrap(request.fallbackPrompt).hasSuffix("assistant:seed:"))
            _ = try await output("generated")
        }
        try install(state,store:store)
        let key = state.stickyPrefillKey
        state.setAssistantPrefill(key:key,text:" \u{FEFF}seed: ")
        try state.startGeneration(input:"prefill input")
        XCTAssertEqual(state.generation?.output.text,"seed:")
        try await wait { state.generation == nil }
        XCTAssertEqual(state.assistantPrefill(key:key),"")
        XCTAssertEqual(state.conversation?.visibleMessages.last?.parts,[.text("seed:generated")])
        let user = try XCTUnwrap(state.conversation?.visibleMessages.last(where:{$0.role == "user"}))
        let assistant = try XCTUnwrap(state.conversation?.visibleMessages.last)
        // Web treats last-message regeneration as append; add a successor to exercise midchat.
        var tail = try state.messageDraft(nodeID:nil)
        tail.role = "user"; tail.text = "Following user"
        try state.saveMessage(tail,mode:.append)
        state.setAssistantPrefill(key:state.assistantPrefillKey(nodeID:user.id),text:"seed:")
        state.setAssistantPrefill(key:key,text:"sticky draft must survive")
        let draft = try state.messageGenerationDraft(nodeID:assistant.id,operation:.regenerate)
        try state.startGeneration(draft)
        try await wait { state.generation == nil }
        XCTAssertEqual(state.assistantPrefill(key:state.assistantPrefillKey(nodeID:user.id)),"")
        XCTAssertEqual(state.assistantPrefill(key:key),"sticky draft must survive")
        let restarted = ChatState(store:store)
        XCTAssertEqual(restarted.assistantPrefill(key:key),"")
        XCTAssertEqual(try restarted.exportWebData(),try state.exportWebData())
        XCTAssertFalse(String(decoding:try Data(contentsOf:store.fileURL),as:UTF8.self).contains("sticky draft must survive"))
    }

    func testCatalogDownloadRegistersSharedDefinitionAndLocalRevision() async throws {
        let store = try store(), state = try catalogState(store)
        let before = try state.publicationSnapshot()
        try state.applySnapshot(before.replacing("state",with:try before.required("state").replacing("xCatalogOpaque",with:.number("9007199254740993"))))
        CatalogDownloadProtocol.handler = { request in
            XCTAssertEqual(request.url?.host,"huggingface.co")
            return (200,Data("GGUFcatalog fixture".utf8))
        }
        defer { CatalogDownloadProtocol.handler = nil }
        let catalog = try state.localModelCatalog()
        XCTAssertEqual(catalog.count,3)
        try state.startCatalogDownload(id:"smollm2-360m-instruct-q8")
        try await wait { state.catalogDownload(id:"smollm2-360m-instruct-q8")?.running == false }
        let id = "smollm2-360m-instruct-q8"
        XCTAssertEqual(try state.localModelDefinitions().first { (try? $0.required("id").string("id")) == id }?["origin"],.string("HuggingFaceTB/SmolLM2-360M-Instruct-GGUF"))
        let roots = try state.publicationSnapshot().required("state")
        XCTAssertEqual(roots["savedModelMeta"]?[id]?["downloadRevision"],.string("main"))
        XCTAssertEqual(try roots["savedModelMeta"]?[id]?["fileHashes"]?.object("hashes").count,1)
        XCTAssertNotNil(try? state.localModelFiles.installed(modelID:id))
        XCTAssertEqual(try state.publicationSnapshot().required("state")["xCatalogOpaque"],.number("9007199254740993"))
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.publicationSnapshot(),try state.publicationSnapshot())
        XCTAssertNotNil(try? restarted.localModelFiles.installed(modelID:id))
        let records = try SyncRecords.toRecords(state.publicationSnapshot())
        let received = try SyncRecords.fromRecords(records).required("state")
        // Actual Web records canonicalizes object keys; model values and array order must survive.
        for key in ["localModels","activeLocalModels","favoriteLocalModelIds","savedModelMeta"] {
            XCTAssertEqual(try SyncRecords.canonical(received[key] ?? .null),try SyncRecords.canonical(roots[key] ?? .null),key)
        }
        XCTAssertFalse(String(decoding:try state.exportWebData(),as:UTF8.self).contains("catalog-download-resume"))
    }

    func testCatalogCancellationIgnoresLateDownloadCompletion() async throws {
        let store = try store(), state = try catalogState(store)
        CatalogDownloadProtocol.handler = { _ in (200,Data("GGUFlate catalog".utf8)) }
        CatalogDownloadProtocol.hold = true
        defer { CatalogDownloadProtocol.hold = false; CatalogDownloadProtocol.held = nil; CatalogDownloadProtocol.handler = nil }
        let before = try state.publicationSnapshot()
        try state.startCatalogDownload(id:"qwen3-0.6b-q4km")
        try await waitForCatalogProtocol()
        state.cancelCatalogDownload(id:"qwen3-0.6b-q4km")
        CatalogDownloadProtocol.release()
        try await wait { state.catalogDownload(id:"qwen3-0.6b-q4km")?.running == false }
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertThrowsError(try state.localModelFiles.installed(modelID:"qwen3-0.6b-q4km"))
    }

    func testCatalogSaveFailureRollsBackFileThenRetries() async throws {
        final class Gate { var reject = false }
        let base = try store(), gate = Gate()
        let rejecting = LocalStateStore(fileURL:base.fileURL,write: { data, url in
            if gate.reject { throw ExchangeError.invalid("reject save") }
            try data.write(to:url,options:.atomic)
        })
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CatalogDownloadProtocol.self]
        let state = ChatState(store:rejecting,catalogDownloadConfiguration:config)
        try state.importWebData(ChatLibrary.emptySource.encoded())
        CatalogDownloadProtocol.handler = { _ in (200,Data("GGUFsave retry".utf8)) }
        defer { CatalogDownloadProtocol.handler = nil }
        let id = "llm-jp-3-1.8b-instruct-q4km", before = try state.publicationSnapshot()
        gate.reject = true
        try state.startCatalogDownload(id:id)
        try await wait { state.catalogDownload(id:id)?.running == false }
        XCTAssertNotNil(state.catalogDownload(id:id)?.error)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertThrowsError(try state.localModelFiles.installed(modelID:id))
        gate.reject = false
        try state.startCatalogDownload(id:id)
        try await wait { state.catalogDownload(id:id)?.running == false }
        XCTAssertNil(state.catalogDownload(id:id)?.error)
        XCTAssertNotNil(try? state.localModelFiles.installed(modelID:id))
    }

    func testCatalogIDConflictAndHashDuplicatePreserveExistingAssetsAndUseSharedCleanup() async throws {
        let store = try store(), state = try catalogState(store), bytes = Data("GGUFduplicate bytes".utf8)
        let duplicateID = "existing-local"
        let source = store.fileURL.deletingLastPathComponent().appendingPathComponent("existing.gguf")
        try bytes.write(to:source); try state.localModelFiles.install(source,modelID:duplicateID)
        let snapshot = try state.publicationSnapshot(), roots = try snapshot.required("state")
        let existing = try OrderedJSON.decode(Data(#"{"id":"existing-local","engine":"wllama","tasks":["generation","analysis"],"manifest":{"kind":"single-file","entrypoint":"existing.gguf"}}"#.utf8))
        let downloaded = try OrderedJSON.decode(Data(#"{"id":"smollm2-360m-instruct-q8","engine":"wllama","tasks":["generation"],"manifest":{"kind":"single-file","entrypoint":"old.gguf"}}"#.utf8))
        try state.applySnapshot(snapshot.replacing("state",with:roots.replacing("localModels",with:.array([existing,downloaded])).replacing("activeLocalModels",with:.object([.init(key:"generation",value:.string("smollm2-360m-instruct-q8"))])).replacing("favoriteLocalModelIds",with:.array([.string("smollm2-360m-instruct-q8")])).replacing("savedModelMeta",with:.object([.init(key:"smollm2-360m-instruct-q8",value:.object([.init(key:"storageState",value:.string("saved"))]))]))))
        CatalogDownloadProtocol.handler = { _ in (200,bytes) }
        defer { CatalogDownloadProtocol.handler = nil }
        try state.startCatalogDownload(id:"smollm2-360m-instruct-q8")
        try await wait { state.catalogDownload(id:"smollm2-360m-instruct-q8")?.running == false }
        let updated = try state.publicationSnapshot().required("state")
        XCTAssertEqual(try updated.required("localModels").array("models").count,1)
        XCTAssertEqual(updated["activeLocalModels"]?["generation"],.string(duplicateID))
        XCTAssertEqual(updated["favoriteLocalModelIds"],.array([.string(duplicateID)]))
        XCTAssertNil(updated["savedModelMeta"]?["smollm2-360m-instruct-q8"])
        XCTAssertThrowsError(try state.localModelFiles.installed(modelID:"smollm2-360m-instruct-q8"))
    }

    func testCatalogDownloadHTTPFailureKeepsLibraryAndFiles() async throws {
        let store = try store(), state = try catalogState(store)
        CatalogDownloadProtocol.handler = { _ in (503,Data("unavailable".utf8)) }
        defer { CatalogDownloadProtocol.handler = nil }
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        try state.startCatalogDownload(id:"qwen3-0.6b-q4km")
        try await wait { state.catalogDownload(id:"qwen3-0.6b-q4km")?.running == false }
        XCTAssertNotNil(state.catalogDownload(id:"qwen3-0.6b-q4km")?.error)
        XCTAssertEqual(try state.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertThrowsError(try state.localModelFiles.installed(modelID:"qwen3-0.6b-q4km"))
        let existing = store.fileURL.deletingLastPathComponent().appendingPathComponent("conflicting.gguf")
        try Data("GGUFexisting catalog ID".utf8).write(to:existing)
        try state.localModelFiles.install(existing,modelID:"qwen3-0.6b-q4km")
        let original = try Data(contentsOf:state.localModelFiles.installed(modelID:"qwen3-0.6b-q4km"))
        CatalogDownloadProtocol.handler = { _ in (200,Data("GGUFdifferent catalog ID".utf8)) }
        try state.startCatalogDownload(id:"qwen3-0.6b-q4km")
        try await wait { state.catalogDownload(id:"qwen3-0.6b-q4km")?.running == false }
        XCTAssertNotNil(state.catalogDownload(id:"qwen3-0.6b-q4km")?.error)
        XCTAssertEqual(try Data(contentsOf:state.localModelFiles.installed(modelID:"qwen3-0.6b-q4km")),original)
        XCTAssertEqual(try state.publicationSnapshot(),before)
    }

    func testLocalStopKeepsPartialOutputOnSaveFailureThenRetries() async throws {
        let store = try store()
        let finished = expectation(description:"Cancelled generator delivered its late callback")
        let state = try state(store) { _, _, output in
            defer { finished.fulfill() }
            _ = try await output("local partial")
            do { try await Task.sleep(nanoseconds:10_000_000_000) }
            catch { _ = try await output("late output after stop") }
        }
        try install(state,store:store)
        state.setAssistantPrefill(key:state.stickyPrefillKey,text:"seed:")
        try state.startGeneration(input:"local stop")
        state.setAssistantPrefill(key:state.stickyPrefillKey,text:"next generation draft")
        try await wait { state.generation?.output.text == "seed:local partial" }
        let prepared = try state.exportWebData(), disk = try Data(contentsOf:store.fileURL)
        let moved = store.fileURL.appendingPathExtension("saved")
        try FileManager.default.moveItem(at:store.fileURL,to:moved)
        try FileManager.default.createDirectory(at:store.fileURL,withIntermediateDirectories:false)
        state.stopGeneration()
        XCTAssertEqual(state.generation?.running,false)
        XCTAssertEqual(state.generation?.output.text,"seed:local partial")
        XCTAssertEqual(try state.exportWebData(),prepared)
        XCTAssertEqual(try Data(contentsOf:moved),disk)
        try FileManager.default.removeItem(at:store.fileURL)
        try FileManager.default.moveItem(at:moved,to:store.fileURL)
        try state.saveGenerationResult()
        XCTAssertNil(state.generation)
        await fulfillment(of:[finished],timeout:2)
        XCTAssertEqual(ChatState(store:store).conversation?.visibleMessages.last?.parts,[.text("seed:local partial")])
        let chat = try XCTUnwrap(state.conversation), node = try XCTUnwrap(chat.visibleMessages.last)
        XCTAssertEqual(try state.streamStatus(chatID:chat.id,nodeID:node.id)?["reason"],.string("interrupted"))
        XCTAssertEqual(state.assistantPrefill(key:state.stickyPrefillKey),"next generation draft")
    }
}
