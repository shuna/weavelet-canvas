import Foundation

enum ChatSearchMode: String { case library, grep, nodes }
enum ChatSearchScope: String { case all, activePath }
struct ChatSearchResult: Identifiable {
    let chatID: String
    let nodeID: String?
    let resultID: String
    let chatIndex: Int
    let chatTitle: String
    let snippet: String
    let matchType: String
    let isOnActivePath: Bool
    let label: String?
    let starred: Bool
    let pinned: Bool
    var id: Data { Data("\(chatID.utf8.count):\(chatID)\(resultID)".utf8) }
}

enum ChatSearch {
    private static func fields(_ value: OrderedJSON, _ names: [String]) throws -> OrderedJSON {
        .object(try value.object("search object").filter { field in names.contains { field.key.matches($0) } })
    }
    static func results(in source: OrderedJSON, query: String, mode: ChatSearchMode, scope: ChatSearchScope = .all,
                        starredOnly: Bool = false, chatID: String? = nil, currentChatID: String? = nil, currentPath: [String]? = nil) throws -> [ChatSearchResult] {
        var boundary = SharedWebProjection()
        let chats = try source.required("chats").array("chats").map { original -> OrderedJSON in
            var chat = try fields(original, ["id", "title", "folder"])
            if mode != .library, let tree = original["branchTree"] {
                let nodes = try tree.required("nodes").object("nodes").map { field in
                    JSONField(key: field.key, value: try fields(field.value, ["id", "parentId", "contentHash", "label", "starred", "pinned"]))
                }
                chat = chat.replacing("branchTree", with: try fields(tree, ["rootId", "activePath"]).replacing("nodes", with: .object(nodes)))
            } else if mode != .library, let messages = original["messages"] {
                let projected = try messages.array("messages").map { message in
                    try fields(message, ["role"]).replacing("content", with: boundary.parts(message.required("content")))
                }
                chat = chat.replacing("messages", with: .array(projected))
            }
            return chat
        }
        let folders = try (source["folders"] ?? .object([])).object("folders").map { field in
            JSONField(key: field.key, value: try fields(field.value, ["id", "name", "parentId"]))
        }
        // Resolve existing raw deltas in one shared batch before opaque projection.
        // No returned value replaces any part of the source document.
        let store = mode == .library ? OrderedJSON.object([]) : try boundary.store(source["contentStore"] ?? .object([]))
        var input: [JSONField] = [.init(key: "chats", value: .array(chats)), .init(key: "folders", value: .object(folders)),
            .init(key: "contentStore", value: store), .init(key: "query", value: .string(query)), .init(key: "mode", value: .string(mode.rawValue)),
            .init(key: "scope", value: .string(scope.rawValue)), .init(key: "starredOnly", value: .bool(starredOnly))]
        if let chatID { input.append(.init(key: "chatID", value: .string(chatID))) }
        if let currentChatID { input.append(.init(key: "currentChatID", value: .string(currentChatID))) }
        if let currentPath { input.append(.init(key: "currentPath", value: .array(currentPath.map(OrderedJSON.string)))) }
        let result = try SharedWebOperations.call("chatSearch", .object(input))
        return try result.array("search results").map { value in
            ChatSearchResult(chatID: try value.required("chatId").string("chatId"), nodeID: value["nodeId"] == .null ? nil : try value.required("nodeId").string("nodeId"),
                resultID: try value.required("resultId").string("resultId"), chatIndex: Int(try value.required("chatIndex").number("chatIndex")),
                chatTitle: try value.required("chatTitle").string("chatTitle"), snippet: try value.required("snippet").string("snippet"),
                matchType: try value.required("matchType").string("matchType"), isOnActivePath: value["isOnActivePath"] == .bool(true),
                label: value["label"] == nil || value["label"] == .null ? nil : try value.required("label").string("label"),
                starred: value["starred"] == .bool(true), pinned: value["pinned"] == .bool(true))
        }
    }
}
