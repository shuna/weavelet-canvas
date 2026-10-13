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
