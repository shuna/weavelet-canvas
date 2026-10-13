import XCTest
import WebKit
@testable import WeaveletPilot

@MainActor final class WKClassifierHostTests: XCTestCase {
    private func fixture() throws -> [(path: String, data: Data)] {
        let root = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ClassifierFixtureResources", withExtension: nil))
        return try ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"].map { ($0, try Data(contentsOf: root.appendingPathComponent($0))) }
    }
    private func host() throws -> WKClassifierHost { try WKClassifierHost(origin: "fixture/trusted", files: fixture()) }
    func testTaskCancellationRejectsPendingPublicClassification() async throws {
        let host = try host(); defer { host.shutdown() }
        try await host.load()
        let view = try XCTUnwrap(host.webView)
        _ = try await view.evaluateJavaScript("""
            window.classifierRequestEntered = new Promise(resolve => window.classifierRequestResolve = resolve);
            const send = window.classifierHost.send.bind(window.classifierHost);
            window.classifierHost.send = request => {
                if (request.type !== 'classify') return send(request);
                window.classifierRequestResolve();
                return new Promise(resolve => window.releaseClassification = () => resolve());
            }; true
            """)
        let task = Task { try await host.classify(text: "日本語🙂") }
        _ = try await view.callAsyncJavaScript("await window.classifierRequestEntered; return true", arguments: [:], in: nil, contentWorld: .page)
        task.cancel()
        switch await task.result {
        case .success: XCTFail("Cancelled classification must not succeed")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        let before = host.acceptedMessages
        let state = try await view.callAsyncJavaScript("window.releaseClassification(); window.webkit.messageHandlers.classifierHost.postMessage({id:100,type:'classifyResult',labels:[]}); return window.classifierHost.state()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(state?["workerAlive"] as? Bool, false)
        XCTAssertEqual(host.acceptedMessages, before)
    }
    func testNoFixtureFallbackAndEncodedPathIdentity() async throws {
        XCTAssertThrowsError(try WKClassifierHost(origin: "fixture/trusted", files: []))
        XCTAssertThrowsError(try WKClassifierHost(origin: "fixture/trusted", files: [("../model", Data())]))
        XCTAssertThrowsError(try WKClassifierHost(origin: "fixture/trusted", files: [("a", Data()), ("a", Data())]))
        let extra: [(path: String, data: Data)] = [("é.bin", Data([1])), ("e\u{301}.bin", Data([2])), ("literal%2F.bin", Data([3])), ("nested/literal?#.bin", Data([4]))]
        let host = try WKClassifierHost(origin: "fixture/trusted", files: fixture() + extra); defer { host.shutdown() }
        try await host.load()
        let values = try await host.webView?.callAsyncJavaScript("""
            const encode = path => path.split('/').map(encodeURIComponent).join('/');
            return await Promise.all(names.map(async name => Array.from(new Uint8Array(await (await fetch('weavelet-classifier://model/' + encode(name))).arrayBuffer()))));
            """, arguments: ["names": extra.map(\.path)], in: nil, contentWorld: .page) as? [[Int]]
        XCTAssertEqual(values, [[1], [2], [3], [4]])
        let denied = try await host.webView?.callAsyncJavaScript("return await fetch('weavelet-classifier://bundle/model/config.json').then(() => false, () => true)", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(denied as? Bool, true)
    }
    func testOfflineWorkerPipelineWithTrustedSyntheticFixture() async throws {
        let proof = try host()
        defer { proof.shutdown(); print("CLASSIFIER_PROOF_LOCAL_RESOURCES", proof.resourceRequests) }
        try await proof.load()
        _ = try await proof.webView?.evaluateJavaScript("window.classifierHost.observeInputs = true; true")
        for text in ["hello", "日本語🙂 e\u{301} \" </script>", " \n\t ", String(repeating: "hello 日本語 ", count: 1000)] {
            let labels = try await proof.classify(text: text)
            XCTAssertEqual(labels.map(\.label), ["FIXTURE_TWO", "FIXTURE_ZERO"])
            XCTAssertEqual(labels[0].score, 0.880797, accuracy: 0.00001)
            XCTAssertEqual(labels[1].score, 0.119203, accuracy: 0.00001)
            XCTAssertEqual(proof.inputObservation?["utf16"] as? [Int], text.utf16.map(Int.init))
            XCTAssertEqual(proof.inputObservation?["utf8"] as? [Int], text.utf8.map(Int.init))
        }
        try await proof.unload()
        let status = try await proof.webView?.evaluateJavaScript("window.classifierHost.state()") as? [String: Any]
        XCTAssertEqual(status?["workerAlive"] as? Bool, false)
        proof.shutdown()
        XCTAssertTrue(proof.resourceRequests.contains("bundle/ort-wasm-simd-threaded.mjs"))
        XCTAssertTrue(proof.resourceRequests.contains("bundle/ort-wasm-simd-threaded.wasm"))
    }
    func testMissingLocalModelCannotFallBackToRemoteFetch() async throws {
        let proof = try WKClassifierHost(origin: "fixture/missing", files: fixture().filter { !$0.path.hasSuffix(".onnx") }); defer { proof.shutdown() }
        do { try await proof.load(); XCTFail("Missing fixed model must fail") }
        catch { XCTAssertTrue(String(describing: error).contains("Load failed")) }
        XCTAssertFalse(proof.blockedFetchURLs.isEmpty)
        XCTAssertTrue(proof.blockedFetchURLs.allSatisfy { !$0.hasPrefix("https:") && !$0.hasPrefix("http:") })
        print("CLASSIFIER_PROOF_BLOCKED_LOCAL_MISS", proof.blockedFetchURLs)
        let denied = try await proof.webView?.callAsyncJavaScript("return await fetch('https://fixture.invalid/blocked').then(() => false, () => true)", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(denied as? Bool, true)
    }
    func testCancelTerminatesWorkerAndRejectsLateOutput() async throws {
        let proof = try host(); defer { proof.shutdown() }
        _ = try await proof.start()
        let work = Task { try await proof.request("loadClassifier") }
        await Task.yield()
        let before = proof.acceptedMessages
        proof.cancel()
        switch await work.result {
        case .success: XCTFail("Cancelled model loading must not publish success")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        _ = try await proof.webView?.evaluateJavaScript("window.webkit.messageHandlers.classifierHost.postMessage({id:100,type:'classifyResult',labels:[{label:'STALE',score:1}]}); true")
        let status = try await proof.webView?.evaluateJavaScript("window.classifierHost.state()") as? [String: Any]
        XCTAssertEqual(status?["workerAlive"] as? Bool, false)
        XCTAssertEqual(proof.acceptedMessages, before)
    }
    func testWebContentTerminationCallbackRejectsPendingInference() async throws {
        let proof = try host(); defer { proof.shutdown() }
        _ = try await proof.start()
        let view = try XCTUnwrap(proof.webView)
        let work = Task { try await proof.request("loadClassifier") }
        await Task.yield()
        // Exercise the OS delegate boundary, without inducing an actual process crash or using private APIs.
        proof.webViewWebContentProcessDidTerminate(view)
        switch await work.result {
        case .success: XCTFail("Terminated WebContent must not publish success")
        case .failure(let error): XCTAssertTrue(String(describing: error).contains("terminated"))
        }
        XCTAssertNotNil(proof.failure)
    }

    func testCancelDuringBootFetchDoesNotCreateWorkerAfterFetchCompletes() async throws {
        let proof = try host(); defer { proof.shutdown() }
        _ = try await proof.start()
        let view = try XCTUnwrap(proof.webView)
        let waiting = try await view.callAsyncJavaScript("""
            window.classifierHost.cancel();
            const originalFetch = window.fetch.bind(window);
            const entered = new Promise(resolve => window.proofFetchEntered = resolve);
            window.fetch = (input, init) => {
                if (input !== 'weavelet-classifier://bundle/worker.js') return originalFetch(input, init);
                return originalFetch(input, init).then(response => new Promise(resolve => {
                    window.releaseProofBootFetch = () => resolve(response);
                    window.proofFetchEntered();
                }));
            };
            window.pendingProofBoot = window.classifierHost.boot();
            await entered;
            return window.classifierHost.state();
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(waiting?["workerAlive"] as? Bool, false)
        let before = proof.acceptedMessages
        proof.cancel()
        let resumed = try await view.callAsyncJavaScript("""
            window.releaseProofBootFetch();
            await window.pendingProofBoot;
            window.webkit.messageHandlers.classifierHost.postMessage({id:100,type:'classifyResult',labels:[{label:'STALE',score:1}]});
            return window.classifierHost.state();
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(resumed?["workerAlive"] as? Bool, false)
        XCTAssertEqual(proof.acceptedMessages, before)
    }

}
