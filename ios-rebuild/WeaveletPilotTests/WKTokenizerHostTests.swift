import XCTest
@testable import WeaveletPilot

@MainActor final class WKTokenizerHostTests: XCTestCase {
    private func vectors() throws -> (cases: [OrderedJSON], expected: [OrderedJSON]) {
        let root = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "TokenizerFixtureResources", withExtension: nil))
        return try (OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("vectors.json"))).required("cases").array("cases"),
            OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("expected.json"))).array("expected"))
    }
    func testActualWebCountAndLimitVectorsKeepRawUnknownFields() async throws {
        let vectors = try vectors(), host = WKTokenizerHost()
        defer { host.shutdown(); print("TOKENIZER_LOCAL_RESOURCES", host.resourceRequests) }
        try await host.load()
        for (index, vector) in vectors.cases.enumerated() {
            let messages = try vector.required("messages"), model = try vector.required("model").string("model")
            let count = try await host.countTokens(messages: messages, model: model)
            XCTAssertEqual(count, Int(try vectors.expected[index].required("count").number("count")))
            let limited = try await host.limitMessages(messages: messages, model: model, limit: Int(try vector.required("limit").number("limit")))
            let indices = try vectors.expected[index].required("indices").array("indices").map { Int(try $0.number("index")) }
            let originals = try messages.array("messages")
            XCTAssertEqual(try limited.encoded(), try OrderedJSON.array(indices.map { originals[$0] }).encoded())
        }
        let retained = try await host.limitMessages(messages: vectors.cases[1].required("messages"), model: "gpt-4", limit: 16)
        let raw = try XCTUnwrap(retained.array("retained").first)
        XCTAssertEqual(raw["unknown"]?["number"], .number("9007199254740993"))
        XCTAssertEqual(raw["unknown"]?["lone"], try vectors.cases[1].required("messages").array("messages")[2]["unknown"]?["lone"])
        XCTAssertEqual(try raw.required("unknown").required("nfd").stringKey("nfd").utf16, [101, 769])
    }
    func testCancellingOneRequestKeepsOtherRequestAndWorkerAlive() async throws {
        let host = WKTokenizerHost(); defer { host.shutdown() }
        try await host.load()
        let view = try XCTUnwrap(host.webView)
        _ = try await view.evaluateJavaScript("""
            window.tokenizerRequests = [];
            window.tokenizerEntered = new Promise(resolve => window.tokenizerResolve = resolve);
            window.tokenizerOriginalSend = window.tokenizerHost.send.bind(window.tokenizerHost);
            window.tokenizerHost.send = json => {
                if (JSON.parse(json).type !== 'countTokens') return window.tokenizerOriginalSend(json);
                window.tokenizerRequests.push(JSON.parse(json).id);
                if (window.tokenizerRequests.length === 2) window.tokenizerResolve();
            }; true
            """)
        let cancelled = Task { try await host.countTokens(messages: .array([]), model: "gpt-4") }
        _ = try await view.callAsyncJavaScript("while (window.tokenizerRequests.length < 1) await new Promise(resolve => setTimeout(resolve, 1)); return true", arguments: [:], in: nil, contentWorld: .page)
        let surviving = Task { try await host.countTokens(messages: .array([]), model: "gpt-4") }
        _ = try await view.callAsyncJavaScript("await window.tokenizerEntered; return true", arguments: [:], in: nil, contentWorld: .page)
        let requestIDs = try await view.evaluateJavaScript("window.tokenizerRequests") as? [Int]
        let ids = try XCTUnwrap(requestIDs)
        let before = host.acceptedMessages
        _ = try await view.callAsyncJavaScript("window.webkit.messageHandlers.tokenizerHost.postMessage({epoch:0,json:JSON.stringify({id:ids[0],type:'countTokensResult',count:99})});return true", arguments: ["ids": ids], in: nil, contentWorld: .page)
        XCTAssertEqual(host.acceptedMessages, before)
        cancelled.cancel()
        switch await cancelled.result {
        case .success: XCTFail("Cancelled count must fail")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        let state = try await view.callAsyncJavaScript("window.webkit.messageHandlers.tokenizerHost.postMessage({epoch:1,json:JSON.stringify({id:ids[0],type:'countTokensResult',count:99})});window.webkit.messageHandlers.tokenizerHost.postMessage({epoch:1,json:JSON.stringify({id:ids[1],type:'countTokensResult',count:7})});return window.tokenizerHost.state()", arguments: ["ids": ids], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(state?["workerAlive"] as? Bool, true)
        let survivingCount = try await surviving.value
        XCTAssertEqual(survivingCount, 7)
        XCTAssertEqual(host.acceptedMessages, before + 1)
        _ = try await view.evaluateJavaScript("window.tokenizerHost.send = window.tokenizerOriginalSend; true")
        let subsequentCount = try await host.countTokens(messages: .array([]), model: "gpt-4")
        XCTAssertGreaterThanOrEqual(subsequentCount, 0)
    }
    func testCancellingOneLoadWaiterKeepsSharedLoadAlive() async throws {
        let host = WKTokenizerHost(); defer { host.shutdown() }
        let cancelled = Task { try await host.load() }
        let surviving = Task { try await host.load() }
        let deadline = Date().addingTimeInterval(5)
        while host.webView == nil && Date() < deadline { try await Task.sleep(nanoseconds: 1_000_000) }
        XCTAssertNotNil(host.webView)
        cancelled.cancel()
        switch await cancelled.result {
        case .success: XCTFail("Cancelled load waiter must fail")
        case .failure(let error): XCTAssertTrue(error is CancellationError)
        }
        try await surviving.value
        let count = try await host.countTokens(messages: .array([]), model: "gpt-4")
        XCTAssertGreaterThanOrEqual(count, 0)
    }
    func testOfflineResourceGateAndSelectionValidation() async throws {
        let host = WKTokenizerHost(); defer { host.shutdown() }
        try await host.load()
        let view = try XCTUnwrap(host.webView)
        let denied = try await view.callAsyncJavaScript("""
            const urls = ['https://fixture.invalid/blocked','http://fixture.invalid/blocked','weavelet-tokenizer://bundle/provenance.json','weavelet-tokenizer://bundle/worker.js?anything'];
            return await Promise.all(urls.map(url => fetch(url).then(() => false, () => true)));
            """, arguments: [:], in: nil, contentWorld: .page) as? [Bool]
        XCTAssertEqual(denied, [true, true, true, true])
        let websocketDenied = try await view.evaluateJavaScript("(() => {try { new WebSocket('wss://fixture.invalid/blocked'); return false; } catch { return true; }})()")
        XCTAssertEqual(websocketDenied as? Bool, true)
        _ = try await view.evaluateJavaScript("window.tokenizerHost.send = json => { const request=JSON.parse(json); window.webkit.messageHandlers.tokenizerHost.postMessage({epoch:1,json:JSON.stringify({id:request.id,type:'limitMessagesResult',indices:[0,0]})}); };true")
        do {
            _ = try await host.limitMessages(messages: .array([.object([])]), model: "gpt-4", limit: 16)
            XCTFail("Duplicate selection must fail")
        } catch { XCTAssertTrue(String(describing: error).contains("selection")) }
    }
}
