import SwiftUI

struct DisplaySettingsView: View {
    @ObservedObject var state: ChatState
    @State private var errorMessage: String?

    private func save(_ field: DisplaySetting, _ value: OrderedJSON) {
        do { try state.saveDisplaySetting(field, value: value); errorMessage = nil }
        catch { errorMessage = error.localizedDescription }
    }
    private func selection(_ field: DisplaySetting, value: OrderedJSON) -> Binding<String> {
        Binding(get: { field.accepts(value) ? (try? value.string(field.rawValue)) ?? "unknown" : "unknown" },
                set: { if $0 != "unknown" { save(field, .string($0)) } })
    }
    @ViewBuilder private func boolean(_ field: DisplaySetting, title: String, value: OrderedJSON) -> some View {
        if case .bool(let enabled) = value {
            Toggle(title, isOn: Binding(get: { enabled }, set: { save(field, .bool($0)) }))
                .frame(minHeight: 44)
        } else {
            Picker(title, selection: Binding(get: { "unknown" }, set: { choice in
                if choice == "true" || choice == "false" { save(field, .bool(choice == "true")) }
            })) {
                Text("元の値（未対応）").tag("unknown").disabled(true)
                Text("オン").tag("true")
                Text("オフ").tag("false")
            }.frame(minHeight: 44)
        }
    }
    var body: some View {
        Form {
            switch Result(catching: {
                try (state.displaySetting(.theme), state.displaySetting(.inlineLatex),
                     state.displaySetting(.markdownMode), state.displaySetting(.streamingMarkdownPolicy), state.displaySetting(.displayChatSize),
                     state.displaySetting(.branchSwipeDirection), state.displaySetting(.animateBubbleNavigation), state.displaySetting(.enterToSubmit))
            }) {
            case .success(let values):
                Section("外観") {
                    Picker("テーマ", selection: selection(.theme, value: values.0)) {
                        if !DisplaySetting.theme.accepts(values.0) { Text("元の値（未対応）").tag("unknown").disabled(true) }
                        Text("ライト").tag("light")
                        Text("ダーク").tag("dark")
                    }.frame(minHeight: 44)
                }
                Section("会話一覧") {
                    boolean(.displayChatSize, title: "会話サイズを表示", value: values.4)
                }
                Section("本文の入力") {
                    boolean(.enterToSubmit, title: "キーボードのEnterで送信", value: values.7)
                    Text("外付けキーボードでの操作に適用します。画面のキーボードでは改行します。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("本文の移動") {
                    Picker("分岐のスワイプ方向", selection: selection(.branchSwipeDirection, value: values.5)) {
                        if !DisplaySetting.branchSwipeDirection.accepts(values.5) { Text("元の値（未対応）").tag("unknown").disabled(true) }
                        Text("左へスワイプで次の分岐").tag("left-next")
                        Text("右へスワイプで次の分岐").tag("right-next")
                    }.frame(minHeight: 44)
                    Text("本文下の分岐番号をスワイプして切り替えます。")
                        .font(.footnote).foregroundStyle(.secondary)
                    boolean(.animateBubbleNavigation, title: "本文へのスクロールをアニメーション", value: values.6)
                }
                Section("本文の表示") {
                    boolean(.markdownMode, title: "Markdownで表示", value: values.2)
                    boolean(.inlineLatex, title: "インライン数式を表示", value: values.1)
                    Picker("生成中のMarkdown表示", selection: selection(.streamingMarkdownPolicy, value: values.3)) {
                        if !DisplaySetting.streamingMarkdownPolicy.accepts(values.3) { Text("元の値（未対応）").tag("unknown").disabled(true) }
                        Text("自動").tag("auto")
                        Text("常に表示").tag("always")
                        Text("生成中は表示しない").tag("never")
                    }.frame(minHeight: 44)
                }
            case .failure(let error): Text(error.localizedDescription).foregroundStyle(.red)
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).textSelection(.enabled) }
        }
        .navigationTitle("外観と本文の表示")
        .disabled(state.generation != nil)
    }
}
