import XCTest
@testable import WeaveletPilot

@MainActor final class CloudKitAutoSyncTests: XCTestCase {
    func testCoalescesEditsAndWaitsForInFlightSend() async throws {
        let gate = SendGate()
        let started = expectation(description: "first send started")
        var sends = 0
        let queue = CloudKitAutoSync(delayNanoseconds: 60_000_000_000, send: {
            sends += 1
            if sends == 1 { started.fulfill(); await gate.wait() }
        }, onError: { XCTFail("unexpected error: \($0)") })

        queue.enqueue(); queue.enqueue()
        let first = Task { try await queue.flush() }
        await fulfillment(of: [started], timeout: 1)
        queue.enqueue(); queue.enqueue()
        XCTAssertEqual(sends, 1)
        gate.release()
        try await first.value
        XCTAssertEqual(sends, 1)
        try await queue.flush()
        XCTAssertEqual(sends, 2)
        queue.cancel()
    }

    func testFailureWaitsForExplicitRetry() async throws {
        enum Failure: Error { case expected }
        var sends = 0
        let queue = CloudKitAutoSync(delayNanoseconds: 60_000_000_000, send: {
            sends += 1
            if sends == 1 { throw Failure.expected }
        }, onError: { XCTFail("unexpected timer error: \($0)") })

        queue.enqueue()
        do { try await queue.flush(); XCTFail("send should fail") }
        catch Failure.expected {}
        XCTAssertEqual(sends, 1)
        try await queue.flush()
        XCTAssertEqual(sends, 2)
        queue.cancel()
    }

    func testCancelDropsQueuedEditsIncludingOneDuringSend() async throws {
        let gate = SendGate()
        let started = expectation(description: "send started")
        var sends = 0
        let queue = CloudKitAutoSync(delayNanoseconds: 60_000_000_000, send: {
            sends += 1
            started.fulfill()
            await gate.wait()
        }, onError: { XCTFail("unexpected error: \($0)") })

        queue.enqueue(); queue.cancel()
        try await queue.flush()
        XCTAssertEqual(sends, 0)
        queue.enqueue()
        let first = Task { try await queue.flush() }
        await fulfillment(of: [started], timeout: 1)
        queue.enqueue(); queue.cancel()
        gate.release()
        try await first.value
        try await queue.flush()
        XCTAssertEqual(sends, 1)
    }
}

@MainActor private final class SendGate {
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async { await withCheckedContinuation { continuation = $0 } }
    func release() { continuation?.resume(); continuation = nil }
}
