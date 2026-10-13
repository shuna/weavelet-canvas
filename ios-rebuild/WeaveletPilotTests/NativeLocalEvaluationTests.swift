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
}
