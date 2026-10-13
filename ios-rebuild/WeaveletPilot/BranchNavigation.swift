import Foundation

// Shared Web code resolves paths and history; Swift transports raw values and decodes UI results.
enum BranchNavigation {
    enum Source: String { case branchSwitch = "branch-switch", search, grep, branchEditor = "branch-editor", chatSwitch = "chat-switch", chatClick = "chat-click", viewSwitch = "view-switch", scroll, initial = "init" }
    enum Status: String { case reached, chatMissing = "chat-missing", nodeMissing = "node-missing" }
    struct Result {
        let status: Status
        let chatID: String?
        let focusedNodeID: String?
        let path: [String]
        let source: OrderedJSON
        fileprivate let rawTarget: OrderedJSON
    }
    struct NodeCandidates {
        let nodeID: String
        let siblingIDs: [String]
        let selectedIndex: Int
    }
    struct ChatCandidates {
        let chatID: String
        let activePath: [String]
        let nodeIDs: [String]
        let byNode: [NodeCandidates]
        fileprivate let nodePositions: [Data:Int]
        func candidates(for nodeID: String) -> NodeCandidates? { nodePositions[Data(nodeID.utf8)].map { byNode[$0] } }
    }
    enum HistoryAction: String { case initialize, push, back, forward, capture }
    struct HistoryResult {
        let history: OrderedJSON
        let entry: OrderedJSON?
        let canBack: Bool
        let canForward: Bool
    }
    static func navigate(in source: OrderedJSON, chatID: String, nodeID: String? = nil, source navigationSource: Source = .branchSwitch, viewingPath: [String]? = nil) throws -> Result {
        var input = OrderedJSON.object([.init(key:"operation",value:.string("navigate")),.init(key:"chatId",value:.string(chatID)),.init(key:"navigationSource",value:.string(navigationSource.rawValue))])
        if let nodeID { input = input.replacing("nodeId",with:.string(nodeID)) }
        if let viewingPath { input = input.replacing("viewingPath",with:.array(viewingPath.map(OrderedJSON.string))) }
        return try navigation(input,in:source)
    }
    static func restore(in source: OrderedJSON, entry: OrderedJSON) throws -> Result {
        try navigation(.object([.init(key:"operation",value:.string("restore")),.init(key:"entry",value:entry)]),in:source)
    }
    private static func navigation(_ input: OrderedJSON, in source: OrderedJSON) throws -> Result {
        var boundary = SharedWebProjection()
        let chats = try source.required("chats").array("chats").map { try boundary.chat($0) }
        let projected = source.replacing("chats",with:.array(chats)).replacing("contentStore",with:try boundary.store(source.required("contentStore")))
        let output = try SharedWebOperations.call("navigationOperation",input.replacing("source",with:projected))
        guard let status = Status(rawValue:try output.required("status").string("status")) else { throw ExchangeError.invalid("navigation status") }
        let changed = try OrderedJSONChanges.apply(output.required("changes"),to:source,opaque:boundary.opaque)
        return try .init(status:status,chatID:output["chatId"].map { try $0.string("chat ID") },focusedNodeID:output["focusedNodeId"].map { try $0.string("node ID") },path:output["path"].map { try $0.array("path").map { try $0.string("node ID") } } ?? [],source:changed,rawTarget:output)
    }
    static func candidates(in source: OrderedJSON) throws -> [ChatCandidates] {
        let output = try SharedWebOperations.call("navigationOperation",.object([.init(key:"operation",value:.string("candidates")),.init(key:"source",value:source)]))
        return try output.array("candidates").map { chat in
            let groups = try chat.required("groups").array("groups").map { try $0.array("siblings").map { try $0.string("node ID") } }
            let byNode = try chat.required("byNode").object("nodes").map { field in
                let groupIndex = Int(try field.value.required("groupIndex").number("group index"))
                guard groups.indices.contains(groupIndex) else { throw ExchangeError.invalid("sibling group") }
                return NodeCandidates(nodeID:try field.key.native("node ID"),siblingIDs:groups[groupIndex],selectedIndex:Int(try field.value.required("selectedIndex").number("index")))
            }
            let nodePositions = Dictionary(uniqueKeysWithValues:byNode.enumerated().map { (Data($0.element.nodeID.utf8),$0.offset) })
            return try ChatCandidates(chatID:chat.required("chatId").string("chat ID"),activePath:chat.required("activePath").array("path").map { try $0.string("node ID") },nodeIDs:chat.required("nodeIDs").array("nodes").map { try $0.string("node ID") },byNode:byNode,nodePositions:nodePositions)
        }
    }
    static func emptyHistory() throws -> OrderedJSON {
        try SharedWebOperations.call("navigationOperation",.object([.init(key:"operation",value:.string("historyEmpty"))]))
    }
    static func history(_ history: OrderedJSON, action: HistoryAction, in source: OrderedJSON, entry: OrderedJSON? = nil, target: Result? = nil, chatID: String? = nil, view: String? = nil, navigationSource: Source = .branchSwitch, viewingPath: [String]? = nil, scrollAnchor: OrderedJSON? = nil, key: String = UUID().uuidString.lowercased()) throws -> HistoryResult {
        var input = OrderedJSON.object([.init(key:"operation",value:.string("history")),.init(key:"action",value:.string(action.rawValue)),.init(key:"history",value:history),.init(key:"source",value:source),.init(key:"key",value:.string(key))])
        if let entry { input = input.replacing("entry",with:entry) }
        if let target { input = input.replacing("target",with:target.rawTarget).replacing("navigationSource",with:.string(navigationSource.rawValue)) }
        if let viewingPath { input = input.replacing("viewingPath",with:.array(viewingPath.map(OrderedJSON.string))) }
        if let scrollAnchor { input = input.replacing("scrollAnchor",with:scrollAnchor) }
        if let chatID { input = input.replacing("chatId",with:.string(chatID)) }
        if let view { input = input.replacing("view",with:.string(view)) }
        let output = try SharedWebOperations.call("navigationOperation",input)
        let current = output["entry"]
        return try .init(history:output.required("history"),entry:current == .null ? nil : current,canBack:output.required("canBack").boolean("can back"),canForward:output.required("canForward").boolean("can forward"))
    }
}
