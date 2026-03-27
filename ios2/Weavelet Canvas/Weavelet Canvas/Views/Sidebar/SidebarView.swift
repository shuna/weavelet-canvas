//
//  SidebarView.swift
//  Weavelet Canvas
//

import SwiftUI
import Observation

// MARK: - Shared State

@Observable
final class SidebarState {
    var editMode: EditMode = .inactive
    var selectedChatIDs: Set<UUID> = []

    var isEditing: Bool { editMode.isEditing }

    func toggleEditMode() {
        withAnimation {
            if editMode.isEditing {
                editMode = .inactive
                selectedChatIDs.removeAll()
            } else {
                editMode = .active
            }
        }
    }

    func deleteSelected(perform: (Set<UUID>) -> Void) {
        perform(selectedChatIDs)
        selectedChatIDs.removeAll()
    }
}

// MARK: - Sidebar Root

struct SidebarView: View {
    @Bindable var state: SidebarState
    @State private var searchText = ""
    @State private var menuOptionsExpanded = true

    var body: some View {
        VStack(spacing: 0) {
            ChatListSection(
                state: state,
                searchText: $searchText
            )

            Divider()

            MenuOptionsSection(isExpanded: $menuOptionsExpanded)
        }
        .navigationTitle("")
    }
}

// MARK: - Chat List

private struct ChatListSection: View {
    @Bindable var state: SidebarState
    @Binding var searchText: String

    // Placeholder data
    @State private var folders: [SidebarFolder] = [
        SidebarFolder(
            name: "Work Projects",
            color: .blue,
            chats: [
                SidebarChat(title: "API Design Discussion"),
                SidebarChat(title: "Database Schema Review"),
            ]
        ),
        SidebarFolder(
            name: "Personal",
            color: .green,
            chats: [
                SidebarChat(title: "Travel Planning"),
            ]
        ),
    ]

    @State private var chats: [SidebarChat] = [
        SidebarChat(title: "Quick brainstorm"),
        SidebarChat(title: "Code review notes"),
        SidebarChat(title: "Meeting summary"),
    ]

    @State private var activeChatID: UUID?

    var body: some View {
        List(selection: state.isEditing ? $state.selectedChatIDs : nil) {
            ForEach(folders) { folder in
                FolderRow(
                    folder: folder,
                    activeChatID: $activeChatID,
                    allFolders: folders,
                    onDeleteChat: { chatID in
                        deleteChat(id: chatID, fromFolder: folder.id)
                    },
                    onRenameChat: { chatID, newTitle in
                        renameChat(id: chatID, newTitle: newTitle, inFolder: folder.id)
                    },
                    onMoveChat: { chatID, targetFolderID in
                        moveChat(id: chatID, from: folder.id, to: targetFolderID)
                    },
                    onDuplicateChat: { chatID in
                        duplicateChat(id: chatID, inFolder: folder.id)
                    },
                    onRenameFolder: { newName in
                        renameFolder(id: folder.id, newName: newName)
                    },
                    onDeleteFolder: {
                        deleteFolder(id: folder.id)
                    },
                    onChangeFolderColor: { color in
                        changeFolderColor(id: folder.id, color: color)
                    }
                )
            }

            ForEach(filteredChats) { chat in
                ChatRow(
                    chat: chat,
                    isActive: chat.id == activeChatID,
                    folders: folders,
                    onSelect: { activeChatID = chat.id },
                    onDelete: { deleteChat(id: chat.id) },
                    onRename: { newTitle in renameChat(id: chat.id, newTitle: newTitle) },
                    onDuplicate: { duplicateChat(id: chat.id) },
                    onMove: { folderID in moveChat(id: chat.id, to: folderID) }
                )
            }
        }
        .listStyle(.sidebar)
        .searchable(text: $searchText, prompt: "Search chats")
        .environment(\.editMode, $state.editMode)
    }

    private var filteredChats: [SidebarChat] {
        if searchText.isEmpty { return chats }
        return chats.filter { $0.title.localizedCaseInsensitiveContains(searchText) }
    }

    // MARK: Chat operations

    private func deleteChat(id: UUID, fromFolder folderID: UUID? = nil) {
        if let folderID {
            if let fi = folders.firstIndex(where: { $0.id == folderID }) {
                folders[fi].chats.removeAll { $0.id == id }
            }
        } else {
            chats.removeAll { $0.id == id }
        }
        if activeChatID == id { activeChatID = nil }
    }

    private func renameChat(id: UUID, newTitle: String, inFolder folderID: UUID? = nil) {
        if let folderID {
            if let fi = folders.firstIndex(where: { $0.id == folderID }),
               let ci = folders[fi].chats.firstIndex(where: { $0.id == id }) {
                folders[fi].chats[ci].title = newTitle
            }
        } else {
            if let ci = chats.firstIndex(where: { $0.id == id }) {
                chats[ci].title = newTitle
            }
        }
    }

    private func duplicateChat(id: UUID, inFolder folderID: UUID? = nil) {
        if let folderID {
            if let fi = folders.firstIndex(where: { $0.id == folderID }),
               let chat = folders[fi].chats.first(where: { $0.id == id }) {
                let copy = SidebarChat(title: "Copy of \(chat.title)")
                folders[fi].chats.append(copy)
            }
        } else {
            if let chat = chats.first(where: { $0.id == id }) {
                let copy = SidebarChat(title: "Copy of \(chat.title)")
                chats.insert(copy, at: 0)
            }
        }
    }

    private func moveChat(id: UUID, from sourceFolderID: UUID? = nil, to targetFolderID: UUID?) {
        var movedChat: SidebarChat?
        if let sourceFolderID {
            if let fi = folders.firstIndex(where: { $0.id == sourceFolderID }),
               let ci = folders[fi].chats.firstIndex(where: { $0.id == id }) {
                movedChat = folders[fi].chats.remove(at: ci)
            }
        } else {
            if let ci = chats.firstIndex(where: { $0.id == id }) {
                movedChat = chats.remove(at: ci)
            }
        }

        // Also search all folders if source wasn't specified
        if movedChat == nil {
            for fi in folders.indices {
                if let ci = folders[fi].chats.firstIndex(where: { $0.id == id }) {
                    movedChat = folders[fi].chats.remove(at: ci)
                    break
                }
            }
        }

        guard let chat = movedChat else { return }

        if let targetFolderID {
            if let fi = folders.firstIndex(where: { $0.id == targetFolderID }) {
                folders[fi].chats.append(chat)
            }
        } else {
            chats.insert(chat, at: 0)
        }
    }

    // MARK: Folder operations

    private func renameFolder(id: UUID, newName: String) {
        if let fi = folders.firstIndex(where: { $0.id == id }) {
            folders[fi].name = newName
        }
    }

    private func deleteFolder(id: UUID) {
        if let fi = folders.firstIndex(where: { $0.id == id }) {
            let orphanedChats = folders[fi].chats
            chats.insert(contentsOf: orphanedChats, at: 0)
            folders.remove(at: fi)
        }
    }

    private func changeFolderColor(id: UUID, color: Color?) {
        if let fi = folders.firstIndex(where: { $0.id == id }) {
            folders[fi].color = color ?? .secondary
        }
    }
}

// MARK: - Folder Row

private struct FolderRow: View {
    let folder: SidebarFolder
    @Binding var activeChatID: UUID?
    let allFolders: [SidebarFolder]

    let onDeleteChat: (UUID) -> Void
    let onRenameChat: (UUID, String) -> Void
    let onMoveChat: (UUID, UUID?) -> Void
    let onDuplicateChat: (UUID) -> Void
    let onRenameFolder: (String) -> Void
    let onDeleteFolder: () -> Void
    let onChangeFolderColor: (Color?) -> Void

    @Environment(\.editMode) private var editMode
    @State private var isExpanded = true
    @State private var isRenaming = false
    @State private var editedName = ""
    @State private var showDeleteConfirmation = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            ForEach(folder.chats) { chat in
                ChatRow(
                    chat: chat,
                    isActive: chat.id == activeChatID,
                    folders: allFolders,
                    onSelect: { activeChatID = chat.id },
                    onDelete: { onDeleteChat(chat.id) },
                    onRename: { newTitle in onRenameChat(chat.id, newTitle) },
                    onDuplicate: { onDuplicateChat(chat.id) },
                    onMove: { targetFolderID in onMoveChat(chat.id, targetFolderID) }
                )
            }
        } label: {
            Label {
                if isRenaming {
                    TextField("Folder name", text: $editedName)
                        .onSubmit {
                            commitRename()
                        }
                } else {
                    Text(folder.name)
                        .lineLimit(1)
                }
            } icon: {
                Image(systemName: "folder.fill")
                    .foregroundStyle(folder.color)
            }
            .contextMenu {
                if editMode?.wrappedValue.isEditing != true {
                Button {
                    editedName = folder.name
                    isRenaming = true
                } label: {
                    Label("Rename", systemImage: "pencil")
                }

                Menu {
                    ForEach(FolderColor.allCases) { fc in
                        Button {
                            onChangeFolderColor(fc.color)
                        } label: {
                            Label(fc.name, systemImage: "circle.fill")
                        }
                    }
                    Divider()
                    Button {
                        onChangeFolderColor(nil)
                    } label: {
                        Label("Default", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Label("Color", systemImage: "paintpalette")
                }

                Divider()

                Button(role: .destructive) {
                    showDeleteConfirmation = true
                } label: {
                    Label("Delete Folder", systemImage: "trash")
                }
                } // end if !isEditing
            }
        }
        .confirmationDialog(
            "Delete \"\(folder.name)\"?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Folder", role: .destructive) {
                onDeleteFolder()
            }
        } message: {
            Text("Chats in this folder will be moved out, not deleted.")
        }
    }

    private func commitRename() {
        let trimmed = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            onRenameFolder(trimmed)
        }
        isRenaming = false
    }
}

// MARK: - Chat Row

private struct ChatRow: View {
    let chat: SidebarChat
    let isActive: Bool
    let folders: [SidebarFolder]

    let onSelect: () -> Void
    let onDelete: () -> Void
    let onRename: (String) -> Void
    let onDuplicate: () -> Void
    let onMove: (UUID?) -> Void

    @Environment(\.editMode) private var editMode
    @State private var isRenaming = false
    @State private var editedTitle = ""
    @State private var showDeleteConfirmation = false

    private var isEditing: Bool { editMode?.wrappedValue.isEditing == true }

    var body: some View {
        Label {
            if isRenaming {
                TextField("Chat title", text: $editedTitle)
                    .onSubmit {
                        commitRename()
                    }
            } else {
                Text(chat.title)
                    .lineLimit(1)
            }
        } icon: {
            Image(systemName: "bubble.left")
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .onTapGesture { onSelect() }
        .tag(chat.id)
        .listRowBackground(isActive ? Color.accentColor.opacity(0.12) : nil)
        .contextMenu {
            if !isEditing {
                Button {
                    editedTitle = chat.title
                    isRenaming = true
                } label: {
                    Label("Rename", systemImage: "pencil")
                }

                Button {
                    onDuplicate()
                } label: {
                    Label("Duplicate", systemImage: "doc.on.doc")
                }

                Menu {
                    Button {
                        onMove(nil)
                    } label: {
                        Label("No Folder", systemImage: "tray")
                    }

                    Divider()

                    ForEach(folders) { folder in
                        Button {
                            onMove(folder.id)
                        } label: {
                            Label(folder.name, systemImage: "folder")
                        }
                    }
                } label: {
                    Label("Move to Folder", systemImage: "folder.badge.plus")
                }

                Button {
                    // export
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }

                Divider()

                Button(role: .destructive) {
                    showDeleteConfirmation = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
        .confirmationDialog(
            "Delete \"\(chat.title)\"?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                onDelete()
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if !isEditing {
                Button(role: .destructive) {
                    showDeleteConfirmation = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if !isEditing {
                Button {
                    onDuplicate()
                } label: {
                    Label("Duplicate", systemImage: "doc.on.doc")
                }
                .tint(.blue)
            }
        }
    }

    private func commitRename() {
        let trimmed = editedTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            onRename(trimmed)
        }
        isRenaming = false
    }
}

// MARK: - Menu Options (Bottom Section)

private struct MenuOptionsSection: View {
    @Binding var isExpanded: Bool

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(isExpanded ? 0 : 180))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 2) {
                    MenuOptionButton(
                        title: "Settings",
                        icon: "gearshape",
                        action: {}
                    )
                    MenuOptionButton(
                        title: "Import / Export",
                        icon: "square.and.arrow.up.on.square",
                        action: {}
                    )
                    MenuOptionButton(
                        title: "Sync",
                        icon: "arrow.triangle.2.circlepath",
                        action: {}
                    )
                    MenuOptionButton(
                        title: "Help",
                        icon: "questionmark.circle",
                        action: {}
                    )
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            Text("v1.0.0")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .padding(.bottom, 4)
        }
    }
}

private struct MenuOptionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                .padding(.horizontal, 8)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .hoverEffect(.highlight)
    }
}

// MARK: - Models (Placeholder)

struct SidebarChat: Identifiable {
    let id = UUID()
    var title: String
}

struct SidebarFolder: Identifiable {
    let id = UUID()
    var name: String
    var color: Color
    var chats: [SidebarChat]
}

enum FolderColor: String, CaseIterable, Identifiable {
    case red, orange, yellow, green, blue, purple, pink

    var id: String { rawValue }

    var name: String { rawValue.capitalized }

    var color: Color {
        switch self {
        case .red: .red
        case .orange: .orange
        case .yellow: .yellow
        case .green: .green
        case .blue: .blue
        case .purple: .purple
        case .pink: .pink
        }
    }
}

#Preview {
    NavigationStack {
        SidebarView(state: SidebarState())
            .navigationTitle("Chats")
    }
}
