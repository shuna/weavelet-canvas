import Foundation

enum DisplaySetting: String {
    case theme, inlineLatex, markdownMode, streamingMarkdownPolicy, displayChatSize, branchSwipeDirection, animateBubbleNavigation, enterToSubmit, advancedMode, showDebugPanel, splitPanelRatio, splitPanelSwapped, searchHistory, sidebarSearchHistory, chatFindHistory

    func accepts(_ value: OrderedJSON) -> Bool {
        switch self {
        case .theme: return value == .string("light") || value == .string("dark")
        case .inlineLatex, .markdownMode, .displayChatSize, .animateBubbleNavigation, .enterToSubmit, .advancedMode, .showDebugPanel, .splitPanelSwapped: if case .bool = value { return true }; return false
        case .splitPanelRatio: return (try? value.number("splitPanelRatio")) != nil
        case .searchHistory, .sidebarSearchHistory, .chatFindHistory: if case .array(let entries) = value { return entries.allSatisfy(\.isString) }; return false
        case .branchSwipeDirection: return ["left-next", "right-next"].contains { value == .string($0) }
        case .streamingMarkdownPolicy: return ["auto", "always", "never"].contains { value == .string($0) }
        }
    }
}

enum DisplaySettings {
    private static let defaults = Result { try ChatImport.call("defaults") }
    private static let displaySession = Result<SharedWebOperations.Session, Error> { try SharedWebOperations.Session() }
    static func messagesForDisplay(_ messages: [MessageNode], advancedMode: Bool) throws -> [MessageNode] {
        let indexes = try displaySession.get().call("messageDisplayIndexes", .object([
            .init(key: "advancedMode", value: .bool(advancedMode)),
            .init(key: "roles", value: .array(messages.map { .string($0.role) }))
        ])).array("display indexes")
        return try indexes.map {
            let index = Int(try $0.number("display index"))
            guard messages.indices.contains(index) else { throw ExchangeError.invalid("本文表示の位置が正しくありません") }
            return messages[index]
        }
    }
    static func value(_ field: DisplaySetting, in roots: OrderedJSON) throws -> OrderedJSON {
        if let stored = roots[field.rawValue] { return stored }
        return try defaults.get().required(field.rawValue)
    }
    static func clampedSplitPanelRatio(_ ratio: Double) throws -> OrderedJSON {
        guard ratio.isFinite else { throw ExchangeError.invalid("splitPanelRatio") }
        let value = try displaySession.get().call("splitPanelRatio", .object([.init(key: "ratio", value: .number(String(ratio)))]))
        guard DisplaySetting.splitPanelRatio.accepts(value) else { throw ExchangeError.invalid("splitPanelRatio") }
        return value
    }
}

extension ChatState {
    func displaySetting(_ field: DisplaySetting) throws -> OrderedJSON {
        let roots = (try? publicationSnapshot().required("state")) ?? .object([])
        return try DisplaySettings.value(field, in: roots)
    }
    func saveDisplaySetting(_ field: DisplaySetting, value: OrderedJSON) throws {
        guard field.accepts(value) else { throw ExchangeError.invalid("表示設定の値が正しくありません") }
        if field == .splitPanelRatio || field == .splitPanelSwapped || field == .searchHistory || field == .sidebarSearchHistory || field == .chatFindHistory {
            try saveLayoutSetting(field.rawValue,value:value)
            return
        }
        let snapshot = try syncInputSnapshot()
        if try snapshot.required("state")[field.rawValue]?.encoded() == value.encoded() { return }
        try applySnapshot(.object([.init(key: "version", value: try snapshot.required("version")),
                                  .init(key: "state", value: .object([.init(key: field.rawValue, value: value)]))]))
    }
    func saveSplitPanelRatio(_ ratio: Double) throws {
        try saveDisplaySetting(.splitPanelRatio, value: DisplaySettings.clampedSplitPanelRatio(ratio))
    }
    func saveSearchQueryToHistory(_ query: String, field: DisplaySetting = .searchHistory) throws {
        guard field == .searchHistory || field == .sidebarSearchHistory || field == .chatFindHistory else {
            throw ExchangeError.invalid("検索履歴の設定が正しくありません")
        }
        let current = try displaySetting(field)
        let updated = try ChatSearch.searchHistory(current, query: query)
        guard updated != current else { return }
        try saveDisplaySetting(field, value: updated)
    }
}
