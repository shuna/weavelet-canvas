import Foundation

struct PreparedSummary {
    let chatID: String
    let sourceNodeIDs: [String]
    let mode: String
    let originNodeID: String
    let format: String?
    let summaryID: String
    let now: Double
    let config: OrderedJSON?
    let originalChat: OrderedJSON
    let expectedChatConfig: OrderedJSON
    let expectedBranchTree: OrderedJSON
    let summary: OrderedJSON
    let selection: OrderedJSON
    let boundary: SharedWebProjection
    let request: URLRequest
    let fallbackEndpoint: String
}

enum ConversationSummary {
    private static func chat(_ source: OrderedJSON, id: String) throws -> OrderedJSON? {
        try source.required("chats").array("chats").first {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(id.utf8)
        }
    }
    private static func wireNodeID(_ id: String, chat: OrderedJSON) throws -> String {
        if chat["branchTree"] != nil { return id }
        guard id.hasPrefix("message-"), let index = Int(id.dropFirst(8)), index >= 0,
              id.utf8.elementsEqual("message-\(index)".utf8) else { throw ExchangeError.invalid("flat node ID") }
        return String(index)
    }
    private static func displayNodeID(_ id: String, chat: OrderedJSON) -> String {
        guard chat["branchTree"] == nil, let index = Int(id), index >= 0,
              id.utf8.elementsEqual(String(index).utf8) else { return id }
        return "message-\(index)"
    }
    static func sourceDisplayIDs(_ summary: OrderedJSON, source: OrderedJSON, chatID: String) throws -> [String] {
        guard let rawChat = try chat(source,id:chatID) else { return [] }
        return try summary.required("sources").array("sources").map {
            displayNodeID(try $0.required("nodeId").string("node ID"),chat:rawChat)
        }
    }
    private static func project(_ value: OrderedJSON, known: [String], boundary: inout SharedWebProjection) throws -> OrderedJSON {
        .object(try value.object("summary field").map { field in
            .init(key:field.key,value:known.contains(where: field.key.matches) ? field.value : try boundary.reference(field.value))
        })
    }
    private static func projectedConfig(_ config: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var projected = try ChatConfig.projection(config,boundary:&boundary)
        for key in ["temperature", "top_p", "presence_penalty", "frequency_penalty"] {
            if let value = config[key] { projected = projected.replacing(key,with:value) }
        }
        return projected
    }
    private static func projectedChat(_ chat: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var result = try boundary.chat(chat)
        if let config = chat["config"] {
            result = result.replacing("config",with:try projectedConfig(config,boundary:&boundary))
        }
        if let summaries = chat["summaries"] {
            let projected = try summaries.array("summaries").map { summary -> OrderedJSON in
                var value = try project(summary,known:["id", "mode", "format", "text", "useForSubmit", "sources", "generation"],boundary:&boundary)
                if let sources = summary["sources"] {
                    value = value.replacing("sources",with:.array(try sources.array("sources").map {
                        try project($0,known:["nodeId", "parentId", "role", "textParts"],boundary:&boundary)
                    }))
                }
                if let generation = summary["generation"] {
                    var projectedGeneration = try project(generation,known:["model", "providerId", "createdAt", "settings"],boundary:&boundary)
                    if let settings = generation["settings"] {
                        projectedGeneration = projectedGeneration.replacing("settings",with:try project(settings,known:["temperature", "max_tokens", "reasoning_effort"],boundary:&boundary))
                    }
                    value = value.replacing("generation",with:projectedGeneration)
                }
                return value
            }
            result = result.replacing("summaries",with:.array(projected))
        }
        if let targets = chat["summaryTargets"] {
            result = result.replacing("summaryTargets",with:.object(try targets.object("summary targets").map { field in
                if case .bool = field.value { return field }
                return .init(key:field.key,value:try boundary.reference(field.value))
            }))
        }
        return result
    }
    private static func select(chat: OrderedJSON, sourceNodeIDs: [String], mode: String, originNodeID: String, format: String?,
                               config: OrderedJSON?, summaryID: String, now: Double, generatingNodeIDs: [String], busyJobs: [(originNodeID: String, sourceNodeIDs: [String])],
                               state: OrderedJSON, fallbackEndpoint: String, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("select")),.init(key:"chat",value:try projectedChat(chat,boundary:&boundary)),
            .init(key:"sourceNodeIds",value:.array(sourceNodeIDs.map(OrderedJSON.string))),
            .init(key:"mode",value:.string(mode)),.init(key:"originNodeId",value:.string(originNodeID)),
            .init(key:"summaryId",value:.string(summaryID)),.init(key:"now",value:.number(String(now))),
            .init(key:"generatingNodeIds",value:.array(generatingNodeIDs.map(OrderedJSON.string))),
            .init(key:"busyJobs",value:.array(busyJobs.map { job in .object([
                .init(key:"originNodeId",value:.string(job.originNodeID)),
                .init(key:"sourceNodeIds",value:.array(job.sourceNodeIDs.map(OrderedJSON.string)))
            ]) })),
            .init(key:"settings",value:try AuxiliaryRemoteRequest.providerSettings(state:state,fallbackEndpoint:fallbackEndpoint))
        ])
        if let format { input = input.replacing("format",with:.string(format)) }
        if let config { input = input.replacing("config",with:try projectedConfig(config,boundary:&boundary)) }
        return try SharedWebOperations.call("summaryOperation",input)
    }
    private static func restored(_ value: OrderedJSON, boundary: SharedWebProjection) throws -> OrderedJSON {
        try OrderedJSONChanges.apply(.array([.object([
            .init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:value)
        ])]),to:.null,opaque:boundary.opaque)
    }

    static func prepare(source: OrderedJSON, state: OrderedJSON, chatID: String, sourceNodeIDs: [String], mode: String, originNodeID: String,
                        format: String? = nil, summaryID: String, now: Double, config: OrderedJSON? = nil, generatingNodeIDs: [String] = [],
                        busyJobs: [(originNodeID: String, sourceNodeIDs: [String])] = [],
                        legacy: RemoteCredentialRecord, readProviderCredential: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:), promptTokens: Int? = nil) throws -> PreparedSummary? {
        guard let rawChat = try chat(source,id:chatID) else { return nil }
        let wireSources = try sourceNodeIDs.map { try wireNodeID($0,chat:rawChat) }
        let wireOrigin = try wireNodeID(originNodeID,chat:rawChat)
        let wireGenerating = try generatingNodeIDs.map { try wireNodeID($0,chat:rawChat) }
        let wireBusy = try busyJobs.map { job in
            (originNodeID:try wireNodeID(job.originNodeID,chat:rawChat),sourceNodeIDs:try job.sourceNodeIDs.map { try wireNodeID($0,chat:rawChat) })
        }
        var boundary = SharedWebProjection()
        let selection = try select(chat:rawChat,sourceNodeIDs:wireSources,mode:mode,originNodeID:wireOrigin,format:format,
                                   config:config,summaryID:summaryID,now:now,generatingNodeIDs:wireGenerating,busyJobs:wireBusy,
                                   state:state,fallbackEndpoint:legacy.settings.endpoint,boundary:&boundary)
        guard selection["status"] == .string("ready") else { return nil }
        let (credential,url) = try AuxiliaryRemoteRequest.credential(selection:selection,state:state,legacy:legacy,read:readProviderCredential)
        let proxy = try legacy.proxy?.validated()
        let transport = AuxiliaryRemoteRequest.transport(url:url,key:credential.key,apiVersion:state["apiVersion"],viaProxy:proxy != nil)
        var planInput = OrderedJSON.object([
            .init(key:"operation",value:.string("plan")),.init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),
            .init(key:"selection",value:selection),.init(key:"modelState",value:ChatConfig.modelState(in:state)),
            .init(key:"transport",value:transport)
        ])
        if let promptTokens { planInput = planInput.replacing("promptTokens",with:.number(String(promptTokens))) }
        let plan = try SharedWebOperations.call("summaryOperation",planInput)
        let upstream = try AuxiliaryRemoteRequest.bind(plan.required("request"),boundary:boundary,url:url,key:credential.key)
        let request = try AuxiliaryRemoteRequest.route(upstream,proxy:proxy)
        return try PreparedSummary(chatID:chatID,sourceNodeIDs:wireSources,mode:mode,originNodeID:wireOrigin,format:format,
            summaryID:summaryID,now:now,config:config,originalChat:rawChat,expectedChatConfig:rawChat["config"] ?? .object([]),
            expectedBranchTree:rawChat["branchTree"] ?? .null,
            summary:restored(selection.required("summary"),boundary:boundary),
            selection:selection,boundary:boundary,request:request,fallbackEndpoint:legacy.settings.endpoint)
    }
    static func generate(_ prepared: PreparedSummary, client: RemoteClient = RemoteClient()) async throws -> (text: String, finishReason: String?) {
        let response = try await client.completeJSON(prepared.request)
        guard let choice = try response.required("choices").array("choices").first else { throw ExchangeError.invalid("要約生成応答がありません") }
        let text = try choice.required("message").required("content").string("summary response")
        let reason = choice["finish_reason"] == .null ? nil : try choice["finish_reason"]?.string("finish reason")
        return (text,reason)
    }
    static func usagePlan(_ response: String, prepared: PreparedSummary, source: OrderedJSON) throws -> OrderedJSON {
        let rawChat = try chat(source,id:prepared.chatID) ?? prepared.originalChat
        var boundary = prepared.boundary
        let plan = try SharedWebOperations.call("summaryOperation",.object([.init(key:"operation",value:.string("usagePlan")),
            .init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),.init(key:"selection",value:prepared.selection),
            .init(key:"responseText",value:.string(response))]))
        return try restored(plan,boundary:boundary)
    }
    static func apply(_ response: (text: String, finishReason: String?), prepared: PreparedSummary, source: OrderedJSON, state: OrderedJSON,
                      generatingNodeIDs: [String] = [], counts: OrderedJSON? = nil) throws -> (source: OrderedJSON, tokenUsage: OrderedJSON?, summary: OrderedJSON?, savesTokens: Bool?, warning: String?, error: String?)? {
        let latestChat = try chat(source,id:prepared.chatID)
        let rawChat = latestChat ?? prepared.originalChat
        let stale = try latestChat == nil || (rawChat["config"] ?? .object([])).encoded() != prepared.expectedChatConfig.encoded()
            || (rawChat["branchTree"] ?? .null).encoded() != prepared.expectedBranchTree.encoded()
        let wireGenerating = try generatingNodeIDs.map { try wireNodeID($0,chat:rawChat) }
        var boundary = prepared.boundary
        var input = OrderedJSON.object([
            .init(key:"operation",value:.string("apply")),.init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),
            .init(key:"selection",value:prepared.selection),.init(key:"responseText",value:.string(response.text)),
            .init(key:"totalTokenUsed",value:state["totalTokenUsed"] ?? .object([])),
            .init(key:"generatingNodeIds",value:.array(wireGenerating.map(OrderedJSON.string))),
            .init(key:"stale",value:.bool(stale))
        ])
        if let reason = response.finishReason { input = input.replacing("finishReason",with:.string(reason)) }
        if let counts { input = input.replacing("counts",with:counts) }
        let result = try SharedWebOperations.call("summaryOperation",input)
        let base = OrderedJSON.object([.init(key:"chat",value:rawChat),.init(key:"totalTokenUsed",value:state["totalTokenUsed"] ?? .object([]))])
        let updated = try OrderedJSONChanges.apply(result.required("changes"),to:base,opaque:boundary.opaque)
        try NativeUsage.validateCounters(result:result,before:state["totalTokenUsed"] ?? .object([]),after:updated["totalTokenUsed"] ?? .object([]))
        var chats = try source.required("chats").array("chats")
        if let index = chats.firstIndex(where: {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(prepared.chatID.utf8)
        }) { chats[index] = try updated.required("chat") }
        return (source.replacing("chats",with:.array(chats)),updated["totalTokenUsed"],
                try result["summary"].flatMap { $0 == .null ? nil : try restored($0,boundary:boundary) },
                try result["savesTokens"]?.boolean("saves tokens"),try result["warning"]?.string("summary warning"),
                try result["error"]?.string("summary error"))
    }

    static func mutate(source: OrderedJSON, chatID: String, action: String, summaryID: String? = nil, nodeID: String? = nil, use: Bool? = nil) throws -> OrderedJSON {
        guard let rawChat = try chat(source,id:chatID) else { throw ExchangeError.invalid("chat ID") }
        var boundary = SharedWebProjection()
        var input = OrderedJSON.object([.init(key:"operation",value:.string("mutate")),
                                        .init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),
                                        .init(key:"action",value:.string(action))])
        if let summaryID { input = input.replacing("summaryId",with:.string(summaryID)) }
        if let nodeID { input = input.replacing("nodeId",with:.string(try wireNodeID(nodeID,chat:rawChat))) }
        if let use { input = input.replacing("use",with:.bool(use)) }
        let changes = try SharedWebOperations.call("summaryOperation",input).required("changes")
        let updated = try OrderedJSONChanges.apply(changes,to:rawChat,opaque:boundary.opaque)
        var chats = try source.required("chats").array("chats")
        guard let index = chats.firstIndex(where: {
            guard case .string(let value) = $0["id"] else { return false }
            return value.utf8.elementsEqual(chatID.utf8)
        }) else { throw ExchangeError.invalid("chat ID") }
        chats[index] = updated
        return source.replacing("chats",with:.array(chats))
    }

    static func describe(source: OrderedJSON, chatID: String, nodeID: String, mode: String? = nil, originNodeID: String? = nil,
                         chosenSummaryID: String? = nil, generatingNodeIDs: [String] = []) throws -> OrderedJSON? {
        guard let rawChat = try chat(source,id:chatID) else { return nil }
        let wireNode = try wireNodeID(nodeID,chat:rawChat)
        let wireOrigin = try originNodeID.map { try wireNodeID($0,chat:rawChat) }
        let wireGenerating = try generatingNodeIDs.map { try wireNodeID($0,chat:rawChat) }
        var boundary = SharedWebProjection()
        var input = OrderedJSON.object([.init(key:"operation",value:.string("describe")),
                                        .init(key:"chat",value:try projectedChat(rawChat,boundary:&boundary)),
                                        .init(key:"nodeId",value:.string(wireNode)),
                                        .init(key:"generatingNodeIds",value:.array(wireGenerating.map(OrderedJSON.string)))])
        if let mode { input = input.replacing("mode",with:.string(mode)) }
        if let wireOrigin { input = input.replacing("originNodeId",with:.string(wireOrigin)) }
        if let chosenSummaryID { input = input.replacing("chosenSummaryId",with:.string(chosenSummaryID)) }
        var result = try restored(SharedWebOperations.call("summaryOperation",input),boundary:boundary)
        if rawChat["branchTree"] == nil {
            if let path = result["path"] {
                result = result.replacing("path",with:.array(try path.array("summary path").map { entry in
                    guard let id = try entry["nodeId"]?.string("node ID") else { return entry }
                    return entry.replacing("nodeId",with:.string(displayNodeID(id,chat:rawChat)))
                }))
            }
            if let ids = result["sourceNodeIds"] {
                result = result.replacing("sourceNodeIds",with:.array(try ids.array("source IDs").map {
                    .string(displayNodeID(try $0.string("node ID"),chat:rawChat))
                }))
            }
            if let anchor = try result["anchor"]?.string("anchor") {
                result = result.replacing("anchor",with:.string(displayNodeID(anchor,chat:rawChat)))
            }
        }
        return result
    }
}
