import SwiftUI

/// "+" button shown between message bubbles, matching the web version.
/// Tapping inserts a new empty user message at the given position.
/// Long-press (or chevron) shows branch actions (Branch & Generate, Branch Only).
struct NewMessageButton: View {
    @Bindable var viewModel: ChatViewModel
    let messageIndex: Int
    let nodeId: String
    let role: MessageRole
    @State private var showBranchMenu = false

    private var canBranch: Bool { role == .user }

    var body: some View {
        HStack(spacing: 0) {
            Spacer()
            HStack(spacing: 0) {
                // Plus button — insert empty user message
                Button {
                    viewModel.insertMessageAfter(messageIndex: messageIndex)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .medium))
                        .frame(width: 32, height: 28)
                }
                .accessibilityLabel("Insert Message")

                // Branch chevron
                Rectangle()
                    .fill(Color.primary.opacity(0.2))
                    .frame(width: 1, height: 18)

                Button {
                    if canBranch {
                        showBranchMenu = true
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 24, height: 28)
                        .opacity(canBranch ? 1 : 0.35)
                }
                .disabled(!canBranch)
                .accessibilityLabel("Branch Actions")
                .popover(isPresented: $showBranchMenu, arrowEdge: .top) {
                    VStack(spacing: 0) {
                        Button {
                            showBranchMenu = false
                            viewModel.createBranch(parentNodeId: nodeId)
                            viewModel.sendMessage()
                        } label: {
                            Label("Branch & Generate", systemImage: "arrow.triangle.branch")
                                .font(.subheadline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        Divider()

                        Button {
                            showBranchMenu = false
                            viewModel.createBranch(parentNodeId: nodeId)
                        } label: {
                            Label("Branch Only", systemImage: "pencil")
                                .font(.subheadline)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(minWidth: 200)
                    .presentationCompactAdaptation(.popover)
                }
            }
            .foregroundStyle(.secondary)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(Color.primary.opacity(0.12), lineWidth: 0.5))
            Spacer()
        }
        .frame(height: 20)  // small layout height so footer bars don't overlap
    }
}
