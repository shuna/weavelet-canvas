import Foundation

enum NodeOptions {
    struct Value: Equatable {
        var label = ""
        var starred = false
        var pinned = false
        var collapsed = false
        var omitted = false
        var protected = false
        static func == (left:Value,right:Value) -> Bool {
            left.label.utf8.elementsEqual(right.label.utf8) && left.starred == right.starred && left.pinned == right.pinned && left.collapsed == right.collapsed && left.omitted == right.omitted && left.protected == right.protected
        }
        func json(preservingLabel original: OrderedJSON?) throws -> OrderedJSON {
            let savedLabel = try original.flatMap { label.utf8.elementsEqual(try $0.displayString("label").utf8) ? $0 : nil } ?? .string(label)
            return .object([
            .init(key:"label",value:savedLabel),.init(key:"starred",value:.bool(starred)),.init(key:"pinned",value:.bool(pinned)),
            .init(key:"collapsed",value:.bool(collapsed)),.init(key:"omitted",value:.bool(omitted)),.init(key:"protected",value:.bool(protected))
        ])
        }
    }
    enum Status: String { case updated, unchanged, chatMissing = "chat-missing", nodeMissing = "node-missing" }
    struct Result {
        let status: Status
        let nodeID: String?
        let path: [String]?
        let source: OrderedJSON
    }
    // WebExchange constructs flat display IDs as message-{index}; Web targets/maps
    // use the corresponding canonical decimal index. Tree IDs are passed verbatim.
    private static func targetID(chat: OrderedJSON, nodeID: String) throws -> String {
        if chat["branchTree"] != nil { return nodeID }
        guard nodeID.hasPrefix("message-"), let index=Int(nodeID.dropFirst(8)), index >= 0,
              nodeID.utf8.elementsEqual("message-\(index)".utf8) else { throw ExchangeError.invalid("flat node ID") }
        return String(index)
    }
    // These are typed display fields, not mutation or tree rules. No JS VM is
    // created while WebExchange builds the node list or the UI redraws it.
    static func read(chat: OrderedJSON, nodeID: String) throws -> Value {
        let id=try targetID(chat:chat,nodeID:nodeID)
        let node: OrderedJSON?
        if let tree=chat["branchTree"] {
            guard let found=try tree.required("nodes")[id] else { throw ExchangeError.invalid("node ID") }
            node=found
        } else {
            guard let index=Int(id), try chat.required("messages").array("messages").indices.contains(index) else { throw ExchangeError.invalid("node ID") }
            node=nil
        }
        func flag(_ field:String) throws -> Bool { try node?[field]?.boolean(field) ?? false }
        func mapped(_ field:String) throws -> Bool {
            guard let map=chat[field], map != .null else { return false }
            _ = try map.object(field)
            return try map[id]?.boolean(field) ?? false
        }
        return try Value(label:node?["label"]?.displayString("label") ?? "",starred:flag("starred"),pinned:flag("pinned"),collapsed:mapped("collapsedNodes"),omitted:mapped("omittedNodes"),protected:mapped("protectedNodes"))
    }
    static func read(in source: OrderedJSON, chatID: String, nodeID: String) throws -> Value {
        guard let chat=try source.required("chats").array("chats").first(where:{ try $0.required("id").string("chat ID").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        return try read(chat:chat,nodeID:nodeID)
    }
    static func save(in source: OrderedJSON, chatID: String, nodeID: String, value: Value, newIDs: [String]? = nil, now: Double = Date().timeIntervalSince1970 * 1000) throws -> Result {
        var chats=try source.required("chats").array("chats")
        guard let index=try chats.firstIndex(where:{ try $0.required("id").string("chat ID").utf8.elementsEqual(chatID.utf8) }) else { return .init(status:.chatMissing,nodeID:nil,path:nil,source:source) }
        let chat=chats[index], id=try targetID(chat:chat,nodeID:nodeID)
        var boundary=SharedWebProjection()
        var projected=try boundary.chat(chat)
        if let originalTree=chat["branchTree"] {
            let projectedTree=try projected.required("branchTree"), projectedNodes=try projectedTree.required("nodes")
            let nodes=try originalTree.required("nodes").object("nodes").map { field -> JSONField in
                var node=try projectedNodes.required(field.key)
                for key in ["label","starred","pinned"] { if let value=field.value[key] { node=node.replacing(key,with:value) } }
                return .init(key:field.key,value:node)
            }
            projected=projected.replacing("branchTree",with:projectedTree.replacing("nodes",with:.object(nodes)))
        }
        let store=try source.required("contentStore")
        let projectedStore=try boundary.store(store)
        let ids=try newIDs ?? (0..<(chat["branchTree"] == nil ? chat.required("messages").array("messages").count : 0)).map { _ in UUID().uuidString.lowercased() }
        let input=OrderedJSON.object([.init(key:"operation",value:.string("save")),.init(key:"chat",value:projected),.init(key:"contentStore",value:projectedStore),.init(key:"nodeId",value:.string(id)),.init(key:"value",value:try value.json(preservingLabel:chat["branchTree"]?["nodes"]?[id]?["label"])),.init(key:"newIDs",value:.array(ids.map(OrderedJSON.string))),.init(key:"now",value:.number(String(now)))])
        let output=try SharedWebOperations.call("nodeOptions",input)
        guard let status=Status(rawValue:try output.required("status").string("status")) else { throw ExchangeError.invalid("node options status") }
        let changed=try OrderedJSONChanges.apply(output.required("changes"),to:.object([.init(key:"chat",value:chat),.init(key:"contentStore",value:store)]),opaque:boundary.opaque)
        chats[index]=try changed.required("chat")
        let changedSource=source.replacing("chats",with:.array(chats)).replacing("contentStore",with:try changed.required("contentStore"))
        let returnedID=try output["nodeId"].map { try $0.string("node ID") }
        let displayID=changed["chat"]?["branchTree"] == nil ? returnedID.map { "message-\($0)" } : returnedID
        return try .init(status:status,nodeID:displayID,path:output["path"].map { try $0.array("path").map { try $0.string("node ID") } },source:changedSource)
    }
}
