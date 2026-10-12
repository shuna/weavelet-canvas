import Foundation

// Swift owns the raw containers; all document rules run in the shared Web operation.
struct SyncDocument {
    let snapshot: OrderedJSON
    let v3Sidecar: OrderedJSON
    let v3RootOrder: [String]
    init(snapshot: OrderedJSON, v3Sidecar: OrderedJSON = .object([]), v3RootOrder: [String] = []) throws {
        _ = try snapshot.object("snapshot")
        _ = try snapshot.required("state").object("state")
        _ = try snapshot.required("version").number("version")
        _ = try v3Sidecar.object("V3 sidecar")
        self.snapshot = snapshot; self.v3Sidecar = v3Sidecar; self.v3RootOrder = v3RootOrder
    }
    init(v3: OrderedJSON) throws {
        let layout = try SharedWebOperations.call("documentOperation", .object([.init(key: "operation", value: .string("v3Layout")), .init(key: "v3", value: .object([.init(key: "version", value: try v3.required("version"))] + v3.object("V3").filter { $0.key != "version" }.map { .init(key: $0.key, value: .null) }))]))
        func roots(_ key: String) throws -> OrderedJSON {
            let names = try layout.required(key).array(key).map { try $0.string("root") }
            return .object(try v3.object("V3").filter { field in names.contains { $0.utf8.elementsEqual(field.key.utf8) } })
        }
        try self.init(snapshot: .object([.init(key: "version", value: try layout.required("version")), .init(key: "state", value: roots("sharedRoots"))]), v3Sidecar: roots("sidecarRoots"), v3RootOrder: v3.object("V3").map(\.key))
    }
    private var raw: OrderedJSON { .object([.init(key: "snapshot", value: snapshot), .init(key: "v3Sidecar", value: v3Sidecar)]) }
    private func projected(_ boundary: inout SharedWebProjection) throws -> OrderedJSON {
        let state = try snapshot.required("state")
        var fields: [JSONField] = []
        for field in try state.object("state") {
            let value: OrderedJSON
            if field.key == "chats", case .array(let chats) = field.value { value = .array(try chats.map { try boundary.chat($0) }) }
            else if field.key == "contentStore", case .object = field.value { value = try boundary.store(field.value, strict: true) }
            else if field.key == "folders", case .object = field.value { value = try boundary.folders(field.value) }
            else { value = try boundary.reference(field.value) }
            fields.append(.init(key: field.key, value: value))
        }
        // Preserve null display roots as null, so the shared projection can supply its defaults.
        for index in fields.indices where fields[index].key == "chats" || fields[index].key == "contentStore" || fields[index].key == "folders" {
            if state[fields[index].key] == .null { fields[index] = .init(key: fields[index].key, value: .null) }
        }
        let projectedSnapshot = OrderedJSON.object(try snapshot.object("snapshot").map { field in
            .init(key: field.key, value: field.key == "state" ? .object(fields) : field.key == "version" ? field.value : try boundary.reference(field.value))
        })
        let sidecar = try v3Sidecar.object("sidecar").map { field in JSONField(key: field.key, value: try boundary.reference(field.value)) }
        return .object([.init(key: "snapshot", value: projectedSnapshot), .init(key: "v3Sidecar", value: .object(sidecar))])
    }
    private func projectedV3(_ source: OrderedJSON, boundary: inout SharedWebProjection) throws -> OrderedJSON {
        .object(try source.object("V3").map { field in
            let value: OrderedJSON
            if field.key == "version" { value = field.value }
            else if field.key == "chats", case .array(let chats) = field.value { value = .array(try chats.map { try boundary.chat($0) }) }
            else if field.key == "contentStore", case .object = field.value { value = try boundary.store(field.value, strict: true) }
            else if field.key == "folders", case .object = field.value { value = try boundary.folders(field.value) }
            else { value = try boundary.reference(field.value) }
            return .init(key: field.key, value: value)
        })
    }
    func uiProjection() throws -> OrderedJSON {
        var boundary = SharedWebProjection()
        let output = try SharedWebOperations.call("documentOperation", .object([.init(key: "operation", value: .string("project")), .init(key: "document", value: projected(&boundary))]))
        let restored = try OrderedJSONChanges.apply(.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: output)])]), to: .null, opaque: boundary.opaque)
        let fields = try restored.object("projection")
        let ordered = v3RootOrder.compactMap { key in fields.first { $0.key.utf8.elementsEqual(key.utf8) } }
        return .object(ordered + fields.filter { field in !v3RootOrder.contains { $0.utf8.elementsEqual(field.key.utf8) } })
    }
    func applyingV3Edits(_ edited: OrderedJSON, comparedTo before: OrderedJSON, now: Double = Date().timeIntervalSince1970 * 1000) throws -> SyncDocument {
        var boundary = SharedWebProjection()
        let store = try snapshot.required("state")["contentStore"]
        let entries = try store == .null ? [] : store?.object("store") ?? []
        let deltaEntries = entries.filter { $0.value["delta"] != nil }.map { OrderedJSON.string($0.key) }
        let input = OrderedJSON.object([.init(key: "deltaEntries", value: .array(deltaEntries)), .init(key: "operation", value: .string("applyEdits")), .init(key: "now", value: .number(String(now))), .init(key: "document", value: try projected(&boundary)), .init(key: "before", value: try projectedV3(before, boundary: &boundary)), .init(key: "edited", value: try projectedV3(edited, boundary: &boundary))])
        let changes = try SharedWebOperations.call("documentOperation", input)
        return try Self.fromRaw(OrderedJSONChanges.apply(changes, to: raw, opaque: boundary.opaque), order: v3RootOrder)
    }
    func synchronizingSnapshot(_ received: OrderedJSON) throws -> SyncDocument {
        let input = OrderedJSON.object([.init(key: "operation", value: .string("syncSnapshot")), .init(key: "document", value: raw), .init(key: "received", value: received)])
        let planned = try SharedWebOperations.call("documentOperation", input).array("changes")
        func rawValue(_ path: OrderedJSON) throws -> OrderedJSON {
            var value = snapshot
            for key in try path.array("source path") {
                switch key {
                case .string(let name): value = try value.required(name)
                case .number(let raw):
                    let values = try value.array("source array")
                    guard let index = Int(raw), values.indices.contains(index) else { throw ExchangeError.invalid("raw source index") }
                    value = values[index]
                default: throw ExchangeError.invalid("raw source path")
                }
            }
            return value
        }
        let changes = try planned.map { change -> OrderedJSON in
            guard let references = change["rawSources"] else { return change }
            let restores = try references.array("raw sources").map { reference in
                OrderedJSON.object([.init(key:"op",value:.string("set")),.init(key:"path",value:try reference.required("path")),.init(key:"value",value:try rawValue(reference.required("sourcePath")))])
            }
            return try change.replacing("value",with:OrderedJSONChanges.apply(.array(restores),to:change.required("value")))
        }
        return try .init(snapshot: OrderedJSONChanges.apply(.array(changes), to: snapshot), v3Sidecar: v3Sidecar, v3RootOrder: v3RootOrder)
    }
    func mergingSnapshot(_ incoming: OrderedJSON) throws -> SyncDocument {
        // Send only root presence/type containers. Set values always come from the raw incoming source.
        let shallow = incoming.replacing("state", with: .object(try incoming.required("state").object("state").map { .init(key: $0.key, value: .null) }))
        let identity = snapshot.replacing("state", with: .object([]))
        let input = OrderedJSON.object([.init(key: "operation", value: .string("mergeSnapshot")), .init(key: "document", value: .object([.init(key: "snapshot", value: identity), .init(key: "v3Sidecar", value: .object([]))])), .init(key: "incoming", value: shallow)])
        let planned = try SharedWebOperations.call("documentOperation", input).array("changes")
        // Enumerate new raw roots in their original order; JS integer-key enumeration cannot reorder them.
        let order = try incoming.object("snapshot").filter { $0.key != "state" }.map { [OrderedJSON.string($0.key)] } + incoming.required("state").object("state").map { [.string("state"), .string($0.key)] }
        var changes: [OrderedJSON] = []
        for path in order {
            guard let change = planned.first(where: { $0["sourcePath"] == .array(path) }) else { throw ExchangeError.invalid("raw snapshot source path") }
            var value = incoming
            for key in path { value = try value.required(key.string("source key")) }
            changes.append(change.replacing("value", with: value))
        }
        return try Self.fromRaw(OrderedJSONChanges.apply(.array(changes), to: raw), order: v3RootOrder)
    }
    func importingV3(_ v3: OrderedJSON) throws -> SyncDocument {
        let shallow = OrderedJSON.object(try v3.object("V3").map { .init(key: $0.key, value: $0.key == "version" ? $0.value : .null) })
        let identity = snapshot.replacing("state", with: .object([]))
        let input = OrderedJSON.object([.init(key: "operation", value: .string("importV3")), .init(key: "document", value: .object([.init(key: "snapshot", value: identity), .init(key: "v3Sidecar", value: .object([]))])), .init(key: "v3", value: shallow)])
        let planned = try SharedWebOperations.call("documentOperation", input).array("changes")
        var changes: [OrderedJSON] = []
        for field in try v3.object("V3") where field.key != "version" {
            guard let change = planned.first(where: { $0["sourcePath"] == .array([.string(field.key)]) }) else { throw ExchangeError.invalid("raw V3 source path") }
            changes.append(change.replacing("value", with: field.value))
        }
        let imported = try OrderedJSONChanges.apply(.array(changes), to: raw)
        let names = try v3.object("V3").map(\.key)
        let order = v3RootOrder + names.filter { name in !v3RootOrder.contains { $0.utf8.elementsEqual(name.utf8) } }
        return try Self.fromRaw(imported, order: order)
    }
    func exportData() throws -> Data { try uiProjection().encoded() }
    private static func fromRaw(_ raw: OrderedJSON, order: [String]) throws -> SyncDocument { try .init(snapshot: raw.required("snapshot"), v3Sidecar: raw.required("v3Sidecar"), v3RootOrder: order) }
}
