import Foundation
import JavaScriptCore

// JSON keys use code units: Swift String repairs lone surrogates and normalizes equality.
struct JSONString: Hashable, ExpressibleByStringLiteral {
    let utf16: [UInt16]
    init(_ value: String) { utf16 = Array(value.utf16) }
    init(utf16: [UInt16]) { self.utf16 = utf16 }
    init(stringLiteral value: String) { self.init(value) }
    // Only native display/OS APIs use this repaired projection; JSON keeps utf16.
    var text: String { String(decoding: utf16, as: UTF16.self) }
    func native(_ field: String) throws -> String {
        let value = text
        guard value.utf16.elementsEqual(utf16) else { throw ExchangeError.invalid(field) }
        return value
    }
    var json: OrderedJSON {
        let value = text
        return value.utf16.elementsEqual(utf16) ? .string(value) : .utf16String(utf16)
    }
    func matches(_ value: String) -> Bool { utf16.elementsEqual(value.utf16) }
    static func == (lhs: Self, rhs: String) -> Bool { lhs.matches(rhs) }
    static func != (lhs: Self, rhs: String) -> Bool { !lhs.matches(rhs) }
}

struct JSONField: Equatable {
    let key: JSONString
    let value: OrderedJSON
    init(key: String, value: OrderedJSON) { self.key = JSONString(key); self.value = value }
    init(key: JSONString, value: OrderedJSON) { self.key = key; self.value = value }
}

// Object order and number spelling are retained; no Dictionary or Double round trip.
indirect enum OrderedJSON: Equatable {
    case object([JSONField]), array([OrderedJSON]), string(String), utf16String([UInt16]), number(String), bool(Bool), null

    static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.object(let left), .object(let right)): return left == right
        case (.array(let left), .array(let right)): return left == right
        case (.string(let left), .string(let right)): return left.utf8.elementsEqual(right.utf8)
        case (.utf16String(let left), .utf16String(let right)): return left == right
        case (.string(let left), .utf16String(let right)): return left.utf16.elementsEqual(right)
        case (.utf16String(let left), .string(let right)): return left.elementsEqual(right.utf16)
        case (.number(let left), .number(let right)): return left == right
        case (.bool(let left), .bool(let right)): return left == right
        case (.null, .null): return true
        default: return false
        }
    }

    subscript(_ key: String) -> OrderedJSON? { self[JSONString(key)] }

    subscript(_ key: JSONString) -> OrderedJSON? {
        guard case .object(let fields) = self else { return nil }
        return fields.first { $0.key == key }?.value
    }

    func replacing(_ key: String, with value: OrderedJSON) -> OrderedJSON { replacing(JSONString(key), with: value) }

    func replacing(_ key: JSONString, with value: OrderedJSON) -> OrderedJSON {
        guard case .object(var fields) = self else { return self }
        if let index = fields.firstIndex(where: { $0.key == key }) {
            fields[index] = JSONField(key: key, value: value)
        } else {
            fields.append(JSONField(key: key, value: value))
        }
        return .object(fields)
    }

    func encoded() throws -> Data {
        func string(_ value: String) throws -> String {
            String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        }
        func encode(_ value: OrderedJSON) throws -> String {
            switch value {
            case .object(let fields):
                return "{" + (try fields.map { try encode($0.key.json) + ":" + encode($0.value) }).joined(separator: ",") + "}"
            case .array(let items): return "[" + (try items.map(encode)).joined(separator: ",") + "]"
            case .string(let value): return try string(value)
            case .utf16String(let units): return "\"" + units.map { String(format: "\\u%04x", $0) }.joined() + "\""
            case .number(let value): return value
            case .bool(let value): return value ? "true" : "false"
            case .null: return "null"
            }
        }
        return Data(try encode(self).utf8)
    }

    static func decode(_ data: Data) throws -> OrderedJSON {
        var parser = JSONParser(bytes: Array(data))
        let value = try parser.value(depth: 0)
        parser.skipWhitespace()
        guard parser.offset == parser.bytes.count else { throw ExchangeError.invalid("JSON末尾") }
        return value
    }
}

private struct JSONParser {
    let bytes: [UInt8]
    var offset = 0

    mutating func skipWhitespace() {
        while offset < bytes.count && [9, 10, 13, 32].contains(bytes[offset]) { offset += 1 }
    }

    mutating func consume(_ byte: UInt8) -> Bool {
        skipWhitespace()
        guard offset < bytes.count, bytes[offset] == byte else { return false }
        offset += 1
        return true
    }

    mutating func string() throws -> JSONString {
        skipWhitespace()
        let start = offset
        guard consume(34) else { throw ExchangeError.invalid("JSON文字列") }
        while offset < bytes.count {
            let byte = bytes[offset]
            offset += 1
            if byte == 92 {
                guard offset < bytes.count else { throw ExchangeError.invalid("JSONエスケープ") }
                offset += 1
            } else if byte == 34 {
                let data = Data(bytes[start..<offset])
                if let value = try? JSONDecoder().decode(String.self, from: data) { return JSONString(value) }
                // JSON.parse accepts escaped lone surrogates; extract units before Swift bridging repairs them.
                guard let token = String(data: data, encoding: .utf8), let context = JSContext(),
                      let parsed = context.objectForKeyedSubscript("JSON")?.invokeMethod("parse", withArguments: [token]),
                      context.exception == nil, parsed.isString,
                      let units = context.evaluateScript("s => Array.from({length: s.length}, (_, i) => s.charCodeAt(i))")?.call(withArguments: [parsed])?.toArray() as? [NSNumber],
                      context.exception == nil else { throw ExchangeError.invalid("JSON文字列") }
                return JSONString(utf16: units.map(\.uint16Value))
            }
        }
        throw ExchangeError.invalid("JSON文字列の終端")
    }

    mutating func value(depth: Int) throws -> OrderedJSON {
        // Bound recursion at the file boundary, rather than risking a stack overflow.
        guard depth <= 256 else { throw ExchangeError.invalid("JSONの入れ子が深すぎます") }
        skipWhitespace()
        guard offset < bytes.count else { throw ExchangeError.invalid("JSON値") }
        if bytes[offset] == 34 { return try string().json }
        if consume(123) {
            var fields: [JSONField] = []
            var keys = Set<JSONString>()
            if consume(125) { return .object(fields) }
            repeat {
                let key = try string()
                guard keys.insert(key).inserted, consume(58) else { throw ExchangeError.invalid("JSONの重複keyまたは区切り") }
                fields.append(JSONField(key: key, value: try value(depth: depth + 1)))
                if consume(125) { return .object(fields) }
            } while consume(44)
            throw ExchangeError.invalid("JSON objectの終端")
        }
        if consume(91) {
            var values: [OrderedJSON] = []
            if consume(93) { return .array(values) }
            repeat {
                values.append(try value(depth: depth + 1))
                if consume(93) { return .array(values) }
            } while consume(44)
            throw ExchangeError.invalid("JSON arrayの終端")
        }
        let start = offset
        while offset < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[offset]) { offset += 1 }
        let token = String(decoding: bytes[start..<offset], as: UTF8.self)
        switch token {
        case "true": return .bool(true)
        case "false": return .bool(false)
        case "null": return .null
        default:
            guard token.range(of: #"\A-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?\z"#, options: .regularExpression) != nil else {
                throw ExchangeError.invalid("JSON数値")
            }
            return .number(token)
        }
    }
}

enum ExchangeError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let field): return "読み込めないV3 JSONです: \(field)" }
    }
}

extension OrderedJSON {
    func object(_ field: String) throws -> [JSONField] {
        guard case .object(let value) = self else { throw ExchangeError.invalid(field) }
        return value
    }
    func array(_ field: String) throws -> [OrderedJSON] {
        guard case .array(let value) = self else { throw ExchangeError.invalid(field) }
        return value
    }
    func string(_ field: String) throws -> String {
        return try stringKey(field).native(field)
    }
    func displayString(_ field: String) throws -> String { try stringKey(field).text }
    func stringKey(_ field: String) throws -> JSONString {
        switch self {
        case .string(let value): return JSONString(value)
        case .utf16String(let units): return JSONString(utf16: units)
        default: throw ExchangeError.invalid(field)
        }
    }
    var isString: Bool { if case .string = self { return true }; if case .utf16String = self { return true }; return false }
    static func string(_ key: JSONString) -> OrderedJSON { key.json }
    func number(_ field: String) throws -> Double {
        guard case .number(let raw) = self, let value = Double(raw), value.isFinite else { throw ExchangeError.invalid(field) }
        return value
    }
    func boolean(_ field: String) throws -> Bool {
        guard case .bool(let value) = self else { throw ExchangeError.invalid(field) }
        return value
    }
    func required(_ key: JSONString) throws -> OrderedJSON {
        guard let value = self[key] else { throw ExchangeError.invalid(key.text) }
        return value
    }
    func required(_ key: String) throws -> OrderedJSON {
        guard let value = self[key] else { throw ExchangeError.invalid(key) }
        return value
    }
}
