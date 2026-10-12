import Foundation

struct ChatDefaults {
    let config: OrderedJSON
    let imageDetail: String

    // shortcut: Persisted global/model settings are connected separately from these shared initial values.
    static func webInitial() throws -> ChatDefaults {
        let value = try SharedWebOperations.call("libraryDefaults", .object([]))
        return try ChatDefaults(config: value.required("config"), imageDetail: value.required("imageDetail").string("imageDetail"))
    }
}

enum ChatLibrary {
    static let emptySource = OrderedJSON.object([
        JSONField(key: "version", value: .number("3")), JSONField(key: "chats", value: .array([])),
        JSONField(key: "contentStore", value: .object([])), JSONField(key: "folders", value: .object([]))
    ])

    static func create(in source: OrderedJSON, id: String, defaults: ChatDefaults, folder: String? = nil) throws -> OrderedJSON {
        var operation = OrderedJSON.object([.init(key: "type", value: .string("create")), .init(key: "newID", value: .string(id))])
        if let folder { operation = operation.replacing("folder", with: .string(folder)) }
        return try apply(in: source, operation: operation, defaults: defaults)
    }

    static func rename(in source: OrderedJSON, id: String, title: String) throws -> OrderedJSON {
        try apply(in: source, operation: .object([
            .init(key: "type", value: .string("rename")), .init(key: "id", value: .string(id)), .init(key: "title", value: .string(title))
        ]))
    }

    static func duplicate(in source: OrderedJSON, id: String, newID: String) throws -> OrderedJSON {
        try apply(in: source, operation: .object([
            .init(key: "type", value: .string("duplicate")), .init(key: "id", value: .string(id)), .init(key: "newID", value: .string(newID))
        ]))
    }

    static func delete(in source: OrderedJSON, ids: [String], replacementID: String, defaults: ChatDefaults) throws -> OrderedJSON {
        try apply(in: source, operation: .object([
            .init(key: "type", value: .string("delete")), .init(key: "ids", value: .array(ids.map(OrderedJSON.string))),
            .init(key: "newID", value: .string(replacementID))
        ]), defaults: defaults)
    }

    private static func apply(in source: OrderedJSON, operation: OrderedJSON, defaults: ChatDefaults? = nil) throws -> OrderedJSON {
        var projection = SharedWebProjection()
        var chats: [OrderedJSON] = []
        for chat in try source.required("chats").array("chats") { chats.append(try projection.chat(chat)) }
        var input = OrderedJSON.object([
            .init(key: "chats", value: .array(chats)),
            .init(key: "contentStore", value: try projection.store(source.required("contentStore"))),
            .init(key: "operation", value: operation)
        ])
        if let defaults {
            input = input.replacing("defaults", with: .object([
                .init(key: "config", value: try projection.config(defaults.config)), .init(key: "imageDetail", value: .string(defaults.imageDetail))
            ]))
        }
        return try OrderedJSONChanges.apply(SharedWebOperations.call("libraryOperation", input), to: source, opaque: projection.opaque)
    }
}
