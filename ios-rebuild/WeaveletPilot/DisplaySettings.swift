import Foundation

enum DisplaySetting: String {
    case theme, inlineLatex, markdownMode, streamingMarkdownPolicy, displayChatSize, branchSwipeDirection, animateBubbleNavigation

    func accepts(_ value: OrderedJSON) -> Bool {
        switch self {
        case .theme: return value == .string("light") || value == .string("dark")
        case .inlineLatex, .markdownMode, .displayChatSize, .animateBubbleNavigation: if case .bool = value { return true }; return false
        case .branchSwipeDirection: return ["left-next", "right-next"].contains { value == .string($0) }
        case .streamingMarkdownPolicy: return ["auto", "always", "never"].contains { value == .string($0) }
        }
    }
}

enum DisplaySettings {
    private static let defaults = Result { try ChatImport.call("defaults") }
    static func value(_ field: DisplaySetting, in roots: OrderedJSON) throws -> OrderedJSON {
        if let stored = roots[field.rawValue] { return stored }
        return try defaults.get().required(field.rawValue)
    }
}

extension ChatState {
    func displaySetting(_ field: DisplaySetting) throws -> OrderedJSON {
        let roots = (try? publicationSnapshot().required("state")) ?? .object([])
        return try DisplaySettings.value(field, in: roots)
    }
    func saveDisplaySetting(_ field: DisplaySetting, value: OrderedJSON) throws {
        guard field.accepts(value) else { throw ExchangeError.invalid("表示設定の値が正しくありません") }
        let snapshot = try syncInputSnapshot()
        if try snapshot.required("state")[field.rawValue]?.encoded() == value.encoded() { return }
        try applySnapshot(.object([.init(key: "version", value: try snapshot.required("version")),
                                  .init(key: "state", value: .object([.init(key: field.rawValue, value: value)]))]))
    }
}
