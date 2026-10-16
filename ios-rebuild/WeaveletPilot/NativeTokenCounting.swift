import Foundation

@MainActor final class NativeTokenCounting {
    typealias Counter = @MainActor @Sendable (OrderedJSON, String) async throws -> Int
    typealias Limiter = @MainActor @Sendable (OrderedJSON, String, Int) async throws -> OrderedJSON
    private var host: WKTokenizerHost?
    private var loading: Task<Void, Never>?
    private var ready = false
    private var unavailable = false
    private var epoch = 0
    var isReady: Bool { ready || counter != nil }
    private let counter: Counter?
    private let limiter: Limiter?
    nonisolated init(count: Counter? = nil, limit: Limiter? = nil) { counter = count; limiter = limit }

    private func fallback(_ operation: String, messages: OrderedJSON, count: Int? = nil, limit: Int? = nil) throws -> OrderedJSON {
        var fields: [JSONField] = [.init(key:"operation",value:.string(operation)),.init(key:"messages",value:messages)]
        if let count { fields.append(.init(key:"count",value:.number(String(count)))) }
        if let limit { fields.append(.init(key:"limit",value:.number(String(limit)))) }
        return try SharedWebOperations.call("tokenizerOperation",.object(fields))
    }
    private func startLoading() {
        guard !ready, !unavailable, loading == nil, counter == nil else { return }
        let host = WKTokenizerHost(); self.host = host
        let generation = epoch
        loading = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { if self.epoch == generation { self.loading = nil } }
            do {
                try await host.load(); try Task.checkCancellation()
                guard self.epoch == generation else { return }
                self.ready = true
            } catch {
                guard self.epoch == generation else { return }
                host.shutdown(); self.host = nil
                self.unavailable = !(error is CancellationError)
            }
        }
    }
    func count(messages: OrderedJSON, model: String) async throws -> Int {
        try Task.checkCancellation()
        if counter == nil, !ready { startLoading(); return try fallback("fallbackCount",messages:messages).nativeTokenInteger("token count") }
        let generation = epoch
        do {
            let count: Int
            if let counter { count = try await counter(messages,model) }
            else { count = try await host!.countTokens(messages:messages,model:model) }
            try Task.checkCancellation(); guard epoch == generation else { throw CancellationError() }
            guard count >= 0 else { throw ExchangeError.invalid("token count") }
            return try fallback("ensureCount",messages:messages,count:count).nativeTokenInteger("token count")
        } catch {
            if error is CancellationError || Task.isCancelled || epoch != generation { throw CancellationError() }
            unavailable = true; ready = false; host?.shutdown(); host = nil
            return try fallback("fallbackCount",messages:messages).nativeTokenInteger("token count")
        }
    }
    func limit(messages: OrderedJSON, model: String, limit: Int) async throws -> OrderedJSON {
        try Task.checkCancellation()
        let generation = epoch
        startLoading()
        if let loading {
            await loading.value
        }
        try Task.checkCancellation()
        guard epoch == generation else { throw CancellationError() }
        do {
            let result: OrderedJSON
            if let limiter { result = try await limiter(messages,model,limit) }
            else if ready, let host { result = try await host.limitMessages(messages:messages,model:model,limit:limit) }
            else { return try limitedFallback(messages:messages,limit:limit) }
            try Task.checkCancellation(); guard epoch == generation else { throw CancellationError() }
            _ = try result.array("limited messages")
            return result
        } catch {
            if error is CancellationError || Task.isCancelled || epoch != generation { throw CancellationError() }
            unavailable = true; ready = false; host?.shutdown(); host = nil
            return try limitedFallback(messages:messages,limit:limit)
        }
    }
    private func limitedFallback(messages: OrderedJSON, limit: Int) throws -> OrderedJSON {
        let original = try messages.array("token messages")
        let indices = try fallback("fallbackLimit",messages:messages,limit:limit).array("token indices")
        return .array(try indices.map { value in
            let index = try value.nativeTokenInteger("token index")
            guard original.indices.contains(index) else { throw ExchangeError.invalid("token index") }
            return original[index]
        })
    }
    func counts(plan: OrderedJSON) async throws -> OrderedJSON {
        let model = try plan.required("model").string("token model")
        let prompt = try await count(messages:plan.required("promptMessages"),model:model)
        let completion: Int
        if let message = plan["completionMessage"], message != .null { completion = try await count(messages:.array([message]),model:model) }
        else { completion = 0 }
        var fields: [JSONField] = [.init(key:"promptTokens",value:.number(String(prompt))),.init(key:"completionTokens",value:.number(String(completion)))]
        if let original = plan["originalMessages"], let replacement = plan["replacementMessage"] {
            let originalCount = try await count(messages:original,model:model)
            let replacementCount = try await count(messages:.array([replacement]),model:model)
            fields.append(.init(key:"originalTokens",value:.number(String(originalCount))))
            fields.append(.init(key:"replacementTokens",value:.number(String(replacementCount))))
        }
        return .object(fields)
    }
    func shutdown() {
        epoch += 1; loading?.cancel(); loading = nil
        host?.shutdown(); host = nil; ready = false; unavailable = false
    }
}

extension OrderedJSON {
    func nativeTokenInteger(_ field: String) throws -> Int {
        let value = try number(field)
        guard value.isFinite, value >= 0, value.rounded() == value, value < Double(Int.max) else { throw ExchangeError.invalid(field) }
        return Int(value)
    }
}
