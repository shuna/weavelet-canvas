import SwiftUI

struct BranchLayoutKey: Equatable {
    let chatID: String
    let chatIndex: Int
    let title: String
    let tree: OrderedJSON?
    let contentStore: OrderedJSON?

    init(chatID: String, chatIndex: Int, title: String, tree: OrderedJSON?, contentStore: OrderedJSON?) {
        self.chatID = chatID; self.chatIndex = chatIndex; self.title = title
        self.tree = tree; self.contentStore = contentStore
    }

    init(state: ChatState) {
        let selectedID = state.selectedConversationID
        let chats = (try? state.exchange?.source.required("chats").array("chats")) ?? []
        let index = chats.firstIndex { $0["id"] == .string(selectedID) } ?? -1
        self.init(chatID: selectedID, chatIndex: index, title: state.conversation?.title ?? "",
            tree: chats.indices.contains(index) ? chats[index]["branchTree"] : nil,
            contentStore: state.exchange?.source["contentStore"])
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.chatID.utf8.elementsEqual(rhs.chatID.utf8) && lhs.chatIndex == rhs.chatIndex &&
        lhs.title.utf8.elementsEqual(rhs.title.utf8) && lhs.tree == rhs.tree && lhs.contentStore == rhs.contentStore
    }

    func input(requestID: Int) throws -> OrderedJSON {
        guard let tree, let contentStore, chatIndex >= 0 else { throw ExchangeError.invalid("分岐データがありません") }
        let nodes = try tree.required("nodes")
        var previewStore: [JSONField] = []
        var seen = Set<Data>()
        for field in try nodes.object("nodes") {
            let hash = try field.value.required("contentHash").string("contentHash")
            guard seen.insert(Data(hash.utf8)).inserted else { continue }
            let entry = try contentStore.required(hash)
            let preview = entry["delta"] == nil ? entry : entry.replacing("content", with: try SyncRecords.resolveProjectedContent(contentStore, hash: hash))
            previewStore.append(.init(key: hash, value: preview))
        }
        return .object([
            .init(key: "requestId", value: .number(String(requestID))),
            .init(key: "entries", value: .array([.object([
                .init(key: "chatIndex", value: .number(String(chatIndex))),
                .init(key: "chatId", value: .string(chatID)),
                .init(key: "chatTitle", value: .string(title)),
                .init(key: "nodes", value: nodes),
                .init(key: "activePath", value: try tree.required("activePath"))
            ])])),
            .init(key: "contentStore", value: .object(previewStore))
        ])
    }
}

struct BranchGraph {
    struct Node {
        let id: String
        var identity: Data { Data(id.utf8) }
        let role: String
        let preview: String
        let label: String?
        let active: Bool
        let x: CGFloat
        let y: CGFloat
    }
    struct Edge {
        let source: String
        let target: String
        let active: Bool
    }
    let nodes: [Node]
    let edges: [Edge]
    let width: CGFloat
    let height: CGFloat
    var positionsByID: [Data: CGPoint] {
        Dictionary(uniqueKeysWithValues: nodes.map { ($0.identity, CGPoint(x: $0.x + 140, y: $0.y + 40)) })
    }

    init(_ output: OrderedJSON, requestID: Int) throws {
        guard Int(try output.required("requestId").number("requestId")) == requestID else { throw ExchangeError.invalid("古い分岐配置") }
        nodes = try output.required("rfNodes").array("rfNodes").map { item in
            let data = try item.required("data"), position = try item.required("position")
            return try Node(id: item.required("id").string("node id"), role: data.required("role").string("role"),
                preview: data.required("contentPreview").string("preview"), label: data["label"].flatMap { try? $0.string("label") },
                active: data.required("isActive").boolean("active"),
                x: CGFloat(position.required("x").number("x")), y: CGFloat(position.required("y").number("y")))
        }
        edges = try output.required("rfEdges").array("rfEdges").map { item in
            Edge(source: try item.required("source").string("source"), target: try item.required("target").string("target"),
                active: (try? item.required("style").required("strokeWidth").number("strokeWidth")) == 2)
        }
        width = (nodes.map { $0.x }.max() ?? 0) + 300
        height = (nodes.map { $0.y }.max() ?? 0) + 100
    }
}

struct BranchEditorView: View {
    @ObservedObject var state: ChatState
    @State private var graph: BranchGraph?
    @State private var error: String?
    @State private var scale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1

    var body: some View {
        let key = BranchLayoutKey(state: state)
        Group {
            if let graph {
                ScrollView([.horizontal, .vertical]) {
                    graphCanvas(graph)
                        .frame(width: max(300, graph.width), height: max(100, graph.height))
                        .scaleEffect(scale * gestureScale, anchor: .topLeading)
                        .frame(width: graph.width * scale * gestureScale, height: graph.height * scale * gestureScale, alignment: .topLeading)
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
        .task(id: key) {
            graph = nil; error = nil
            if key.tree == nil {
                do { try state.ensureBranchTreeForEditor() }
                catch { self.error = "分岐を表示できません: \(error.localizedDescription)" }
                return
            }
            let requestID = Int(UInt32.random(in: 1...UInt32.max))
            do {
                let computed = try await Task.detached(priority: .userInitiated) {
                    let input = try key.input(requestID: requestID)
                    return try BranchGraph(SharedWebOperations.call("branchLayout", input), requestID: requestID)
                }.value
                guard !Task.isCancelled else { return }
                graph = computed
            } catch {
                guard !Task.isCancelled else { return }
                self.error = "分岐を表示できません: \(error.localizedDescription)"
            }
        }
    }

    private func graphCanvas(_ graph: BranchGraph) -> some View {
        ZStack(alignment: .topLeading) {
            Canvas { context, _ in
                let positions = graph.positionsByID
                for edge in graph.edges {
                    guard let start = positions[Data(edge.source.utf8)], let end = positions[Data(edge.target.utf8)] else { continue }
                    var path = Path()
                    path.move(to: CGPoint(x: start.x, y: start.y + 40))
                    path.addLine(to: CGPoint(x: start.x, y: (start.y + end.y) / 2))
                    path.addLine(to: CGPoint(x: end.x, y: (start.y + end.y) / 2))
                    path.addLine(to: CGPoint(x: end.x, y: end.y - 40))
                    context.stroke(path, with: .color(edge.active ? .blue : .secondary), lineWidth: edge.active ? 2 : 1)
                }
            }
            ForEach(graph.nodes, id: \.identity) { node in
                BranchNodeCard(node: node) {
                    do {
                        try state.navigate(chatID: state.selectedConversationID, nodeID: node.id, source: .branchEditor)
                        if state.chatActiveView == .branchEditor { try state.setChatActiveView(.chat) }
                    }
                    catch { self.error = error.localizedDescription }
                }
                .position(x: node.x + 140, y: node.y + 40)
            }
        }
    }
}

private struct BranchNodeCard: View {
    let node: BranchGraph.Node
    let select: () -> Void

    var body: some View {
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
            .frame(width: 280, height: 80, alignment: .topLeading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(node.active ? Color.blue : Color.secondary.opacity(0.5), lineWidth: node.active ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(node.label ?? node.role)、\(node.preview)")
    }
}
