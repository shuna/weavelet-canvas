import Foundation
import UniformTypeIdentifiers

enum ChatExport {
    enum Format: String, CaseIterable, Identifiable {
        case v3, v1, openAI = "openai", openRouter = "openrouter", lmStudio = "lmstudio", markdown
        var id: String { rawValue }
        var label: String {
            switch self { case .v3: return "V3"; case .v1: return "V1"; case .openAI: return "OpenAI"; case .openRouter: return "OpenRouter"; case .lmStudio: return "LM Studio"; case .markdown: return "Markdown" }
        }
        var scopes: [Scope] {
            switch self { case .v1: return [.all]; case .openRouter: return [.all, .chat]; case .markdown: return [.chat, .branch]; default: return [.all, .chat, .branch] }
        }
    }
    enum Scope: String, CaseIterable, Identifiable {
        case all, chat, branch
        var id: String { rawValue }
        var label: String { switch self { case .all: return "全件"; case .chat: return "選択した会話"; case .branch: return "選択した会話の表示枝" } }
    }
    struct Artifact {
        let data: Data
        let filename: String
        let contentType: UTType
    }
    static func make(v3: OrderedJSON, format: Format, scope: Scope, chatID: String?, visiblePath: [String]?, compressed: Bool) throws -> Artifact {
        var boundary = SharedWebProjection()
        let projected = try OrderedJSON.object(v3.object("V3").map { field -> JSONField in
            let value: OrderedJSON
            if field.key == "version" { value = field.value }
            else if field.key == "chats", case .array(let chats) = field.value {
                value = .array(try chats.map { chat in
                    var result = try boundary.chat(chat)
                    if let configuration = chat["config"], let model = configuration["model"] {
                        result = result.replacing("config", with: try result.required("config").replacing("model", with: model))
                    }
                    if let targets = chat["summaryTargets"] { result = result.replacing("summaryTargets", with: targets) }
                    if let summaries = chat["summaries"] {
                        if summaries == .null { result = result.replacing("summaries", with: .null) }
                        else {
                            let projectedSummaries = try summaries.array("summaries").map { summary -> OrderedJSON in
                                let sources = try summary.required("sources").array("sources").map { source -> OrderedJSON in
                                    .object(try source.object("summary source").map { field in
                                        .init(key:field.key,value:field.key == "nodeId" || field.key == "parentId" ? field.value : try boundary.reference(field.value))
                                    })
                                }
                                return .object(try summary.object("summary").map { field in
                                    .init(key:field.key,value:field.key == "sources" ? .array(sources) : try boundary.reference(field.value))
                                })
                            }
                            result = result.replacing("summaries", with: .array(projectedSummaries))
                        }
                    }
                    return result
                })
            } else if field.key == "contentStore", case .object = field.value { value = try boundary.store(field.value, strict: true) }
            else if field.key == "evaluationResults", case .object = field.value { value = .object(try field.value.object("evaluationResults").map { .init(key:$0.key,value:try boundary.reference($0.value)) }) }
            else { value = try boundary.reference(field.value) }
            return .init(key:field.key,value:value)
        })
        let input = OrderedJSON.object([.init(key:"v3",value:projected),.init(key:"format",value:.string(format.rawValue)),
            .init(key:"scope",value:.string(scope == .all ? "all" : "chat")),.init(key:"chatId",value:chatID.map(OrderedJSON.string) ?? .null),
            .init(key:"visibleBranchOnly",value:.bool(scope == .branch)),.init(key:"visiblePath",value:visiblePath.map { .array($0.map(OrderedJSON.string)) } ?? .null)])
        let output = try SharedWebOperations.call("fileExport", input)
        let raw: Data
        if let changes = output["payloadChanges"] {
            raw = try OrderedJSONChanges.apply(changes, to: v3, opaque: boundary.opaque).encoded()
        } else if output["mimeType"] == .string("text/markdown") {
            // Web Blob converts text to Unicode scalar values; JSON payloads above retain their code units.
            raw = Data(try output.required("payload").displayString("Markdown").utf8)
        } else {
            let payload = try OrderedJSONChanges.apply(.array([.object([.init(key:"op",value:.string("set")),.init(key:"path",value:.array([])),.init(key:"value",value:output.required("payload"))])]), to: .null, opaque: boundary.opaque)
            raw = try payload.encoded()
        }
        let ext = try output.required("extension").string("extension")
        guard ext == "json" || ext == "md" else { throw ExchangeError.invalid("export extension") }
        let data = try compressed ? NativeGzip.compress(raw) : raw
        return Artifact(data:data,filename:"weavelet-\(format.rawValue)-\(scope.rawValue).\(ext)" + (compressed ? ".gz" : ""),
                        contentType:compressed ? .gzip : ext == "json" ? .json : UTType(filenameExtension:"md") ?? .plainText)
    }
}
