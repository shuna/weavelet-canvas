import SwiftUI

struct BranchLayoutKey: Equatable {
    struct Entry: Equatable {
        let chatID: String
        let chatIndex: Int
        let title: String
        let tree: OrderedJSON?
        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.chatID.utf8.elementsEqual(rhs.chatID.utf8) && lhs.chatIndex == rhs.chatIndex &&
            lhs.title.utf8.elementsEqual(rhs.title.utf8) && lhs.tree == rhs.tree
        }
    }
    let chatID: String
    let chatIndex: Int
    let title: String
    let tree: OrderedJSON?
    let contentStore: OrderedJSON?
    let entries: [Entry]
    private let selectedChatID: String
    private let multiViewChatIndices: [Int]

    init(chatID: String, chatIndex: Int, title: String, tree: OrderedJSON?, contentStore: OrderedJSON?) {
        self.chatID = chatID; self.chatIndex = chatIndex; self.title = title
        self.tree = tree; self.contentStore = contentStore
        entries = [Entry(chatID: chatID, chatIndex: chatIndex, title: title, tree: tree)]
        selectedChatID = chatID; multiViewChatIndices = []
    }

    init(state: ChatState) {
        selectedChatID = state.selectedConversationID
        multiViewChatIndices = state.multiViewChatIndices
        let chats = (try? state.exchange?.source.required("chats").array("chats")) ?? []
        chatIndex = chats.firstIndex { $0["id"] == .string(state.selectedConversationID) } ?? -1
        chatID = selectedChatID; title = state.conversation?.title ?? ""
        tree = chats.indices.contains(chatIndex) ? chats[chatIndex]["branchTree"] : nil
        contentStore = state.exchange?.source["contentStore"]
        let indices = multiViewChatIndices.count > 1 ? multiViewChatIndices : [chatIndex]
        entries = indices.compactMap { index in
            guard chats.indices.contains(index), let id = try? chats[index].required("id").string("id"),
                  let title = try? chats[index].required("title").displayString("title") else { return nil }
            return Entry(chatID: id, chatIndex: index, title: title, tree: chats[index]["branchTree"])
        }
    }

    private init(_ key: Self, entry: Entry) {
        chatID = entry.chatID; chatIndex = entry.chatIndex; title = entry.title; tree = entry.tree
        contentStore = key.contentStore; entries = key.entries
        selectedChatID = key.selectedChatID; multiViewChatIndices = key.multiViewChatIndices
    }
    func context(chatIndex: Int) -> Self? { entries.first { $0.chatIndex == chatIndex }.map { Self(self, entry: $0) } }
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.chatID.utf8.elementsEqual(rhs.chatID.utf8) && lhs.chatIndex == rhs.chatIndex &&
        lhs.title.utf8.elementsEqual(rhs.title.utf8) && lhs.tree == rhs.tree && lhs.sameLayout(as: rhs)
    }
    private func sameLayout(as key: Self) -> Bool {
        selectedChatID.utf8.elementsEqual(key.selectedChatID.utf8) && multiViewChatIndices == key.multiViewChatIndices &&
        entries == key.entries && contentStore == key.contentStore
    }
    func isCurrent(in state: ChatState) -> Bool { sameLayout(as: Self(state: state)) }
    func isRoot(_ nodeID: String) -> Bool {
        guard let rootID = try? tree?.required("rootId").string("rootId") else { return false }
        return rootID.utf8.elementsEqual(nodeID.utf8)
    }
    func select(_ nodeID: String, in state: ChatState) throws -> Bool {
        guard isCurrent(in: state) else { return false }
        try state.navigate(chatID: chatID, nodeID: nodeID, source: .branchEditor)
        return true
    }
    func input(requestID: Int) throws -> OrderedJSON {
        guard let contentStore, !entries.isEmpty, Set(entries.map(\.chatIndex)).count == entries.count else { throw ExchangeError.invalid("分岐データがありません") }
        var previewStore: [JSONField] = []
        var seen = Set<Data>()
        let projected = try entries.map { entry -> OrderedJSON in
            guard let tree = entry.tree else { throw ExchangeError.invalid("分岐データがありません") }
            let nodes = try tree.required("nodes")
            for field in try nodes.object("nodes") {
                let hash = try field.value.required("contentHash").string("contentHash")
                guard seen.insert(Data(hash.utf8)).inserted else { continue }
                let stored = try contentStore.required(hash)
                let preview = stored["delta"] == nil ? stored : stored.replacing("content", with: try SyncRecords.resolveProjectedContent(contentStore, hash: hash))
                previewStore.append(.init(key: hash, value: preview))
            }
            return .object([.init(key: "chatIndex", value: .number(String(entry.chatIndex))), .init(key: "chatId", value: .string(entry.chatID)),
                .init(key: "chatTitle", value: .string(entry.title)), .init(key: "nodes", value: nodes), .init(key: "activePath", value: try tree.required("activePath"))])
        }
        return .object([.init(key: "requestId", value: .number(String(requestID))),
            .init(key: "entries", value: .array(projected)), .init(key: "contentStore", value: .object(previewStore))])
    }
}

struct BranchGraph {
    struct Identity: Hashable { let chatIndex: Int; let nodeID: Data }
    struct Node {
        let id: String
        let chatIndex: Int
        var identity: Identity { Identity(chatIndex: chatIndex, nodeID: Data(id.utf8)) }
        let role: String
        let preview: String
        let label: String?
        let active: Bool
        let x: CGFloat
        let y: CGFloat
    }
    struct Edge {
        let chatIndex: Int
        let source: String
        let target: String
        let active: Bool
    }
    struct Header: Identifiable {
        let id: Int
        let title: String
        let x: CGFloat
        let y: CGFloat
    }
    func headers(in key: BranchLayoutKey) -> [Header] {
        guard key.entries.count > 1 else { return [] }
        return key.entries.compactMap { entry in
            let group = nodes.filter { $0.chatIndex == entry.chatIndex }
            guard !group.isEmpty else { return nil }
            return Header(id: entry.chatIndex, title: entry.title,
                x: group.reduce(0) { $0 + $1.x + 140 } / CGFloat(group.count), y: (group.map(\.y).min() ?? 0) + 20)
        }
    }
    let nodes: [Node]
    let edges: [Edge]
    let width: CGFloat
    let height: CGFloat
    var positionsByID: [Identity: CGPoint] {
        Dictionary(uniqueKeysWithValues: nodes.map { ($0.identity, CGPoint(x: $0.x + 140, y: $0.y + 40)) })
    }

    init(_ output: OrderedJSON, requestID: Int) throws {
        guard Int(try output.required("requestId").number("requestId")) == requestID else { throw ExchangeError.invalid("古い分岐配置") }
        nodes = try output.required("rfNodes").array("rfNodes").map { item in
            let data = try item.required("data"), position = try item.required("position")
            return try Node(id: data.required("nodeId").string("node id"), chatIndex: Int(data.required("chatIndex").number("chat index")), role: data.required("role").string("role"),
                preview: data.required("contentPreview").string("preview"), label: data["label"].flatMap { try? $0.string("label") },
                active: data.required("isActive").boolean("active"),
                x: CGFloat(position.required("x").number("x")), y: CGFloat(position.required("y").number("y")))
        }
        edges = try output.required("rfEdges").array("rfEdges").map { item in
            Edge(chatIndex: Int(try item.required("data").required("chatIndex").number("chat index")), source: try item.required("source").string("source"), target: try item.required("target").string("target"),
                active: (try? item.required("style").required("strokeWidth").number("strokeWidth")) == 2)
        }
        width = (nodes.map { $0.x }.max() ?? 0) + 300
        height = (nodes.map { $0.y }.max() ?? 0) + 100
    }
}

struct BranchEditorView: View {
    @ObservedObject var state: ChatState
    let configure: (String) -> Void
    let deleteBranch: (String) -> Void
    let clipboard: (String, BranchClipboardOperation) -> Void
    @State private var rendered: (key: BranchLayoutKey, graph: BranchGraph)?
    @State private var compareTarget: (key: BranchLayoutKey, nodeID: String)?
    @State private var comparison: BranchDiffRequest?
    @State private var error: String?
    @State private var scale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1

    var body: some View {
        let key = BranchLayoutKey(state: state)
        VStack(spacing: 0) {
            HStack {
                Menu("表示する会話", systemImage: "rectangle.3.group") {
                    Button("選択中の会話だけ") { state.multiViewChatIndices = [] }
                    Divider()
                    ForEach(Array(state.conversations.enumerated()), id: \.element.identity) { index, conversation in
                        Button {
                            guard state.conversations.indices.contains(index), state.conversations[index].identity == conversation.identity else { return }
                            if state.multiViewChatIndices.contains(index) { state.multiViewChatIndices.removeAll { $0 == index } }
                            else { state.multiViewChatIndices.append(index) }
                        } label: {
                            if state.multiViewChatIndices.contains(index) { Label(conversation.title, systemImage: "checkmark") }
                            else { Text(conversation.title) }
                        }
                    }
                }
                .disabled(state.generation != nil)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            Group {
                if let rendered, rendered.key == key {
                    let graph = rendered.graph
                    ScrollView([.horizontal, .vertical]) {
                        graphCanvas(graph, sourceKey: rendered.key)
                            .frame(width: max(300, graph.width), height: max(100, graph.height) + (key.entries.count > 1 ? 60 : 0))
                            .scaleEffect(scale * gestureScale, anchor: .topLeading)
                            .frame(width: graph.width * scale * gestureScale, height: (graph.height + (key.entries.count > 1 ? 60 : 0)) * scale * gestureScale, alignment: .topLeading)
                            .padding(16)
                    }
                    .gesture(MagnificationGesture().updating($gestureScale) { value, state, _ in state = value }
                        .onEnded { scale = min(2, max(0.5, scale * $0)) })
                    .accessibilityLabel("分岐図")
                    .overlay(alignment: .bottom) {
                        if let error { Text(error).foregroundStyle(.red).padding(8).background(.regularMaterial) }
                    }
                } else if let error {
                    ContentUnavailableView(error, systemImage: "point.3.connected.trianglepath.dotted")
                } else {
                    ProgressView("分岐を配置中")
                }
            }
        }
        .sheet(item: $comparison) { request in BranchDiffView(state: state, request: request) }
        .onChange(of: key) { _, _ in compareTarget = nil; comparison = nil }
        .task(id: key) {
            rendered = nil; error = nil
            if key.tree == nil || key.entries.contains(where: { $0.tree == nil }) {
                do {
                    if key.tree == nil, !key.entries.contains(where: { $0.chatID.utf8.elementsEqual(key.chatID.utf8) }) {
                        try state.ensureBranchTreeForEditor(chatID: key.chatID)
                    }
                    for entry in key.entries where entry.tree == nil { try state.ensureBranchTreeForEditor(chatID: entry.chatID) }
                }
                catch { self.error = "分岐を表示できません: \(error.localizedDescription)" }
                return
            }
            let requestID = Int(UInt32.random(in: 1...UInt32.max))
            do {
                let computed = try await Task.detached(priority: .userInitiated) {
                    let input = try key.input(requestID: requestID)
                    return try BranchGraph(SharedWebOperations.call("branchLayout", input), requestID: requestID)
                }.value
                guard !Task.isCancelled, key.isCurrent(in: state) else { return }
                rendered = (key, computed)
            } catch {
                guard !Task.isCancelled, key.isCurrent(in: state) else { return }
                self.error = "分岐を表示できません: \(error.localizedDescription)"
            }
        }
    }

    private func graphCanvas(_ graph: BranchGraph, sourceKey: BranchLayoutKey) -> some View {
        let headerOffset: CGFloat = sourceKey.entries.count > 1 ? 60 : 0
        return ZStack(alignment: .topLeading) {
            ForEach(graph.headers(in: sourceKey)) { header in
                Text(header.title).font(.headline).lineLimit(1).frame(width: 280, height: 40)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                    .position(x: header.x, y: header.y)
            }
            Canvas { context, _ in
                let positions = graph.positionsByID
                for edge in graph.edges {
                    guard let start = positions[BranchGraph.Identity(chatIndex: edge.chatIndex, nodeID: Data(edge.source.utf8))], let end = positions[BranchGraph.Identity(chatIndex: edge.chatIndex, nodeID: Data(edge.target.utf8))] else { continue }
                    var path = Path()
                    path.move(to: CGPoint(x: start.x, y: start.y + 40))
                    path.addLine(to: CGPoint(x: start.x, y: (start.y + end.y) / 2))
                    path.addLine(to: CGPoint(x: end.x, y: (start.y + end.y) / 2))
                    path.addLine(to: CGPoint(x: end.x, y: end.y - 40))
                    context.stroke(path, with: .color(edge.active ? .blue : .secondary), lineWidth: edge.active ? 2 : 1)
                }
            }
            .offset(y: headerOffset)
            ForEach(graph.nodes, id: \.identity) { node in
                if let nodeKey = sourceKey.context(chatIndex: node.chatIndex) {
                    let target = compareTarget?.key == nodeKey ? compareTarget?.nodeID : nil
                    let otherNode = target.flatMap { $0.utf8.elementsEqual(node.id.utf8) ? nil : $0 }
                    BranchNodeCard(node: node, canEdit: state.exchange != nil && state.generation == nil,
                        canDelete: !(node.role == "system" && nodeKey.isRoot(node.id)),
                        hasClipboard: state.hasBranchClipboard, select: {
                        do {
                            if try nodeKey.select(node.id, in: state), state.chatActiveView == .branchEditor {
                                try state.setChatActiveView(.chat)
                            }
                        }
                        catch { self.error = error.localizedDescription }
                    }, configure: { performMenu(node, key: nodeKey) { configure(node.id) } },
                       deleteBranch: { performMenu(node, key: nodeKey) { deleteBranch(node.id) } },
                       clipboard: { operation in performMenu(node, key: nodeKey) { clipboard(node.id, operation) } }, compareCurrent: {
                           if sourceKey.isCurrent(in: state) { comparison = BranchDiffRequest(key: nodeKey, mode: .current(nodeID: node.id)) }
                       }, setCompareTarget: {
                           if sourceKey.isCurrent(in: state) { compareTarget = (nodeKey, node.id) }
                       }, compareSelected: otherNode.map { first in
                           { if sourceKey.isCurrent(in: state), compareTarget?.key == nodeKey,
                                compareTarget?.nodeID.utf8.elementsEqual(first.utf8) == true {
                               comparison = BranchDiffRequest(key: nodeKey, mode: .nodes(first: first, second: node.id))
                               compareTarget = nil
                           } }
                       })
                    .position(x: node.x + 140, y: node.y + 40 + headerOffset)
                }
            }
        }
    }
    private func performMenu(_ node: BranchGraph.Node, key: BranchLayoutKey, action: () -> Void) {
        guard key.isCurrent(in: state), state.generation == nil else { return }
        do {
            if !state.selectedConversationID.utf8.elementsEqual(key.chatID.utf8) {
                try state.navigate(chatID: key.chatID, nodeID: node.id, source: .branchEditor)
            }
            action()
        } catch { self.error = error.localizedDescription }
    }
}

private struct BranchNodeCard: View {
    let node: BranchGraph.Node
    let canEdit: Bool
    let canDelete: Bool
    let hasClipboard: Bool
    let select: () -> Void
    let configure: () -> Void
    let deleteBranch: () -> Void
    let clipboard: (BranchClipboardOperation) -> Void
    let compareCurrent: () -> Void
    let setCompareTarget: () -> Void
    let compareSelected: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            Button(action: select) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(node.label ?? node.role.capitalized).font(.caption.bold()).lineLimit(1)
                        Spacer(minLength: 4)
                        if node.active { Image(systemName: "checkmark.circle.fill").accessibilityLabel("現在の経路") }
                    }
                    Text(node.preview.isEmpty ? "本文なし" : node.preview).font(.caption).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(10)
                .frame(width: 236, height: 80, alignment: .topLeading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(node.label ?? node.role)、\(node.preview)")
            Menu {
                Button("ラベル・スター・ピン留め", systemImage: "slider.horizontal.3", action: configure)
                    .disabled(!canEdit)
                Divider()
                Button("範囲をコピー", systemImage: "doc.on.doc") { clipboard(.copy) }.disabled(!canEdit)
                Button("範囲を切り取り", systemImage: "scissors") { clipboard(.cut) }.disabled(!canEdit)
                if hasClipboard { Button("範囲を貼り付け", systemImage: "doc.on.clipboard") { clipboard(.paste) }.disabled(!canEdit) }
                if canDelete {
                    Divider()
                    Button("枝全体を削除", systemImage: "trash", role: .destructive, action: deleteBranch).disabled(!canEdit)
                }
                Divider()
                Button("現在の枝と比較", systemImage: "square.split.2x1", action: compareCurrent)
                if let compareSelected {
                    Button("選択ノードと比較", systemImage: "square.on.square", action: compareSelected)
                } else {
                    Button("比較対象に指定", systemImage: "square.dashed", action: setCompareTarget)
                }
            } label: {
                Image(systemName: "ellipsis.circle").frame(width: 44, height: 80)
            }
            .accessibilityLabel("メッセージ操作")
        }
        .frame(width: 280, height: 80)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(node.active ? Color.blue : Color.secondary.opacity(0.5), lineWidth: node.active ? 2 : 1))
    }
}
