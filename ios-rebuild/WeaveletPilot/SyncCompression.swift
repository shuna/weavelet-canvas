import Foundation
import JavaScriptCore

// Each operation gets its own context; inputs are values, never evaluated source.
enum SyncCompression {
    static func compressGoogle(_ text: String) throws -> Data { try compressed("compressGoogle", text: text) }
    static func decompressGoogle(_ bytes: Data) throws -> String { try decompressed("decompressGoogle", bytes: bytes) }
    static func compressCloudKit(_ text: String) throws -> Data { try compressed("compressCloudKit", text: text) }
    static func decompressCloudKit(_ bytes: Data) throws -> String { try decompressed("decompressCloudKit", bytes: bytes) }

    private static func compressed(_ method: String, text: String) throws -> Data {
        guard let array = try call(method, argument: text).toArray() as? [NSNumber],
              array.allSatisfy({ $0.doubleValue >= 0 && $0.doubleValue <= 255 && $0.doubleValue.rounded() == $0.doubleValue }) else {
            throw CompressionError.invalidResult
        }
        return Data(array.map { $0.uint8Value })
    }

    private static func decompressed(_ method: String, bytes: Data) throws -> String {
        guard !bytes.isEmpty, bytes.count.isMultiple(of: 2) else { throw CompressionError.invalidData }
        let value = try call(method, argument: bytes.map(Int.init))
        guard value.isString, let text = value.toString() else { throw CompressionError.invalidResult }
        return text
    }

    private static func call(_ method: String, argument: Any) throws -> JSValue {
        guard let context = JSContext() else { throw CompressionError.unavailable }
        let bundle = Bundle(for: CompressionResource.self)
        for name in ["lz-string.min", "LZBridge"] {
            guard let url = bundle.url(forResource: name, withExtension: "js") else { throw CompressionError.missingResource }
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
            guard context.exception == nil else { throw CompressionError.executionFailed }
        }
        guard let bridge = context.objectForKeyedSubscript("WeaveletLZ"),
              let result = bridge.invokeMethod(method, withArguments: [argument]), context.exception == nil else {
            throw CompressionError.executionFailed
        }
        return result
    }
}

private final class CompressionResource: NSObject {}

enum CompressionError: LocalizedError {
    case unavailable, missingResource, executionFailed, invalidResult, invalidData
    var errorDescription: String? {
        switch self {
        case .unavailable: return "圧縮処理を開始できません。"
        case .missingResource: return "固定の圧縮処理ファイルがありません。"
        case .executionFailed: return "圧縮または展開処理に失敗しました。"
        case .invalidResult: return "圧縮または展開結果の形式が不正です。"
        case .invalidData: return "圧縮データの長さが不正です。"
        }
    }
}
