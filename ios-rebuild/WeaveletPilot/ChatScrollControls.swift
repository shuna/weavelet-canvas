import SwiftUI
import UIKit

@MainActor final class ChatScrollOffset: ObservableObject {
    weak var scrollView: UIScrollView?
    @Published private(set) var attached = false
    var isInteracting: Bool { scrollView.map { $0.isTracking || $0.isDragging || $0.isDecelerating } ?? false }
    func attach(_ value: UIScrollView) {
        guard scrollView !== value else { return }
        scrollView = value
        DispatchQueue.main.async { [weak self, weak value] in
            guard let self, self.scrollView === value else { return }
            self.attached = true
        }
    }
    @discardableResult func move(by delta: CGFloat) -> CGFloat {
        guard let scrollView, !isInteracting else { return 0 }
        let previous = scrollView.contentOffset.y
        let minimum = -scrollView.adjustedContentInset.top
        let maximum = max(minimum, scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom)
        let y = min(max(scrollView.contentOffset.y + delta, minimum), maximum)
        if abs(y - scrollView.contentOffset.y) > 0.5 {
            scrollView.setContentOffset(CGPoint(x:scrollView.contentOffset.x,y:y),animated:false)
        }
        return scrollView.contentOffset.y - previous
    }
}

private struct ChatScrollOffsetProbe: UIViewRepresentable {
    let offset: ChatScrollOffset
    final class Probe: UIView {
        weak var offset: ChatScrollOffset?
        override func didMoveToWindow() { super.didMoveToWindow(); attach() }
        override func layoutSubviews() { super.layoutSubviews(); attach() }
        func attach() {
            var parent = superview
            while let view = parent {
                if let scroll = view as? UIScrollView { offset?.attach(scroll); return }
                parent = view.superview
            }
        }
    }
    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.offset = offset; view.isUserInteractionEnabled = false; view.accessibilityElementsHidden = true
        return view
    }
    func updateUIView(_ view: Probe, context: Context) { view.offset = offset }
}

private struct ChatScrollOffsetKey: EnvironmentKey {
    static let defaultValue: ChatScrollOffset? = nil
}
private extension EnvironmentValues {
    var chatScrollOffset: ChatScrollOffset? {
        get { self[ChatScrollOffsetKey.self] }
        set { self[ChatScrollOffsetKey.self] = newValue }
    }
}

enum ChatScrollMarker: Hashable {
    case message(Data), context(Data), content, composer
}

struct ChatScrollFrames: PreferenceKey {
    static var defaultValue: [ChatScrollMarker: CGRect] = [:]
    static func reduce(value: inout [ChatScrollMarker: CGRect], nextValue: () -> [ChatScrollMarker: CGRect]) {
        value.merge(nextValue()) { _, next in next }
    }
}

extension View {
    func chatScrollMarker(_ marker: ChatScrollMarker) -> some View {
        background(ChatScrollMeasurement(marker:marker))
    }
}
private struct ChatScrollMeasurement: View {
    let marker: ChatScrollMarker
    @Environment(\.chatScrollOffset) private var offset
    var body: some View {
        GeometryReader { geometry in
            Color.clear.preference(key: ChatScrollFrames.self, value: [marker: geometry.frame(in: .named("chat-scroll-viewport"))])
                .background {
                    if marker == .content, let offset { ChatScrollOffsetProbe(offset:offset) }
                }
        }
    }
}

struct ChatScrollTargets: Equatable {
    var previous = -1
    var next = -1

    static func resolve(ids: [Data], frames: [ChatScrollMarker: CGRect], height: CGFloat,
                        bridge: SharedWebOperations.Session) throws -> Self {
        guard let content = frames[.content], height > 0 else { return .init() }
        let items = ids.enumerated().compactMap { index, id -> OrderedJSON? in
            guard let frame = frames[.message(id)] else { return nil }
            return .object([.init(key: "index", value: .number(String(index))),
                            .init(key: "top", value: .number(String(Double(frame.minY))))])
        }
        let result = try bridge.call("bubbleScroll", .object([
            .init(key: "items", value: .array(items)),
            .init(key: "scrollTop", value: .number(String(Double(max(0, -content.minY))))),
            .init(key: "scrollHeight", value: .number(String(Double(content.height)))),
            .init(key: "clientHeight", value: .number(String(Double(height))))]))
        var targets = try Self(previous: Int(result.required("previous").number("previous bubble")),
                               next: Int(result.required("next").number("next bubble")))
        // LazyVStack can omit the row following a tall bubble; its ordered ID still permits scrollTo.
        if targets.next < 0, content.maxY > height + 0.5,
           let current = ids.indices.last(where: { frames[.message(ids[$0])].map { $0.minY <= 0.5 } == true }),
           ids.indices.contains(current + 1), frames[.message(ids[current + 1])] == nil {
            targets.next = current + 1
        }
        if targets.previous < 0, content.minY < -0.5,
           let current = ids.indices.first(where: { frames[.message(ids[$0])].map { abs($0.minY) <= 0.5 } == true }),
           current > 0, frames[.message(ids[current - 1])] == nil {
            targets.previous = current - 1
        }
        return targets
    }
}

struct ChatStreamFollowing {
    var following = true
    var scrollTop: CGFloat = 0

    mutating func measure(top: CGFloat, height: CGFloat, viewport: CGFloat, scrollEvent: Bool,
                          changedScroller: Bool, generating: Bool, editing: Bool,
                          bridge: SharedWebOperations.Session) throws -> Bool {
        let result = try bridge.call("bubbleScroll", .object([
            .init(key:"operation",value:.string("streamFollow")),
            .init(key:"following",value:.bool(following)),
            .init(key:"previousScrollTop",value:.number(String(Double(scrollTop)))),
            .init(key:"scrollTop",value:.number(String(Double(top)))),
            .init(key:"scrollHeight",value:.number(String(Double(height)))),
            .init(key:"clientHeight",value:.number(String(Double(viewport)))),
            .init(key:"scrollEvent",value:.bool(scrollEvent)),
            .init(key:"scrollerChanged",value:.bool(changedScroller)),
            .init(key:"generating",value:.bool(generating)),
            .init(key:"editing",value:.bool(editing)),
            // Message rows, including branch gestures, are disabled during native generation.
            .init(key:"branchSwiping",value:.bool(false))]))
        following = try result.required("following").boolean("stream following")
        scrollTop = top
        return try result.required("shouldScroll").boolean("stream scrolling")
    }
}

struct ChatScrollControls: ViewModifier {
    @ObservedObject var state: ChatState
    let scroll: ScrollViewProxy
    let ids: [Data]
    let viewportHeight: CGFloat
    let isEditing: Bool
    @Binding var minimumContentHeight: CGFloat?
    let reportError: (Error) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var frames: [ChatScrollMarker: CGRect] = [:]
    @State private var targets = ChatScrollTargets()
    @State private var bridge: SharedWebOperations.Session?
    @StateObject private var offset = ChatScrollOffset()
    @State private var stream = ChatStreamFollowing()
    @State private var streamChatID: Data?
    @State private var offPathTarget: String?

    private var atTop: Bool { (frames[.content]?.minY ?? 0) >= -0.5 }
    private var atBottom: Bool { (frames[.content]?.maxY ?? 0) <= viewportHeight + 0.5 }
    private var bottomInset: CGFloat {
        max(8, frames[.composer].map { viewportHeight - $0.minY + 8 } ?? 8)
    }
    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { reportError(error) }
    }
    private func updateTargets() {
        guard let chatID = state.conversation?.identity, frames[.context(chatID)] != nil else { targets = .init(); return }
        perform {
            if bridge == nil { bridge = try SharedWebOperations.Session() }
            targets = try ChatScrollTargets.resolve(ids: ids, frames: frames, height: viewportHeight, bridge: bridge!)
        }
    }
    private func updateGenerationTarget() {
        offPathTarget = nil
        perform { offPathTarget = try state.offPathGenerationTarget() }
    }
    private func captureAnchor() throws -> OrderedJSON? {
        guard let chatID = state.conversation?.identity, frames[.context(chatID)] != nil,
              let content = frames[.content], viewportHeight > 0 else { return nil }
        if bridge == nil { bridge = try SharedWebOperations.Session() }
        let items = ids.enumerated().compactMap { index, id -> OrderedJSON? in
            guard let frame = frames[.message(id)] else { return nil }
            return .object([.init(key:"index",value:.number(String(index))),
                            .init(key:"nodeId",value:.string(String(decoding:id,as:UTF8.self))),
                            .init(key:"top",value:.number(String(Double(frame.minY)))),
                            .init(key:"bottom",value:.number(String(Double(frame.maxY))))])
        }
        return try bridge!.call("bubbleScroll",.object([
            .init(key:"operation",value:.string("capture")),.init(key:"items",value:.array(items)),
            .init(key:"scrollTop",value:.number(String(Double(max(0,-content.minY))))),
            .init(key:"scrollHeight",value:.number(String(Double(content.height)))),
            .init(key:"clientHeight",value:.number(String(Double(viewportHeight))))]))
    }
    private func updateAnchor() {
        perform {
            if let anchor = try captureAnchor() { state.captureChatScroll(chatID:state.selectedConversationID,anchor:anchor) }
        }
    }
    private func followStream(scrollEvent: Bool = false) {
        guard let chatID = state.conversation?.identity, frames[.context(chatID)] != nil,
              let content = frames[.content], viewportHeight > 0 else { return }
        perform {
            if bridge == nil { bridge = try SharedWebOperations.Session() }
            let top = max(0, -content.minY)
            let changed = streamChatID != chatID
            if changed { minimumContentHeight = nil }
            let shouldScroll = try stream.measure(top:top,height:content.height,viewport:viewportHeight,
                scrollEvent:scrollEvent,changedScroller:changed,generating:state.generation?.running == true,
                editing:isEditing || offset.isInteracting || state.chatScrollRestoration != nil,bridge:bridge!)
            streamChatID = chatID
            if scrollEvent, minimumContentHeight != nil { minimumContentHeight = top + viewportHeight }
            if shouldScroll {
                stream.scrollTop = top + offset.move(by:content.maxY - viewportHeight)
            }
        }
    }
    private func restorePosition() {
        guard let request = state.chatScrollRestoration,
              request.chatID.utf8.elementsEqual(state.selectedConversationID.utf8) else { return }
        if isEditing || offset.isInteracting { state.completeChatScrollRestoration(id:request.id); return }
        guard frames[.context(Data(request.chatID.utf8))] != nil,
              let content = frames[.content], offset.attached else { return }
        perform {
            if bridge == nil { bridge = try SharedWebOperations.Session() }
            var input: [JSONField] = [.init(key:"operation",value:.string("restore")),.init(key:"anchor",value:request.anchor),
                .init(key:"scrollTop",value:.number(String(Double(max(0,-content.minY))))),
                .init(key:"scrollHeight",value:.number(String(Double(content.height)))),
                .init(key:"clientHeight",value:.number(String(Double(viewportHeight))))]
            let nodeID = try request.anchor["nodeId"]?.string("scroll node")
            let index = Int((try request.anchor["firstVisibleItemIndex"]?.number("scroll index")) ?? -1)
            let id = nodeID.map { Data($0.utf8) } ?? (ids.indices.contains(index) ? ids[index] : nil)
            if let id, let frame = frames[.message(id)] {
                input.append(.init(key:"itemTop",value:.number(String(Double(frame.minY)))))
            }
            let desired = try bridge!.call("bubbleScroll",.object(input))
            if desired != .null { offset.move(by:CGFloat(try desired.number("scroll position")) - max(0,-content.minY)) }
        }
    }
    private func move<ID: Hashable>(_ id: ID, anchor: UnitPoint, followsEnd: Bool = false) {
        stream.following = followsEnd
        if let request = state.chatScrollRestoration { state.completeChatScrollRestoration(id:request.id) }
        do {
            if let current = try captureAnchor() { try state.recordChatScrollNavigation(chatID:state.selectedConversationID,anchor:current) }
        } catch { reportError(error); return }
        if !reduceMotion && (try? state.displaySetting(.animateBubbleNavigation)) == .bool(true) {
            withAnimation { scroll.scrollTo(id, anchor: anchor) }
        } else { scroll.scrollTo(id, anchor: anchor) }
    }
    private func moveBubble(_ index: Int) {
        guard ids.indices.contains(index) else { return }
        move(ids[index], anchor: .top)
    }
    private func button(_ label: String, _ symbol: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 14))
                .frame(width: 44, height: 44)
                .background(Color(uiColor: .secondarySystemBackground).opacity(0.94), in: Circle())
                .overlay(Circle().strokeBorder(Color.primary.opacity(0.08)))
        }
        .buttonStyle(.plain).foregroundStyle(.secondary)
        .accessibilityLabel(label).help(label).disabled(disabled)
    }
    func body(content: Content) -> some View {
        content
            .environment(\.chatScrollOffset,offset)
            .coordinateSpace(name: "chat-scroll-viewport")
            .onPreferenceChange(ChatScrollFrames.self) { value in
                guard let chatID = state.conversation?.identity, value[.context(chatID)] != nil else { return }
                // Lazy layout can change the offset without a user scroll event.
                let scrollEvent = offset.isInteracting
                frames = value
                updateTargets()
                followStream(scrollEvent:scrollEvent)
                restorePosition()
                updateAnchor()
            }
            .onChange(of: viewportHeight) { _, _ in updateTargets(); restorePosition(); followStream() }
            .onChange(of: ids) { _, _ in minimumContentHeight = nil; updateTargets(); restorePosition(); updateGenerationTarget() }
            .onChange(of: state.conversation?.identity) { _, _ in minimumContentHeight = nil; updateGenerationTarget() }
            .onChange(of: state.generation?.id) { _, _ in updateGenerationTarget() }
            .task { updateGenerationTarget() }
            .onChange(of: offset.attached) { _, _ in restorePosition(); followStream() }
            .onChange(of: state.generation?.running == true) { wasRunning, running in
                updateGenerationTarget()
                if running { minimumContentHeight = nil; followStream() }
                else if wasRunning, streamChatID == state.conversation?.identity {
                    stream.following = false
                    minimumContentHeight = stream.scrollTop + viewportHeight
                }
            }
            .onChange(of: isEditing) { _, editing in
                if editing, let request = state.chatScrollRestoration { state.completeChatScrollRestoration(id:request.id) }
                if !editing { followStream() }
            }
            .task(id:state.chatScrollRestoration?.id) {
                guard let request = state.chatScrollRestoration,
                      request.chatID.utf8.elementsEqual(state.selectedConversationID.utf8) else { return }
                guard !isEditing, !offset.isInteracting else { state.completeChatScrollRestoration(id:request.id); return }
                if request.anchor["wasAtBottom"] == .bool(true) {
                    scroll.scrollTo("connected-composer",anchor:.bottom)
                } else if let nodeID = try? request.anchor["nodeId"]?.string("scroll node"), ids.contains(Data(nodeID.utf8)) {
                    scroll.scrollTo(Data(nodeID.utf8),anchor:.top)
                }
                restorePosition()
                do { try await Task.sleep(nanoseconds:1_200_000_000) } catch { return }
                if !offset.attached { reportError(ExchangeError.invalid("スクロール位置を復元できませんでした")) }
                state.completeChatScrollRestoration(id:request.id)
                updateAnchor()
            }
            .overlay(alignment: .bottom) {
                if state.exchange != nil, !ids.isEmpty, !isEditing, viewportHeight - bottomInset >= (offPathTarget == nil ? 188 : 236) {
                    HStack(alignment: .bottom) {
                        VStack(spacing: 4) {
                            if offPathTarget != nil {
                                button("表示経路外の生成を分岐図で表示", "point.3.connected.trianglepath.dotted", disabled:false) {
                                    perform { try state.showOffPathGeneration(compact:horizontalSizeClass == .compact) }
                                }.accessibilityValue("1件")
                            }
                            button("編集を元に戻す", "arrow.uturn.backward", disabled: !state.canUndoMessageEdit) { perform { try state.undoMessageEdit() } }
                            button("編集をやり直す", "arrow.uturn.forward", disabled: !state.canRedoMessageEdit) { perform { try state.redoMessageEdit() } }
                            button("すべての本文を折りたたむ", "rectangle.compress.vertical", disabled: state.generation != nil) { perform { try state.setAllMessagesCollapsed(true) } }
                            button("すべての本文を展開", "rectangle.expand.vertical", disabled: state.generation != nil) { perform { try state.setAllMessagesCollapsed(false) } }
                        }
                        Spacer(minLength: 8)
                        VStack(spacing: 4) {
                            button("最初へ", "arrow.up.to.line", disabled: atTop) { move("connected-top", anchor: .top) }
                            button("一つ前のバブルへ", "chevron.up", disabled: targets.previous < 0) { moveBubble(targets.previous) }
                            button("一つ次のバブルへ", "chevron.down", disabled: targets.next < 0) { moveBubble(targets.next) }
                            button("入力欄へ", "arrow.down.to.line", disabled: atBottom) { move("connected-composer", anchor: .bottom, followsEnd:true) }
                        }
                    }
                    .padding(.horizontal, 8).padding(.bottom, bottomInset)
                }
            }
    }
}
