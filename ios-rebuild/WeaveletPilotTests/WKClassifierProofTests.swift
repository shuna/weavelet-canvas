import XCTest
import WebKit
@testable import WeaveletPilot

@MainActor final class WKClassifierProofTests: XCTestCase {
    func testOfflineWorkerPipelineWithTrustedSyntheticFixture() async throws {
        let proof = WKClassifierProof()
        defer { proof.shutdown(); print("CLASSIFIER_PROOF_LOCAL_RESOURCES", proof.resourceRequests) }
        let started = try await proof.start()
        XCTAssertEqual(started["type"] as? String, "runtimeReady")
        print("CLASSIFIER_PROOF_RUNTIME", started)
        let loaded: [String: Any]
        do { loaded = try await proof.request("loadClassifier") }
        catch { print("CLASSIFIER_PROOF_LOAD_ERROR", String(reflecting: type(of: error)), error as NSError); throw error }
        XCTAssertEqual(loaded["type"] as? String, "loaded")
        for text in ["hello", "日本語🙂 e\u{301}", " \n\t ", String(repeating: "hello 日本語 ", count: 1000)] {
            let output = try await proof.request("classify", text: text)
            let labels = try XCTUnwrap(output["labels"] as? [[String: Any]])
            XCTAssertEqual(labels.count, 2)
            XCTAssertEqual(labels[0]["label"] as? String, "FIXTURE_TWO")
            XCTAssertEqual(labels[0]["score"] as? Double ?? 0, 0.880797, accuracy: 0.00001)
            XCTAssertEqual(labels[1]["label"] as? String, "FIXTURE_ZERO")
            XCTAssertEqual(labels[1]["score"] as? Double ?? 0, 0.119203, accuracy: 0.00001)
            print("CLASSIFIER_PROOF_LABELS", labels)
        }
        let unloaded = try await proof.request("unload")
        XCTAssertEqual(unloaded["type"] as? String, "unloaded")
        let status = try await proof.webView?.evaluateJavaScript("window.classifierProof.state()") as? [String: Any]
        XCTAssertEqual(status?["workerAlive"] as? Bool, false)
        proof.shutdown()
        XCTAssertTrue(proof.resourceRequests.contains("ort-wasm-simd-threaded.mjs"))
        XCTAssertTrue(proof.resourceRequests.contains("ort-wasm-simd-threaded.wasm"))
    }
    func testMissingLocalModelCannotFallBackToRemoteFetch() async throws {
        let proof = WKClassifierProof(); defer { proof.shutdown() }
        _ = try await proof.start()
        do { _ = try await proof.request("loadClassifierMissing"); XCTFail("Missing fixed model must fail") }
        catch { XCTAssertTrue(String(describing: error).contains("Load failed")) }
        XCTAssertFalse(proof.blockedFetchURLs.isEmpty)
        XCTAssertTrue(proof.blockedFetchURLs.allSatisfy { !$0.hasPrefix("https:") && !$0.hasPrefix("http:") })
        print("CLASSIFIER_PROOF_BLOCKED_LOCAL_MISS", proof.blockedFetchURLs)
        let denied = try await proof.webView?.callAsyncJavaScript("return await fetch('https://fixture.invalid/blocked').then(() => false, () => true)", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(denied as? Bool, true)
    }
    func testCancelTerminatesWorkerAndRejectsLateOutput() async throws {
        let proof = WKClassifierProof(); defer { proof.shutdown() }
        _ = try await proof.start()
        let work = Task { try await proof.request("loadClassifier") }
        await Task.yield()
        let before = proof.acceptedMessages
        proof.cancel()
        switch await work.result {
        case .success: XCTFail("Cancelled model loading must not publish success")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        _ = try await proof.webView?.evaluateJavaScript("window.webkit.messageHandlers.classifierProof.postMessage({id:100,type:'classifyResult',labels:[{label:'STALE',score:1}]}); true")
        let status = try await proof.webView?.evaluateJavaScript("window.classifierProof.state()") as? [String: Any]
        XCTAssertEqual(status?["workerAlive"] as? Bool, false)
        XCTAssertEqual(proof.acceptedMessages, before)
    }
    func testWebContentTerminationCallbackRejectsPendingInference() async throws {
        let proof = WKClassifierProof(); defer { proof.shutdown() }
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
        let proof = WKClassifierProof(); defer { proof.shutdown() }
        _ = try await proof.start()
        let view = try XCTUnwrap(proof.webView)
        let waiting = try await view.callAsyncJavaScript("""
            window.classifierProof.cancel();
            const originalFetch = window.fetch.bind(window);
            const entered = new Promise(resolve => window.proofFetchEntered = resolve);
            window.fetch = (input, init) => {
                if (input !== 'weavelet-classifier://bundle/worker.js') return originalFetch(input, init);
                return originalFetch(input, init).then(response => new Promise(resolve => {
                    window.releaseProofBootFetch = () => resolve(response);
                    window.proofFetchEntered();
                }));
            };
            window.pendingProofBoot = window.classifierProof.boot();
            await entered;
            return window.classifierProof.state();
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(waiting?["workerAlive"] as? Bool, false)
        let before = proof.acceptedMessages
        proof.cancel()
        let resumed = try await view.callAsyncJavaScript("""
            window.releaseProofBootFetch();
            await window.pendingProofBoot;
            window.webkit.messageHandlers.classifierProof.postMessage({id:100,type:'classifyResult',labels:[{label:'STALE',score:1}]});
            return window.classifierProof.state();
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(resumed?["workerAlive"] as? Bool, false)
        XCTAssertEqual(proof.acceptedMessages, before)
    }

}
