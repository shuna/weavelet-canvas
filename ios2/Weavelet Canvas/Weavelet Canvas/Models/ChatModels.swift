import SwiftUI

// MARK: - Message

enum MessageRole: String, Codable, CaseIterable {
    case user
    case assistant
    case system

    var label: String {
        switch self {
        case .user: "User"
        case .assistant: "Assistant"
        case .system: "System"
        }
    }

    var icon: String {
        switch self {
        case .user: "person.fill"
        case .assistant: "sparkles"
        case .system: "gearshape.fill"
        }
    }
}

struct ChatMessage: Identifiable, Equatable {
    let id: UUID
    var role: MessageRole
    var content: String
    var timestamp: Date
    var isGenerating: Bool = false
    var isOmitted: Bool = false
    var isProtected: Bool = false
    var isCollapsed: Bool = false

    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id && lhs.content == rhs.content && lhs.isGenerating == rhs.isGenerating
            && lhs.isOmitted == rhs.isOmitted && lhs.isProtected == rhs.isProtected && lhs.role == rhs.role
            && lhs.isCollapsed == rhs.isCollapsed
    }
}

// MARK: - AI Model

struct AIModel: Identifiable, Hashable {
    let id: String
    let name: String
    let provider: String
    let supportsVision: Bool
    let supportsReasoning: Bool
    let supportsAudio: Bool

    static let samples: [AIModel] = [
        AIModel(id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", supportsVision: true, supportsReasoning: false, supportsAudio: true),
        AIModel(id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "Anthropic", supportsVision: true, supportsReasoning: false, supportsAudio: false),
        AIModel(id: "o1", name: "o1", provider: "OpenAI", supportsVision: false, supportsReasoning: true, supportsAudio: false),
        AIModel(id: "gemini-pro", name: "Gemini Pro", provider: "Google", supportsVision: true, supportsReasoning: false, supportsAudio: true),
    ]
}

// MARK: - Detail View Mode

enum DetailViewMode: String, CaseIterable {
    case chat
    case branchEditor

    var label: String {
        switch self {
        case .chat: "Chat"
        case .branchEditor: "Branch Editor"
        }
    }

    var icon: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .branchEditor: "arrow.triangle.branch"
        }
    }

    var opposite: DetailViewMode {
        switch self {
        case .chat: .branchEditor
        case .branchEditor: .chat
        }
    }
}

// MARK: - Chat View Model

@Observable
class ChatViewModel {
    var messages: [ChatMessage] = ChatViewModel.sampleMessages
    var selectedModelID: String = "claude-3.5-sonnet"
    var availableModels: [AIModel] = AIModel.samples
    var isGenerating: Bool = false
    var isSearching: Bool = false
    var searchQuery: String = ""
    var searchCurrentMatch: Int = 0
    var searchTotalMatches: Int = 0
    var canGoBack: Bool = true    // placeholder
    var canGoForward: Bool = false // placeholder
    var draftText: String = ""
    var viewMode: DetailViewMode = .chat
    var errorMessage: String? = nil
    var editingMessageID: UUID? = nil
    var editText: String = ""

    var selectedModel: AIModel? {
        availableModels.first { $0.id == selectedModelID }
    }

    func sendMessage() {
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMessage = ChatMessage(id: UUID(), role: .user, content: text, timestamp: .now)
        messages.append(userMessage)
        draftText = ""

        // Simulate AI response
        isGenerating = true
        let typingMessage = ChatMessage(id: UUID(), role: .assistant, content: "", timestamp: .now, isGenerating: true)
        messages.append(typingMessage)

        // Simulated delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
            if let lastIndex = messages.indices.last {
                messages[lastIndex] = ChatMessage(
                    id: messages[lastIndex].id,
                    role: .assistant,
                    content: "This is a simulated response to: \"\(text)\"",
                    timestamp: .now
                )
            }
            isGenerating = false
        }
    }

    func stopGenerating() {
        isGenerating = false
        if let lastIndex = messages.indices.last, messages[lastIndex].isGenerating {
            messages[lastIndex] = ChatMessage(
                id: messages[lastIndex].id,
                role: .assistant,
                content: messages[lastIndex].content.isEmpty ? "Generation stopped." : messages[lastIndex].content,
                timestamp: messages[lastIndex].timestamp
            )
        }
    }

    func deleteMessage(_ id: UUID) {
        messages.removeAll { $0.id == id }
    }

    func regenerateMessage(_ id: UUID) {
        // placeholder
    }

    func regenerateBelow(_ id: UUID) {
        // placeholder: regenerate all messages below this one
    }

    func moveMessageUp(_ id: UUID) {
        guard let i = messages.firstIndex(where: { $0.id == id }), i > 0 else { return }
        messages.swapAt(i, i - 1)
    }

    func moveMessageDown(_ id: UUID) {
        guard let i = messages.firstIndex(where: { $0.id == id }), i < messages.count - 1 else { return }
        messages.swapAt(i, i + 1)
    }

    func copyMessage(_ message: ChatMessage) {
        UIPasteboard.general.string = message.content
    }

    func toggleOmit(_ id: UUID) {
        if let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].isOmitted.toggle()
        }
    }

    func toggleProtect(_ id: UUID) {
        if let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].isProtected.toggle()
        }
    }

    func changeRole(_ id: UUID, to role: MessageRole) {
        if let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].role = role
        }
    }

    func editMessage(_ id: UUID, newContent: String) {
        if let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].content = newContent
        }
    }

    func toggleCollapse(_ id: UUID) {
        if let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].isCollapsed.toggle()
        }
    }

    func collapseAll() {
        for i in messages.indices { messages[i].isCollapsed = true }
    }

    func expandAll() {
        for i in messages.indices { messages[i].isCollapsed = false }
    }

    func searchNext() {
        guard searchTotalMatches > 0 else { return }
        searchCurrentMatch = (searchCurrentMatch % searchTotalMatches) + 1
    }

    func searchPrevious() {
        guard searchTotalMatches > 0 else { return }
        searchCurrentMatch = searchCurrentMatch <= 1 ? searchTotalMatches : searchCurrentMatch - 1
    }

    func retryLastMessage() {
        errorMessage = nil
        // placeholder: retry logic
    }

    static let sampleMessages: [ChatMessage] = [
        ChatMessage(id: UUID(), role: .user, content: "SwiftUIで3カラムレイアウトを作るにはどうすればいいですか？", timestamp: Date().addingTimeInterval(-300)),
        ChatMessage(id: UUID(), role: .assistant, content: "SwiftUIで3カラムレイアウトを作成するには、`NavigationSplitView` を使用するのが最も標準的なアプローチです。\n\n```swift\nNavigationSplitView {\n    // Sidebar\n    List { ... }\n} content: {\n    // Content\n    List { ... }\n} detail: {\n    // Detail\n    Text(\"Detail View\")\n}\n```\n\nこれにより、iPadやMacでは3カラム表示、iPhoneではナビゲーションスタックとして動作します。\n\nカスタムの3ペインレイアウトが必要な場合は、`GeometryReader` と `HStack` を組み合わせて独自に実装することも可能です。", timestamp: Date().addingTimeInterval(-280)),
        ChatMessage(id: UUID(), role: .user, content: "インスペクターペインの表示・非表示を切り替えるにはどうすればいいですか？", timestamp: Date().addingTimeInterval(-200)),
        ChatMessage(id: UUID(), role: .assistant, content: "iOS 17以降では `.inspector` モディファイアを使用できます。\n\n```swift\n.inspector(isPresented: $showInspector) {\n    InspectorView()\n        .inspectorColumnWidth(min: 200, ideal: 300, max: 400)\n}\n```\n\nまた、ツールバーにトグルボタンを配置するのが一般的です：\n\n```swift\n.toolbar {\n    Button {\n        showInspector.toggle()\n    } label: {\n        Label(\"Inspector\", systemImage: \"sidebar.trailing\")\n    }\n}\n```", timestamp: Date().addingTimeInterval(-180)),
    ]
}
