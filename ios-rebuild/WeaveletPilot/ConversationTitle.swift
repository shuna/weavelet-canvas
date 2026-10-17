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

    private static func settings(_ state: OrderedJSON, global: OrderedJSON, fallbackEndpoint: String) throws -> OrderedJSON {
        var result = try AuxiliaryRemoteRequest.providerSettings(state:state,fallbackEndpoint:fallbackEndpoint)
        for key in ["titleModel", "titleProviderId"] {
            if let value = global[key] { result = result.replacing(key,with:value) }
        }
        return result
    }

    private static func projectedChat(_ chat: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var projected = try boundary.chat(chat)
        if let config = chat["config"] { projected = projected.replacing("config",with:try ChatConfig.projection(config,boundary:&boundary)) }
        return projected
    }

    private static func select(chat: OrderedJSON, state: OrderedJSON, language: String, sourceConfig: OrderedJSON?, fallbackEndpoint: String,
                               boundary: inout SharedWebProjection) throws -> OrderedJSON {
        let savedGlobal = OrderedJSON.object(["autoTitle", "titleModel", "titleProviderId"].compactMap { key in
            state[key].map { .init(key:key,value:$0) }
        })
        let global = try SharedWebOperations.call("titleOperation",.object([
            .init(key:"operation",value:.string("settings")),.init(key:"state",value:savedGlobal)
        ]))
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("select")),
            .init(key:"chat",value:try projectedChat(chat,boundary:&boundary)),
            .init(key:"autoTitle",value:try global.required("autoTitle")),
            .init(key:"language",value:.string(language)),
            .init(key:"settings",value:try settings(state,global:global,fallbackEndpoint:fallbackEndpoint))
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
        let (credential,authorizedURL) = try AuxiliaryRemoteRequest.credential(selection:selection,state:state,legacy:legacy,read:readProviderCredential)
        let proxy = try legacy.proxy?.validated()
        let transport = AuxiliaryRemoteRequest.transport(url:authorizedURL,key:credential.key,apiVersion:state["apiVersion"],viaProxy:proxy != nil)
        let plan = try SharedWebOperations.call("titleOperation",.object([
            .init(key:"operation",value:.string("plan")),
            .init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),
            .init(key:"selection",value:selection),
            .init(key:"modelState",value:ChatConfig.modelState(in:state)),
            .init(key:"transport",value:transport)
        ]))
        guard plan["status"] == .string("ready") else { return nil }
        let envelope = try plan.required("request")
        let upstream = try AuxiliaryRemoteRequest.bind(envelope,boundary:boundary,url:authorizedURL,key:credential.key)
        let request = try AuxiliaryRemoteRequest.route(upstream,proxy:proxy)
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
        let response = try await client.completeJSON(prepared.request)
        guard let choice = try response.required("choices").array("choices").first else { throw ExchangeError.invalid("タイトル生成応答がありません") }
        return try choice.required("message").required("content").string("title response")
    }

    static func apply(_ responseText: String, prepared: PreparedConversationTitle, source: OrderedJSON, state: OrderedJSON,
                      language: String, fallbackEndpoint: String, counts: OrderedJSON? = nil) throws -> (source: OrderedJSON, tokenUsage: OrderedJSON?)? {
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
            .init(key:"operation",value:.string("apply")),.init(key:"chat",value:try projectedChat(currentChat,boundary:&boundary)),
            .init(key:"selection",value:current),.init(key:"responseText",value:.string(responseText))
        ])
        let countTokens = state["countTotalTokens"] == .bool(true)
        if countTokens {
            input = input.replacing("countTotalTokens",with:.bool(true))
                .replacing("totalTokenUsed",with:state["totalTokenUsed"] ?? .object([]))
        }
        if let counts { input = input.replacing("counts",with:counts) }
        let result = try SharedWebOperations.call("titleOperation",input)
        guard result["status"] == .string("updated") else { return nil }
        let base = OrderedJSON.object([.init(key:"chat",value:currentChat)] + (countTokens ? [.init(key:"totalTokenUsed",value:state["totalTokenUsed"] ?? .object([]))] : []))
        let updated = try OrderedJSONChanges.apply(result.required("changes"),to:base,opaque:boundary.opaque)
        if countTokens { try NativeUsage.validateCounters(result:result,before:state["totalTokenUsed"] ?? .object([]),after:updated["totalTokenUsed"] ?? .object([])) }
        var chats = try source.required("chats").array("chats")
        guard let index = chats.firstIndex(where: {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(prepared.chatID.utf8)
        }) else { return nil }
        chats[index] = try updated.required("chat")
        return (source.replacing("chats",with:.array(chats)),countTokens ? updated["totalTokenUsed"] : nil)
    }
}
