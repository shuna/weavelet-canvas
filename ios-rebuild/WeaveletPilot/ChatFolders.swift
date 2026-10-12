import Foundation
import JavaScriptCore

enum ChatFolderOperation {
    case create(id: String)
    case rename(id: String, name: String)
    case color(id: String, color: String?)
    case expanded(id: String, expanded: Bool)
    case remove(id: String)
    case move(chatIDs: [String], folderID: String?)

    var json: OrderedJSON {
        var fields: [JSONField]
        switch self {
        case .create(let id): fields = [.init(key: "type", value: .string("create")), .init(key: "id", value: .string(id))]
        case .rename(let id, let name): fields = [.init(key: "type", value: .string("rename")), .init(key: "id", value: .string(id)), .init(key: "name", value: .string(name))]
        case .color(let id, let color):
            fields = [.init(key: "type", value: .string("color")), .init(key: "id", value: .string(id))]
            if let color { fields.append(.init(key: "color", value: .string(color))) }
        case .expanded(let id, let expanded): fields = [.init(key: "type", value: .string("expanded")), .init(key: "id", value: .string(id)), .init(key: "expanded", value: .bool(expanded))]
        case .remove(let id): fields = [.init(key: "type", value: .string("remove")), .init(key: "id", value: .string(id))]
        case .move(let ids, let folder):
            fields = [.init(key: "type", value: .string("move")), .init(key: "chatIds", value: .array(ids.map(OrderedJSON.string)))]
            if let folder { fields.append(.init(key: "folderId", value: .string(folder))) }
        }
        return .object(fields)
    }
}

struct ChatFolderRow: Identifiable {
    let id: String
    let name: String
    let expanded: Bool
    let order: Double
    let color: String?
    var identity: Data { Data(id.utf8) }
}

private final class FolderResource {}
enum SharedWebOperations {
    static func call(_ name: String, _ input: OrderedJSON) throws -> OrderedJSON {
        guard let context = JSContext(), let url = Bundle(for: FolderResource.self).url(forResource: "GoogleSync.bundle", withExtension: "js") else { throw ExchangeError.invalid("共有処理 bundle がありません") }
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        guard context.exception == nil, let bridge = context.objectForKeyedSubscript("WeaveletGoogleSync"), let function = bridge.objectForKeyedSubscript(name), !function.isUndefined else { throw ExchangeError.invalid("共有処理を読み込めません") }
        let result = function.call(withArguments: [String(decoding: try input.encoded(), as: UTF8.self)])
        guard context.exception == nil, let text = result?.toString() else { throw ExchangeError.invalid(context.exception?.toString() ?? "共有処理に失敗しました") }
        return try OrderedJSON.decode(Data(text.utf8))
    }
}

enum ChatFolders {
    private static let folderFields = ["id", "name", "order", "expanded", "color"]
    private static func projection(_ value: OrderedJSON, fields: [String]) throws -> OrderedJSON {
        .object(try value.object("projection").filter { field in fields.contains { $0.utf8.elementsEqual(field.key.utf8) } })
    }
    private static func input(_ source: OrderedJSON) throws -> OrderedJSON {
        let folders = try source.required("folders").object("folders").map { field in
            JSONField(key: field.key, value: try projection(field.value, fields: folderFields))
        }
        let chats = try source.required("chats").array("chats").map { try projection($0, fields: ["id", "folder"]) }
        return .object([.init(key: "folders", value: .object(folders)), .init(key: "chats", value: .array(chats))])
    }
    // Mechanically apply the shared routine's known-field changes to the original document.
    // Bodies, unknown attributes and unchanged number spellings never pass through JS.
    private static func patch(_ original: OrderedJSON, _ change: OrderedJSON) throws -> OrderedJSON {
        let removed = try change.required("remove").array("remove").map { try $0.string("field") }
        var result = OrderedJSON.object(try original.object("object").filter { field in !removed.contains { $0.utf8.elementsEqual(field.key.utf8) } })
        for field in try change.required("set").object("set") { result = result.replacing(field.key, with: field.value) }
        return result
    }
    static func apply(in source: OrderedJSON, operation: ChatFolderOperation) throws -> OrderedJSON {
        try apply(in: source, operationJSON: operation.json)
    }
    static func apply(in source: OrderedJSON, operationJSON: OrderedJSON) throws -> OrderedJSON {
        let output = try SharedWebOperations.call("folderOperation", input(source).replacing("operation", with: operationJSON))
        var folders = try source.required("folders")
        for change in try output.required("folderChanges").array("folderChanges") {
            let key = try change.required("key").string("key")
            folders = folders.replacing(key, with: try patch(folders[key] ?? .object([]), change))
        }
        let ordered = try output.required("folderKeys").array("folderKeys").map { key -> JSONField in
            let id = try key.string("folderKey")
            return JSONField(key: id, value: try folders.required(id))
        }
        var chats = try source.required("chats").array("chats")
        for change in try output.required("chatChanges").array("chatChanges") {
            let index = Int(try change.required("index").number("index"))
            guard chats.indices.contains(index) else { throw ExchangeError.invalid("共有処理の会話indexが不正です") }
            chats[index] = try patch(chats[index], change)
        }
        return source.replacing("folders", with: .object(ordered)).replacing("chats", with: .array(chats))
    }
    static func rows(in source: OrderedJSON) throws -> [ChatFolderRow] {
        try SharedWebOperations.call("folderRows", input(source)).array("rows").map { row in
            let color: String?
            if case .string(let text) = row["color"] { color = text } else { color = nil }
            return try ChatFolderRow(id: row.required("id").string("id"), name: row.required("name").string("name"), expanded: row.required("expanded").boolean("expanded"), order: row.required("order").number("order"), color: color)
        }
    }
    static func membership(of chat: OrderedJSON) -> String? {
        if case .string(let id) = chat["folder"], !id.isEmpty { return id }
        return nil
    }
}
