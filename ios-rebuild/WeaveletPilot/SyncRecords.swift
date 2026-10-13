import Foundation
import CryptoKit
import JavaScriptCore

// The actual Web records module owns conversion and validation; Swift only crosses the JSON boundary.
enum SyncRecords {
    static func toRecords(_ snapshot: OrderedJSON) throws -> OrderedJSON { try SharedRecordJSON().call("toRecords", [snapshot]) }
    static func fromRecords(_ records: OrderedJSON) throws -> OrderedJSON { try SharedRecordJSON().call("fromRecords", [records]) }
    static func canonical(_ value: OrderedJSON) throws -> String { try SharedRecordJSON().call("canonical", [value]).string("canonical") }
    static func resolveContent(_ source: OrderedJSON, hash: String) throws -> OrderedJSON { try resolvedContent(source, hash: hash, operation: "resolveContent") }
    static func resolveProjectedContent(_ source: OrderedJSON, hash: String) throws -> OrderedJSON { try resolvedContent(source, hash: hash, operation: "resolveProjectedContent") }
    private static func resolvedContent(_ source: OrderedJSON, hash: String, operation: String) throws -> OrderedJSON {
        if operation == "resolveContent", source[hash]?["delta"] != nil {
            _ = try SharedRecordJSON().call(operation, [source, .string(hash)])
        }
        var projection = SharedWebProjection()
        let projected = try projection.store(source, resolving: [hash])
        let result = try SharedRecordJSON().call(operation, [projected, .string(hash)])
        let changes = OrderedJSON.array([.object([.init(key: "op", value: .string("set")), .init(key: "path", value: .array([])), .init(key: "value", value: result)])])
        return try OrderedJSONChanges.apply(changes, to: .null, opaque: projection.opaque)
    }
    static func digest(_ value: String) -> String { hash(Data(value.utf8)) }
    private static func hash(_ value: Data) -> String { SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined() }
    static func encodeWire(_ value: OrderedJSON) throws -> Data {
        // Standard JSON.parse/stringify supplies the Web number and property-order semantics.
        guard let context = JSContext(), let json = context.objectForKeyedSubscript("JSON"),
              let parsed = json.invokeMethod("parse", withArguments: [String(decoding: try value.encoded(), as: UTF8.self)]), context.exception == nil,
              let serialized = json.invokeMethod("stringify", withArguments: [parsed]), context.exception == nil, let text = serialized.toString() else {
            throw RecordError.invalid("Wire JSON operation failed")
        }
        return try SyncCompression.compressGoogle(text)
    }
    static func decodeWire(_ bytes: Data) throws -> OrderedJSON { try OrderedJSON.decode(Data(SyncCompression.decompressGoogle(bytes).utf8)) }

    static func primitive(_ json: String) -> String {
        let response: OrderedJSON
        do {
            let request = try OrderedJSON.decode(Data(json.utf8))
            let args = try request.required("args").array("args").map { try OrderedJSON.decode(Data($0.string("argument JSON").utf8)) }
            let value: OrderedJSON
            switch try request.required("operation").string("operation") {
            case "digest":
                let bytes: Data
                if case .string(let text) = args[0] { bytes = Data(text.utf8) } else { bytes = try args[0].syncData() }
                value = .string(hash(bytes))
            case "uuid": value = .string(UUID().uuidString.lowercased())
            case "utf8": value = .syncBytes(Data(try args[0].string("text").utf8))
            case "text":
                guard let text = String(data: try args[0].syncData(), encoding: .utf8) else { throw RecordError.invalid("Invalid UTF8") }
                value = .string(text)
            default: throw RecordError.invalid("Unsupported shared record primitive")
            }
            response = .object([JSONField(key: "ok", value: .bool(true)), JSONField(key: "value", value: value)])
        } catch { response = .object([JSONField(key: "ok", value: .bool(false)), JSONField(key: "error", value: .string(error.localizedDescription))]) }
        return String(decoding: try! response.encoded(), as: UTF8.self)
    }
}

private struct SharedRecordJSON {
    let context: JSContext
    let bridge: JSValue
    init() throws {
        guard let context = JSContext() else { throw RecordError.invalid("JavaScriptCore unavailable") }
        let callback: @convention(block) (String) -> String = { SyncRecords.primitive($0) }
        context.setObject(callback, forKeyedSubscript: "nativeSyncCall" as NSString)
        let bundle = Bundle(for: RecordResource.self)
        guard let url = bundle.url(forResource: "GoogleSync.bundle", withExtension: "js") else { throw RecordError.invalid("Missing shared records resource") }
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
        guard context.exception == nil, let bridge = context.objectForKeyedSubscript("WeaveletGoogleSync") else { throw RecordError.invalid("Invalid shared records resource") }
        self.context = context; self.bridge = bridge
    }
    func call(_ operation: String, _ values: [OrderedJSON]) throws -> OrderedJSON {
        let input = String(decoding: try OrderedJSON.array(values).encoded(), as: UTF8.self)
        _ = bridge.invokeMethod("recordsStart", withArguments: [operation, input])
        guard context.exception == nil, let output = bridge.invokeMethod("recordsResult", withArguments: []), context.exception == nil, let text = output.toString() else {
            throw RecordError.invalid("Shared records operation failed")
        }
        let result = try OrderedJSON.decode(Data(text.utf8))
        if let error = result["error"] { throw RecordError.invalid(try error.string("record error")) }
        guard let json = result["valueJSON"] else { throw RecordError.invalid("Shared records promise did not complete") }
        return try OrderedJSON.decode(Data(json.string("record result").utf8))
    }
}
private final class RecordResource: NSObject {}
enum RecordError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { switch self { case .invalid(let field): return "同期recordを処理できません: \(field)" } }
}
