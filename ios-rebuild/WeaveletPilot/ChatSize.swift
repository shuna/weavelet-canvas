import Foundation

actor ChatSize {
    private var session: SharedWebOperations.Session?

    static func projection(_ source: OrderedJSON) throws -> OrderedJSON {
        .array(try source.required("chats").array("chats").map { chat in
            try Task.checkCancellation()
            let messages = try chat.required("messages").array("messages").map { message in
                OrderedJSON.array(try message.required("content").array("content").map { part in
                    try Task.checkCancellation()
                    let text = try? part["text"]?.stringKey("text")
                    let url = try? part["image_url"]?["url"]?.stringKey("image URL")
                    return try .object([.init(key: "type", value: part.required("type")),
                        .init(key: "textLength", value: .number(String(text?.utf16.count ?? 0))),
                        .init(key: "hasImageURL", value: .bool(part["image_url"] != nil)),
                        .init(key: "imageURLLength", value: .number(String(url?.utf16.count ?? 0)))])
                })
            }
            return try .object([.init(key: "id", value: chat.required("id")), .init(key: "messages", value: .array(messages))])
        })
    }
    func sizes(source: OrderedJSON, enabled: Bool) throws -> [Data: String] {
        guard enabled else { return [:] }
        try Task.checkCancellation()
        let input = try Self.projection(source)
        try Task.checkCancellation()
        if session == nil { session = try SharedWebOperations.Session() }
        let result = try session!.call("chatSizes", input)
        try Task.checkCancellation()
        var labels: [Data: String] = [:]
        for row in try result.array("chat sizes") {
            if let label = row["label"] {
                labels[Data(try row.required("id").string("chat ID").utf8)] = try label.string("chat size")
            }
        }
        return labels
    }
}
