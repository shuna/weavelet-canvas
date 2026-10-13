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
                     state.displaySetting(.markdownMode), state.displaySetting(.streamingMarkdownPolicy))
            }) {
            case .success(let values):
                Section("外観") {
                    Picker("テーマ", selection: selection(.theme, value: values.0)) {
                        if !DisplaySetting.theme.accepts(values.0) { Text("元の値（未対応）").tag("unknown").disabled(true) }
                        Text("ライト").tag("light")
                        Text("ダーク").tag("dark")
                    }.frame(minHeight: 44)
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
