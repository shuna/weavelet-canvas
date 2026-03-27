//
//  ContentView.swift
//  Weavelet Canvas
//
//  Created by suzuki on 2026/03/26.
//

import SwiftUI

struct ContentView: View {
    @State private var threeColumnState: ThreeColumnState = {
        let s = ThreeColumnState()
        s.showsDefaultInspectorButton = false
        return s
    }()
    @State private var sidebarState = SidebarState()
    @State private var chatViewModel = ChatViewModel()

    var body: some View {
        ThreePaneView(
            state: threeColumnState,
            Sidebar: {
                SidebarView(state: sidebarState)
            },
            Detail: {
                ChatDetailView(viewModel: chatViewModel)
            },
            sidebarToolbarCenter: { _, _ in
                EmptyView()
            },
            sidebarToolbarTrailing: { [sidebarState] _, _ in
                SidebarToolbarTrailing(state: sidebarState)
            },
            detailToolbarLeading: { [chatViewModel] _, _ in
                DetailToolbarLeading(viewModel: chatViewModel)
            },
            detailToolbarCenter: { [chatViewModel] _, _ in
                DetailCenterToolbar(viewModel: chatViewModel)
            },
            detailToolbarTrailing: { [chatViewModel, threeColumnState] _, _ in
                DetailToolbarTrailing(viewModel: chatViewModel, threeColumnState: threeColumnState)
            },
            detailToolbarBottomLeading: { _, _ in
                EmptyView()
            },
            detailToolbarBottomTrailing: { _, _ in
                EmptyView()
            },
            detailToolbarBottomStatus: { _, _ in
                EmptyView()
            },
            inspectorToolbarCenter: { [chatViewModel] _, _ in
                InspectorCenterToolbar(viewModel: chatViewModel)
            },
            inspectorToolbarTrailing: { [chatViewModel, threeColumnState] _, _ in
                InspectorToolbarTrailing(viewModel: chatViewModel, threeColumnState: threeColumnState)
            },
            inspectorContent: { [chatViewModel] in
                InspectorContentView(viewModel: chatViewModel)
            }
        )
        .threeColumnNavigationTitles(
            ThreeColumnNavigationTitles(
                sidebar: "Chats",
                detail: "Weavelet Canvas",
                inspector: ""
            )
        )
    }
}

private struct SidebarToolbarTrailing: View {
    @Bindable var state: SidebarState

    var body: some View {
        HStack(spacing: 12) {
            if state.isEditing {
                // Edit mode: move to folder + delete + done
                Button {
                    // batch move to folder
                } label: {
                    Image(systemName: "folder")
                }
                .disabled(state.selectedChatIDs.isEmpty)
                .accessibilityLabel("Move to Folder")

                Button(role: .destructive) {
                    // batch delete selected
                    state.selectedChatIDs.removeAll()
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(state.selectedChatIDs.isEmpty)
                .accessibilityLabel("Delete Selected")

                Button("Done") {
                    state.toggleEditMode()
                }
                .fontWeight(.semibold)
            } else {
                // Normal mode: show folder + new chat + edit
                Button {
                    // new folder
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
                .accessibilityLabel("New Folder")

                Button {
                    // new chat
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("New Chat")

                Button("Edit") {
                    state.toggleEditMode()
                }
            }
        }
    }
}

// MARK: - Model Selector (with capability icons)

// MARK: - Capability Icons

private struct CapabilityIcons: View {
    let reasoning: Bool
    let vision: Bool
    let audio: Bool
    var size: CGFloat = 11

    var body: some View {
        HStack(spacing: 3) {
            capabilityIcon("brain", enabled: reasoning)
            capabilityIcon("photo", enabled: vision)
            capabilityIcon("mic", enabled: audio)
        }
        .font(.system(size: size))
    }

    private func capabilityIcon(_ name: String, enabled: Bool) -> some View {
        Image(systemName: name)
            .foregroundStyle(enabled ? .primary : .quaternary)
            .overlay {
                if !enabled {
                    // Diagonal strikethrough line
                    GeometryReader { geo in
                        Path { path in
                            path.move(to: CGPoint(x: geo.size.width * 0.85, y: geo.size.height * 0.1))
                            path.addLine(to: CGPoint(x: geo.size.width * 0.15, y: geo.size.height * 0.9))
                        }
                        .stroke(.quaternary, lineWidth: 1.2)
                    }
                }
            }
    }
}

private struct ModelSelectorButton: View {
    @Bindable var viewModel: ChatViewModel
    @State private var showPicker = false

    var body: some View {
        Button {
            showPicker.toggle()
        } label: {
            HStack(spacing: 5) {
                Text(viewModel.selectedModel?.name ?? "Model")
                    .font(.subheadline.weight(.medium))
                if let model = viewModel.selectedModel {
                    CapabilityIcons(
                        reasoning: model.supportsReasoning,
                        vision: model.supportsVision,
                        audio: model.supportsAudio,
                        size: 10
                    )
                }
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.primary)
        }
        .popover(isPresented: $showPicker, arrowEdge: .top) {
            ModelPickerList(viewModel: viewModel, showPicker: $showPicker)
        }
    }
}

private struct ModelPickerList: View {
    var viewModel: ChatViewModel
    @Binding var showPicker: Bool

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(viewModel.availableModels.enumerated()), id: \.element.id) { _, model in
                ModelPickerRow(
                    model: model,
                    isSelected: viewModel.selectedModelID == model.id,
                    onSelect: {
                        viewModel.selectedModelID = model.id
                        showPicker = false
                    }
                )

                if model.id != viewModel.availableModels.last?.id {
                    Divider().padding(.leading, 42)
                }
            }

            Divider()

            Button {
                showPicker = false
            } label: {
                HStack {
                    Image(systemName: "square.grid.2x2")
                        .frame(width: 16)
                    Text("Browse All Models")
                    Spacer()
                }
                .font(.subheadline)
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
        .frame(minWidth: 320)
    }
}

private struct ModelPickerRow: View {
    let model: AIModel
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(isSelected ? Color.primary : Color.clear)
                    .frame(width: 16)

                Text(model.name)
                    .foregroundStyle(.primary)

                Spacer()

                Text(model.provider)
                    .foregroundStyle(.secondary)

                CapabilityIcons(
                    reasoning: model.supportsReasoning,
                    vision: model.supportsVision,
                    audio: model.supportsAudio,
                    size: 13
                )
            }
            .font(.subheadline)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Detail Toolbar Leading (back/forward + streaming indicator)

private struct DetailToolbarLeading: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        HStack(spacing: 8) {
            // Back / Forward
            Button {
                // go back
            } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(!viewModel.canGoBack)
            .accessibilityLabel("Back")

            Button {
                // go forward
            } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(!viewModel.canGoForward)
            .accessibilityLabel("Forward")

            // Streaming indicator
            if viewModel.isGenerating {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }
}

// MARK: - Detail Center Toolbar

private struct DetailCenterToolbar: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        switch viewModel.viewMode {
        case .chat:
            ModelSelectorButton(viewModel: viewModel)
        case .branchEditor:
            Text("Branch Editor")
                .font(.headline)
        }
    }
}

// MARK: - Detail Toolbar Trailing (search + unified view/inspector menu)

private struct DetailToolbarTrailing: View {
    @Bindable var viewModel: ChatViewModel
    @Bindable var threeColumnState: ThreeColumnState

    var body: some View {
        HStack(spacing: 8) {
            // Model settings (chat view only)
            if viewModel.viewMode == .chat {
                Button {
                    // TODO: open model settings
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Model Settings")
            }

            // Search (always)
            Button {
                viewModel.isSearching.toggle()
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel("Search")

            // Inspector toggle
            if !threeColumnState.inspectorPresented {
                Button {
                    withAnimation(.spring(duration: 0.3, bounce: 0.0)) {
                        threeColumnState.inspectorPresented = true
                    }
                } label: {
                    Image(systemName: "sidebar.trailing")
                        .font(.body)
                }
                .accessibilityLabel("Show \(viewModel.viewMode.opposite.label)")
            }
        }
    }
}

// MARK: - Inspector Center Toolbar

// MARK: - Inspector Toolbar Trailing (hide + swap menu)

private struct InspectorToolbarTrailing: View {
    @Bindable var viewModel: ChatViewModel
    @Bindable var threeColumnState: ThreeColumnState

    /// The view shown in the inspector is the opposite of viewMode
    private var inspectorShowsChat: Bool { viewModel.viewMode == .branchEditor }

    var body: some View {
        HStack(spacing: 8) {
            // Model settings (only when inspector shows chat)
            if inspectorShowsChat {
                Button {
                    // TODO: open model settings
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Model Settings")
            }

            // Search (always)
            Button {
                // TODO: inspector search
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel("Search")

            // Hide/Swap menu
            Menu {
                Button {
                    withAnimation(.spring(duration: 0.3, bounce: 0.0)) {
                        threeColumnState.inspectorPresented = false
                    }
                } label: {
                    Label("Hide \(viewModel.viewMode.opposite.label)", systemImage: "sidebar.trailing")
                }

                Divider()

                Button {
                    viewModel.viewMode = viewModel.viewMode.opposite
                } label: {
                    Label("Swap Panels", systemImage: "arrow.left.arrow.right")
                }
            } label: {
                Image(systemName: "sidebar.trailing")
                    .font(.body)
            }
        }
    }
}

private struct InspectorCenterToolbar: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        switch viewModel.viewMode {
        case .chat:
            Text("Branch Editor")
                .font(.headline)
        case .branchEditor:
            ModelSelectorButton(viewModel: viewModel)
        }
    }
}

// MARK: - Inspector Content

private struct InspectorContentView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        Group {
            switch viewModel.viewMode {
            case .chat:
                BranchEditorView()
            case .branchEditor:
                ChatDetailView(viewModel: viewModel, forceChat: true)
            }
        }
    }
}

#Preview("iPhone") {
    ContentView()
}

#Preview("iPad") {
    ContentView()
}
