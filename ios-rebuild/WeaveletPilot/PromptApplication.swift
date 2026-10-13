import Foundation

enum PromptPickerInput {
    case command(parts: OrderedJSON, text: String)
    case system(text: String)

    var guardValue: OrderedJSON {
        switch self {
        case .command(let parts, let text): return .object([.init(key: "parts", value: parts), .init(key: "text", value: .string(text))])
        case .system(let text): return .string(text)
        }
    }
}
struct PromptPickerRequest: Identifiable {
    let id = UUID()
    let snapshot: OrderedJSON
    let chatID: String
    let input: PromptPickerInput
}
enum PromptPickerResult {
    case command(ComposerDraft)
    case system(String)
}
struct PromptPickerRow: Identifiable {
    let id: Int
    let name: String
    let body: String
}

actor PromptApplication {
    private var session: SharedWebOperations.Session?
    private var prompts: OrderedJSON?
    private var snapshotBytes: Data?

    private func call(_ input: OrderedJSON) throws -> OrderedJSON {
        if session == nil { session = try SharedWebOperations.Session() }
        return try session!.call("promptApplicationOperation", input)
    }
    func search(snapshot: OrderedJSON, query: String) throws -> [PromptPickerRow] {
        let bytes = try snapshot.encoded()
        if snapshotBytes != bytes {
            if let saved = try snapshot.required("state")["prompts"] { prompts = saved }
            else {
                if session == nil { session = try SharedWebOperations.Session() }
                prompts = try session!.call("promptLibraryOperation", .object([.init(key: "operation", value: .string("defaults"))]))
            }
            snapshotBytes = bytes
        }
        let items = try PromptLibrary.items(prompts!)
        let names = OrderedJSON.array(items.enumerated().map { index, item in
            .object([.init(key: "name", value: .string(item.name)), .init(key: "index", value: .number(String(index)))])
        })
        let result = try call(.object([.init(key: "operation", value: .string("search")),
                                      .init(key: "prompts", value: names), .init(key: "query", value: .string(query))]))
        return try result.array("prompt search").map { row in
            let index = Int(try row.required("index").number("prompt index"))
            guard items.indices.contains(index) else { throw ExchangeError.invalid("プロンプトがありません") }
            return PromptPickerRow(id: index, name: items[index].name, body: items[index].body)
        }
    }
    func apply(_ input: PromptPickerInput, text: String) throws -> PromptPickerResult {
        switch input {
        case .system(let previous):
            return try .system(call(.object([.init(key: "operation", value: .string("system")),
                                             .init(key: "previous", value: .string(previous)), .init(key: "text", value: .string(text))])).string("system prompt"))
        case .command(let parts, let editedText):
            var boundary = SharedWebProjection()
            let projected = try parts.array("prompt parts").map { part in
                OrderedJSON.object(try part.object("prompt part").map { field in
                    let direct = (field.key == "type" || field.key == "text") && { if case .string = field.value { return true }; return false }()
                    return .init(key: field.key, value: try direct ? field.value : boundary.reference(field.value))
                })
            }
            let result = try call(.object([.init(key: "operation", value: .string("command")),
                                           .init(key: "parts", value: .array(projected)), .init(key: "editedText", value: .string(editedText)),
                                           .init(key: "text", value: .string(text))]))
            let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")),
                .init(key: "path", value: .array([])), .init(key: "value", value: result.required("parts"))])]), to: .null, opaque: boundary.opaque)
            return try .command(ComposerDraft(parts: restored, text: result.required("text").string("prompt text"),
                                               hasMeaningfulContent: result.required("hasMeaningfulContent").boolean("prompt content")))
        }
    }
    static func validate(_ request: PromptPickerRequest, snapshot: OrderedJSON, chatID: String, input: PromptPickerInput) throws {
        guard request.chatID.utf8.elementsEqual(chatID.utf8), try request.snapshot.encoded() == snapshot.encoded(),
              try request.input.guardValue.encoded() == input.guardValue.encoded() else {
            throw ExchangeError.invalid("入力または保存データが変更されました。プロンプトを選び直してください")
        }
    }
}

extension ChatState {
    func promptPickerRequest(_ input: PromptPickerInput) throws -> PromptPickerRequest {
        PromptPickerRequest(snapshot: try syncInputSnapshot(), chatID: selectedConversationID, input: input)
    }
    func validatePromptPicker(_ request: PromptPickerRequest, input: PromptPickerInput) throws {
        try PromptApplication.validate(request, snapshot: syncInputSnapshot(), chatID: selectedConversationID, input: input)
    }
}
