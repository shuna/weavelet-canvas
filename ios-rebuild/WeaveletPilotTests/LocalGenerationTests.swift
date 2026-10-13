import XCTest
@testable import WeaveletPilot

@MainActor final class LocalGenerationTests: XCTestCase {
    private func store() throws -> LocalStateStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-local-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:dir) }
        return LocalStateStore(fileURL:dir.appendingPathComponent("state.json"))
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
        XCTAssertEqual(restarted.conversation?.visibleMessages.last?.content,"<think>local text</think> answer")
        let after = try XCTUnwrap(state.exchange).source
        let before = try OrderedJSON.decode(original)
        XCTAssertEqual(after["xRoot"],before["xRoot"])
        XCTAssertEqual(try after.required("chats").array("chats")[0]["config"],try before.required("chats").array("chats")[0]["config"])
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
        try state.startGeneration(input:"local stop")
        try await wait { state.generation?.output.text == "local partial" }
        let prepared = try state.exportWebData(), disk = try Data(contentsOf:store.fileURL)
        let moved = store.fileURL.appendingPathExtension("saved")
        try FileManager.default.moveItem(at:store.fileURL,to:moved)
        try FileManager.default.createDirectory(at:store.fileURL,withIntermediateDirectories:false)
        state.stopGeneration()
        XCTAssertEqual(state.generation?.running,false)
        XCTAssertEqual(state.generation?.output.text,"local partial")
        XCTAssertEqual(try state.exportWebData(),prepared)
        XCTAssertEqual(try Data(contentsOf:moved),disk)
        try FileManager.default.removeItem(at:store.fileURL)
        try FileManager.default.moveItem(at:moved,to:store.fileURL)
        try state.saveGenerationResult()
        XCTAssertNil(state.generation)
        await fulfillment(of:[finished],timeout:2)
        XCTAssertEqual(ChatState(store:store).conversation?.visibleMessages.last?.content,"local partial")
    }
}
