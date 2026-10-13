import Foundation

enum NativeLocalModeration {
    typealias Classifier = @MainActor (String, [(path: String, data: Data)], String) async throws -> [(label: String, score: Double)]

    @MainActor static func run(text: String, state: OrderedJSON, files: LocalModelFiles,
        classifier: Classifier? = nil, isCurrent: @escaping @MainActor @Sendable () -> Bool) async throws -> OrderedJSON? {
        @MainActor func check() throws { try Task.checkCancellation(); guard isCurrent() else { throw CancellationError() } }
        try check()
        do {
            let selection = try SharedWebOperations.call("evaluation",.object([
                .init(key:"operation",value:.string("localModerationModel")),
                .init(key:"state",value:.object(["localModelEnabled","activeLocalModels"].compactMap { key in state[key].map { .init(key:key,value:$0) } }))
            ]))
            guard selection != .null else { return nil }
            let id = try selection.string("moderation model")
            guard let model = try state["localModels"]?.array("local models").first(where: {
                guard case .string(let value) = $0["id"] else { return false }
                return value.utf8.elementsEqual(id.utf8)
            }) else { return nil }
            let origin = try model.required("origin").string("model origin")
            let supply = try await background {
                let root = try files.directoryURL(modelID:id)
                let revision = try revision(root)
                let entries: [(path: String, data: Data)]
                do { entries = try files.directoryEntries(model:model) }
                catch { guard (try? Self.revision(root)) == revision else { throw CancellationError() }; throw error }
                guard (try? Self.revision(root)) == revision else { throw CancellationError() }
                return (root, revision, entries)
            }
            try check()
            let labels: [(label: String, score: Double)]
            do {
                if let classifier { labels = try await classifier(origin,supply.2,text) }
                else {
                    let host = try WKClassifierHost(origin:origin,files:supply.2)
                    defer { host.shutdown() }
                    try await host.load()
                    try check()
                    labels = try await host.classify(text:text)
                }
            } catch {
                try check()
                try await background { guard (try? revision(supply.0)) == supply.1 else { throw CancellationError() } }
                throw error
            }
            try check()
            try await background {
                guard (try? revision(supply.0)) == supply.1 else { throw CancellationError() }
            }
            try check()
            return try SharedWebOperations.call("evaluation",.object([
                .init(key:"operation",value:.string("localModeration")),
                .init(key:"labels",value:.array(labels.map { .object([.init(key:"label",value:.string($0.label)),.init(key:"score",value:.number(String($0.score)))]) })),
                .init(key:"now",value:.number(String(Int(Date().timeIntervalSince1970 * 1000))))
            ]))
        } catch is CancellationError { throw CancellationError() }
        catch { try check(); return nil }
    }

    private static func background<T>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        let task = Task.detached { try Task.checkCancellation(); let value = try work(); try Task.checkCancellation(); return value }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private struct FileRevision: Equatable {
        let device: UInt64
        let inode: UInt64
        let size: UInt64
        let modified: Date
    }
    // OS file generations only; model declaration and required paths stay in the shared directory adapter.
    private static func revision(_ root: URL) throws -> [Data: FileRevision] {
        var enumerationError: Error?
        guard let enumerator = FileManager.default.enumerator(at:root,includingPropertiesForKeys:nil,options:[],errorHandler:{ _, error in enumerationError = error; return false }) else {
            throw ExchangeError.invalid("モデルのファイル世代を確認できません")
        }
        var values: [Data: FileRevision] = [:]
        let urls = [root] + enumerator.allObjects.compactMap { $0 as? URL }
        if let enumerationError { throw enumerationError }
        for url in urls {
            try Task.checkCancellation()
            let attributes = try FileManager.default.attributesOfItem(atPath:url.path)
            guard let device = attributes[.systemNumber] as? NSNumber, let inode = attributes[.systemFileNumber] as? NSNumber,
                  let size = attributes[.size] as? NSNumber, let modified = attributes[.modificationDate] as? Date else {
                throw ExchangeError.invalid("モデルのファイル世代を確認できません")
            }
            values[Data(url.path.utf8)] = FileRevision(device:device.uint64Value,inode:inode.uint64Value,size:size.uint64Value,modified:modified)
        }
        return values
    }
}
