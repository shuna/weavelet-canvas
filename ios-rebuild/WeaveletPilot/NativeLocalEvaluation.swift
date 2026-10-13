import Foundation

enum NativeLocalEvaluation {
    static func modelURL(state: OrderedJSON, files: LocalModelFiles) throws -> URL {
        guard state["localModelEnabled"] == .bool(true),
              let active = state["activeLocalModels"]?["analysis"], case .string(let modelID) = active,
              !modelID.isEmpty else { throw ExchangeError.invalid("分析モデルが選択されていません") }
        let models = try state.required("localModels").array("local models")
        guard let model = models.first(where: {
            guard let id = $0["id"], case .string(let value) = id else { return false }
            return value.utf8.elementsEqual(modelID.utf8)
        }), model["engine"] == .string("wllama"), model["manifest"]?["kind"] == .string("single-file"),
              try model.required("tasks").array("local tasks").contains(.string("analysis")) else {
            throw ExchangeError.invalid("選択した分析モデルは単一GGUFによる品質評価に対応していません")
        }
        return try files.installed(modelID:modelID)
    }

    @MainActor
    static func runQuality(context: OrderedJSON, scope: String, language: String = "en", modelURL: URL,
                           generator: @escaping LocalLlama.Generator = LocalLlama.generate,
                           isCurrent: @escaping @MainActor @Sendable () -> Bool = { true },
                           onProgress: @escaping @MainActor (OrderedJSON) -> Void = { _ in }) async throws -> OrderedJSON {
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        guard ["single","full-context"].contains(scope) else { throw ExchangeError.invalid("評価範囲") }
        let text = try (scope == "full-context" ? context.required("contextText") : context.required("userText")).string("評価文")
        guard !text.isEmpty else { throw ExchangeError.invalid("評価文が空です") }
        let assistantResponse = try context["assistantText"]?.string("応答")
        let axes = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localAxes"))]))
            .array("quality axes").map { try $0.string("quality axis") }
        guard axes.count == 5 else { throw ExchangeError.invalid("品質評価軸") }
        for axis in axes { onProgress(.object([.init(key:axis,value:.string("waiting"))])) }
        var outputs: [JSONField] = []
        for axis in axes {
            try Task.checkCancellation()
            guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
            onProgress(.object([.init(key:axis,value:.string("generating"))]))
            var fields: [JSONField] = [.init(key:"operation",value:.string("localPrompt")),
                .init(key:"axis",value:.string(axis)),.init(key:"text",value:.string(text)),
                .init(key:"language",value:.string(language))]
            if let assistantResponse { fields.append(.init(key:"assistantResponse",value:.string(assistantResponse))) }
            let plan = try SharedWebOperations.call("evaluation",.object(fields))
            let prompt = try plan.required("prompt").string("local prompt")
            var raw = try await generate(prompt:prompt,options:plan.required("options"),modelURL:modelURL,
                                         generator:generator,isCurrent:isCurrent)
            if raw.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                raw = try await generate(prompt:plan.required("fallback").string("fallback prompt"),
                                         options:plan.required("fallbackOptions"),modelURL:modelURL,
                                         generator:generator,isCurrent:isCurrent)
            }
            try Task.checkCancellation()
            guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
            outputs.append(.init(key:axis,value:.string(raw.trimmingCharacters(in:.whitespacesAndNewlines))))
            onProgress(.object([.init(key:axis,value:.string("done"))]))
        }
        return try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localQualityResult")),
            .init(key:"outputs",value:.object(outputs)),
            .init(key:"now",value:.number(String(Int(Date().timeIntervalSince1970 * 1000))))]))
    }

    private actor Output {
        var text = ""
        func receive(_ cumulative: String) { text = cumulative }
    }

    @MainActor
    private static func generate(prompt: String, options: OrderedJSON, modelURL: URL,
                                 generator: @escaping LocalLlama.Generator,
                                 isCurrent: @escaping @MainActor @Sendable () -> Bool) async throws -> String {
        let maxTokens = try options.required("maxTokens").number("max tokens")
        let temperature = try options.required("temperature").number("temperature")
        guard maxTokens >= 0, maxTokens.rounded() == maxTokens, maxTokens <= Double(Int32.max),
              temperature.isFinite, abs(temperature) <= Double(Float.greatestFiniteMagnitude) else {
            throw ExchangeError.invalid("評価生成オプション")
        }
        let request = LocalLlamaRequest(messages:[.init(role:"user",content:prompt)],assistantPrefix:nil,
                                        maxTokens:Int(maxTokens),temperature:Float(temperature),fallbackPrompt:prompt)
        let output = Output()
        try await generator(modelURL,request) { cumulative in
            try Task.checkCancellation()
            guard await isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
            await output.receive(cumulative)
            return false
        }
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        return await output.text
    }
}
