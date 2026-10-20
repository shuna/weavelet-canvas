import Foundation

extension ChatState {
    @MainActor private func requireDirectoryImport(_ model: OrderedJSON) throws {
        try Task.checkCancellation()
        guard !hasGenerations, !evaluationJobs.values.contains(where: { $0.busy }) else {
            throw ExchangeError.invalid("生成・評価の終了後にモデルフォルダーを選択してください")
        }
        let id = try model.required("id").string("model id")
        try requireLocalModelAssetAccess(id:id)
        let matches = try localModelDefinitions().filter { definition in
            (try? definition.required("id").string("id"))?.utf8.elementsEqual(id.utf8) == true
        }
        guard matches.count == 1, try matches[0].encoded() == model.encoded() else {
            throw ExchangeError.invalid("選択中にモデル定義が変更されました。もう一度フォルダーを選択してください")
        }
    }

    @MainActor func publishModelDirectory(_ staged: LocalModelFiles.DirectoryStage, model: OrderedJSON) throws {
        try requireDirectoryImport(model)
        try localModelFiles.publishDirectory(staged,model:model)
    }

    @MainActor func importModelDirectory(_ source: URL, model: OrderedJSON) async throws -> String {
        try requireDirectoryImport(model)
        let files = localModelFiles
        let worker = Task.detached {
            let inspection = try files.inspectDirectory(source,model:model)
            return try files.stageDirectory(source,model:model,inspection:inspection)
        }
        let staged = try await withTaskCancellationHandler {
            try await worker.value
        } onCancel: { worker.cancel() }
        defer { Task.detached { staged.discard() } }
        try publishModelDirectory(staged,model:model)
        return try model.required("id").string("model id")
    }
}
