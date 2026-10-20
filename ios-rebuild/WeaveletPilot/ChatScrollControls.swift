import SwiftUI
import UIKit

@MainActor final class ChatScrollOffset: ObservableObject {
    weak var scrollView: UIScrollView?
    @Published private(set) var attached = false
    var isInteracting: Bool { scrollView.map { $0.isDragging || $0.isDecelerating } ?? false }
    func attach(_ value: UIScrollView) {
        guard scrollView !== value else { return }
        scrollView = value
        DispatchQueue.main.async { [weak self, weak value] in
            guard let self, self.scrollView === value else { return }
            self.attached = true
        }
    }
    func move(by delta: CGFloat) {
        guard let scrollView, !isInteracting else { return }
        let minimum = -scrollView.adjustedContentInset.top
        let maximum = max(minimum, scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom)
        let y = min(max(scrollView.contentOffset.y + delta, minimum), maximum)
        if abs(y - scrollView.contentOffset.y) > 0.5 {
            scrollView.setContentOffset(CGPoint(x:scrollView.contentOffset.x,y:y),animated:false)
        }
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

struct ChatScrollControls: ViewModifier {
    @ObservedObject var state: ChatState
    let scroll: ScrollViewProxy
    let ids: [Data]
    let viewportHeight: CGFloat
    let isEditing: Bool
    let reportError: (Error) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var frames: [ChatScrollMarker: CGRect] = [:]
    @State private var targets = ChatScrollTargets()
    @State private var bridge: SharedWebOperations.Session?
    @StateObject private var offset = ChatScrollOffset()

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
    private func move<ID: Hashable>(_ id: ID, anchor: UnitPoint) {
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
                frames = value
                updateTargets()
                restorePosition()
                updateAnchor()
            }
            .onChange(of: viewportHeight) { _, _ in updateTargets(); restorePosition() }
            .onChange(of: ids) { _, _ in updateTargets(); restorePosition() }
            .onChange(of: offset.attached) { _, _ in restorePosition() }
            .onChange(of: isEditing) { _, editing in
                if editing, let request = state.chatScrollRestoration { state.completeChatScrollRestoration(id:request.id) }
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
                if state.exchange != nil, !ids.isEmpty, !isEditing, viewportHeight - bottomInset >= 188 {
                    HStack(alignment: .bottom) {
                        VStack(spacing: 4) {
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
                            button("入力欄へ", "arrow.down.to.line", disabled: atBottom) { move("connected-composer", anchor: .bottom) }
                        }
                    }
                    .padding(.horizontal, 8).padding(.bottom, bottomInset)
                }
            }
    }
}
