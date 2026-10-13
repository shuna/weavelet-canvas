import SwiftUI
import UniformTypeIdentifiers

struct PromptLibraryView: View {
    @ObservedObject var state: ChatState
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PromptLibraryDraft?
    @State private var errorMessage: String?
    @State private var confirmsClear = false
    @State private var showsImporter = false
    @State private var showsExporter = false
    @State private var importMode = "append"
    @State private var exportGzip = false
    @State private var exportDocument: PromptCSVDocument?
    @State private var exportName = "prompts.csv"

    private func perform(_ action: OrderedJSON) {
        guard var draft else { return }
        do {
            draft.prompts = try PromptLibrary.apply(draft.prompts, action: action)
            self.draft = draft
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private func action(_ type: String, _ fields: [JSONField] = []) -> OrderedJSON {
        .object([.init(key: "type", value: .string(type))] + fields)
    }

    private func edit(_ index: Int, _ field: String, _ value: OrderedJSON) {
        perform(action("edit", [.init(key: "index", value: .number(String(index))),
                                .init(key: "field", value: .string(field)),
                                .init(key: "value", value: value)]))
    }

    private func label(_ item: PromptLibrary.Item) -> String {
        if item.label == "system" || item.label == "user" { return item.label! }
        return item.hasOtherLabel || item.label != nil ? "other" : "none"
    }

    private func importFile(_ url: URL) throws {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let csv = String(decoding: try Data(contentsOf: url), as: UTF8.self)
        let rows = try PromptLibrary.parseCSV(csv)
        let ids = try rows.array("CSV rows").map { _ in OrderedJSON.string(UUID().uuidString) }
        perform(action("import", [.init(key: "mode", value: .string(importMode)),
                                   .init(key: "rows", value: rows),
                                   .init(key: "newIDs", value: .array(ids))]))
    }

    private func export() {
        guard let draft else { return }
        do {
            let csv = try PromptLibrary.csv(draft.original)
            let bytes = Data(csv.utf8)
            exportDocument = PromptCSVDocument(data: try exportGzip ? NativeGzip.compress(bytes) : bytes)
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            if exportGzip { formatter.timeZone = TimeZone(secondsFromGMT: 0) }
            exportName = "prompts-\(formatter.string(from: Date())).csv" + (exportGzip ? ".gz" : "")
            showsExporter = true
        } catch { errorMessage = error.localizedDescription }
    }

    var body: some View {
        Form {
            if let draft {
                let items = (try? PromptLibrary.items(draft.prompts)) ?? []
                Section {
                    Button("新しいプロンプトを追加", systemImage: "plus") {
                        perform(action("add", [.init(key: "id", value: .string(UUID().uuidString))]))
                    }
                    Button("すべて削除", role: .destructive) { confirmsClear = true }
                        .disabled(items.isEmpty)
                }
                ForEach(items.indices, id: \.self) { index in
                    Section("プロンプト \(index + 1)") {
                        TextField("名前", text: Binding(get: { items[index].name }, set: { edit(index, "name", .string($0)) }))
                        TextEditor(text: Binding(get: { items[index].body }, set: { edit(index, "prompt", .string($0)) }))
                            .frame(minHeight: 100)
                            .accessibilityLabel("本文")
                        Picker("ラベル", selection: Binding(get: { label(items[index]) }, set: { value in
                            guard value != "other" else { return }
                            edit(index, "label", value == "none" ? .null : .string(value))
                        })) {
                            Text("なし").tag("none")
                            Text("system").tag("system")
                            Text("user").tag("user")
                            if label(items[index]) == "other" { Text("その他（元の値）").tag("other") }
                        }
                        Button("このプロンプトを削除", role: .destructive) {
                            perform(action("remove", [.init(key: "index", value: .number(String(index)))]))
                        }
                    }
                }
                Section("CSV") {
                    Picker("読み込み方法", selection: $importMode) {
                        Text("追加").tag("append")
                        Text("置き換え").tag("replace")
                    }
                    Button("CSVを読み込む") { showsImporter = true }
                    Toggle("gzipで書き出す", isOn: $exportGzip)
                    Button("保存済みプロンプトをCSVに書き出す") { export() }
                    Text("CSVには名前と本文のみ含まれます。読み込み結果は「保存」まで確定しません。ラベルは分類用で、利用方法を制限しません。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    HStack {
                        Button("キャンセル") { dismiss() }
                        Spacer()
                        Button("保存") {
                            do { try state.savePromptLibrary(draft); dismiss() }
                            catch { errorMessage = error.localizedDescription }
                        }.disabled(!draft.hasChanges)
                    }
                }
            } else { ProgressView() }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).textSelection(.enabled) }
        }
        .navigationTitle("プロンプトライブラリ")
        .disabled(state.generation != nil)
        .task {
            guard draft == nil else { return }
            do { draft = try state.promptLibraryDraft() }
            catch { errorMessage = error.localizedDescription }
        }
        .confirmationDialog("すべてのプロンプトを削除しますか？", isPresented: $confirmsClear) {
            Button("すべて削除", role: .destructive) { perform(action("clear")) }
        }
        .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.commaSeparatedText]) { result in
            do { try importFile(result.get()) }
            catch { if (error as? CocoaError)?.code != .userCancelled { errorMessage = error.localizedDescription } }
        }
        .fileExporter(isPresented: $showsExporter, document: exportDocument,
                      contentType: exportGzip ? .gzip : .commaSeparatedText, defaultFilename: exportName) { result in
            if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct PromptCSVDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText, .gzip] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw ExchangeError.invalid("CSVファイル") }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
