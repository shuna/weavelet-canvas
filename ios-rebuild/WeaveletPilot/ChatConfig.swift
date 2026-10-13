import Foundation

struct ChatConfigDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let source: OrderedJSON
    let snapshot: OrderedJSON
    let modelState: OrderedJSON
    var config: OrderedJSON
    var defaultSettings: (systemMessage: String, imageDetail: String)? = nil
}

enum ChatConfig {
    static func systemPromptForEditing(_ config: OrderedJSON) throws -> String {
        try config["systemPrompt"]?.string("systemPromptはこの画面では編集・挿入できません") ?? ""
    }

    static func modelState(in state: OrderedJSON) -> OrderedJSON {
        .object(["favoriteModels", "providerModelCache", "providerCustomModels", "localModels"].compactMap { key in
            state[key].map { JSONField(key:key,value:$0) }
        })
    }
    // Saved model entries copy unknown fields, so carry those values in the same raw table.
    static func projection(_ config: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        var result = try boundary.requestConfig(config)
        if let router = config["openRouter"] { result = result.replacing("openRouter",with:try boundary.reference(router)) }
        if case .object(let entries) = config["modelSettings"] {
            var projected: [JSONField] = []
            for entry in entries { projected.append(.init(key:entry.key,value:try projection(entry.value,boundary:&boundary))) }
            result = result.replacing("modelSettings",with:.object(projected))
        }
        return result
    }
    static func normalizedDefaults(_ config: OrderedJSON, modelState: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let input = OrderedJSON.object([.init(key:"operation",value:.string("saveDefaults")),
            .init(key:"config",value:try projection(config,boundary:&boundary)),.init(key:"modelState",value:modelState)])
        let result = try SharedWebOperations.call("chatConfig",input)
        return try OrderedJSONChanges.apply(result.required("changes"),to:config,opaque:boundary.opaque)
    }
    static func switched(_ config: OrderedJSON, model: String, providerID: String?, modelState: OrderedJSON, modelSource: String = "remote") throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        var target: [JSONField] = [.init(key:"model",value:.string(model)),.init(key:"modelSource",value:.string(modelSource))]
        if let providerID, !providerID.isEmpty { target.append(.init(key:"providerId",value:.string(providerID))) }
        let input = OrderedJSON.object([.init(key:"operation",value:.string("switch")),.init(key:"config",value:try projection(config,boundary:&boundary)),
            .init(key:"modelState",value:modelState),.init(key:"target",value:.object(target))])
        let result = try SharedWebOperations.call("chatConfig",input)
        return try OrderedJSONChanges.apply(result.required("changes"),to:config,opaque:boundary.opaque)
    }
}
