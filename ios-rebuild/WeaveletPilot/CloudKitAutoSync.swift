import Foundation

@MainActor final class CloudKitAutoSync {
    private let delayNanoseconds: UInt64
    private let sleep: @MainActor (UInt64) async throws -> Void
    private let send: @MainActor () async throws -> Void
    private let onError: @MainActor (Error) -> Void
    private var pending = false
    private var generation = 0
    private var timer: Task<Void, Never>?
    private var inFlight: Task<Void, Error>?

    init(delayNanoseconds: UInt64, sleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) }, send: @escaping @MainActor () async throws -> Void, onError: @escaping @MainActor (Error) -> Void) {
        self.delayNanoseconds = delayNanoseconds
        self.sleep = sleep
        self.send = send
        self.onError = onError
    }

    func enqueue() {
        pending = true
        if inFlight == nil { schedule() }
    }

    func flush() async throws {
        timer?.cancel()
        timer = nil
        if let inFlight {
            try await inFlight.value
            if pending { try await flush() }
            return
        }
        guard pending else { return }
        pending = false
        let startedGeneration = generation
        let operation = Task { try await send() }
        inFlight = operation
        do {
            try await operation.value
        } catch {
            inFlight = nil
            let changedDuringSend = pending
            if generation == startedGeneration { pending = true }
            if changedDuringSend { schedule() }
            throw error
        }
        inFlight = nil
        if pending { schedule() }
    }

    func cancel() {
        generation += 1
        pending = false
        timer?.cancel()
        timer = nil
    }

    private func schedule() {
        timer?.cancel()
        let scheduledGeneration = generation
        timer = Task { [weak self] in
            guard let self else { return }
            do {
                try await sleep(delayNanoseconds)
                try Task.checkCancellation()
                try await flush()
            } catch is CancellationError {
                // Disconnect and a newer edit both cancel only the scheduled wait.
            } catch {
                if generation == scheduledGeneration { onError(error) }
            }
        }
    }
}
