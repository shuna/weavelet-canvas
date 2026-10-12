import Foundation

struct ChatDefaults {
    let config: OrderedJSON
    let imageDetail: String

    // Global settings/model capabilities are not connected yet; use Web initial constants.
    static let webInitial = ChatDefaults(config: .object([
        JSONField(key: "model", value: .string("")), JSONField(key: "max_tokens", value: .number("4000")),
        JSONField(key: "temperature", value: .number("1")), JSONField(key: "presence_penalty", value: .number("0")),
        JSONField(key: "top_p", value: .number("1")), JSONField(key: "frequency_penalty", value: .number("0")),
        JSONField(key: "stream", value: .bool(true)), JSONField(key: "reasoning_effort", value: .string("none")),
        JSONField(key: "reasoning_budget_tokens", value: .number("0")),
        JSONField(key: "systemPrompt", value: .string("You are a large language model assistant.\nCarefully heed the user's instructions. \nRespond using Markdown."))
    ]), imageDetail: "auto")
}

enum ChatLibrary {
    static let emptySource = OrderedJSON.object([
        JSONField(key: "version", value: .number("3")), JSONField(key: "chats", value: .array([])),
        JSONField(key: "contentStore", value: .object([])), JSONField(key: "folders", value: .object([]))
    ])

    static func create(in source: OrderedJSON, id: String, defaults: ChatDefaults, folder: String? = nil) throws -> OrderedJSON {
        let chats = try source.required("chats").array("chats")
        try validateNewID(id, chats: chats)
        var index = 1
        while hasTitle("New Chat \(index)", chats: chats) { index += 1 }
        let chat = makeChat(id: id, title: "New Chat \(index)", defaults: defaults, folder: folder)
        return source.replacing("chats", with: .array([chat] + chats))
    }

    static func rename(in source: OrderedJSON, id: String, title: String) throws -> OrderedJSON {
        var chats = try source.required("chats").array("chats")
        let index = try chatIndex(id, chats: chats)
        chats[index] = chats[index].replacing("title", with: .string(title))
        return source.replacing("chats", with: .array(chats))
    }

    static func duplicate(in source: OrderedJSON, id: String, newID: String) throws -> OrderedJSON {
        let chats = try source.required("chats").array("chats")
        try validateNewID(newID, chats: chats)
        let original = chats[try chatIndex(id, chats: chats)]
        let originalTitle = try original.required("title").string("title")
        var title = "Copy of \(originalTitle)"
        var index = 0
        while hasTitle(title, chats: chats) { index += 1; title = "Copy \(index) of \(originalTitle)" }
        let copy = original.replacing("id", with: .string(newID)).replacing("title", with: .string(title))
        let store = try adjustReferences(source.required("contentStore"), chats: [original], delta: 1)
        return source.replacing("chats", with: .array([copy] + chats)).replacing("contentStore", with: store)
    }

    static func delete(in source: OrderedJSON, ids: [String], replacementID: String, defaults: ChatDefaults) throws -> OrderedJSON {
        let chats = try source.required("chats").array("chats")
        let selected = Set(ids.map { Data($0.utf8) })
        guard !selected.isEmpty, selected.count == ids.count else { throw ExchangeError.invalid("削除する会話の選択") }
        for id in ids { _ = try chatIndex(id, chats: chats) }
        var removed: [OrderedJSON] = []
        var remaining: [OrderedJSON] = []
        for chat in chats {
            let id = try chat.required("id").string("id")
            if selected.contains(Data(id.utf8)) { removed.append(chat) } else { remaining.append(chat) }
        }
        if remaining.isEmpty {
            try validateNewID(replacementID, chats: chats)
            let replacement = makeChat(id: replacementID, title: "New Chat", defaults: defaults, folder: nil)
            return source.replacing("chats", with: .array([replacement])).replacing("contentStore", with: .object([]))
        }
        let store = try adjustReferences(source.required("contentStore"), chats: removed, delta: -1)
        return source.replacing("chats", with: .array(remaining)).replacing("contentStore", with: store)
    }

    private static func makeChat(id: String, title: String, defaults: ChatDefaults, folder: String?) -> OrderedJSON {
        var fields = [JSONField(key: "id", value: .string(id)), JSONField(key: "title", value: .string(title)),
                      JSONField(key: "messages", value: .array([])), JSONField(key: "config", value: defaults.config),
                      JSONField(key: "titleSet", value: .bool(false)), JSONField(key: "imageDetail", value: .string(defaults.imageDetail))]
        if let folder { fields.append(JSONField(key: "folder", value: .string(folder))) }
        return .object(fields)
    }

    private static func chatIndex(_ id: String, chats: [OrderedJSON]) throws -> Int {
        for (index, chat) in chats.enumerated() {
            if try chat.required("id").string("id").utf8.elementsEqual(id.utf8) { return index }
        }
        throw ExchangeError.invalid("会話ID")
    }
    private static func validateNewID(_ id: String, chats: [OrderedJSON]) throws {
        guard !id.isEmpty else { throw ExchangeError.invalid("新しい会話ID") }
        for chat in chats {
            guard try !chat.required("id").string("id").utf8.elementsEqual(id.utf8) else { throw ExchangeError.invalid("会話ID重複") }
        }
    }
    private static func hasTitle(_ title: String, chats: [OrderedJSON]) -> Bool {
        chats.contains { chat in
            guard let value = chat["title"], case .string(let current) = value else { return false }
            return current.utf8.elementsEqual(title.utf8)
        }
    }
    private static func adjustReferences(_ original: OrderedJSON, chats: [OrderedJSON], delta: Int) throws -> OrderedJSON {
        var store = original
        for chat in chats {
            guard let tree = chat["branchTree"] else { continue }
            for field in try tree.required("nodes").object("nodes") {
                let hash = try field.value.required("contentHash").string("contentHash")
                let entry = try store.required(hash)
                let count = try entry.required("refCount").number("refCount")
                let updated = count + Double(delta)
                guard updated >= 0, updated.isFinite, count.rounded() == count else { throw ExchangeError.invalid("本文参照数") }
                store = store.replacing(hash, with: entry.replacing("refCount", with: .number(String(format: "%.0f", updated))))
            }
        }
        return store
    }
}
