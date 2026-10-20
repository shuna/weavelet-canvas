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
        }), model["engine"] == .string("wllama"), [.string("single-file"),.string("gguf-sharded")].contains(model["manifest"]?["kind"] ?? .null),
              try model.required("tasks").array("local tasks").contains(.string("analysis")) else {
            throw ExchangeError.invalid("選択した分析モデルはGGUFによる品質評価に対応していません")
        }
        return try files.installed(model:model)
    }

    @MainActor
    static func runQuality(context: OrderedJSON, scope: String, language: String = "en", modelURL: URL,
                           generator: LocalLlama.Generator? = nil,
                           isCurrent: @escaping @MainActor @Sendable () -> Bool = { true },
                           onProgress: @escaping @MainActor (OrderedJSON) -> Void = { _ in }) async throws -> OrderedJSON {
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        guard ["single","full-context"].contains(scope) else { throw ExchangeError.invalid("評価範囲") }
        let text = try (scope == "full-context" ? context.required("contextText") : context.required("userText")).string("評価文")
        guard !text.isEmpty else { throw ExchangeError.invalid("評価文が空です") }
        let assistantResponse = try context["assistantText"]?.string("応答")
        let revision = try modelRevision(modelURL)
        let axes = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localAxes"))]))
            .array("quality axes").map { try $0.string("quality axis") }
        guard axes.count == 5 else { throw ExchangeError.invalid("品質評価軸") }
        for axis in axes { onProgress(.object([.init(key:axis,value:.string("waiting"))])) }
        func evaluate(generator: @escaping LocalLlama.Generator) async throws -> OrderedJSON {
            var outputs: [JSONField] = []
            for axis in axes {
                try Task.checkCancellation()
                guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
                try checkModel(modelURL,revision:revision)
                onProgress(.object([.init(key:axis,value:.string("generating"))]))
                var fields: [JSONField] = [.init(key:"operation",value:.string("localPrompt")),
                    .init(key:"axis",value:.string(axis)),.init(key:"text",value:.string(text)),
                    .init(key:"language",value:.string(language))]
                if let assistantResponse { fields.append(.init(key:"assistantResponse",value:.string(assistantResponse))) }
                let plan = try SharedWebOperations.call("evaluation",.object(fields))
                let prompt = try plan.required("prompt").string("local prompt")
                var raw = try await generate(prompt:prompt,options:plan.required("options"),modelURL:modelURL,revision:revision,
                                             generator:generator,isCurrent:isCurrent)
                if raw.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
                    raw = try await generate(prompt:plan.required("fallback").string("fallback prompt"),
                                             options:plan.required("fallbackOptions"),modelURL:modelURL,revision:revision,
                                             generator:generator,isCurrent:isCurrent)
                }
                try Task.checkCancellation()
                guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
                try checkModel(modelURL,revision:revision)
                outputs.append(.init(key:axis,value:.string(raw.trimmingCharacters(in:.whitespacesAndNewlines))))
                onProgress(.object([.init(key:axis,value:.string("done"))]))
            }
            try checkModel(modelURL,revision:revision)
            return try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("localQualityResult")),
                .init(key:"outputs",value:.object(outputs)),
                .init(key:"now",value:.number(String(Int(Date().timeIntervalSince1970 * 1000))))]))
        }
        if let generator { return try await evaluate(generator:generator) }
        return try await LocalLlama.withModelSession(modelURL:modelURL) { generate in
            try await evaluate(generator:generate)
        }
    }

    private actor Output {
        var text = ""
        func receive(_ cumulative: String) { text = cumulative }
    }

    private struct ModelRevision: Equatable {
        let device: UInt64
        let inode: UInt64
        let size: UInt64
        let modified: Date
    }

    private static func modelRevision(_ url: URL) throws -> ModelRevision {
        let attributes = try FileManager.default.attributesOfItem(atPath:url.path)
        guard let device = attributes[.systemNumber] as? NSNumber,
              let inode = attributes[.systemFileNumber] as? NSNumber,
              let size = attributes[.size] as? NSNumber,
              let modified = attributes[.modificationDate] as? Date else {
            throw ExchangeError.invalid("評価モデルのファイル世代を確認できません")
        }
        return ModelRevision(device:device.uint64Value,inode:inode.uint64Value,size:size.uint64Value,modified:modified)
    }

    private static func checkModel(_ url: URL, revision: ModelRevision) throws {
        guard let current = try? modelRevision(url), current == revision else {
            throw ExchangeError.invalid("評価中にモデルが置き換わりました")
        }
    }

    @MainActor
    private static func generate(prompt: String, options: OrderedJSON, modelURL: URL, revision: ModelRevision,
                                 generator: @escaping LocalLlama.Generator,
                                 isCurrent: @escaping @MainActor @Sendable () -> Bool) async throws -> String {
        try checkModel(modelURL,revision:revision)
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
            await output.receive(cumulative)
            return false
        }
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        try checkModel(modelURL,revision:revision)
        return await output.text
    }
}
