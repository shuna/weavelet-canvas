import Foundation

struct JSONField: Equatable {
    let key: String
    let value: OrderedJSON
}

// Object order and number spelling are retained; no Dictionary or Double round trip.
indirect enum OrderedJSON: Equatable {
    case object([JSONField]), array([OrderedJSON]), string(String), number(String), bool(Bool), null

    subscript(_ key: String) -> OrderedJSON? {
        guard case .object(let fields) = self else { return nil }
        return fields.first { $0.key.utf8.elementsEqual(key.utf8) }?.value
    }

    func replacing(_ key: String, with value: OrderedJSON) -> OrderedJSON {
        guard case .object(var fields) = self else { return self }
        if let index = fields.firstIndex(where: { $0.key.utf8.elementsEqual(key.utf8) }) {
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
                return "{" + (try fields.map { try string($0.key) + ":" + encode($0.value) }).joined(separator: ",") + "}"
            case .array(let items): return "[" + (try items.map(encode)).joined(separator: ",") + "]"
            case .string(let value): return try string(value)
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

    mutating func string() throws -> String {
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
                return try JSONDecoder().decode(String.self, from: Data(bytes[start..<offset]))
            }
        }
        throw ExchangeError.invalid("JSON文字列の終端")
    }

    mutating func value(depth: Int) throws -> OrderedJSON {
        // Bound recursion at the file boundary, rather than risking a stack overflow.
        guard depth <= 256 else { throw ExchangeError.invalid("JSONの入れ子が深すぎます") }
        skipWhitespace()
        guard offset < bytes.count else { throw ExchangeError.invalid("JSON値") }
        if bytes[offset] == 34 { return .string(try string()) }
        if consume(123) {
            var fields: [JSONField] = []
            var keys = Set<Data>()
            if consume(125) { return .object(fields) }
            repeat {
                let key = try string()
                guard keys.insert(Data(key.utf8)).inserted, consume(58) else { throw ExchangeError.invalid("JSONの重複keyまたは区切り") }
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
        guard case .string(let value) = self else { throw ExchangeError.invalid(field) }
        return value
    }
    func number(_ field: String) throws -> Double {
        guard case .number(let raw) = self, let value = Double(raw), value.isFinite else { throw ExchangeError.invalid(field) }
        return value
    }
    func boolean(_ field: String) throws -> Bool {
        guard case .bool(let value) = self else { throw ExchangeError.invalid(field) }
        return value
    }
    func required(_ key: String) throws -> OrderedJSON {
        guard let value = self[key] else { throw ExchangeError.invalid(key) }
        return value
    }
}
