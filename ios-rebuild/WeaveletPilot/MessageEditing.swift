import Foundation

enum MessageSaveMode: String { case overwrite, branch, append, insert }

enum MessageGenerationOperation: String { case append, regenerate, retry; case fromHere = "continue" }
struct MessageGenerationDraft {
    let chatID: String
    let nodeID: String
    let operation: MessageGenerationOperation
    let source: OrderedJSON
    let path: [String]
}

enum NodeRemovalOperation: String { case remove, pruneHidden }

struct NodeRemovalDraft {
    let chatID: String
    let nodeID: String?
    let source: OrderedJSON
    let path: [String]
    let operation: NodeRemovalOperation
}

enum NodeMoveDirection: String { case up, down }
enum NodeTransformOperation: String { case move, deleteBranch }
struct NodeTransformDraft {
    let chatID: String
    let nodeID: String
    let source: OrderedJSON
    let path: [String]
    let operation: NodeTransformOperation
    let direction: NodeMoveDirection?
}
struct NodeTransformResult {
    let status: String
    let removedNodeIDs: [String]
    let pruneBlockedBy: [String]
    let blockedNodeIDs: [String]
    var explanation: String? {
        switch status {
        case "protected": return "保護されたメッセージを含むため、変更できません。対象: " + blockedNodeIDs.joined(separator: ", ")
        case "missing", "chat-missing", "node-missing", "invalid-target": return "対象メッセージがないか、現在の表示経路から外れています。操作を開き直してください。"
        case "invalid-input": return "操作の対象または範囲が正しくありません。"
        case "busy": return "生成結果を保存してから操作してください。"
        case "updated", "unchanged": return nil
        default: return "操作できませんでした: " + status
        }
    }
}

enum BranchClipboardOperation: String, CaseIterable { case copy, cut, paste, move }
struct BranchClipboardDraft: Identifiable {
    let id = UUID()
    let source: OrderedJSON
    let snapshot: OrderedJSON
    var operation: BranchClipboardOperation
    var sourceChatID: String
    var fromNodeID: String
    var toNodeID: String
    var targetChatID: String
    var afterNodeID: String
}
struct BranchClipboardResult {
    let status: String
    let nodeIDs: [String]
    let blockedNodeIDs: [String]
    var explanation: String? {
        switch status {
        case "copied", "cut", "pasted", "moved": return nil
        case "protected": return "保護されたメッセージを含むため、範囲を取り除けません。対象: " + blockedNodeIDs.joined(separator: ", ")
        case "missing", "chat-missing", "node-missing": return "対象の会話またはメッセージがありません。操作を開き直してください。"
        case "not-ancestor": return "始点から終点へ親子関係でつながる範囲を選んでください。"
        case "invalid-target": return "貼り付け先に実在するメッセージを選んでください。移動する範囲内には貼り付けできません。"
        case "empty-clipboard", "clipboard-empty": return "コピーした範囲がありません。"
        case "content-missing": return "範囲の本文を読み取れません。保存データは変更していません。"
        default: return "操作できませんでした: " + status
        }
    }
}

struct MessageDraft: Identifiable {
    let id = UUID()
    let chatID: String
    let nodeID: String?
    let path: [String]
    let source: OrderedJSON
    let isInsertion: Bool
    var beforeNodeID: String? { isInsertion ? nodeID : nil }
    func targets(chatID: String, nodeID: String) -> Bool {
        self.chatID.utf8.elementsEqual(chatID.utf8) && self.nodeID?.utf8.elementsEqual(nodeID.utf8) == true
    }
    var promptParts: OrderedJSON?
    var parts: OrderedJSON { promptParts ?? originalParts }
    let originalParts: OrderedJSON
    let originalRole: String
    let isProtected: Bool
    var role: String
    var text: String
    var isReplacingAndPruning = false
    var removeCount = 0
    var followingCount: Int {
        guard let nodeID, let index = path.firstIndex(where: { $0.utf8.elementsEqual(nodeID.utf8) }) else { return 0 }
        return path.count - index - 1
    }

    let originalText: String
    var changed: Bool { role != originalRole || !text.utf8.elementsEqual(originalText.utf8) || (promptParts.map { $0 != originalParts } ?? false) }
    init(chatID: String, nodeID: String?, path: [String], source: OrderedJSON, isInsertion: Bool = false, originalParts: OrderedJSON, originalRole: String,
         isProtected: Bool, role: String, text: String) throws {
        self.chatID = chatID; self.nodeID = nodeID; self.path = path; self.source = source; self.isInsertion = isInsertion; self.originalParts = originalParts
        self.originalRole = originalRole; self.isProtected = isProtected; self.role = role; self.text = text
        originalText = try MessageEditing.textValue(of: originalParts)
    }

}

enum MessageEditing {
    struct HistoryState {
        let raw: OrderedJSON
        let canUndo: Bool
        let canRedo: Bool
    }
    struct HistoryMove {
        let source: OrderedJSON
        let history: HistoryState
        let affectedChatIDs: [String]
        let updated: Bool
    }

    private static func historyState(_ result: OrderedJSON) throws -> HistoryState {
        let can = try result.required("can")
        return try HistoryState(raw: result.required("history"), canUndo: can.required("undo").boolean("undo"), canRedo: can.required("redo").boolean("redo"))
    }
    private static func perform(in source: OrderedJSON, chatID: String, kind: String, history: HistoryState?,
                                onHistory: ((HistoryState) -> Void)?, fields: (inout SharedWebProjection) throws -> [JSONField]) throws -> (source: OrderedJSON, output: OrderedJSON) {
        var chats = try source.required("chats").array("chats")
        guard let index = try chats.firstIndex(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        var boundary = SharedWebProjection()
        let chat = try boundary.editingChat(chats[index])
        let store = try boundary.store(source.required("contentStore"))
        let input = try OrderedJSON.object([.init(key: "chat", value: chat), .init(key: "contentStore", value: store)] + fields(&boundary))
        let changes: OrderedJSON
        let output: OrderedJSON
        var next: HistoryState?
        if onHistory != nil {
            let payload = try OrderedJSON.object([.init(key: "operation", value: .string("edit")), .init(key: "kind", value: .string(kind)),
                .init(key: "input", value: input), .init(key: "history", value: boundary.history(history?.raw))])
            output = try SharedWebOperations.call("branchHistory", payload)
            changes = try output.required("changes")
            next = try historyState(output)
        } else {
            output = try SharedWebOperations.call(kind, input)
            if kind == "treeEdit" || kind == "generationPlan" || (kind == "messageEdit" && input["operation"] == .string("insertGenerate")) { changes = try output.required("changes") }
            else if kind == "nodeOptions" {
                guard output["status"] == .string("updated") || output["status"] == .string("unchanged") else { throw ExchangeError.invalid("メッセージがありません") }
                changes = try output.required("changes")
            } else { changes = output }
        }
        let original = OrderedJSON.object([.init(key: "chat", value: chats[index]), .init(key: "contentStore", value: try source.required("contentStore"))])
        let changed = try OrderedJSONChanges.apply(changes, to: original, opaque: boundary.opaque)
        chats[index] = try changed.required("chat")
        let result = source.replacing("chats", with: .array(chats)).replacing("contentStore", with: try changed.required("contentStore"))
        if let next {
            let raw = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: next.raw)])]), to: .null, opaque: boundary.opaque)
            onHistory?(HistoryState(raw: raw, canUndo: next.canUndo, canRedo: next.canRedo))
        }
        return (result, output)
    }

    static func generation(in source: OrderedJSON, chatID: String, operation: String, action: MessageGenerationOperation? = nil,
                           nodeID: String? = nil, viewingPath: [String], plan: OrderedJSON? = nil, parts: OrderedJSON? = nil,
                           newIDs: [String]? = nil, stream: OrderedJSON? = nil, now: Double, history: HistoryState?, onHistory: @escaping (HistoryState) -> Void) throws -> (source: OrderedJSON, output: OrderedJSON) {
        guard let chat = try source.required("chats").array("chats").first(where:{ try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        var target = nodeID
        if let nodeID, chat["branchTree"] == nil {
            guard nodeID.hasPrefix("message-"), let index = Int(nodeID.dropFirst(8)), index >= 0, nodeID.utf8.elementsEqual("message-\(index)".utf8) else { throw ExchangeError.invalid("flat node ID") }
            target = String(index)
        }
        return try perform(in:source,chatID:chatID,kind:"generationPlan",history:history,onHistory:onHistory) { boundary in
            var fields: [JSONField] = [.init(key:"operation",value:.string(operation)),.init(key:"viewingPath",value:.array(viewingPath.map(OrderedJSON.string))),.init(key:"now",value:.number(String(now)))]
            if let action { fields.append(.init(key:"action",value:.string(action.rawValue))) }
            if let target { fields.append(.init(key:"nodeID",value:.string(target))) }
            if let plan { fields.append(.init(key:"plan",value:plan)) }
            if let stream { fields.append(.init(key:"stream",value:stream)) }
            if let parts { fields.append(.init(key:"parts",value:try boundary.parts(parts))) }
            if let newIDs { fields.append(.init(key:"newIDs",value:.array(newIDs.map(OrderedJSON.string)))) }
            return fields
        }
    }

    static func streamState(in source: OrderedJSON, chatID: String, plan: OrderedJSON, stream: OrderedJSON, now: Double) throws -> OrderedJSON {
        let changed = try perform(in:source,chatID:chatID,kind:"generationPlan",history:nil,onHistory:nil) { _ in [
            .init(key:"operation",value:.string("streamState")),.init(key:"plan",value:plan),.init(key:"stream",value:stream),
            .init(key:"viewingPath",value:.array([])),.init(key:"now",value:.number(String(now)))
        ] }
        guard changed.output["status"] == .string("updated") else { throw ExchangeError.invalid("生成状態の保存先がありません") }
        return changed.source
    }

    static func remove(in source: OrderedJSON, chatID: String, nodeID: String?, viewingPath: [String],
                       operation: NodeRemovalOperation, newIDs: [String], now: Double,
                       history: HistoryState? = nil, onHistory: ((HistoryState) -> Void)? = nil) throws -> OrderedJSON {
        try perform(in: source, chatID: chatID, kind: "nodeRemoval", history: history, onHistory: onHistory) { _ in [
            .init(key: "nodeID", value: nodeID.map(OrderedJSON.string) ?? .null),
            .init(key: "viewingPath", value: .array(viewingPath.map(OrderedJSON.string))), .init(key: "operation", value: .string(operation.rawValue)),
            .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))] }.source
    }
    static func textValue(of parts: OrderedJSON) throws -> String {
        var boundary = SharedWebProjection()
        return try SharedWebOperations.call("messageEdit", .object([.init(key: "operation", value: .string("textValue")),
            .init(key: "parts", value: boundary.parts(parts))])).string("textValue")
    }
    static func save(in source: OrderedJSON, chatID: String, nodeID: String?, viewingPath: [String], role: String,
                     parts: OrderedJSON, editedText: String? = nil, mode: MessageSaveMode, newIDs: [String], now: Double,
                     history: HistoryState? = nil, onHistory: ((HistoryState) -> Void)? = nil) throws -> OrderedJSON {
        try perform(in: source, chatID: chatID, kind: "messageEdit", history: history, onHistory: onHistory) { boundary in
            var fields: [JSONField] = [.init(key: "viewingPath", value: .array(viewingPath.map(OrderedJSON.string))),
                .init(key: "nodeID", value: nodeID.map(OrderedJSON.string) ?? .null), .init(key: "role", value: .string(role)),
                .init(key: "parts", value: try boundary.parts(parts)), .init(key: "mode", value: .string(mode.rawValue)),
                .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))]
            if let editedText { fields.append(.init(key: "editedText", value: .string(editedText))) }
            return fields
        }.source
    }
    static func insertionForGeneration(in source: OrderedJSON, draft: MessageDraft, newIDs: [String], now: Double,
                                      history: HistoryState?, onHistory: @escaping (HistoryState) -> Void) throws -> (source: OrderedJSON, nodeID: String) {
        let changed = try perform(in: source, chatID: draft.chatID, kind: "messageEdit", history: history, onHistory: onHistory) { boundary in
            [.init(key: "operation", value: .string("insertGenerate")), .init(key: "mode", value: .string("insert")),
             .init(key: "viewingPath", value: .array(draft.path.map(OrderedJSON.string))), .init(key: "nodeID", value: draft.nodeID.map(OrderedJSON.string) ?? .null),
             .init(key: "role", value: .string(draft.role)), .init(key: "parts", value: try boundary.parts(draft.parts)), .init(key: "editedText", value: .string(draft.text)),
             .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))]
        }
        guard changed.output["status"] == .string("updated"), try changed.output["pruneBlockedBy"]?.array("protected nodes").isEmpty != false else {
            throw ExchangeError.invalid("挿入する本文の生成を準備できません。保護された後続や対象の表示経路を確認してください")
        }
        return try (changed.source, changed.output.required("nodeID").string("inserted node ID"))
    }

    static func saveOptions(in source: OrderedJSON, chatID: String, nodeID: String, value: NodeOptions.Value, newIDs: [String], now: Double,
                            history: HistoryState?, onHistory: @escaping (HistoryState) -> Void) throws -> OrderedJSON {
        _ = try NodeOptions.read(in: source, chatID: chatID, nodeID: nodeID)
        guard let chat = try source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let target = chat["branchTree"] == nil ? String(nodeID.dropFirst(8)) : nodeID
        return try perform(in: source, chatID: chatID, kind: "nodeOptions", history: history, onHistory: onHistory) { _ in [
            .init(key: "operation", value: .string("save")), .init(key: "nodeId", value: .string(target)),
            .init(key: "value", value: try value.json(preservingLabel:chat["branchTree"]?["nodes"]?[target]?["label"])),
            .init(key: "newIDs", value: .array(newIDs.map(OrderedJSON.string))), .init(key: "now", value: .number(String(now)))] }.source
    }

    static func transform(in source: OrderedJSON, chatID: String, nodeID: String, viewingPath: [String], operation: String,
                          direction: NodeMoveDirection? = nil, role: String? = nil, parts: OrderedJSON? = nil, editedText: String? = nil,
                          removeCount: Int? = nil, newIDs: [String], now: Double, history: HistoryState?, onHistory: @escaping (HistoryState) -> Void) throws -> (source: OrderedJSON, result: NodeTransformResult) {
        guard let chat = try source.required("chats").array("chats").first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { throw ExchangeError.invalid("chat ID") }
        let target: String
        if chat["branchTree"] == nil {
            guard nodeID.hasPrefix("message-"), let index = Int(nodeID.dropFirst(8)), index >= 0, nodeID.utf8.elementsEqual("message-\(index)".utf8) else { throw ExchangeError.invalid("flat node ID") }
            target = String(index)
        } else { target = nodeID }
        let changed = try perform(in: source, chatID: chatID, kind: "treeEdit", history: history, onHistory: onHistory) { boundary in
            var fields: [JSONField] = [.init(key:"nodeID",value:.string(target)),.init(key:"viewingPath",value:.array(viewingPath.map(OrderedJSON.string))),
                .init(key:"operation",value:.string(operation)),.init(key:"newIDs",value:.array(newIDs.map(OrderedJSON.string))),.init(key:"now",value:.number(String(now)))]
            if let direction { fields.append(.init(key:"direction",value:.string(direction.rawValue))) }
            if let role { fields.append(.init(key:"role",value:.string(role))) }
            if let parts { fields.append(.init(key:"parts",value:try boundary.parts(parts))) }
            if let editedText { fields.append(.init(key:"editedText",value:.string(editedText))) }
            if let removeCount { fields.append(.init(key:"removeCount",value:.number(String(removeCount)))) }
            return fields
        }
        func ids(_ key: String) throws -> [String] { try changed.output[key]?.array(key).map { try $0.string("node ID") } ?? [] }
        return try (changed.source, NodeTransformResult(status: changed.output.required("status").string("status"), removedNodeIDs: ids("removedNodeIds"), pruneBlockedBy: ids("pruneBlockedBy"), blockedNodeIDs: ids("blockedNodeIds")))
    }

    static func clipboard(in source: OrderedJSON, clipboard: OrderedJSON, draft: BranchClipboardDraft, newIDs: [String], now: Double,
                          history: HistoryState?) throws -> (source: OrderedJSON, clipboard: OrderedJSON, history: HistoryState, affectedChatIDs: [String], result: BranchClipboardResult) {
        var boundary = SharedWebProjection()
        let originals = try source.required("chats").array("chats")
        let chats = try originals.map { try boundary.editingChat($0) }
        func nodeID(_ id: String, chatID: String) throws -> String {
            guard let chat = try originals.first(where: { try $0.required("id").string("id").utf8.elementsEqual(chatID.utf8) }) else { return id }
            guard chat["branchTree"] == nil else { return id }
            guard id.hasPrefix("message-"), let index = Int(id.dropFirst(8)), index >= 0, id.utf8.elementsEqual("message-\(index)".utf8) else { return id }
            return String(index)
        }
        let input = try OrderedJSON.object([.init(key:"chats",value:.array(chats)),.init(key:"contentStore",value:boundary.store(source.required("contentStore"))),
            .init(key:"clipboard",value:boundary.clipboard(clipboard)),.init(key:"operation",value:.string(draft.operation.rawValue)),
            .init(key:"sourceChatId",value:.string(draft.sourceChatID)),.init(key:"fromNodeId",value:.string(nodeID(draft.fromNodeID,chatID:draft.sourceChatID))),
            .init(key:"toNodeId",value:.string(nodeID(draft.toNodeID,chatID:draft.sourceChatID))),.init(key:"targetChatId",value:.string(draft.targetChatID)),
            .init(key:"afterNodeId",value:.string(nodeID(draft.afterNodeID,chatID:draft.targetChatID))),
            .init(key:"newIDs",value:.array(newIDs.map(OrderedJSON.string))),.init(key:"now",value:.number(String(now)))])
        let output = try SharedWebOperations.call("branchHistory", .object([.init(key:"operation",value:.string("edit")),.init(key:"kind",value:.string("branchClipboard")),
            .init(key:"input",value:input),.init(key:"history",value:boundary.history(history?.raw))]))
        let original = try OrderedJSON.object([.init(key:"chats",value:source.required("chats")),.init(key:"contentStore",value:source.required("contentStore")),.init(key:"clipboard",value:clipboard)])
        let changed = try OrderedJSONChanges.apply(output.required("changes"), to: original, opaque: boundary.opaque)
        let state = try historyState(output)
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:state.raw)])]), to: .null, opaque: boundary.opaque)
        func ids(_ key: String) throws -> [String] { try output[key]?.array(key).map { try $0.string("ID") } ?? [] }
        return try (source.replacing("chats",with:changed.required("chats")).replacing("contentStore",with:changed.required("contentStore")), changed.required("clipboard"),
            HistoryState(raw:restored,canUndo:state.canUndo,canRedo:state.canRedo), ids("affectedChatIds"),
            BranchClipboardResult(status:output.required("status").string("status"),nodeIDs:ids("nodeIds"),blockedNodeIDs:ids("blockedNodeIds")))
    }

    static func moveHistory(_ operation: String, in source: OrderedJSON, history: HistoryState?, now: Double) throws -> HistoryMove {
        var boundary = SharedWebProjection()
        let chats = try source.required("chats").array("chats").map { try boundary.editingChat($0) }
        let store = try boundary.store(source.required("contentStore"))
        let input = try OrderedJSON.object([.init(key: "operation", value: .string(operation)), .init(key: "history", value: boundary.history(history?.raw)),
            .init(key: "chats", value: .array(chats)), .init(key: "contentStore", value: store), .init(key: "busyChatIds", value: .array([])), .init(key: "now", value: .number(String(now)))])
        let output = try SharedWebOperations.call("branchHistory", input)
        let changed = try OrderedJSONChanges.apply(output.required("changes"), to: source, opaque: boundary.opaque)
        let state = try historyState(output)
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: state.raw)])]), to: .null, opaque: boundary.opaque)
        return try HistoryMove(source: changed, history: HistoryState(raw: restored, canUndo: state.canUndo, canRedo: state.canRedo),
            affectedChatIDs: output.required("affectedChatIds").array("affectedChatIds").map { try $0.string("chat ID") }, updated: output["status"] == .string("updated"))
    }
    static func invalidatingHistory(_ history: HistoryState?, before: OrderedJSON, after: OrderedJSON) throws -> HistoryState? {
        guard let history else { return nil }
        var boundary = SharedWebProjection()
        let previous = try before.required("chats").array("chats").map { try boundary.editingChat($0) }
        let next = try after.required("chats").array("chats").map { try boundary.editingChat($0) }
        let output = try SharedWebOperations.call("branchHistory", .object([.init(key: "operation", value: .string("invalidate")),
            .init(key: "history", value: boundary.history(history.raw)), .init(key: "before", value: .array(previous)), .init(key: "after", value: .array(next))]))
        let state = try historyState(output)
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: state.raw)])]), to: .null, opaque: boundary.opaque)
        return HistoryState(raw: restored, canUndo: state.canUndo, canRedo: state.canRedo)
    }
}

// Opaque attributes are references into the original native document. Only the
// fields the Web editing functions use are decoded by JavaScript.
struct SharedWebProjection {
    var opaque: [OrderedJSON] = []
    private var identities: [Data: Int] = [:]
    mutating func reference(_ value: OrderedJSON) throws -> OrderedJSON {
        if value == .null { return .null }
        let key = try value.encoded()
        let index: Int
        if let existing = identities[key] { index = existing }
        else { index = opaque.count; opaque.append(value); identities[key] = index }
        return .object([.init(key: "opaqueRef", value: .number(String(index)))])
    }
    mutating private func fields(_ value: OrderedJSON, known: [String]) throws -> OrderedJSON {
        var output: [JSONField] = []
        for field in try value.object("object") {
            output.append(.init(key: field.key, value: known.contains(where: field.key.matches) ? field.value : try reference(field.value)))
        }
        return .object(output)
    }
    mutating func parts(_ value: OrderedJSON) throws -> OrderedJSON {
        var values: [OrderedJSON] = []
        for part in try value.array("content") {
            let type = try part.required("type").string("content.type")
            let known: [String]
            switch type {
            case "text", "reasoning": known = ["type", "text"]
            case "image_url": known = ["type", "image_url"]
            case "tool_call": known = ["type", "id", "name", "arguments"]
            case "tool_result": known = ["type", "tool_call_id", "content"]
            default: throw ExchangeError.invalid("content.type")
            }
            for key in known where key != "image_url" { _ = try part.required(key).stringKey(key) }
            var projected = try fields(part, known: known)
            if type == "image_url" {
                let image = try part.required("image_url")
                _ = try image.required("url").stringKey("image_url.url")
                _ = try image.required("detail").string("image_url.detail")
                projected = projected.replacing("image_url", with: try fields(image, known: ["url", "detail"]))
            }
            values.append(projected)
        }
        return .array(values)
    }
    mutating private func messages(_ value: OrderedJSON) throws -> OrderedJSON {
        var result: [OrderedJSON] = []
        for message in try value.array("messages") {
            var projected = try fields(message, known: ["role", "content"])
            projected = projected.replacing("content", with: try parts(message.required("content")))
            result.append(projected)
        }
        return .array(result)
    }
    mutating func folders(_ value: OrderedJSON) throws -> OrderedJSON {
        var result: [JSONField] = []
        for field in try value.object("folders") {
            var folder = try fields(field.value, known: ["id", "name", "order", "expanded", "color", "parentId"])
            // The current hierarchy validator tolerates future color values;
            // only strings are used by the native color UI.
            if let color = field.value["color"], case .string = color {} else if let color = field.value["color"] {
                folder = folder.replacing("color", with: try reference(color))
            }
            result.append(.init(key: field.key, value: folder))
        }
        return .object(result)
    }
    mutating func requestConfig(_ value: OrderedJSON) throws -> OrderedJSON {
        try fields(value, known: ["model", "stream", "max_tokens", "providerId", "reasoning_effort", "reasoning_budget_tokens", "verbosity", "force_reasoning", "systemPrompt", "modelSource", "modelSettings", "openRouter"])
    }
    mutating func config(_ value: OrderedJSON) throws -> OrderedJSON {
        try fields(value, known: ["systemPrompt"])
    }
    mutating func chat(_ value: OrderedJSON) throws -> OrderedJSON {
        var result = try fields(value, known: ["id", "title", "titleSet", "imageDetail", "messages", "config", "branchTree", "collapsedNodes", "omittedNodes", "protectedNodes"])
        if let configuration = value["config"] { result = result.replacing("config", with: try config(configuration)) }
        if case .array = value["messages"] { result = result.replacing("messages", with: try messages(value.required("messages"))) }
        if let tree = value["branchTree"] {
            var projectedTree = try fields(tree, known: ["nodes", "rootId", "activePath", "messageAttributesV1"])
            var nodes: [JSONField] = []
            for node in try tree.required("nodes").object("nodes") {
                var projected = try fields(node.value, known: ["id", "parentId", "role", "contentHash", "createdAt", "streamState"])
                if let saved = node.value["streamState"] {
                    if case .object = saved {
                        projected = projected.replacing("streamState",with:try fields(saved,known:["reason","requestId","proxy","createdAt"]))
                    } else { projected = projected.replacing("streamState",with:try reference(saved)) }
                }
                nodes.append(.init(key:node.key,value:projected))
            }
            projectedTree = projectedTree.replacing("nodes", with: .object(nodes))
            if let attributes = tree["messageAttributesV1"] {
                var byNode: [JSONField] = []
                for node in try attributes.required("byNode").object("byNode") { byNode.append(.init(key: node.key, value: try fields(node.value, known: []))) }
                projectedTree = projectedTree.replacing("messageAttributesV1", with: attributes.replacing("byNode", with: .object(byNode)))
            }
            result = result.replacing("branchTree", with: projectedTree)
        }
        return result
    }
    mutating func editingChat(_ value: OrderedJSON) throws -> OrderedJSON {
        var result = try chat(value)
        if let tree = value["branchTree"] {
            let projectedTree = try result.required("branchTree"), projectedNodes = try projectedTree.required("nodes")
            let nodes = try tree.required("nodes").object("nodes").map { field -> JSONField in
                var node = try projectedNodes.required(field.key)
                for key in ["label", "starred", "pinned"] { if let value = field.value[key] { node = node.replacing(key, with: value) } }
                return .init(key: field.key, value: node)
            }
            result = result.replacing("branchTree", with: projectedTree.replacing("nodes", with: .object(nodes)))
        }
        return result
    }
    mutating func clipboard(_ value: OrderedJSON) throws -> OrderedJSON {
        if value == .null { return .null }
        var result = try fields(value, known: ["nodeIds", "sourceChat", "nodes", "messageAttributesV1", "collapsedNodes", "omittedNodes", "protectedNodes"])
        let tree = OrderedJSON.object([.init(key:"nodes",value:try value.required("nodes")),.init(key:"rootId",value:.string("")),.init(key:"activePath",value:try value.required("nodeIds"))] + (value["messageAttributesV1"].map { [.init(key:"messageAttributesV1",value:$0)] } ?? []))
        let projected = try editingChat(.object([.init(key:"branchTree",value:tree)])).required("branchTree")
        result = result.replacing("nodes",with:try projected.required("nodes"))
        if let attributes = projected["messageAttributesV1"] { result = result.replacing("messageAttributesV1",with:attributes) }
        return result
    }
    mutating func history(_ value: OrderedJSON?) throws -> OrderedJSON {
        guard let value else { return .null }
        var result = value
        for key in ["past", "future"] {
            let snapshots = try value.required(key).array(key).map { snapshot -> OrderedJSON in
                let chats = try snapshot.required("chats").array("chats").map { chat -> OrderedJSON in
                    var projected = try editingChat(chat)
                    for field in ["expectedActivePath", "systemPrompt"] { if let value = chat[field] { projected = projected.replacing(field, with: value) } }
                    return projected
                }
                return try snapshot.replacing("chats", with: .array(chats)).replacing("contentStore", with: store(snapshot.required("contentStore")))
            }
            result = result.replacing(key, with: .array(snapshots))
        }
        return result
    }
    mutating func store(_ value: OrderedJSON, resolving hashes: [String]? = nil, strict: Bool = false) throws -> OrderedJSON {
        let resolved = try SharedWebOperations.call("documentOperation", .object([.init(key: "operation", value: .string("resolveStore")), .init(key: "store", value: value), .init(key: "strict", value: .bool(strict)), .init(key: "hashes", value: hashes.map { .array($0.map(OrderedJSON.string)) } ?? .null)]))
        var entries: [JSONField] = []
        for entry in try value.object("contentStore") {
            let original: OrderedJSON
            if let json = resolved[entry.key] {
                let content = try OrderedJSON.decode(Data(json.string("resolved delta").utf8))
                original = .object(try entry.value.object("entry").filter { $0.key != "delta" }.map { $0.key == "content" ? .init(key: "content", value: content) : $0 })
            } else { original = entry.value }
            var projected = try fields(original, known: ["content", "refCount"])
            projected = projected.replacing("content", with: try parts(original.required("content")))
            entries.append(.init(key: entry.key, value: projected))
        }
        return .object(entries)
    }
}
