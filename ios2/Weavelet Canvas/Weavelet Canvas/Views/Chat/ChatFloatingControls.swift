import SwiftUI

// MARK: - Back/Forward Navigation

struct ChatNavButtons: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            floatingButton("chevron.left", label: "Back", disabled: !viewModel.canGoBack) { viewModel.goBack() }
            Divider().frame(width: 20)
            floatingButton("chevron.right", label: "Forward", disabled: !viewModel.canGoForward) { viewModel.goForward() }
        }
        .glassEffect(.regular.interactive())
        .clipShape(Capsule())
    }

    private func floatingButton(_ icon: String, label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 36, height: 36)
                .foregroundStyle(disabled ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.primary))
        }
        .disabled(disabled)
        .accessibilityLabel(label)
    }
}

// MARK: - Left: Collapse Controls

struct CollapseControls: View {
    let onCollapseAll: () -> Void
    let onExpandAll: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            floatingButton("rectangle.compress.vertical", label: "Collapse All") { onCollapseAll() }
            Divider().frame(width: 20)
            floatingButton("rectangle.expand.vertical", label: "Expand All") { onExpandAll() }
        }
        .glassEffect(.regular.interactive())
        .clipShape(Capsule())
    }

    private func floatingButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 36, height: 36)
        }
        .accessibilityLabel(label)
    }
}

// MARK: - Right: Bubble Navigation

struct BubbleNavigationControls: View {
    let onScrollToTop: () -> Void
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onScrollToBottom: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            floatingButton("arrow.up.to.line", label: "Scroll to Top") { onScrollToTop() }
            Divider().frame(width: 20)
            floatingButton("chevron.up", label: "Previous") { onPrevious() }
            Divider().frame(width: 20)
            floatingButton("chevron.down", label: "Next") { onNext() }
            Divider().frame(width: 20)
            floatingButton("arrow.down.to.line", label: "Scroll to Bottom") { onScrollToBottom() }
        }
        .glassEffect(.regular.interactive())
        .clipShape(Capsule())
    }

    private func floatingButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 36, height: 36)
        }
        .accessibilityLabel(label)
    }
}
