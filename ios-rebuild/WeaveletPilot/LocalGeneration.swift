import Foundation
import CryptoKit
import Darwin

// Device files are not proof that synchronized model metadata is available here.
struct LocalModelFiles {
    let directory: URL
    func url(modelID: String) throws -> URL {
        guard !modelID.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw ExchangeError.invalid("モデルIDを入力してください") }
        let name = SHA256.hash(data:Data(modelID.utf8)).map { String(format:"%02x",$0) }.joined()
        return directory.appendingPathComponent(name + ".gguf")
    }
    func installed(modelID: String) throws -> URL {
        let file = try url(modelID:modelID)
        guard FileManager.default.fileExists(atPath:file.path) else { throw ExchangeError.invalid("この端末でモデルのGGUFファイルを選択してください") }
        return file
    }
    func install(_ source: URL, modelID: String) throws {
        let target = try url(modelID:modelID)
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let handle = try FileHandle(forReadingFrom:source)
        defer { try? handle.close() }
        guard try handle.read(upToCount:4) == Data("GGUF".utf8) else { throw ExchangeError.invalid("GGUFファイルではありません") }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let pending = directory.appendingPathComponent(UUID().uuidString + ".part")
        defer { try? FileManager.default.removeItem(at:pending) }
        try FileManager.default.copyItem(at:source,to:pending)
        guard rename(pending.path,target.path) == 0 else { throw POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
    }
}

enum SharedGenerationContext {
    static func fields(source: OrderedJSON, chat: OrderedJSON, config: OrderedJSON, path: [String], boundary: inout SharedWebProjection) throws -> [JSONField] {
        let store = try boundary.store(source["contentStore"] ?? .object([]))
        var contextChat = chat
        if chat["branchTree"] == nil {
            let messages = try chat.required("messages").array("messages").map { message in
                OrderedJSON.object([.init(key:"role",value:try message.required("role")),.init(key:"content",value:try boundary.parts(message.required("content")))])
            }
            contextChat = contextChat.replacing("messages",with:.array(messages))
        }
        return [.init(key:"contentStore",value:store),.init(key:"chat",value:contextChat),.init(key:"config",value:config),
            .init(key:"activePath",value:.array(path.map(OrderedJSON.string))),.init(key:"omittedNodes",value:chat["omittedNodes"] ?? .object([]))]
    }
}

struct LocalGenerationRequest {
    let engine: LocalLlamaRequest
    let input: OrderedJSON
    static func make(source: OrderedJSON, chat: OrderedJSON, config: OrderedJSON, path: [String]) throws -> Self {
        var boundary = SharedWebProjection()
        let projected = try boundary.requestConfig(config)
        let fields = try SharedGenerationContext.fields(source:source,chat:chat,config:projected,path:path,boundary:&boundary)
        let projectedInput = try SharedWebOperations.call("localGenerationInput",.object(fields))
        let input = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:projectedInput)])]),to:.null,opaque:boundary.opaque)
        let options = try input.required("options")
        let maxTokens = try options.required("maxTokens").number("max tokens")
        let temperature = try options.required("temperature").number("temperature")
        guard maxTokens.isFinite, maxTokens >= 0, maxTokens.rounded() == maxTokens, maxTokens <= Double(Int32.max),
              temperature.isFinite, abs(temperature) <= Double(Float.greatestFiniteMagnitude) else {
            throw ExchangeError.invalid("ローカル生成のtoken数またはtemperatureが不正です")
        }
        let messages = try input.required("messages").array("messages").map {
            try LocalLlamaMessage(role:$0.required("role").string("role"),content:$0.required("content").string("content"))
        }
        return try Self(engine:LocalLlamaRequest(messages:messages,assistantPrefix:input["assistantPrefix"]?.string("prefix"),maxTokens:Int(maxTokens),temperature:Float(temperature),contextSize:nil,fallbackPrompt:input.required("fallbackPrompt").string("prompt")),input:input)
    }
}
