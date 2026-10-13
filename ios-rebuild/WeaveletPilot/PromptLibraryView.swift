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
    @State private var busyOperation: UUID?
    @State private var cancelWork: (() -> Void)?
    @State private var isVisible = false

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

    private func cancelOperation() {
        cancelWork?()
        cancelWork = nil
        busyOperation = nil
    }

    private func accepts(_ expected: PromptLibraryDraft, operation: UUID) throws -> Bool {
        guard busyOperation == operation, isVisible else { return false }
        guard PromptLibrary.canPublish(expected: expected, current: draft,
                                       source: try state.syncInputSnapshot(), active: true) else {
            throw ExchangeError.invalid("保存データが変更されました。プロンプトライブラリを開き直してください")
        }
        return true
    }

    private func importFile(_ url: URL) {
        guard let expected = draft, busyOperation == nil else { return }
        let mode = importMode, operation = UUID()
        busyOperation = operation; errorMessage = nil
        let worker = Task.detached(priority: .userInitiated) {
            try PromptLibrary.importCSV(url, into: expected.prompts, mode: mode)
        }
        cancelWork = { worker.cancel() }
        Task { @MainActor in
            defer { if busyOperation == operation { busyOperation = nil; cancelWork = nil } }
            do {
                let imported = try await worker.value
                guard try accepts(expected, operation: operation) else { return }
                draft?.prompts = imported
            } catch {
                if busyOperation == operation && isVisible && !(error is CancellationError) {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func export() {
        guard let expected = draft, busyOperation == nil else { return }
        let gzip = exportGzip, operation = UUID()
        busyOperation = operation; errorMessage = nil
        let worker = Task.detached(priority: .userInitiated) {
            try PromptLibrary.exportCSV(expected.original, gzip: gzip)
        }
        cancelWork = { worker.cancel() }
        Task { @MainActor in
            defer { if busyOperation == operation { busyOperation = nil; cancelWork = nil } }
            do {
                let data = try await worker.value
                guard try accepts(expected, operation: operation) else { return }
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd"
                if gzip { formatter.timeZone = TimeZone(secondsFromGMT: 0) }
                exportDocument = PromptCSVDocument(data: data)
                exportName = "prompts-\(formatter.string(from: Date())).csv" + (gzip ? ".gz" : "")
                showsExporter = true
            } catch {
                if busyOperation == operation && isVisible && !(error is CancellationError) {
                    errorMessage = error.localizedDescription
                }
            }
        }
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
                }.disabled(busyOperation != nil)
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
                }.disabled(busyOperation != nil)
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
                }.disabled(busyOperation != nil)
                Section {
                    HStack {
                        Button("キャンセル") { cancelOperation(); dismiss() }
                        Spacer()
                        Button("保存") {
                            do { try state.savePromptLibrary(draft); dismiss() }
                            catch { errorMessage = error.localizedDescription }
                        }.disabled(!draft.hasChanges || busyOperation != nil)
                    }
                }
            } else { ProgressView() }
            if busyOperation != nil { ProgressView("CSVを処理中…") }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).textSelection(.enabled) }
        }
        .navigationTitle("プロンプトライブラリ")
        .disabled(state.generation != nil)
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false; cancelOperation() }
        .task {
            guard draft == nil else { return }
            do { draft = try state.promptLibraryDraft() }
            catch { errorMessage = error.localizedDescription }
        }
        .confirmationDialog("すべてのプロンプトを削除しますか？", isPresented: $confirmsClear) {
            Button("すべて削除", role: .destructive) { perform(action("clear")) }
        }
        .fileImporter(isPresented: $showsImporter, allowedContentTypes: [.commaSeparatedText]) { result in
            do { importFile(try result.get()) }
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
