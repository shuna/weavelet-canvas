import XCTest
import Darwin
@testable import WeaveletPilot

private actor LocalEvaluationCalls {
    var prompts: [String] = []
    func record(_ request: LocalLlamaRequest) -> Int {
        prompts.append(request.messages[0].content)
        return prompts.count
    }
}

@MainActor
final class NativeLocalEvaluationTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.decode(Data(text.utf8)) }
    private func modelFixture() throws -> (LocalModelFiles, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("native-local-evaluation-\(UUID())")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let files = LocalModelFiles(directory:directory)
        let url = try files.url(modelID:"analysis-model")
        try Data("GGUF FAKE".utf8).write(to:url)
        return (files,directory)
    }
    private func state() throws -> OrderedJSON {
        try json(#"{"localModelEnabled":true,"activeLocalModels":{"analysis":"analysis-model"},"localModels":[{"id":"analysis-model","engine":"wllama","tasks":["analysis","quality"],"manifest":{"kind":"single-file","entrypoint":"fake.gguf"}}],"xLarge":9007199254740993}"#)
    }
    private func registrySnapshot() throws -> OrderedJSON {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json")))
        let additions = try json(#"{"localModelEnabled":true,"localModels":[{"id":"remove","engine":"wllama","tasks":["generation"],"manifest":{"kind":"single-file","entrypoint":"remove.gguf"}},{"id":"keep","engine":"wllama","tasks":["analysis"],"manifest":{"kind":"single-file","entrypoint":"keep.gguf"},"xModel":9007199254740993}],"activeLocalModels":{"generation":"remove","analysis":"keep","xRaw":9007199254740993},"favoriteLocalModelIds":["keep"],"savedModelMeta":{"remove":{"storedBytes":10},"keep":{"opaque":true}}}"#)
        var roots = try corpus.required("syncSnapshot").required("state")
        for field in try additions.object("registry roots") { roots = roots.replacing(field.key,with:field.value) }
        return try corpus.required("syncSnapshot").replacing("state",with:roots)
    }
    private func registryState(_ store: LocalStateStore) throws -> ChatState {
        let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json")))
        let app = ChatState(store:store)
        try app.importWebData(corpus.required("exportV3").encoded())
        try app.applySnapshot(registrySnapshot())
        return app
    }

    func testSharedRoleSettingsPreserveMetadataAndRestart() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("local-role-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")), app = ChatState(store:store)
        try app.importWebData(Data(#"{"version":3,"chats":[],"localModelEnabled":false,"activeLocalModels":{"generation":"g","moderation":"m","xRaw":9007199254740993},"localModels":[{"id":"analysis-model","engine":"wllama","tasks":["analysis"],"manifest":{"kind":"single-file","entrypoint":"fake.gguf"},"xRaw":9007199254740993}],"savedModelMeta":{"analysis-model":{"storedBytes":9007199254740993}},"xRoot":{"value":9007199254740993}}"#.utf8))
        // V3 extras are sidecar data; live settings enter through the store snapshot.
        let snapshot = try app.publicationSnapshot(), v3 = try OrderedJSON.decode(app.exportWebData())
        var settings = try snapshot.required("state")
        for key in ["localModelEnabled","activeLocalModels","localModels","savedModelMeta","xRoot"] {
            settings = settings.replacing(key,with:try v3.required(key))
        }
        try app.applySnapshot(snapshot.replacing("state",with:settings))
        let before = try app.publicationSnapshot(), exportBefore = try OrderedJSON.decode(app.exportWebData())
        try app.saveLocalModelRole(enabled:true)
        try app.saveLocalModelRole(task:"analysis",modelID:"analysis-model")
        XCTAssertTrue(app.localModelsEnabled)
        XCTAssertEqual(app.activeLocalModel("analysis"),"analysis-model")
        let model = try XCTUnwrap(app.localModelDefinitions().first)
        XCTAssertEqual(model["xRaw"],.number("9007199254740993"))
        let roots = try app.publicationSnapshot().required("state")
        for key in ["localModels","savedModelMeta","xRoot"] {
            XCTAssertEqual(roots[key],before["state"]?[key])
            XCTAssertEqual(try OrderedJSON.decode(app.exportWebData())[key],exportBefore[key])
        }
        XCTAssertEqual(roots["activeLocalModels"]?["xRaw"],.number("9007199254740993"))
        XCTAssertEqual(roots["activeLocalModels"]?["moderation"],.string("m"))
        XCTAssertThrowsError(try NativeLocalEvaluation.modelURL(state:roots,files:app.localModelFiles))
        try app.saveLocalModelRole(task:"analysis")
        XCTAssertNil(app.activeLocalModel("analysis"))
        XCTAssertEqual(app.activeLocalModel("generation"),"g")
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),try app.publicationSnapshot())
    }

    func testSingleGGUFImportKeepsOtherStateAndReusesDuplicate() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("single-gguf-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let source = directory.appendingPathComponent("My Model.gguf")
        try Data("GGUF TEST".utf8).write(to:source)
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")), app = ChatState(store:store)
        try app.importWebData(Data(#"{"version":3,"chats":[],"activeLocalModels":{"generation":"already"},"savedModelMeta":{"old":{"storedBytes":9007199254740993}},"xRoot":{"raw":9007199254740993}}"#.utf8))
        let initial = try app.publicationSnapshot(), imported = try OrderedJSON.decode(app.exportWebData())
        var roots = try initial.required("state")
        for key in ["activeLocalModels","savedModelMeta","xRoot"] {
            roots = roots.replacing(key,with:try imported.required(key))
        }
        try app.applySnapshot(initial.replacing("state",with:roots))
        let before = try OrderedJSON.decode(app.exportWebData())
        let id = try await app.importSingleGGUF(source)
        XCTAssertTrue(id.hasPrefix("local-file--"))
        XCTAssertEqual(app.activeLocalModel("generation"),"already")
        XCTAssertEqual(app.activeLocalModel("analysis"),id)
        XCTAssertEqual(try app.localModelDefinitions().count,1)
        let copied = try app.localModelFiles.installed(modelID:id)
        let copiedHash = try app.localModelFiles.inspect(copied).hash
        let sourceHash = try app.localModelFiles.inspect(source).hash
        XCTAssertEqual(copiedHash,sourceHash)
        let after = try OrderedJSON.decode(app.exportWebData())
        XCTAssertEqual(after["savedModelMeta"],before["savedModelMeta"])
        XCTAssertEqual(after["xRoot"],before["xRoot"])
        let repeated = try await app.importSingleGGUF(source)
        XCTAssertEqual(repeated,id)
        XCTAssertEqual(try app.localModelDefinitions().count,1)
    }

    func testSingleGGUFImportSaveFailureLeavesStateAndRetryableFile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("single-gguf-failure-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let source = directory.appendingPathComponent("retry.gguf")
        try Data("GGUF RETRY".utf8).write(to:source)
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json"),write:{ bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        })
        let app = ChatState(store:store)
        try app.importWebData(Data(#"{"version":3,"chats":[],"activeLocalModels":{"analysis":"keep"}}"#.utf8))
        let initial = try app.publicationSnapshot(), imported = try OrderedJSON.decode(app.exportWebData())
        let roots = try initial.required("state").replacing("activeLocalModels",with:imported.required("activeLocalModels"))
        try app.applySnapshot(initial.replacing("state",with:roots))
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        reject = true
        do { _ = try await app.importSingleGGUF(source); XCTFail("save should fail") } catch { }
        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        reject = false
        let id = try await app.importSingleGGUF(source)
        XCTAssertEqual(app.activeLocalModel("analysis"),"keep")
        XCTAssertEqual(app.activeLocalModel("generation"),id)
        XCTAssertEqual(try app.localModelDefinitions().count,1)
    }

    func testSingleGGUFImportUsesByteExactExistingID() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("single-gguf-id-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let source = directory.appendingPathComponent("same.gguf")
        try Data("GGUF SAME".utf8).write(to:source)
        let app = ChatState(store:LocalStateStore(fileURL:directory.appendingPathComponent("state.json")))
        try app.importWebData(Data(#"{"version":3,"chats":[]}"#.utf8))
        let composed = "caf\u{E9}", decomposed = "cafe\u{301}"
        func model(_ id:String, task:String) -> OrderedJSON {
            .object([.init(key:"id",value:.string(id)),.init(key:"engine",value:.string("wllama")),
                     .init(key:"tasks",value:.array([.string(task)])),
                     .init(key:"manifest",value:.object([.init(key:"kind",value:.string("single-file")),.init(key:"entrypoint",value:.string("same.gguf"))]))])
        }
        let snapshot = try app.publicationSnapshot()
        let roots = try snapshot.required("state").replacing("localModels",with:.array([model(composed,task:"generation"),model(decomposed,task:"analysis")]))
        try app.applySnapshot(snapshot.replacing("state",with:roots))
        let files = app.localModelFiles, fingerprint = try files.inspect(source)
        try files.installNew(source,modelID:decomposed,hash:fingerprint.hash)
        let importedID = try await app.importSingleGGUF(source)
        XCTAssertTrue(importedID.utf8.elementsEqual(decomposed.utf8))
        XCTAssertNil(app.activeLocalModel("generation"))
        XCTAssertEqual(app.activeLocalModel("analysis")?.utf8.elementsEqual(decomposed.utf8),true)
        XCTAssertEqual(try app.localModelDefinitions().count,2)
        let target = try files.installed(modelID:decomposed), revision = try files.revision(target)
        try Data("GGUF NEW".utf8).write(to:source)
        try files.install(source,modelID:decomposed)
        XCTAssertThrowsError(try files.checkRevision(target,expected:revision))
    }

    func testCancelledSingleGGUFImportDoesNotPublishModel() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("single-gguf-cancel-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let source = directory.appendingPathComponent("cancel.gguf")
        try Data("GGUF CANCEL".utf8).write(to:source)
        let app = ChatState(store:LocalStateStore(fileURL:directory.appendingPathComponent("state.json")))
        try app.importWebData(Data(#"{"version":3,"chats":[]}"#.utf8))
        let cancelled = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await app.importSingleGGUF(source)
        }
        do { _ = try await cancelled.value; XCTFail("cancelled import should not publish") }
        catch is CancellationError { }
        XCTAssertTrue(try app.localModelDefinitions().isEmpty)
    }

    func testRoleSettingsSaveFailureKeepsMemoryAndDisk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("local-role-failure-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json"),write:{ bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        })
        let app = ChatState(store:store)
        try app.importWebData(Data(#"{"version":3,"chats":[],"localModelEnabled":false,"activeLocalModels":{"analysis":"original"}}"#.utf8))
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)
        reject = true
        XCTAssertThrowsError(try app.saveLocalModelRole(enabled:true))
        XCTAssertThrowsError(try app.saveLocalModelRole(task:"analysis",modelID:"replacement"))
        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
    }

    func testLocalModelRegistrySaveFailureKeepsStateDiskAndStagedAsset() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("local-model-registry-failure-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        var reject = false
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json"),write:{ bytes,url in
            if reject { throw CocoaError(.fileWriteNoPermission) }
            try bytes.write(to:url,options:.atomic)
        })
        let app = try registryState(store)
        let source = directory.appendingPathComponent("remove.gguf")
        try Data("GGUF registry failure".utf8).write(to:source)
        try app.localModelFiles.install(source,modelID:"remove")
        let target = try XCTUnwrap(app.localModelDefinitions().first { $0["id"] == .string("remove") })
        let before = try app.publicationSnapshot(), disk = try Data(contentsOf:store.fileURL)

        reject = true
        XCTAssertThrowsError(try app.toggleLocalModelFavorite(target))
        do { try await app.removeLocalModel(target); XCTFail("save should fail") } catch { }

        XCTAssertEqual(try app.publicationSnapshot(),before)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertEqual(try Data(contentsOf:app.localModelFiles.installed(modelID:"remove")),Data("GGUF registry failure".utf8))

        reject = false
        try app.toggleLocalModelFavorite(target)
        try await app.removeLocalModel(target)
        XCTAssertThrowsError(try app.localModelFiles.installed(modelID:"remove"))
        XCTAssertNil(try app.publicationSnapshot().required("state")["savedModelMeta"]?["remove"])
    }

    func testLocalModelRegistryRemovalPreservesOtherRootsAcrossRestartAndRecords() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("local-model-registry-success-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")), app = try registryState(store)
        let source = directory.appendingPathComponent("remove.gguf")
        try Data("GGUF registry success".utf8).write(to:source)
        try app.localModelFiles.install(source,modelID:"remove")
        let target = try XCTUnwrap(app.localModelDefinitions().first { $0["id"] == .string("remove") })
        let before = try app.publicationSnapshot(), beforeRoots = try before.required("state")

        try app.toggleLocalModelFavorite(target)
        XCTAssertEqual(try app.publicationSnapshot().required("state").required("favoriteLocalModelIds"),.array([.string("keep"),.string("remove")]))
        try await app.removeLocalModel(target)

        let after = try app.publicationSnapshot(), updated = try after.required("state")
        XCTAssertEqual(try updated.required("localModels").array("models").count,1)
        XCTAssertEqual(updated["activeLocalModels"]?["analysis"],.string("keep"))
        XCTAssertEqual(updated["activeLocalModels"]?["xRaw"],.number("9007199254740993"))
        XCTAssertNil(updated["activeLocalModels"]?["generation"])
        XCTAssertEqual(updated["favoriteLocalModelIds"],.array([.string("keep")]))
        XCTAssertNil(updated["savedModelMeta"]?["remove"])
        XCTAssertEqual(updated["savedModelMeta"]?["keep"]?["opaque"],.bool(true))
        XCTAssertEqual(try updated.required("localModels").array("models")[0]["xModel"],.number("9007199254740993"))
        let registryRoots = Set(["localModels","activeLocalModels","favoriteLocalModelIds","savedModelMeta"])
        for field in try beforeRoots.object("baseline roots") where !registryRoots.contains(field.key.text) {
            XCTAssertEqual(updated[field.key],field.value,field.key.text)
        }
        XCTAssertThrowsError(try app.localModelFiles.installed(modelID:"remove"))
        XCTAssertEqual(try ChatState(store:store).publicationSnapshot(),after)
        let records = try SyncRecords.toRecords(after)
        let received = try SyncRecords.fromRecords(records).required("state")
        for key in registryRoots {
            XCTAssertEqual(try SyncRecords.canonical(received[key] ?? .null),try SyncRecords.canonical(updated[key] ?? .null),key)
        }
    }

    func testLocalModelRegistryRestartRecoversStagedRemovalByRegistration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("local-model-registry-recovery-\(UUID())")
        defer { try? FileManager.default.removeItem(at:directory) }
        let store = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")), app = try registryState(store)
        let source = directory.appendingPathComponent("remove.gguf"), bytes = Data("GGUF registry recovery".utf8)
        try bytes.write(to:source); try app.localModelFiles.install(source,modelID:"remove")

        _ = try app.localModelFiles.stageModelRemoval(modelID:"remove")
        let restored = ChatState(store:store)
        XCTAssertEqual(try Data(contentsOf:restored.localModelFiles.installed(modelID:"remove")),bytes)

        let snapshot = try restored.publicationSnapshot(), roots = try snapshot.required("state")
        let remainingModels = try roots.required("localModels").array("models").filter { $0["id"] != .string("remove") }
        let remainingActive = try roots.required("activeLocalModels").object("active").filter { $0.value != .string("remove") }
        let remainingFavorites = try roots.required("favoriteLocalModelIds").array("favorites").filter { $0 != .string("remove") }
        let remainingMetadata = try roots.required("savedModelMeta").object("metadata").filter { !$0.key.matches("remove") }
        let unregistered = roots.replacing("localModels",with:.array(remainingModels))
            .replacing("activeLocalModels",with:.object(remainingActive))
            .replacing("favoriteLocalModelIds",with:.array(remainingFavorites))
            .replacing("savedModelMeta",with:.object(remainingMetadata))
        try restored.applySnapshot(snapshot.replacing("state",with:unregistered))
        _ = try restored.localModelFiles.stageModelRemoval(modelID:"remove")
        let committed = ChatState(store:store)
        XCTAssertThrowsError(try committed.localModelFiles.installed(modelID:"remove"))
    }

    func testModelSelectionRequiresMetadataAndInstalledSingleGGUF() throws {
        let (files,directory) = try modelFixture()
        defer { try? FileManager.default.removeItem(at:directory) }
        let state = try state()
        XCTAssertEqual(try NativeLocalEvaluation.modelURL(state:state,files:files),try files.url(modelID:"analysis-model"))
        let unsupported = state.replacing("localModels",with:.array([try state.required("localModels").array("models")[0].replacing("engine",with:.string("transformers.js"))]))
        XCTAssertThrowsError(try NativeLocalEvaluation.modelURL(state:unsupported,files:files))
        try FileManager.default.removeItem(at:files.url(modelID:"analysis-model"))
        XCTAssertThrowsError(try NativeLocalEvaluation.modelURL(state:state,files:files))
        XCTAssertEqual(state["xLarge"],.number("9007199254740993"))
    }

    func testFiveAxesUseSharedPromptsFallbackAndCumulativeOutput() async throws {
        let (files,directory) = try modelFixture()
        defer { try? FileManager.default.removeItem(at:directory) }
        let calls = LocalEvaluationCalls()
        let generator: LocalLlama.Generator = { _, request, onText in
            let index = await calls.record(request)
            if index == 1 { return }
            _ = try await onText("go")
            _ = try await onText("good")
        }
        var progress: [OrderedJSON] = []
        let context = try json(#"{"userText":"短い質問","contextText":"[user]\n短い質問","assistantText":"短い回答","xRaw":9007199254740993}"#)
        let before = try context.encoded()
        let result = try await NativeLocalEvaluation.runQuality(context:context,scope:"full-context",language:"ja",
            modelURL:files.installed(modelID:"analysis-model"),generator:generator,onProgress:{ progress.append($0) })
        let axes = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localAxes"))]))
            .array("axes").map { try $0.string("axis") }
        let prompts = await calls.prompts
        XCTAssertEqual(prompts.count,6)
        for (index,axis) in axes.enumerated() {
            let expected = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localPrompt")),
                .init(key:"axis",value:.string(axis)),.init(key:"text",value:context.required("contextText")),
                .init(key:"assistantResponse",value:context.required("assistantText")),.init(key:"language",value:.string("ja"))]))
            XCTAssertEqual(prompts[index + (index > 0 ? 1 : 0)],try expected.required("prompt").string("prompt"))
            if index == 0 { XCTAssertEqual(prompts[1],try expected.required("fallback").string("fallback")) }
        }
        XCTAssertEqual(result["kind"],.string("standard"))
        XCTAssertEqual(result["source"],.string("local"))
        XCTAssertEqual(result["scores"]?["taskCompletion"],.number("0.65"))
        XCTAssertEqual(result["reasoning"]?["instructionFollowing"],.string("good"))
        XCTAssertEqual(progress.count,15)
        XCTAssertEqual(progress[0][axes[0]],.string("waiting"))
        XCTAssertEqual(progress[5][axes[0]],.string("generating"))
        XCTAssertEqual(progress[7][axes[1]],.string("generating"))
        XCTAssertEqual(progress[14][axes[4]],.string("done"))
        XCTAssertEqual(try context.encoded(),before)
    }

    func testLocalPromptBridgeDecodesTruncatedEmojiWithoutChangingContext() throws {
        let cutAt400 = String(repeating:"x",count:399) + "😀"
        let cutAt150 = String(repeating:"x",count:149) + "😀"
        let context = OrderedJSON.object([.init(key:"userText",value:.string(cutAt400)),
                                          .init(key:"assistantText",value:.string("valid 😀 𠀀")),
                                          .init(key:"xRaw",value:.number("9007199254740993"))])
        let before = try context.encoded()
        func plan(_ text: String) throws -> OrderedJSON {
            try SharedWebOperations.call("evaluation",.object([
                .init(key:"operation",value:.string("localPrompt")),.init(key:"axis",value:.string("taskCompletion")),
                .init(key:"text",value:.string(text)),.init(key:"assistantResponse",value:context.required("assistantText")),
                .init(key:"language",value:.string("en"))]))
        }
        let first = try plan(cutAt400)
        XCTAssertTrue(try first.required("prompt").string("prompt").contains(String(repeating:"x",count:399) + "�"))
        XCTAssertTrue(try first.required("prompt").string("prompt").contains("valid 😀 𠀀"))
        let fallback = try plan(cutAt150)
        XCTAssertTrue(try fallback.required("fallback").string("fallback").contains(String(repeating:"x",count:149) + "�"))
        XCTAssertEqual(try context.encoded(),before)
    }

    func testStaleRequestDoesNotStartGenerator() async throws {
        let calls = LocalEvaluationCalls()
        let generator: LocalLlama.Generator = { _, request, _ in _ = await calls.record(request) }
        do {
            _ = try await NativeLocalEvaluation.runQuality(context:json(#"{"userText":"question","contextText":"question"}"#),
                scope:"single",modelURL:URL(fileURLWithPath:"/private/tmp/FAKE.gguf"),generator:generator,isCurrent:{ false })
            XCTFail("stale evaluation accepted")
        } catch {
            let prompts = await calls.prompts
            XCTAssertTrue(prompts.isEmpty)
        }
    }

    func testReplacingModelDuringFirstAxisRejectsMixedResult() async throws {
        let (files,directory) = try modelFixture()
        defer { try? FileManager.default.removeItem(at:directory) }
        let modelURL = try files.installed(modelID:"analysis-model")
        let calls = LocalEvaluationCalls()
        let generator: LocalLlama.Generator = { _, request, onText in
            _ = await calls.record(request)
            let replacement = directory.appendingPathComponent("replacement.gguf")
            try Data("GGUF REPLACEMENT".utf8).write(to:replacement)
            guard rename(replacement.path,modelURL.path) == 0 else { throw POSIXError(.EIO) }
            _ = try await onText("good")
        }
        var progress: [OrderedJSON] = []
        do {
            _ = try await NativeLocalEvaluation.runQuality(context:json(#"{"userText":"question","contextText":"question"}"#),
                scope:"single",modelURL:modelURL,generator:generator,onProgress:{ progress.append($0) })
            XCTFail("mixed-model evaluation accepted")
        } catch {
            let prompts = await calls.prompts
            XCTAssertEqual(prompts.count,1)
            XCTAssertFalse(progress.contains { $0["taskCompletion"] == .string("done") })
        }
    }
    func testRealGGUFExecutesSharedFiveAxisEvaluationWhenModelIsProvided() async throws {
        guard let path = ProcessInfo.processInfo.environment["WEAVELET_REAL_GGUF"] else { throw XCTSkip("Provide an existing test GGUF for native inference") }
        let model = path.hasPrefix("/") ? URL(fileURLWithPath:path) : URL(fileURLWithPath:NSHomeDirectory()).appendingPathComponent(path)
        var progress: [OrderedJSON] = []
        let context = try json(#"{"userText":"Write a short story.","contextText":"[user]\nWrite a short story.","assistantText":"Anna and Ben played together."}"#)
        let result = try await NativeLocalEvaluation.runQuality(context:context,scope:"single",language:"en",modelURL:model,onProgress:{ progress.append($0) })
        XCTAssertEqual(result["source"],.string("local"))
        XCTAssertEqual(try result.required("scores").object("scores").count,5)
        XCTAssertEqual(progress.count,15)
        for field in try result.required("scores").object("scores") {
            let score = try field.value.number("score")
            XCTAssertTrue(score.isFinite && score >= 0 && score <= 1)
        }
    }

}
