import SwiftUI

enum ChatScrollMarker: Hashable {
    case message(Data), content, composer
}

struct ChatScrollFrames: PreferenceKey {
    static var defaultValue: [ChatScrollMarker: CGRect] = [:]
    static func reduce(value: inout [ChatScrollMarker: CGRect], nextValue: () -> [ChatScrollMarker: CGRect]) {
        value.merge(nextValue()) { _, next in next }
    }
}

extension View {
    func chatScrollMarker(_ marker: ChatScrollMarker) -> some View {
        background(GeometryReader { geometry in
            Color.clear.preference(key: ChatScrollFrames.self, value: [marker: geometry.frame(in: .named("chat-scroll-viewport"))])
        })
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

    private var atTop: Bool { (frames[.content]?.minY ?? 0) >= -0.5 }
    private var atBottom: Bool { (frames[.content]?.maxY ?? 0) <= viewportHeight + 0.5 }
    private var bottomInset: CGFloat {
        max(8, frames[.composer].map { viewportHeight - $0.minY + 8 } ?? 8)
    }
    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { reportError(error) }
    }
    private func updateTargets() {
        perform {
            if bridge == nil { bridge = try SharedWebOperations.Session() }
            targets = try ChatScrollTargets.resolve(ids: ids, frames: frames, height: viewportHeight, bridge: bridge!)
        }
    }
    private func move<ID: Hashable>(_ id: ID, anchor: UnitPoint) {
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
            .coordinateSpace(name: "chat-scroll-viewport")
            .onPreferenceChange(ChatScrollFrames.self) { value in
                frames = value
                updateTargets()
            }
            .onChange(of: viewportHeight) { _, _ in updateTargets() }
            .onChange(of: ids) { _, _ in updateTargets() }
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
