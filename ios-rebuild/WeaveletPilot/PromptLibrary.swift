import Foundation

struct PromptLibraryDraft: Identifiable {
    let id = UUID()
    let snapshot: OrderedJSON
    let original: OrderedJSON
    var prompts: OrderedJSON
    var hasChanges: Bool { prompts != original }
}

enum PromptLibrary {
    struct Item {
        let name: String
        let body: String
        let label: String?
        let hasOtherLabel: Bool
    }

    static func items(_ prompts: OrderedJSON) throws -> [Item] {
        try prompts.array("prompts").map { value in
            let label = try? value["label"]?.string("label")
            return Item(name: (try? value["name"]?.string("name")) ?? "",
                body: (try? value["prompt"]?.string("prompt")) ?? "",
                label: label, hasOtherLabel: value["label"] != nil && label == nil)
        }
    }

    private static func project(_ prompts: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        .array(try prompts.array("prompts").map { prompt in
            .object(try prompt.object("prompt").map { field in
                let known = ["id", "name", "prompt", "label"].contains { field.key.matches($0) }
                let value: OrderedJSON
                if known, case .string = field.value { value = field.value }
                else { value = try boundary.reference(field.value) }
                return .init(key: field.key, value: value)
            })
        })
    }

    static func defaults() throws -> OrderedJSON {
        try SharedWebOperations.call("promptLibraryOperation", .object([.init(key: "operation", value: .string("defaults"))]))
    }

    static func apply(_ prompts: OrderedJSON, action: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let result = try SharedWebOperations.call("promptLibraryOperation", .object([
            .init(key: "operation", value: .string("apply")),
            .init(key: "prompts", value: try project(prompts, boundary: &boundary)),
            .init(key: "action", value: action)
        ]))
        return try OrderedJSONChanges.apply(.array([.object([
            .init(key: "op", value: .string("set")), .init(key: "path", value: .array([])),
            .init(key: "value", value: result)
        ])]), to: .null, opaque: boundary.opaque)
    }

    static func parseCSV(_ csv: String) throws -> OrderedJSON {
        try SharedWebOperations.call("promptLibraryOperation", .object([
            .init(key: "operation", value: .string("parseCSV")), .init(key: "csv", value: .string(csv))
        ]))
    }

    static func csv(_ prompts: OrderedJSON) throws -> String {
        var boundary = SharedWebProjection()
        let result = try SharedWebOperations.call("promptLibraryOperation", .object([
            .init(key: "operation", value: .string("exportCSV")),
            .init(key: "prompts", value: try project(prompts, boundary: &boundary))
        ]))
        return try result.required("csv").string("CSV")
    }

    static func importCSV(_ url: URL, into prompts: OrderedJSON, mode: String) throws -> OrderedJSON {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let csv = String(decoding: try Data(contentsOf: url), as: UTF8.self)
        try Task.checkCancellation()
        let rows = try parseCSV(csv)
        try Task.checkCancellation()
        let ids = try rows.array("CSV rows").map { _ in OrderedJSON.string(UUID().uuidString) }
        return try apply(prompts, action: .object([
            .init(key: "type", value: .string("import")), .init(key: "mode", value: .string(mode)),
            .init(key: "rows", value: rows), .init(key: "newIDs", value: .array(ids))
        ]))
    }

    static func exportCSV(_ prompts: OrderedJSON, gzip: Bool) throws -> Data {
        let bytes = Data(try csv(prompts).utf8)
        try Task.checkCancellation()
        return try gzip ? NativeGzip.compress(bytes) : bytes
    }

    static func canPublish(expected: PromptLibraryDraft, current: PromptLibraryDraft?,
                           source: OrderedJSON, active: Bool) -> Bool {
        active && current?.id == expected.id && current?.prompts == expected.prompts && source == expected.snapshot
    }
}

extension ChatState {
    func promptLibraryDraft() throws -> PromptLibraryDraft {
        let snapshot = try syncInputSnapshot()
        let prompts = try snapshot.required("state")["prompts"] ?? PromptLibrary.defaults()
        _ = try prompts.array("prompts")
        return PromptLibraryDraft(snapshot: snapshot, original: prompts, prompts: prompts)
    }

    func savePromptLibrary(_ draft: PromptLibraryDraft) throws {
        guard try syncInputSnapshot().encoded() == draft.snapshot.encoded() else {
            throw ExchangeError.invalid("保存データが変更されました。プロンプトライブラリを開き直してください")
        }
        guard draft.hasChanges else { return }
        try applySnapshot(.object([
            .init(key: "version", value: try draft.snapshot.required("version")),
            .init(key: "state", value: .object([.init(key: "prompts", value: draft.prompts)]))
        ]))
    }
}
