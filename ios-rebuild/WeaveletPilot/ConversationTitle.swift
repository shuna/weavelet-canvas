import Foundation

struct PreparedConversationTitle {
    let chatID: String
    let sourceConfig: OrderedJSON?
    let expectedConfig: OrderedJSON
    let expectedResolvedConfig: OrderedJSON
    let promptMessage: OrderedJSON
    let selection: OrderedJSON
    let request: URLRequest
}

enum ConversationTitle {
    private static func chat(_ source: OrderedJSON, id: String) throws -> OrderedJSON? {
        try source.required("chats").array("chats").first {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(id.utf8)
        }
    }

    private static func settings(_ state: OrderedJSON, fallbackEndpoint: String) throws -> OrderedJSON {
        let favorites = try (state["favoriteModels"] ?? .array([])).array("favoriteModels").map { item in
            OrderedJSON.object(["modelId", "providerId"].compactMap { key in item[key].map { .init(key:key,value:$0) } })
        }
        let providers = try (state["providers"] ?? .object([])).object("providers").map { field in
            JSONField(key:field.key,value:.object(["id", "endpoint"].compactMap { key in field.value[key].map { .init(key:key,value:$0) } }))
        }
        var fields: [JSONField] = [
            .init(key:"favoriteModels",value:.array(favorites)),
            .init(key:"providers",value:.object(providers)),
            .init(key:"fallbackProvider",value:.object([.init(key:"endpoint",value:.string(fallbackEndpoint))]))
        ]
        for key in ["titleModel", "titleProviderId"] {
            if let value = state[key] { fields.append(.init(key:key,value:value)) }
        }
        return .object(fields)
    }

    private static func projectedChat(_ chat: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var projected = try boundary.chat(chat)
        if let config = chat["config"] { projected = projected.replacing("config",with:try ChatConfig.projection(config,boundary:&boundary)) }
        return projected
    }

    private static func select(chat: OrderedJSON, state: OrderedJSON, language: String, sourceConfig: OrderedJSON?, fallbackEndpoint: String,
                               boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("select")),
            .init(key:"chat",value:try projectedChat(chat,&boundary)),
            .init(key:"autoTitle",value:state["autoTitle"] ?? .bool(false)),
            .init(key:"language",value:.string(language)),
            .init(key:"settings",value:try settings(state,fallbackEndpoint:fallbackEndpoint))
        ])
        if let sourceConfig { input = input.replacing("sourceConfig",with:try ChatConfig.projection(sourceConfig,boundary:&boundary)) }
        return try SharedWebOperations.call("titleOperation",input)
    }

    static func prepare(source: OrderedJSON, state: OrderedJSON, chatID: String, language: String, sourceConfig: OrderedJSON? = nil,
                        legacy: RemoteCredentialRecord, readProviderCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)) throws -> PreparedConversationTitle? {
        guard let rawChat = try chat(source,id:chatID) else { return nil }
        var boundary = SharedWebProjection()
        let selection = try select(chat:rawChat,state:state,language:language,sourceConfig:sourceConfig,
                                   fallbackEndpoint:legacy.settings.endpoint,boundary:&boundary)
        guard selection["status"] == .string("ready") else { return nil }
        let providerID = try selection["credentialProviderId"]?.string("provider ID")
        let credentialConfig = OrderedJSON.object(providerID.map { [.init(key:"providerId",value:.string($0))] } ?? [])
        let credential = try ProviderModels.generationCredential(config:credentialConfig,state:state,legacy:legacy,read:readProviderCredential)
        let endpoint = try selection.required("endpoint").string("endpoint")
        let authorizedURL = try credential.settings.validatedURL()
        guard try ProviderModels.url(endpoint).absoluteString == authorizedURL.absoluteString else {
            throw ExchangeError.invalid("タイトル生成先が端末認証設定のendpointと一致しません")
        }
        var transport = OrderedJSON.object([.init(key:"hasApiKey",value:.bool(!credential.key.isEmpty))])
        if let apiVersion = state["apiVersion"] { transport = transport.replacing("apiVersion",with:apiVersion) }
        let plan = try SharedWebOperations.call("titleOperation",.object([
            .init(key:"operation",value:.string("plan")),
            .init(key:"chat",value:try projectedChat(rawChat,&boundary)),
            .init(key:"selection",value:selection),
            .init(key:"modelState",value:ChatConfig.modelState(in:state)),
            .init(key:"transport",value:transport)
        ]))
        guard plan["status"] == .string("ready") else { return nil }
        let envelope = try plan.required("request")
        let body = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:try envelope.required("body"))
        ])]),to:.null,opaque:boundary.opaque)
        let request = try RemoteRequest.bindEnvelope(envelope,body:body,originalURL:authorizedURL,key:credential.key)
        guard try !RemoteRequest.streaming(request) else { throw ExchangeError.invalid("タイトル生成は非streamingが必要です") }
        let promptMessage = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:selection.required("promptMessage"))
        ])]),to:.null,opaque:boundary.opaque)
        let resolvedConfig = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:selection.required("config"))
        ])]),to:.null,opaque:boundary.opaque)
        return PreparedConversationTitle(chatID:chatID,sourceConfig:sourceConfig,expectedConfig:rawChat["config"] ?? .object([]),
                                         expectedResolvedConfig:resolvedConfig,promptMessage:promptMessage,selection:selection,request:request)
    }

    @MainActor static func generate(_ prepared: PreparedConversationTitle, client: RemoteClient = RemoteClient()) async throws -> String {
        var responseText: String?
        try await client.complete(prepared.request,streaming:false) { output in responseText = output.text }
        guard let responseText else { throw ExchangeError.invalid("タイトル生成応答がありません") }
        return responseText
    }

    static func apply(_ responseText: String, prepared: PreparedConversationTitle, source: OrderedJSON, state: OrderedJSON,
                      language: String, fallbackEndpoint: String) throws -> (source: OrderedJSON, tokenUsage: OrderedJSON?)? {
        guard let currentChat = try chat(source,id:prepared.chatID),
              try (currentChat["config"] ?? .object([])).encoded() == prepared.expectedConfig.encoded() else { return nil }
        var boundary = SharedWebProjection()
        let current = try select(chat:currentChat,state:state,language:language,sourceConfig:prepared.sourceConfig,
                                 fallbackEndpoint:fallbackEndpoint,boundary:&boundary)
        guard current["status"] == .string("ready"),
              try current.required("model").encoded() == prepared.selection.required("model").encoded(),
              try (current["providerId"] ?? .null).encoded() == (prepared.selection["providerId"] ?? .null).encoded(),
              try current.required("endpoint").encoded() == prepared.selection.required("endpoint").encoded() else { return nil }
        let currentConfig = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:current.required("config"))
        ])]),to:.null,opaque:boundary.opaque)
        guard try currentConfig.encoded() == prepared.expectedResolvedConfig.encoded() else { return nil }
        let currentPrompt = try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:current.required("promptMessage"))
        ])]),to:.null,opaque:boundary.opaque)
        guard try currentPrompt.encoded() == prepared.promptMessage.encoded() else { return nil }
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("apply")),.init(key:"chat",value:try projectedChat(currentChat,&boundary)),
            .init(key:"selection",value:current),.init(key:"responseText",value:.string(responseText))
        ])
        let countTokens = state["countTotalTokens"] == .bool(true)
        if countTokens {
            input = input.replacing("countTotalTokens",with:.bool(true))
                .replacing("totalTokenUsed",with:state["totalTokenUsed"] ?? .object([]))
        }
        let result = try SharedWebOperations.call("titleOperation",input)
        guard result["status"] == .string("updated") else { return nil }
        let base = OrderedJSON.object([.init(key:"chat",value:currentChat)] + (countTokens ? [.init(key:"totalTokenUsed",value:state["totalTokenUsed"] ?? .object([]))] : []))
        let updated = try OrderedJSONChanges.apply(result.required("changes"),to:base,opaque:boundary.opaque)
        var chats = try source.required("chats").array("chats")
        guard let index = chats.firstIndex(where: {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(prepared.chatID.utf8)
        }) else { return nil }
        chats[index] = try updated.required("chat")
        return (source.replacing("chats",with:.array(chats)),countTokens ? updated["totalTokenUsed"] : nil)
    }
}
