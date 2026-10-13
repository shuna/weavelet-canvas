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
        let model = URL(fileURLWithPath:path)
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
