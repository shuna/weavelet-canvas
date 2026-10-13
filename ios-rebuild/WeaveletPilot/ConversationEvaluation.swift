import Foundation

enum ConversationEvaluation {
    enum Execution { case remote(URLRequest), local(URL) }
    struct Prepared {
        let chatID: String
        let nodeID: String
        let key: String
        let phase: String
        let dimension: String
        let mode: String
        let scope: String
        let omittedMode: String
        let context: OrderedJSON
        let execution: Execution
        let language: String
        fileprivate let sourceChat: Data
        fileprivate let sourceContentStore: Data
        fileprivate let providerState: Data
    }

    static func resultKey(source: OrderedJSON, chatID: String, nodeID: String) throws -> String? {
        guard let chat = try source.required("chats").array("chats").first(where: {
            guard let value = $0["id"], case .string(let id) = value else { return false }
            return id.utf8.elementsEqual(chatID.utf8)
        }),
              let target = try targetMessage(chat: chat, source: source, nodeID: nodeID) else { return nil }
        let phase = target.role == "assistant" ? "post-receive" : "pre-send"
        return try SharedWebOperations.call("evaluation", .object([
            .init(key:"operation",value:.string("resultKey")), .init(key:"chatId",value:.string(chatID)),
            .init(key:"nodeId",value:.string(nodeID)), .init(key:"phase",value:.string(phase))
        ])).string("evaluation key")
    }

    static func prepare(source: OrderedJSON, state: OrderedJSON, chatID: String, nodeID: String,
                        dimension: String, scope: String = "full-context", omittedMode: String = "respect-omitted",
                        language: String = "en", legacy: @autoclosure () throws -> RemoteCredentialRecord = RemoteCredentialRecord(), files: LocalModelFiles? = nil,
                        readProviderCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws -> Prepared {
        guard ["safety", "quality"].contains(dimension), ["single", "full-context"].contains(scope),
              ["respect-omitted", "include-omitted"].contains(omittedMode) else { throw ExchangeError.invalid("評価条件") }
        let chats = try source.required("chats").array("chats")
        guard let chat = chats.first(where: {
            guard let value = $0["id"], case .string(let id) = value else { return false }
            return id.utf8.elementsEqual(chatID.utf8)
        }),
              let target = try targetMessage(chat: chat, source: source, nodeID: nodeID) else { throw ExchangeError.invalid("評価対象") }
        let phase = target.role == "assistant" ? "post-receive" : "pre-send"
        let key = try SharedWebOperations.call("evaluation", .object([
            .init(key:"operation",value:.string("resultKey")), .init(key:"chatId",value:.string(chatID)),
            .init(key:"nodeId",value:.string(nodeID)), .init(key:"phase",value:.string(phase))
        ])).string("evaluation key")
        let effectiveOmitted = scope == "single" ? "respect-omitted" : omittedMode
        let context = try SharedWebOperations.call("evaluation", .object([
            .init(key:"operation",value:.string("context")), .init(key:"chat",value:target.chat),
            .init(key:"omittedNodes",value:chat["omittedNodes"] ?? .object([])),
            .init(key:"messageIndex",value:.number(String(target.index))), .init(key:"role",value:.string(target.role)),
            .init(key:"scope",value:.string(scope)), .init(key:"omittedMode",value:.string(effectiveOmitted))
        ]))
        guard context != .null else { throw ExchangeError.invalid("評価コンテキスト") }
        let execution: Execution
        if dimension == "quality" {
            if state["localModelEnabled"] == .bool(true), let analysis = state["activeLocalModels"]?["analysis"],
               case .string(let localModel) = analysis, !localModel.isEmpty {
                guard let files else { throw ExchangeError.invalid("この端末の分析モデルを選択してください") }
                execution = .local(try NativeLocalEvaluation.modelURL(state:state,files:files))
            } else {
            let legacy = try legacy()
            let prompt = try (scope == "full-context" ? context.required("contextText") : context.required("userText")).string("評価文")
            guard !prompt.isEmpty else { throw ExchangeError.invalid("評価文が空です") }
            let config = try chat.required("config")
            let providerID = try config["providerId"]?.string("provider ID")
            let selected = OrderedJSON.object([.init(key:"endpoint",value:.string(try ProviderModels.generationCredential(config:config,state:state,legacy:legacy,read:readProviderCredential).settings.validatedURL().absoluteString))] +
                (providerID.map { [.init(key:"credentialProviderId",value:.string($0))] } ?? []))
            let credential = try AuxiliaryRemoteRequest.credential(selection:selected,state:state,legacy:legacy,read:readProviderCredential)
            let model = try config["model"]?.string("model") ?? credential.record.settings.model
            guard !model.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw ExchangeError.invalid("評価モデルがありません") }
            var boundary = SharedWebProjection()
            var openRouter = config["openRouter"]
            if let controls = openRouter, let routing = controls["routing"], case .object(let prices) = routing["max_price"] {
                let values = try prices.map { field in JSONField(key:field.key,value:["prompt","completion"].contains(field.key) ? field.value : try boundary.reference(field.value)) }
                openRouter = controls.replacing("routing",with:routing.replacing("max_price",with:.object(values)))
            }
            var fields: [JSONField] = [.init(key:"operation",value:.string("judgeRequest")),.init(key:"userPrompt",value:.string(prompt)),
                .init(key:"endpoint",value:.string(credential.url.absoluteString)),.init(key:"model",value:.string(model)),
                .init(key:"endpointURL",value:.object([.init(key:"protocol",value:.string("https:")),
                    .init(key:"hostname",value:.string(credential.url.host!.lowercased()))])),
                .init(key:"hasApiKey",value:.bool(!credential.record.key.isEmpty)),.init(key:"language",value:.string(language)),
                .init(key:"mode",value:.string(target.role))]
            if phase == "post-receive", let response = context["assistantText"] { fields.append(.init(key:"assistantResponse",value:response)) }
            if let openRouter { fields.append(.init(key:"openRouter",value:openRouter)) }
            let envelope = try SharedWebOperations.call("evaluation",.object(fields))
            let auth = try envelope.required("authentication")
            guard auth == .null || auth == .string("bearer") else { throw ExchangeError.invalid("評価認証方式") }
            let bound = OrderedJSON.object([.init(key:"endpoint",value:try envelope.required("chatUrl")),
                .init(key:"headers",value:try envelope.required("headers")),
                .init(key:"authentication",value:.array(auth == .null ? [] : [.object([.init(key:"name",value:.string("Authorization")),.init(key:"prefix",value:.string("Bearer "))])]))])
            let body = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),
                .init(key:"path",value:.array([])),.init(key:"value",value:try envelope.required("body"))])]),to:.null,opaque:boundary.opaque)
            execution = .remote(try RemoteRequest.bindEnvelope(bound,body:body,originalURL:credential.url,key:credential.record.key))
            guard body["stream"] != .bool(true) else { throw ExchangeError.invalid("評価は非streamingが必要です") }
            }
        } else {
            let text: String
            if scope == "full-context" {
                let prior = try context.required("contextText").string("評価文")
                let response = try context["assistantText"]?.string("応答") ?? ""
                text = phase == "post-receive" && !response.isEmpty ? prior + "\n\n[assistant]\n" + response : prior
            } else {
                text = try (phase == "post-receive" ? context["assistantText"] ?? context.required("userText") : context.required("userText")).string("評価文")
            }
            guard !text.isEmpty else { throw ExchangeError.invalid("評価文が空です") }
            guard let provider = try ProviderModels.providers(in:state).first(where: { $0.id.utf8.elementsEqual("openai".utf8) }) else { throw ExchangeError.invalid("OpenAI providerがありません") }
            let credential = try ProviderModels.credential(provider,read:readProviderCredential)
            guard !credential.key.isEmpty else { throw ExchangeError.invalid("OpenAI API keyがありません") }
            let url = try credential.settings.validatedURL()
            var fields: [JSONField] = [.init(key:"operation",value:.string("safetyRequest")),
                .init(key:"endpoint",value:.string(url.absoluteString)),.init(key:"text",value:.string(text))]
            if let controls = chat["config"]?["openRouter"] { fields.append(.init(key:"openRouter",value:controls)) }
            let envelope = try SharedWebOperations.call("evaluation",.object(fields))
            let bound = OrderedJSON.object([.init(key:"endpoint",value:try envelope.required("endpoint")),
                .init(key:"headers",value:try envelope.required("headers")),
                .init(key:"authentication",value:.array([.object([.init(key:"name",value:.string("Authorization")),
                    .init(key:"prefix",value:.string("Bearer "))])]))])
            execution = .remote(try RemoteRequest.bindEnvelope(bound,body:envelope.required("body"),originalURL:url,key:credential.key))
        }
        return Prepared(chatID:chatID,nodeID:nodeID,key:key,phase:phase,dimension:dimension,mode:target.role,scope:scope,
                        omittedMode:effectiveOmitted,context:context,execution:execution,language:language,sourceChat:try chat.encoded(),
                        sourceContentStore:try (source["contentStore"] ?? .null).encoded(),providerState:try providerDependency(state,execution:execution).encoded())
    }

    @MainActor static func run(_ prepared: Prepared, client: RemoteClient = RemoteClient(), localGenerator: @escaping LocalLlama.Generator = LocalLlama.generate,
                             isCurrent: @escaping @MainActor @Sendable () -> Bool = { true }, onProgress: @escaping @MainActor (OrderedJSON) -> Void = { _ in }) async throws -> OrderedJSON {
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        let response: OrderedJSON
        switch prepared.execution {
        case .local(let modelURL):
            return try await NativeLocalEvaluation.runQuality(context:prepared.context,scope:prepared.scope,language:prepared.language,modelURL:modelURL,generator:localGenerator,isCurrent:isCurrent,onProgress:onProgress)
        case .remote(let request): response = try await client.auxiliaryClient().completeJSON(request)
        }
        try Task.checkCancellation()
        guard isCurrent() else { throw ExchangeError.invalid("評価対象が更新されました") }
        let now = OrderedJSON.number(String(Int(Date().timeIntervalSince1970 * 1000)))
        if prepared.dimension == "safety" {
            var boundary = SharedWebProjection()
            var projected = response
            if var results = try response["results"]?.array("results"), !results.isEmpty,
               let scores = results[0]["category_scores"] {
                results[0] = results[0].replacing("category_scores",with:.object(try scores.object("category scores").map {
                    .init(key:$0.key,value:try boundary.reference($0.value))
                }))
                projected = projected.replacing("results",with:.array(results))
            }
            let parsed = try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("parseSafety")),
                .init(key:"data",value:projected),.init(key:"now",value:now)]))
            return try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),
                .init(key:"path",value:.array([])),.init(key:"value",value:parsed)])]),to:.null,opaque:boundary.opaque)
        }
        let choices = try response.required("choices").array("choices")
        guard let first = choices.first, let content = first["message"]?["content"], content != .null else { throw ExchangeError.invalid("評価応答が空です") }
        let text = try content.string("評価応答")
        guard !text.isEmpty else { throw ExchangeError.invalid("評価応答が空です") }
        return try SharedWebOperations.call("evaluation",.object([.init(key:"operation",value:.string("parseQuality")),
            .init(key:"text",value:.string(text)),.init(key:"mode",value:.string(prepared.mode)),
            .init(key:"now",value:now)]))
    }

    static func apply(_ result: OrderedJSON, prepared: Prepared, source: OrderedJSON, state: OrderedJSON) throws -> OrderedJSON {
        guard try isCurrent(prepared,source:source,state:state) else { throw ExchangeError.invalid("評価対象が更新されました") }
        try Task.checkCancellation()
        var boundary = SharedWebProjection()
        let previous = state["evaluationResults"]?[prepared.key] ?? .object([])
        let projected = OrderedJSON.object(try previous.object("evaluation result").map { field in
            JSONField(key:field.key,value:field.key == "phase" ? field.value : try boundary.reference(field.value))
        })
        let input = OrderedJSON.object([.init(key:"operation",value:.string("mutate")),
            .init(key:"state",value:.object([.init(key:"evaluationResults",value:.object([.init(key:prepared.key,value:projected)]))])),
            .init(key:"action",value:.object([.init(key:"type",value:.string("set-result")),.init(key:"key",value:.string(prepared.key)),
                .init(key:"phase",value:.string(prepared.phase)),.init(key:"dimension",value:.string(prepared.dimension)),
                .init(key:"result",value:try boundary.reference(result)),.init(key:"context",value:.object([.init(key:"scope",value:.string(prepared.scope)),
                    .init(key:"omittedMode",value:.string(prepared.omittedMode))]))]))])
        let changes = try SharedWebOperations.call("evaluation",input).required("changes")
        let raw = OrderedJSON.object([.init(key:"evaluationResults",value:.object([.init(key:prepared.key,value:previous)]))])
        let updated = try OrderedJSONChanges.apply(changes,to:raw,opaque:boundary.opaque)
        let newResult = try updated.required("evaluationResults").required(prepared.key)
        return state.replacing("evaluationResults",with:(state["evaluationResults"] ?? .object([])).replacing(prepared.key,with:newResult))
    }

    static func isCurrent(_ prepared: Prepared, source: OrderedJSON, state: OrderedJSON) throws -> Bool {
        guard let chat = try source.required("chats").array("chats").first(where: {
            guard let value = $0["id"], case .string(let id) = value else { return false }
            return id.utf8.elementsEqual(prepared.chatID.utf8)
        }),
              try chat.encoded() == prepared.sourceChat, try (source["contentStore"] ?? .null).encoded() == prepared.sourceContentStore,
              try providerDependency(state,execution:prepared.execution).encoded() == prepared.providerState else { return false }
        return true
    }

    private static func providerDependency(_ state: OrderedJSON, execution: Execution) -> OrderedJSON {
        var keys = ["providers","localModelEnabled","activeLocalModels"]
        if case .local = execution { keys.append("localModels") }
        return .object(keys.compactMap { key in state[key].map { .init(key:key,value:$0) } })
    }

    private static func targetMessage(chat: OrderedJSON, source: OrderedJSON, nodeID: String) throws -> (chat: OrderedJSON, index: Int, role: String)? {
        let messages: [OrderedJSON]
        let ids: [String]
        if let tree = chat["branchTree"] {
            ids = try tree.required("activePath").array("active path").map { try $0.string("node ID") }
            let nodes = try tree.required("nodes")
            let hashes = try ids.map { try nodes.required($0).required("contentHash").string("content hash") }
            var boundary = SharedWebProjection()
            let store = try boundary.store(source.required("contentStore"),resolving:hashes,strict:true)
            messages = try ids.map { id in
                let node = try nodes.required(id)
                let hash = try node.required("contentHash").string("content hash")
                return .object([.init(key:"role",value:try node.required("role")),
                    .init(key:"content",value:try store.required(hash).required("content"))])
            }
        } else {
            messages = try chat.required("messages").array("messages")
            ids = messages.indices.map { "message-\($0)" }
        }
        guard let index = ids.firstIndex(where: { $0.utf8.elementsEqual(nodeID.utf8) }) else { return nil }
        let role = try messages[index].required("role").string("role")
        guard ["system","user","assistant"].contains(role) else { throw ExchangeError.invalid("評価role") }
        var projected = OrderedJSON.object([.init(key:"messages",value:.array(try messages.map { message in
            .object([.init(key:"role",value:try message.required("role")),
                .init(key:"content",value:try message.required("content"))])
        })),.init(key:"config",value:.object(chat["config"]?["systemPrompt"].map { [.init(key:"systemPrompt",value:$0)] } ?? []))])
        if chat["branchTree"] != nil {
            projected = projected.replacing("branchTree",with:.object([.init(key:"activePath",value:.array(ids.map(OrderedJSON.string)))]))
        }
        return (projected,index,role)
    }
}
