import Foundation

struct ProviderDescriptor: Identifiable {
    let id: String
    let name: String
    let endpoint: String
    let modelsEndpoint: String?
    let modelsRequireAuth: Bool
}
struct ProviderModelRow: Identifiable {
    let modelID: String
    let providerID: String
    let name: String
    var id: Data { Data((providerID + "\u{0}" + modelID).utf8) }
}

struct ProviderModelClient {
    let session: URLSession
    private let ownsSession: Bool
    init(session: URLSession? = nil) {
        if let session { self.session = session; ownsSession = false }
        else {
            ownsSession = true
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
            self.session = URLSession(configuration:config,delegate:RemoteRedirectPolicy(),delegateQueue:nil)
        }
    }
    func fetch(_ provider: ProviderDescriptor, readCredential: ProviderModels.CredentialReader) async throws -> OrderedJSON {
        defer { if ownsSession { session.finishTasksAndInvalidate() } }
        guard let endpoint = provider.modelsEndpoint else { throw ExchangeError.invalid("このproviderにモデル一覧endpointがありません") }
        let url = try ProviderModels.url(endpoint)
        var request = URLRequest(url:url); request.httpMethod = "GET"; request.timeoutInterval = 60
        if provider.modelsRequireAuth {
            guard ProviderModels.sameOrigin(url,try ProviderModels.url(provider.endpoint)) else { throw ExchangeError.invalid("認証付きモデル一覧は完了APIと同じoriginだけ取得できます") }
            let record = try ProviderModels.credential(provider,read:readCredential)
            guard !record.key.isEmpty else { throw ExchangeError.invalid("このproviderのAPI keyを設定してください") }
            request.setValue("Bearer " + record.key,forHTTPHeaderField:"Authorization")
        }
        let (data,response) = try await session.data(for:request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw ExchangeError.invalid("モデル一覧を取得できませんでした") }
        return try SharedWebOperations.call("providerModelList",.object([.init(key:"providerId",value:.string(provider.id)),.init(key:"data",value:OrderedJSON.decode(data))])).required("models")
    }
}

enum ProviderModels {
    typealias CredentialReader = (String) throws -> RemoteCredentialRecord?
    typealias CredentialWriter = (RemoteCredentialRecord,String) throws -> Void
    static func url(_ text: String) throws -> URL { try RemoteSettings(endpoint:text).validatedURL() }
    static func sameOrigin(_ a: URL, _ b: URL) -> Bool { a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased() && (a.port ?? 443) == (b.port ?? 443) }
    static func providers(in state: OrderedJSON) throws -> [ProviderDescriptor] {
        let root = try state["providers"] ?? ChatImport.call("defaults").required("providers")
        return try root.object("providers").map { field in
            let value = field.value, id = try value.required("id").string("provider ID")
            guard field.key.matches(id) else { throw ExchangeError.invalid("provider IDが一致しません") }
            return try ProviderDescriptor(id:id,name:value.required("name").string("provider name"),endpoint:value.required("endpoint").string("endpoint"),modelsEndpoint:value["modelsEndpoint"]?.string("models endpoint"),modelsRequireAuth:value.required("modelsRequireAuth").boolean("models auth"))
        }
    }
    static func credential(_ provider: ProviderDescriptor, read: CredentialReader) throws -> RemoteCredentialRecord {
        guard let record = try read(provider.id) else { throw ExchangeError.invalid("このproviderの端末認証設定がありません") }
        guard try record.settings.validatedURL().absoluteString.utf8.elementsEqual(url(provider.endpoint).absoluteString.utf8) else { throw ExchangeError.invalid("providerの完了API endpointが変更されています。端末認証設定を保存し直してください") }
        return record
    }
    static func generationCredential(config: OrderedJSON, state: OrderedJSON, legacy: RemoteCredentialRecord, read: CredentialReader) throws -> RemoteCredentialRecord {
        guard let id = try config["providerId"]?.string("provider ID"), !id.isEmpty else { return legacy }
        guard !id.utf8.elementsEqual("cohere".utf8) else { throw ExchangeError.invalid("Cohere固有の生成形式は未対応です") }
        guard let provider = try providers(in:state).first(where: { $0.id.utf8.elementsEqual(id.utf8) }) else { throw ExchangeError.invalid("選択したprovider設定がありません") }
        return try credential(provider,read:read)
    }
    static func saveCredential(_ record: RemoteCredentialRecord, provider: ProviderDescriptor, write: CredentialWriter) throws {
        guard try record.settings.validatedURL().absoluteString.utf8.elementsEqual(url(provider.endpoint).absoluteString.utf8) else { throw ExchangeError.invalid("選択したproviderのendpointを使用してください") }
        try write(record,provider.id)
    }
    static func rows(_ value: OrderedJSON?, providerID: String? = nil) throws -> [ProviderModelRow] {
        guard let value else { return [] }
        return try value.array("models").compactMap { item in
            let provider = try item.required("providerId").string("provider ID")
            if let providerID, !provider.utf8.elementsEqual(providerID.utf8) { return nil }
            let id = try (item["modelId"] ?? item.required("id")).string("model ID")
            return try ProviderModelRow(modelID:id,providerID:provider,name:item["name"]?.string("model name") ?? id)
        }
    }
    static func cacheChanges(state: OrderedJSON, providerID: String, models: OrderedJSON) throws -> OrderedJSON {
        var boundary = SharedWebProjection(), cache: [JSONField] = [], favorites: [OrderedJSON] = []
        for field in try state["providerModelCache"]?.object("cache") ?? [] { cache.append(.init(key:field.key,value:try boundary.reference(field.value))) }
        let known = ["modelId","providerId","contextLength","maxCompletionTokens","promptPrice","completionPrice","modelType","streamSupport","supportsReasoning","reasoningMandatory","supportsVision","supportsAudio"]
        for item in try state["favoriteModels"]?.array("favorites") ?? [] {
            favorites.append(.object(try item.object("favorite").map { .init(key:$0.key,value:known.contains(where: $0.key.matches) ? $0.value : try boundary.reference($0.value)) }))
        }
        let base = OrderedJSON.object(try state.object("state").filter { $0.key == "providerModelCache" || $0.key == "favoriteModels" })
        var projectedState: [JSONField] = []
        if state["providerModelCache"] != nil { projectedState.append(.init(key:"providerModelCache",value:.object(cache))) }
        if state["favoriteModels"] != nil { projectedState.append(.init(key:"favoriteModels",value:.array(favorites))) }
        let input = OrderedJSON.object([.init(key:"operation",value:.string("cache")),.init(key:"state",value:.object(projectedState)),.init(key:"providerId",value:.string(providerID)),.init(key:"models",value:models)])
        let changes = try SharedWebOperations.call("providerModelList",input).required("changes")
        return try OrderedJSONChanges.apply(changes,to:base,opaque:boundary.opaque)
    }
}
