import Foundation

enum ChatImportMode: String { case append, replace }
struct ChatImportDecisionRequired: LocalizedError {
    let kind: String
    let message: String
    var errorDescription: String? { message }
}
struct ChatImportPreview: Identifiable {
    let id = UUID()
    let filename: String
    let conversations: [Conversation]
    let folderRows: [ChatFolderRow]
    let recoveredContentCount: Int
    let unavailableContent: [String: [String]]
    let source: OrderedJSON
    let baselineSnapshot: OrderedJSON?
    let baselineSidecar: OrderedJSON?
    let baselineRootOrder: [JSONString]?
}

// The Web inspector identifies opaque fields; Swift only transports their raw values.
enum ChatImport {
    static func value(at path: OrderedJSON, in source: OrderedJSON) throws -> OrderedJSON {
        var value = source
        for component in try path.array("import path") {
            switch component {
            case .string, .utf16String: value = try value.required(component.stringKey("import key"))
            case .number(let raw):
                let values = try value.array("import array")
                guard let index = Int(raw), values.indices.contains(index) else { throw ExchangeError.invalid("import path index") }
                value = values[index]
            default: throw ExchangeError.invalid("import path")
            }
        }
        return value
    }
    static func project(_ raw: OrderedJSON, kind: String, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        let inspection = try SharedWebOperations.call("fileImport", .object([.init(key:"operation",value:.string("inspect")),.init(key:"kind",value:.string(kind)),.init(key:"data",value:raw)]))
        let stores = try inspection.required("contentStorePaths").array("store paths")
        var changes: [OrderedJSON] = []
        func set(_ path: OrderedJSON, _ value: OrderedJSON) -> OrderedJSON {
            .object([.init(key:"op",value:.string("set")),.init(key:"path",value:path),.init(key:"value",value:value)])
        }
        for path in stores { changes.append(set(path, try boundary.store(value(at:path,in:raw),strict:true))) }
        for path in try inspection.required("opaquePaths").array("opaque paths") {
            let components = try path.array("path")
            if try stores.contains(where: { store in
                let prefix = try store.array("store path")
                return components.count >= prefix.count && Array(components.prefix(prefix.count)) == prefix
            }) { continue }
            changes.append(set(path, try boundary.reference(value(at:path,in:raw))))
        }
        // Apply references as values here, without restoring the table until output.
        return try OrderedJSONChanges.apply(.array(changes),to:raw)
    }
    static func restore(_ value: OrderedJSON, boundary: SharedWebProjection) throws -> OrderedJSON {
        try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:value)])]),to:.null,opaque:boundary.opaque)
    }
    static func call(_ operation: String, fields: [JSONField] = []) throws -> OrderedJSON {
        try SharedWebOperations.call("fileImport", .object([.init(key:"operation",value:.string(operation))] + fields))
    }
}
