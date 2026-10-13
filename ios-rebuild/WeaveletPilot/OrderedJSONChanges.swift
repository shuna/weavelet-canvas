import Foundation

// Applies the shared Web routines' leaf changes without serializing untouched values.
enum OrderedJSONChanges {
    static func apply(_ changes: OrderedJSON, to source: OrderedJSON, opaque: [OrderedJSON] = []) throws -> OrderedJSON {
        func restore(_ value: OrderedJSON) throws -> OrderedJSON {
            switch value {
            case .object(let fields):
                if !opaque.isEmpty, fields.count == 1, fields[0].key == "opaqueRef", case .number(let raw) = fields[0].value {
                    guard let index = Int(raw), opaque.indices.contains(index) else { throw ExchangeError.invalid("opaque reference") }
                    return opaque[index]
                }
                return .object(try fields.map { JSONField(key: $0.key, value: try restore($0.value)) })
            case .array(let values): return .array(try values.map(restore))
            default: return value
            }
        }
        func changing(_ value: OrderedJSON, path: ArraySlice<OrderedJSON>, change: OrderedJSON) throws -> OrderedJSON {
            guard let head = path.first else {
                let op = try change.required("op").string("op")
                if op == "set" { return try restore(change.required("value")) }
                guard op == "keys" else { throw ExchangeError.invalid("change operation") }
                let keys = try change.required("keys").array("keys").map { try $0.stringKey("key") }
                let fields = try value.object("object")
                guard keys.count == fields.count, Set(keys).count == keys.count else { throw ExchangeError.invalid("change keys") }
                return .object(try keys.map { JSONField(key: $0, value: try value.required($0)) })
            }
            let remaining = path.dropFirst(), op = try change.required("op").string("op")
            switch (value, head) {
            case (.object(var fields), _) where head.isString:
                let key = try head.stringKey("path key")
                let index = fields.firstIndex { $0.key == key }
                if remaining.isEmpty, op == "remove" { if let index { fields.remove(at: index) }; return .object(fields) }
                let updated = try changing(index.map { fields[$0].value } ?? .object([]), path: remaining, change: change)
                if let index { fields[index] = JSONField(key: key, value: updated) } else { fields.append(JSONField(key: key, value: updated)) }
                return .object(fields)
            case (.array(var values), .number(let raw)):
                guard let index = Int(raw), index >= 0, index <= values.count else { throw ExchangeError.invalid("change index") }
                if remaining.isEmpty, op == "remove" {
                    guard index < values.count else { throw ExchangeError.invalid("change index") }; values.remove(at: index)
                } else {
                    let updated = try changing(index < values.count ? values[index] : .object([]), path: remaining, change: change)
                    if index == values.count { values.append(updated) } else { values[index] = updated }
                }
                return .array(values)
            default: throw ExchangeError.invalid("change path")
            }
        }
        var result = source
        for change in try changes.array("changes") { result = try changing(result, path: change.required("path").array("path")[...], change: change) }
        return result
    }
}
