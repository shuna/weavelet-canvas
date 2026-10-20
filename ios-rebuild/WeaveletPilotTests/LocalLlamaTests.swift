import XCTest
@testable import WeaveletPilot
#if targetEnvironment(macCatalyst) && arch(arm64)
import llama
#endif

private actor LocalLlamaTexts {
    var values: [String] = []
    func add(_ value: String, stop: Bool = true) -> Bool { values.append(value); return stop }
}
final class LocalLlamaTests: XCTestCase {
    func testInvalidModelAndTaskCancellationDoNotProduceText() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let request = LocalLlamaRequest(messages:[],assistantPrefix:nil,maxTokens:16,temperature:0,fallbackPrompt:"Once upon a time")
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("missing-\(UUID()).gguf")
        do {
            try await LocalLlama.generate(modelURL:missing,request:request) { _ in XCTFail("Missing model produced output"); return false }
            XCTFail("Missing model accepted")
        } catch LocalLlamaError.modelLoad {}
        let task = Task { try await LocalLlama.generate(modelURL:missing,request:request) { _ in XCTFail("Cancelled request produced output"); return false } }
        task.cancel()
        do { try await task.value; XCTFail("Cancellation accepted") } catch is CancellationError {}
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }
    func testTensorByteOverflowIsRejectedBeforeAllocation() throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        // Official 4e5b83b2 regression: I64 elements fit Int64 but their byte size exceeds SIZE_MAX.
        var data = Data("GGUF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of:&little) { data.append(contentsOf:$0) } }
        append(UInt32(3)); append(UInt64(1)); append(UInt64(0))
        append(UInt64(1)); data.append(120); append(UInt32(2))
        append(UInt64(1)<<31); append(UInt64(1)<<31); append(UInt32(27)); append(UInt64(0))
        while data.count % 32 != 0 { data.append(0) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("overflow-\(UUID()).gguf")
        defer { try? FileManager.default.removeItem(at:url) }
        try data.write(to:url)
        let parsed = gguf_init_from_file(url.path,gguf_init_params(no_alloc:true,ctx:nil))
        if let parsed { gguf_free(parsed); XCTFail("Overflow tensor accepted") }
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }

    func testOfficialTinyGGUFCompletesTokenBudgetAndCanRunAgain() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let path = ProcessInfo.processInfo.environment["WEAVELET_LLAMA_TEST_MODEL"] ?? "/private/tmp/weavelet-local-llama-test/stories260K.gguf"
        guard FileManager.default.fileExists(atPath:path) else { throw XCTSkip("Optional official GGUF fixture is not bundled/downloaded by tests") }
        let request = LocalLlamaRequest(messages:[.init(role:"user",content:"Once upon a time")],assistantPrefix:nil,maxTokens:8,temperature:0,contextSize:128,fallbackPrompt:"Once upon a time")
        for _ in 0..<2 {
            let texts = LocalLlamaTexts()
            try await LocalLlama.generate(modelURL:URL(fileURLWithPath:path),request:request) { text in await texts.add(text,stop:false) }
            let values = await texts.values
            XCTAssertEqual(values.count,8)
            XCTAssertFalse(try XCTUnwrap(values.last).isEmpty)
        }
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }

    func testOfficialSplitTinyGGUFLoadsAllShardsAndRejectsMissingShard() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let firstPath = ProcessInfo.processInfo.environment["WEAVELET_LLAMA_SPLIT_TEST_MODEL"] ?? "/private/tmp/weavelet-local-llama-test/split/stories260K-00001-of-00002.gguf"
        let first = URL(fileURLWithPath:firstPath)
        let second = first.deletingLastPathComponent().appendingPathComponent("stories260K-00002-of-00002.gguf")
        guard FileManager.default.fileExists(atPath:first.path), FileManager.default.fileExists(atPath:second.path) else {
            throw XCTSkip("Optional official split GGUF fixture is not present; create it with llama-gguf-split before running this test")
        }
        let copiedDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("split-gguf-\(UUID().uuidString)",isDirectory:true)
        try FileManager.default.createDirectory(at:copiedDirectory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:copiedDirectory) }
        let copiedFirst = copiedDirectory.appendingPathComponent(first.lastPathComponent)
        let copiedSecond = copiedDirectory.appendingPathComponent(second.lastPathComponent)
        try FileManager.default.copyItem(at:first,to:copiedFirst)
        try FileManager.default.copyItem(at:second,to:copiedSecond)
        let request = LocalLlamaRequest(messages:[.init(role:"user",content:"Once upon a time")],assistantPrefix:nil,maxTokens:8,temperature:0,contextSize:128,fallbackPrompt:"Once upon a time")
        let texts = LocalLlamaTexts()
        try await LocalLlama.generate(modelURL:copiedFirst,request:request) { text in await texts.add(text,stop:false) }
        let values = await texts.values
        XCTAssertEqual(values.count,8)
        try FileManager.default.removeItem(at:copiedSecond)
        do {
            try await LocalLlama.generate(modelURL:copiedFirst,request:request) { _ in XCTFail("Missing shard produced output"); return false }
            XCTFail("Missing split shard accepted")
        } catch LocalLlamaError.modelLoad {}
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }

    func testScopedModelSessionKeepsFreshContextsAndUnwindsCallbackFailure() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let path = ProcessInfo.processInfo.environment["WEAVELET_LLAMA_TEST_MODEL"] ?? "/private/tmp/weavelet-local-llama-test/stories260K.gguf"
        guard FileManager.default.fileExists(atPath:path) else { throw XCTSkip("Optional official GGUF fixture is not bundled/downloaded by tests") }
        let modelURL = URL(fileURLWithPath:path)
        let request = LocalLlamaRequest(messages:[.init(role:"user",content:"Once upon a time")],assistantPrefix:nil,maxTokens:8,temperature:0,contextSize:128,fallbackPrompt:"Once upon a time")
        enum CallbackFailure: Error { case expected }
        do {
            try await LocalLlama.withModelSession(modelURL:modelURL) { generate in
                do {
                    try await generate(modelURL.appendingPathExtension("other"),request) { _ in XCTFail("Different model used the session"); return false }
                    XCTFail("Different model accepted")
                } catch LocalLlamaError.invalidRequest {}
                var first: [String] = []
                for _ in 0..<2 {
                    let texts = LocalLlamaTexts()
                    try await generate(modelURL,request) { await texts.add($0,stop:false) }
                    let values = await texts.values
                    XCTAssertEqual(values.count,8)
                    if first.isEmpty { first = values } else { XCTAssertEqual(values,first) }
                }
                try await generate(modelURL,request) { _ in throw CallbackFailure.expected }
            }
            XCTFail("Callback error swallowed")
        } catch CallbackFailure.expected {}
        // A new job must work after the old job's context, sampler and model have unwound.
        let texts = LocalLlamaTexts()
        try await LocalLlama.withModelSession(modelURL:modelURL) { generate in
            try await generate(modelURL,request) { await texts.add($0) }
        }
        let values = await texts.values
        XCTAssertEqual(values.count,1)
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }

    func testScopedModelSessionUnwindsCancellationDuringDecode() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let path = ProcessInfo.processInfo.environment["WEAVELET_LLAMA_TEST_MODEL"] ?? "/private/tmp/weavelet-local-llama-test/stories260K.gguf"
        guard FileManager.default.fileExists(atPath:path) else { throw XCTSkip("Optional official GGUF fixture is not bundled/downloaded by tests") }
        let modelURL = URL(fileURLWithPath:path)
        let request = LocalLlamaRequest(messages:[],assistantPrefix:nil,maxTokens:16,temperature:0,contextSize:128,fallbackPrompt:"Once upon a time")
        let (started, signal) = AsyncStream<Void>.makeStream()
        let task = Task {
            defer { signal.finish() }
            try await LocalLlama.withModelSession(modelURL:modelURL) { generate in
                try await generate(modelURL,request) { _ in
                    signal.yield(())
                    while !Task.isCancelled { await Task.yield() }
                    try Task.checkCancellation()
                    return false
                }
            }
        }
        for await _ in started { task.cancel(); break }
        do { try await task.value; XCTFail("Cancellation swallowed") } catch is CancellationError {}
        let texts = LocalLlamaTexts()
        try await LocalLlama.generate(modelURL:modelURL,request:request) { await texts.add($0) }
        let values = await texts.values
        XCTAssertEqual(values.count,1)
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }

    func testOfficialTinyGGUFDecodesAndCallbackStopsAfterOneOutput() async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        let path = ProcessInfo.processInfo.environment["WEAVELET_LLAMA_TEST_MODEL"] ?? "/private/tmp/weavelet-local-llama-test/stories260K.gguf"
        guard FileManager.default.fileExists(atPath:path) else { throw XCTSkip("Optional official GGUF fixture is not bundled/downloaded by tests") }
        let texts = LocalLlamaTexts()
        let request = LocalLlamaRequest(messages:[.init(role:"user",content:"Once upon a time")],assistantPrefix:nil,maxTokens:16,temperature:0,contextSize:128,fallbackPrompt:"Once upon a time")
        try await LocalLlama.generate(modelURL:URL(fileURLWithPath:path),request:request) { text in await texts.add(text) }
        let values = await texts.values
        XCTAssertEqual(values.count,1); XCTAssertFalse(try XCTUnwrap(values.first).isEmpty)
        #else
        throw XCTSkip("Catalyst arm64 engine boundary")
        #endif
    }
}
