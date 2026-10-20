import SwiftUI
import UIKit

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
        let conversationColor: String
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
                conversationColor: data.required("conversationColor").string("conversation color"),
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

struct BranchViewportRequest {
    enum Action { case fit, zoomIn, zoomOut, focus(CGPoint) }
    let id = UUID()
    let action: Action
}

struct BranchMiniMapNode: Equatable {
    let frame: CGRect
    let active: Bool
    let conversationColor: String
}

final class BranchMiniMapView: UIView {
    private var onMoveViewport: (CGPoint) -> Void
    private var onScaleViewport: (CGFloat, CGPoint) -> Void
    private var canvasSize = CGSize.zero
    private var nodes: [BranchMiniMapNode] = []
    private(set) var displayedViewport = CGRect.zero

    init(moveViewport: @escaping (CGPoint) -> Void, scaleViewport: @escaping (CGFloat, CGPoint) -> Void) {
        onMoveViewport = moveViewport; onScaleViewport = scaleViewport
        super.init(frame:.zero)
        isOpaque = false
        backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.9)
        layer.cornerRadius = 8
        layer.borderWidth = 1
        layer.borderColor = UIColor.separator.cgColor
        isAccessibilityElement = true
        accessibilityTraits = .image
        accessibilityLabel = "分岐図の概要。タップまたはドラッグで表示位置を移動し、ピンチで拡大縮小します。"
        accessibilityHint = "直接の拡大、縮小、全体表示は左下の操作を使用できます。"
        addGestureRecognizer(UITapGestureRecognizer(target:self,action:#selector(tapped(_:))))
        let pan = UIPanGestureRecognizer(target:self,action:#selector(panned(_:)))
        pan.maximumNumberOfTouches = 1
        addGestureRecognizer(pan)
        addGestureRecognizer(UIPinchGestureRecognizer(target:self,action:#selector(pinched(_:))))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func setHandlers(moveViewport: @escaping (CGPoint) -> Void, scaleViewport: @escaping (CGFloat, CGPoint) -> Void) {
        onMoveViewport = moveViewport; onScaleViewport = scaleViewport
    }
    func update(canvasSize: CGSize, nodes: [BranchMiniMapNode], visibleRect: CGRect) {
        self.canvasSize = canvasSize; self.nodes = nodes; displayedViewport = visibleRect
        setNeedsDisplay()
    }
    func canvasPoint(at point: CGPoint) -> CGPoint? {
        guard let transform = transformForCanvas else { return nil }
        return CGPoint(x:(point.x - transform.origin.x) / transform.scale, y:(point.y - transform.origin.y) / transform.scale)
    }
    func moveViewport(to point: CGPoint) {
        guard let canvasPoint = canvasPoint(at:point) else { return }
        onMoveViewport(canvasPoint)
    }
    func scaleViewport(by scale: CGFloat, around point: CGPoint) {
        guard let canvasPoint = canvasPoint(at:point) else { return }
        onScaleViewport(scale,canvasPoint)
    }
    private var transformForCanvas: (origin: CGPoint, scale: CGFloat)? {
        guard canvasSize.width > 0, canvasSize.height > 0 else { return nil }
        let inset: CGFloat = 5
        let available = bounds.insetBy(dx:inset,dy:inset)
        guard available.width > 0, available.height > 0 else { return nil }
        let scale = min(available.width / canvasSize.width,available.height / canvasSize.height)
        return (CGPoint(x:available.midX - canvasSize.width * scale / 2,y:available.midY - canvasSize.height * scale / 2),scale)
    }
    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let transform = transformForCanvas else { return }
        context.saveGState()
        context.translateBy(x:transform.origin.x,y:transform.origin.y)
        context.scaleBy(x:transform.scale,y:transform.scale)
        for node in nodes {
            (node.active ? UIColor.branchMiniMapColor(node.conversationColor) : UIColor.systemGray).setFill()
            context.fill(node.frame)
        }
        UIColor.label.withAlphaComponent(0.7).setStroke()
        context.setLineWidth(1 / transform.scale)
        context.stroke(displayedViewport)
        context.restoreGState()
    }
    @objc private func tapped(_ recognizer: UITapGestureRecognizer) { moveViewport(to:recognizer.location(in:self)) }
    @objc private func panned(_ recognizer: UIPanGestureRecognizer) {
        guard recognizer.state == .began || recognizer.state == .changed else { return }
        moveViewport(to:recognizer.location(in:self))
    }
    @objc private func pinched(_ recognizer: UIPinchGestureRecognizer) {
        guard recognizer.state == .began || recognizer.state == .changed else { return }
        scaleViewport(by:recognizer.scale,around:recognizer.location(in:self))
        recognizer.scale = 1
    }
}

private extension UIColor {
    static func branchMiniMapColor(_ hex: String) -> UIColor {
        let value = hex.drop(while:{ $0 == "#" })
        guard value.count == 6, let number = UInt32(String(value),radix:16) else { return .systemBlue }
        return UIColor(red:CGFloat((number >> 16) & 0xff) / 255,green:CGFloat((number >> 8) & 0xff) / 255,blue:CGFloat(number & 0xff) / 255,alpha:1)
    }
}

struct BranchGraphViewport<Content: View>: UIViewControllerRepresentable {
    let content: Content
    let canvasSize: CGSize
    let miniMapNodes: [BranchMiniMapNode]
    let request: BranchViewportRequest?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeUIViewController(context: Context) -> BranchGraphViewportController<Content> {
        BranchGraphViewportController(content: content, miniMapNodes: miniMapNodes)
    }
    func updateUIViewController(_ controller: BranchGraphViewportController<Content>, context: Context) {
        controller.update(content: content, size: canvasSize, miniMapNodes: miniMapNodes, request: request, animated: !reduceMotion)
    }
}

final class BranchGraphViewportController<Content: View>: UIViewController, UIScrollViewDelegate {
    let scrollView = UIScrollView()
    private let hosting: UIHostingController<Content>
    private let miniMap: BranchMiniMapView
    private var miniMapNodes: [BranchMiniMapNode]
    private var canvasSize = CGSize.zero
    private var lastBounds = CGSize.zero
    private var lastRequest: UUID?
    private var pendingRequest: BranchViewportRequest?
    private var followsFit = true
    init(content: Content, miniMapNodes: [BranchMiniMapNode] = []) {
        hosting = UIHostingController(rootView: content)
        self.miniMapNodes = miniMapNodes
        miniMap = BranchMiniMapView(moveViewport:{ _ in },scaleViewport:{ _,_ in })
        super.init(nibName:nil,bundle:nil)
        miniMap.setHandlers(moveViewport:{ [weak self] point in
            self?.followsFit = false
            self?.centerOn(point,animated:false)
        },
                            scaleViewport:{ [weak self] scale, point in
            guard let self else { return }
            self.followsFit = false
            self.zoom(around:point,scale:self.scrollView.zoomScale * scale,animated:false)
        })
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func loadView() { view = UIView() }
    override func viewDidLoad() {
        super.viewDidLoad()
        scrollView.frame = view.bounds
        scrollView.autoresizingMask = [.flexibleWidth,.flexibleHeight]
        view.addSubview(scrollView)
        scrollView.delegate = self
        scrollView.backgroundColor = .secondarySystemBackground
        scrollView.minimumZoomScale = 0.1; scrollView.maximumZoomScale = 2
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.accessibilityLabel = "分岐図"
        addChild(hosting)
        hosting.view.backgroundColor = .clear
        scrollView.addSubview(hosting.view)
        hosting.didMove(toParent:self)
        view.addSubview(miniMap)
        updateMiniMapFrame()
    }
    func update(content: Content, size: CGSize, miniMapNodes: [BranchMiniMapNode] = [], request: BranchViewportRequest?, animated: Bool) {
        loadViewIfNeeded()
        view.layoutIfNeeded()
        hosting.rootView = content; self.miniMapNodes = miniMapNodes
        if size != canvasSize {
            let wasFollowingFit = followsFit
            let zoom = scrollView.zoomScale
            let center = CGPoint(x:(scrollView.contentOffset.x + scrollView.bounds.width / 2) / zoom,
                                 y:(scrollView.contentOffset.y + scrollView.bounds.height / 2) / zoom)
            scrollView.setZoomScale(1,animated:false)
            canvasSize = size
            hosting.view.frame = CGRect(origin:.zero,size:size)
            scrollView.contentSize = size
            scrollView.setZoomScale(zoom,animated:false)
            centerOn(center,animated:false)
            followsFit = wasFollowingFit
            if followsFit { fit(animated:false) }
        }
        if request == nil { pendingRequest = nil }
        if let request, request.id != lastRequest {
            if scrollView.bounds.width > 0 && scrollView.bounds.height > 0 { apply(request,animated:animated) }
            else { pendingRequest = request }
        }
        updateMiniMap()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scrollView.frame = view.bounds
        updateMiniMapFrame()
        guard scrollView.bounds.size != lastBounds else { return }
        lastBounds = scrollView.bounds.size
        if followsFit { fit(animated:false) } else { updateCanvasInsets() }
        if let pendingRequest { self.pendingRequest = nil; apply(pendingRequest,animated:false) }
        updateMiniMap()
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { hosting.view }
    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) { followsFit = false }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { updateCanvasInsets(); updateMiniMap() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { updateMiniMap() }
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { followsFit = false }
    private func updateMiniMap() {
        guard canvasSize.width > 0, canvasSize.height > 0, hosting.view.superview != nil else { return }
        miniMap.update(canvasSize:canvasSize,nodes:miniMapNodes,visibleRect:hosting.view.convert(scrollView.bounds,from:scrollView))
    }
    private func updateMiniMapFrame() {
        let size = CGSize(width:104,height:76), insets = view.safeAreaInsets
        let origin = CGPoint(x:max(10,view.bounds.maxX - insets.right - size.width - 10),
                             y:max(10,view.bounds.maxY - insets.bottom - size.height - 10))
        miniMap.frame = CGRect(origin:origin,size:size)
    }
    private func updateCanvasInsets() {
        // Keep edge nodes centerable, as on the Web graph's pannable canvas.
        scrollView.contentInset = UIEdgeInsets(top:scrollView.bounds.height/2,left:scrollView.bounds.width/2,
                                              bottom:scrollView.bounds.height/2,right:scrollView.bounds.width/2)
    }
    private func zoom(around point: CGPoint, scale: CGFloat, animated: Bool) {
        guard scrollView.bounds.width > 0, scrollView.bounds.height > 0 else { return }
        updateCanvasInsets()
        let scale = min(scrollView.maximumZoomScale,max(scrollView.minimumZoomScale,scale))
        let size = CGSize(width:scrollView.bounds.width/scale,height:scrollView.bounds.height/scale)
        scrollView.zoom(to:CGRect(x:point.x-size.width/2,y:point.y-size.height/2,width:size.width,height:size.height),animated:animated)
    }
    private func centerOn(_ point: CGPoint, animated: Bool) {
        updateCanvasInsets()
        let inset = scrollView.contentInset, bounds = scrollView.bounds, size = scrollView.contentSize
        let x = point.x * scrollView.zoomScale - bounds.width / 2
        let y = point.y * scrollView.zoomScale - bounds.height / 2
        scrollView.setContentOffset(CGPoint(x:min(max(x,-inset.left),max(-inset.left,size.width-bounds.width+inset.right)),
                                            y:min(max(y,-inset.top),max(-inset.top,size.height-bounds.height+inset.bottom))),animated:animated)
        updateMiniMap()
    }
    private func fit(animated: Bool) {
        guard canvasSize.width > 0, canvasSize.height > 0, scrollView.bounds.width > 0, scrollView.bounds.height > 0 else { return }
        let zoom = min(1,scrollView.bounds.width / (canvasSize.width * 1.4),scrollView.bounds.height / (canvasSize.height * 1.4))
        self.zoom(around:CGPoint(x:canvasSize.width/2,y:canvasSize.height/2),scale:zoom,animated:animated)
        followsFit = true
    }
    private func apply(_ request: BranchViewportRequest, animated: Bool) {
        lastRequest = request.id
        switch request.action {
        case .fit: fit(animated:animated)
        case .zoomIn, .zoomOut:
            followsFit = false
            let center = CGPoint(x:(scrollView.contentOffset.x+scrollView.bounds.width/2)/scrollView.zoomScale,
                                 y:(scrollView.contentOffset.y+scrollView.bounds.height/2)/scrollView.zoomScale)
            let multiplier: CGFloat = { if case .zoomIn = request.action { return 1.25 }; return 0.8 }()
            zoom(around:center,scale:scrollView.zoomScale*multiplier,animated:animated)
        case .focus(let point):
            followsFit = false
            zoom(around:point,scale:1.2,animated:animated)
        }
    }
}

struct BranchEditorView: View {
    @ObservedObject var state: ChatState
    @Binding var showsSearch: Bool
    let configure: (String) -> Void
    let deleteBranch: (String) -> Void
    let clipboard: (String, BranchClipboardOperation) -> Void
    @State private var rendered: (key: BranchLayoutKey, graph: BranchGraph)?
    @State private var compareTarget: (key: BranchLayoutKey, nodeID: String)?
    @State private var comparison: BranchDiffRequest?
    @State private var error: String?
    @State private var viewportRequest: BranchViewportRequest?
    @State private var selecting = false
    @State private var selectedNodes: Set<BranchGraph.Identity> = []
    @State private var selectionDraft: BranchClipboardDraft?

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
                .buttonStyle(.plain).font(.subheadline)
                .foregroundStyle(Color(uiColor:.label))
                .frame(minHeight:44)
                .disabled(state.generation != nil)
                Spacer(minLength:4)
                Button {
                    selecting.toggle()
                    if !selecting { selectedNodes.removeAll() }
                } label: {
                    Image(systemName:selecting ? "checkmark.circle.fill" : "checkmark.circle").frame(width:44,height:44)
                }
                .accessibilityLabel("範囲選択")
                .accessibilityValue(selecting ? "選択中、\(selectedNodes.count)件" : "オフ")
                .disabled(state.exchange == nil)
                if selecting {
                    Menu {
                        Button("選択範囲をコピー",systemImage:"doc.on.doc") { openSelectedRange(.copy) }
                        Button("選択範囲を切り取り",systemImage:"scissors") { openSelectedRange(.cut) }
                        if state.hasBranchClipboard {
                            Button("最後の選択ノードへ貼り付け",systemImage:"doc.on.clipboard") { openSelectedRange(.paste) }
                        }
                        Button("選択を解除",systemImage:"xmark") { selectedNodes.removeAll() }
                    } label: {
                        Text("\(selectedNodes.count)件").font(.caption).frame(minWidth:44,minHeight:44)
                    }
                    .accessibilityLabel("選択範囲の操作")
                    .disabled(selectedNodes.isEmpty)
                }
                Button { showsSearch.toggle() } label: { Image(systemName:"magnifyingglass").frame(width:44,height:44) }
                    .accessibilityLabel("表示中の分岐図を検索")
                    .disabled(state.generation != nil)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            CollapsibleSearchPanel(isPresented:showsSearch) {
                ChatSearchView(state:state,initialMode:.nodes,initialScope:.all,inline:true,close:{ showsSearch = false },
                               chatIDs:key.entries.map(\.chatID),dismissOnSelection:false,reportError:{ error = $0 }) { result, _ in
                    guard key.isCurrent(in:state) else { throw ExchangeError.invalid("表示する会話が変わりました。検索し直してください") }
                    try state.navigateBranchSearch(result)
                }
            }
            Group {
                if let rendered {
                    let graph = rendered.graph
                    let height = max(100,graph.height) + (rendered.key.entries.count > 1 ? 60 : 0)
                    BranchGraphViewport(content:graphCanvas(graph,sourceKey:rendered.key)
                        .disabled(rendered.key != key)
                        .frame(width:max(300,graph.width),height:height),
                        canvasSize:CGSize(width:max(300,graph.width),height:height),
                        miniMapNodes:graph.nodes.map { .init(frame:CGRect(x:$0.x,y:$0.y + (rendered.key.entries.count > 1 ? 60 : 0),width:280,height:80),active:$0.active,conversationColor:$0.conversationColor) },
                        request:viewportRequest)
                        .id(rendered.key.entries.map { Data("\($0.chatIndex):\($0.chatID)".utf8) })
                    .overlay(alignment:.bottomLeading) {
                        HStack(spacing:0) {
                            viewportButton("縮小",icon:"minus",action:.zoomOut)
                            viewportButton("拡大",icon:"plus",action:.zoomIn)
                            viewportButton("全体表示",icon:"arrow.up.left.and.arrow.down.right",action:.fit)
                            if let nodeID = state.conversation?.visibleMessages.last?.id,
                               let point = graph.positionsByID[.init(chatIndex:key.chatIndex,nodeID:Data(nodeID.utf8))] {
                                viewportButton("現在のノードへ",icon:"scope",action:.focus(CGPoint(x:point.x,y:point.y + (key.entries.count > 1 ? 60 : 0))))
                            }
                        }.buttonStyle(.plain)
                            .background(Color(uiColor:.secondarySystemBackground),in:RoundedRectangle(cornerRadius:8))
                            .padding(12)
                    }
                    .disabled(rendered.key != key)
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
        .sheet(item:$selectionDraft) { draft in BranchClipboardView(state:state,draft:draft) }
        .onChange(of: key) { _, _ in
            selectedNodes.removeAll()
            compareTarget = nil; comparison = nil; viewportRequest = nil
            if let request = state.branchEditorFocus,
               !key.entries.contains(where:{ $0.chatID.utf8.elementsEqual(request.chatID.utf8) }) {
                state.consumeBranchEditorFocus(request.token)
            }
        }
        .onChange(of:state.branchEditorFocus) { _, _ in
            if let rendered { focusRequestedNode(in:rendered.graph,key:rendered.key) }
        }
        .task(id: key) {
            error = nil
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
                focusRequestedNode(in:computed,key:key)
            } catch {
                guard !Task.isCancelled, key.isCurrent(in: state) else { return }
                self.error = "分岐を表示できません: \(error.localizedDescription)"
            }
        }
    }

    private func focusRequestedNode(in graph: BranchGraph, key: BranchLayoutKey) {
        guard key.isCurrent(in:state), let request = state.branchEditorFocus else { return }
        guard let entry = key.entries.first(where:{ $0.chatID.utf8.elementsEqual(request.chatID.utf8) }),
              let point = graph.positionsByID[.init(chatIndex:entry.chatIndex,nodeID:Data(request.nodeID.utf8))] else {
            state.consumeBranchEditorFocus(request.token)
            return
        }
        viewportRequest = BranchViewportRequest(action:.focus(CGPoint(x:point.x,y:point.y + (key.entries.count > 1 ? 60 : 0))))
        state.consumeBranchEditorFocus(request.token)
    }

    private func viewportButton(_ label: String, icon: String, action: BranchViewportRequest.Action) -> some View {
        Button { viewportRequest = BranchViewportRequest(action:action) } label: {
            Image(systemName:icon).frame(width:44,height:44)
        }.accessibilityLabel(label)
    }

    private func graphCanvas(_ graph: BranchGraph, sourceKey: BranchLayoutKey) -> some View {
        let headerOffset: CGFloat = sourceKey.entries.count > 1 ? 60 : 0
        let livePreviews = branchPreviews(in:graph, sourceKey:sourceKey)
        return ZStack(alignment: .topLeading) {
            ForEach(graph.headers(in: sourceKey)) { header in
                Text(header.title).font(.subheadline.weight(.semibold)).lineLimit(1).frame(width: 280, height: 40)
                    .background(Color(uiColor:.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
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
                    BranchNodeCard(node: node, preview: livePreviews[node.identity] ?? node.preview,
                        selecting:selecting,selected:selectedNodes.contains(node.identity),
                        canEdit: state.exchange != nil && state.generation(for: nodeKey.chatID) == nil,
                        canDelete: !(node.role == "system" && nodeKey.isRoot(node.id)),
                        hasClipboard: state.hasBranchClipboard, select: {
                        if selecting {
                            guard sourceKey.isCurrent(in:state) else { return }
                            if selectedNodes.contains(node.identity) { selectedNodes.remove(node.identity) }
                            else { selectedNodes.insert(node.identity) }
                            return
                        }
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
    private func branchPreviews(in graph: BranchGraph, sourceKey: BranchLayoutKey) -> [BranchGraph.Identity:String] {
        guard sourceKey.isCurrent(in:state) else { return [:] }
        var previews: [BranchGraph.Identity:String] = [:]
        for entry in sourceKey.entries {
            guard let generation = state.generation(for: entry.chatID),
                  case .string(let nodeID) = generation.plan?["targetNodeId"],
                  let current = state.generation(for: entry.chatID,nodeID:nodeID),
                  graph.positionsByID[.init(chatIndex:entry.chatIndex,nodeID:Data(nodeID.utf8))] != nil,
                  let preview = state.branchPreview(for:current) else { continue }
            previews[.init(chatIndex:entry.chatIndex,nodeID:Data(nodeID.utf8))] = preview
        }
        return previews
    }
    private func openSelectedRange(_ operation: BranchClipboardOperation) {
        guard let rendered, rendered.key.isCurrent(in:state) else { return }
        let selection = rendered.graph.nodes.filter { selectedNodes.contains($0.identity) }.compactMap { node -> (chatID:String,nodeID:String)? in
            guard let context = rendered.key.context(chatIndex:node.chatIndex) else { return nil }
            return (context.chatID,node.id)
        }
        guard selection.count == selectedNodes.count else { return }
        do { selectionDraft = try state.branchClipboardDraft(selectedNodes:selection,operation:operation) }
        catch { self.error = error.localizedDescription }
    }
    private func performMenu(_ node: BranchGraph.Node, key: BranchLayoutKey, action: () -> Void) {
        guard key.isCurrent(in: state), state.generation(for: key.chatID) == nil else { return }
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
    let preview: String
    let selecting: Bool
    let selected: Bool
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
                        if selecting { Image(systemName:selected ? "checkmark.circle.fill" : "circle").foregroundStyle(selected ? Color.accentColor : .secondary) }
                        Text(node.label ?? node.role.capitalized).font(.caption.bold()).lineLimit(1)
                        Spacer(minLength: 4)
                        if node.active { Image(systemName: "checkmark.circle.fill").accessibilityLabel("現在の経路") }
                    }
                    Text(preview.isEmpty ? "本文なし" : preview).font(.caption).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(10)
                .frame(width: 236, height: 80, alignment: .topLeading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(node.label ?? node.role)、\(preview)")
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityHint(selecting ? "タップして範囲の選択を切り替えます" : "")
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
        .background(selected ? Color.accentColor.opacity(0.14) : Color(uiColor:.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(node.active ? Color.blue : Color.secondary.opacity(0.5), lineWidth: node.active ? 2 : 1))
    }
}
