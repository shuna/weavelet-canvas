import SwiftUI

struct PromptPickerView: View {
    let request: PromptPickerRequest
    let apply: (PromptPickerResult) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var rows: [PromptPickerRow] = []
    @State private var errorMessage: String?
    @State private var isApplying = false
    @State private var worker = PromptApplication()
    @State private var selectionTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
                ForEach(rows) { row in
                    Button {
                        isApplying = true
                        selectionTask = Task { @MainActor in
                            defer { isApplying = false; selectionTask = nil }
                            do {
                                let result = try await worker.apply(request.input, text: row.body)
                                try Task.checkCancellation()
                                try apply(result)
                                dismiss()
                            } catch is CancellationError { }
                            catch { errorMessage = error.localizedDescription }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.name.isEmpty ? "（名前なし）" : row.name)
                            Text(row.body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .disabled(isApplying)
                }
            }
            .searchable(text: $query, prompt: "名前を検索")
            .navigationTitle("プロンプトを選択")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { selectionTask?.cancel(); dismiss() } } }
            .task(id: Data(query.utf8)) {
                let searched = query
                do {
                    let result = try await worker.search(snapshot: request.snapshot, query: searched)
                    try Task.checkCancellation()
                    guard searched.utf8.elementsEqual(query.utf8) else { return }
                    rows = result
                    errorMessage = nil
                } catch is CancellationError { }
                catch {
                    guard !Task.isCancelled, searched.utf8.elementsEqual(query.utf8) else { return }
                    errorMessage = error.localizedDescription
                }
            }
            .onDisappear { selectionTask?.cancel() }
        }
    }
}
