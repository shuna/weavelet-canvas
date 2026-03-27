import SwiftUI

// MARK: - Branch Node

struct BranchNode: Identifiable, Equatable {
    let id: UUID
    var role: MessageRole
    var content: String
    var label: String?
    var parentID: UUID?
    var isActive: Bool = false
    var isStarred: Bool = false
    var isPinned: Bool = false
    var position: CGPoint = .zero  // layout position

    var contentPreview: String {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= 80 { return trimmed }
        return String(trimmed.prefix(80)) + "…"
    }
}

// MARK: - Branch Edge

struct BranchEdge: Identifiable, Equatable {
    let id: String
    let sourceID: UUID
    let targetID: UUID
    var isActive: Bool = false
}

// MARK: - Interaction Mode

enum BranchInteractionMode: String, CaseIterable {
    case pan
    case select

    var icon: String {
        switch self {
        case .pan: "hand.draw"
        case .select: "rectangle.dashed"
        }
    }

    var label: String {
        switch self {
        case .pan: "Pan"
        case .select: "Select"
        }
    }
}

// MARK: - Branch Editor View Model

@Observable
class BranchEditorViewModel {
    var nodes: [BranchNode] = BranchEditorViewModel.sampleNodes
    var edges: [BranchEdge] = []
    var selectedNodeIDs: Set<UUID> = []
    var interactionMode: BranchInteractionMode = .pan
    var zoom: CGFloat = 1.0
    var offset: CGSize = .zero
    var isSearching: Bool = false
    var searchQuery: String = ""
    var searchCurrentMatch: Int = 0
    var searchTotalMatches: Int = 0

    // Undo/Redo
    var canUndo: Bool = false
    var canRedo: Bool = false

    // Detail modal
    var detailNode: BranchNode? = nil

    static let nodeWidth: CGFloat = 280
    static let nodeHeight: CGFloat = 90
    static let nodeSpacingX: CGFloat = 80
    static let nodeSpacingY: CGFloat = 100
    static let minZoom: CGFloat = 0.2
    static let maxZoom: CGFloat = 3.0

    init() {
        buildEdges()
        layoutNodes()
    }

    func buildEdges() {
        edges = nodes.compactMap { node in
            guard let parentID = node.parentID else { return nil }
            return BranchEdge(
                id: "\(parentID)-\(node.id)",
                sourceID: parentID,
                targetID: node.id,
                isActive: node.isActive && (nodes.first { $0.id == parentID }?.isActive ?? false)
            )
        }
    }

    func layoutNodes() {
        guard !nodes.isEmpty else { return }

        var childrenMap: [UUID: [UUID]] = [:]
        for node in nodes {
            if let pid = node.parentID {
                childrenMap[pid, default: []].append(node.id)
            }
        }

        let nodeUnit = Self.nodeWidth + Self.nodeSpacingX
        let rowHeight: CGFloat = Self.nodeHeight + Self.nodeSpacingY

        // Compute subtree width (in node units) for each node
        var subtreeWidth: [UUID: CGFloat] = [:]
        func computeWidth(_ id: UUID) -> CGFloat {
            let children = childrenMap[id] ?? []
            if children.isEmpty {
                subtreeWidth[id] = 1
                return 1
            }
            let total = children.reduce(CGFloat(0)) { $0 + computeWidth($1) }
            subtreeWidth[id] = total
            return total
        }

        let roots = nodes.filter { $0.parentID == nil }
        for root in roots { _ = computeWidth(root.id) }

        // Assign positions: each node centered over its subtree
        func assignPositions(_ id: UUID, depth: Int, leftX: CGFloat) {
            let w = subtreeWidth[id] ?? 1
            let centerX = leftX + (w * nodeUnit - Self.nodeSpacingX) / 2 - Self.nodeWidth / 2

            if let i = nodes.firstIndex(where: { $0.id == id }) {
                nodes[i].position = CGPoint(x: centerX, y: CGFloat(depth) * rowHeight)
            }

            var childLeft = leftX
            for child in (childrenMap[id] ?? []) {
                assignPositions(child, depth: depth + 1, leftX: childLeft)
                childLeft += (subtreeWidth[child] ?? 1) * nodeUnit
            }
        }

        var rootLeft: CGFloat = 0
        for root in roots {
            assignPositions(root.id, depth: 0, leftX: rootLeft)
            rootLeft += (subtreeWidth[root.id] ?? 1) * nodeUnit
        }
    }

    func selectNode(_ id: UUID) {
        selectedNodeIDs = [id]
    }

    func toggleStarred(_ id: UUID) {
        if let i = nodes.firstIndex(where: { $0.id == id }) {
            nodes[i].isStarred.toggle()
        }
    }

    func togglePinned(_ id: UUID) {
        if let i = nodes.firstIndex(where: { $0.id == id }) {
            nodes[i].isPinned.toggle()
        }
    }

    func deleteNode(_ id: UUID) {
        nodes.removeAll { $0.id == id }
        edges.removeAll { $0.sourceID == id || $0.targetID == id }
        selectedNodeIDs.remove(id)
    }

    func fitToView(canvasSize: CGSize) {
        guard !nodes.isEmpty else { return }
        let minX = nodes.map(\.position.x).min()!
        let maxX = nodes.map(\.position.x).max()! + Self.nodeWidth
        let minY = nodes.map(\.position.y).min()!
        let maxY = nodes.map(\.position.y).max()! + Self.nodeHeight

        let graphW = maxX - minX + 80
        let graphH = maxY - minY + 80

        let scaleX = canvasSize.width / graphW
        let scaleY = canvasSize.height / graphH
        zoom = min(min(scaleX, scaleY), 1.5)

        let centerX = (minX + maxX) / 2
        let centerY = (minY + maxY) / 2
        offset = CGSize(
            width: canvasSize.width / 2 - centerX * zoom,
            height: canvasSize.height / 2 - centerY * zoom
        )
    }

    func zoomIn() { zoom = min(zoom * 1.25, Self.maxZoom) }
    func zoomOut() { zoom = max(zoom / 1.25, Self.minZoom) }

    func searchNext() {
        guard searchTotalMatches > 0 else { return }
        searchCurrentMatch = (searchCurrentMatch % searchTotalMatches) + 1
    }

    func searchPrevious() {
        guard searchTotalMatches > 0 else { return }
        searchCurrentMatch = searchCurrentMatch <= 1 ? searchTotalMatches : searchCurrentMatch - 1
    }

    // MARK: - Sample Data

    static var sampleNodes: [BranchNode] {
        let root = UUID()
        let a1 = UUID()
        let a2 = UUID()
        let u2 = UUID()
        let a3 = UUID()
        let u3 = UUID()
        let a4 = UUID()

        return [
            BranchNode(id: root, role: .user, content: "SwiftUIで3カラムレイアウトを作るには？", parentID: nil, isActive: true),
            BranchNode(id: a1, role: .assistant, content: "NavigationSplitViewを使用するのが標準的なアプローチです。3つのカラムをsidebar, content, detailとして定義できます。", parentID: root, isActive: true),
            BranchNode(id: u2, role: .user, content: "インスペクターペインの表示切替は？", parentID: a1, isActive: true),
            BranchNode(id: a2, role: .assistant, content: ".inspectorモディファイアを使用します。iOS 17以降で利用可能です。", parentID: u2, isActive: true),
            BranchNode(id: u3, role: .user, content: "カスタムの3ペインを作りたい", label: "Alternative", parentID: a1, isActive: false),
            BranchNode(id: a3, role: .assistant, content: "GeometryReaderとHStackを組み合わせて独自に実装できます。", parentID: u3, isActive: false),
            BranchNode(id: a4, role: .assistant, content: "もう一つの方法として、UIKitのUISplitViewControllerをSwiftUIから利用する手法もあります。", parentID: u2, isActive: false, isStarred: true),
        ]
    }
}
