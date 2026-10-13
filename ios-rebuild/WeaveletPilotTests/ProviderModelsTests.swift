import XCTest
@testable import WeaveletPilot

private final class ProviderModelProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var status = 200
    static var delay: Double = 0
    static var payload = Data(#"{"data":[{"id":"fake-model","name":"Fake model","context_length":8000}]}"#.utf8)
    private var stopped = false
    private let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(url:request.url!,statusCode:Self.status,httpVersion:nil,headerFields:nil)!, payload = Self.payload
        DispatchQueue.global().asyncAfter(deadline:.now() + Self.delay) { [weak self] in
            guard let self else { return }
            self.lock.lock(); let stopped = self.stopped; self.lock.unlock(); guard !stopped else { return }
            self.client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
            self.client?.urlProtocol(self,didLoad:payload); self.client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}
final class ProviderModelsTests: XCTestCase {
    private func client() -> ProviderModelClient {
        ProviderModelProtocol.requests = []; ProviderModelProtocol.status = 200; ProviderModelProtocol.delay = 0
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ProviderModelProtocol.self]
        return ProviderModelClient(session:URLSession(configuration:configuration))
    }
    private var auth: ProviderDescriptor { .init(id:"openai",name:"FAKE OpenAI",endpoint:"https://fixture.invalid/v1/chat/completions",modelsEndpoint:"https://fixture.invalid/v1/models",modelsRequireAuth:true) }
    private func record(_ key: String = "FAKE-bound") -> RemoteCredentialRecord { .init(settings:RemoteSettings(endpoint:auth.endpoint,model:"fake-model",stream:false),key:key) }
    private func requested() async throws {
        for _ in 0..<100 { if !ProviderModelProtocol.requests.isEmpty { return }; try await Task.sleep(nanoseconds:1_000_000) }
        XCTFail("request not started")
    }
    func testProviderCredentialRoutingPublicModelsAndAuthenticationOriginRefusal() async throws {
        let client = client(), bound = record(), legacy = record("FAKE-other-provider")
        let row = OrderedJSON.object([.init(key:"id",value:.string(auth.id)),.init(key:"name",value:.string(auth.name)),.init(key:"endpoint",value:.string(auth.endpoint)),.init(key:"modelsEndpoint",value:.string(auth.modelsEndpoint!)),.init(key:"modelsRequireAuth",value:.bool(true)),.init(key:"apiKey",value:.string("FAKE-snapshot-unused"))])
        let state = OrderedJSON.object([.init(key:"providers",value:.object([.init(key:auth.id,value:row)]))]), before = try state.encoded()
        var readIDs: [String] = []
        let resolved = try ProviderModels.generationCredential(config:.object([.init(key:"providerId",value:.string(auth.id))]),state:state,legacy:legacy,read:{ readIDs.append($0); return bound })
        XCTAssertEqual(resolved.key,"FAKE-bound"); XCTAssertEqual(readIDs,["openai"])
        let models = try await client.fetch(auth,readCredential:{ _ in bound })
        XCTAssertEqual(try models.array("models")[0]["providerId"],.string("openai"))
        XCTAssertEqual(ProviderModelProtocol.requests.last?.value(forHTTPHeaderField:"Authorization"),"Bearer FAKE-bound")
        let publicProvider = ProviderDescriptor(id:"openrouter",name:"public",endpoint:auth.endpoint,modelsEndpoint:"https://public.invalid/models",modelsRequireAuth:false)
        _ = try await client.fetch(publicProvider,readCredential:{ _ in XCTFail("public models read a key"); return nil })
        XCTAssertNil(ProviderModelProtocol.requests.last?.value(forHTTPHeaderField:"Authorization"))
        let count = ProviderModelProtocol.requests.count
        let crossOrigin = ProviderDescriptor(id:auth.id,name:auth.name,endpoint:auth.endpoint,modelsEndpoint:"https://other.invalid/models",modelsRequireAuth:true)
        do { _ = try await client.fetch(crossOrigin,readCredential:{ _ in XCTFail("foreign origin read a key"); return bound }); XCTFail("foreign host accepted") } catch {}
        var wrong = bound; wrong.settings.endpoint = "https://other.invalid/v1/chat/completions"
        XCTAssertThrowsError(try ProviderModels.credential(auth,read:{ _ in wrong }))
        XCTAssertEqual(ProviderModelProtocol.requests.count,count)
        var stored: RemoteCredentialRecord?
        XCTAssertThrowsError(try ProviderModels.saveCredential(bound,provider:auth,write:{ _,_ in throw CocoaError(.fileWriteNoPermission) }))
        XCTAssertNil(stored)
        try ProviderModels.saveCredential(bound,provider:auth,write:{ value,id in XCTAssertEqual(id,"openai"); stored = value })
        XCTAssertEqual(stored,bound); XCTAssertEqual(try state.encoded(),before)
        XCTAssertEqual(try ProviderModels.generationCredential(config:.object([]),state:state,legacy:legacy,read:{ _ in XCTFail("legacy read provider key"); return nil }),legacy)
    }
    @MainActor func testModelCacheAtomicFailureCancellationStaleAndEditingConfigRetention() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("provider-cache-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:directory) }
        var failSave = false
        let local = LocalStateStore(fileURL:directory.appendingPathComponent("state.json")) { bytes,url in
            if failSave { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to:url,options:.atomic)
        }
        let state = ChatState(store:local)
        let v3 = try OrderedJSON.decode(Data(#"{"version":3,"chats":[{"id":"chat","title":"Fixture","config":{"model":"fake-model","providerId":"openai","stream":false},"messages":[]}],"contentStore":{},"folders":{}}"#.utf8))
        try state.importWebData(v3.encoded())
        let raw = OrderedJSON.object([.init(key:"huge",value:.number("9007199254740993")),.init(key:"decimal",value:.number("1.2300"))])
        let provider = OrderedJSON.object([.init(key:"id",value:.string(auth.id)),.init(key:"name",value:.string(auth.name)),.init(key:"endpoint",value:.string(auth.endpoint)),.init(key:"modelsEndpoint",value:.string(auth.modelsEndpoint!)),.init(key:"modelsRequireAuth",value:.bool(true))])
        let favorite = OrderedJSON.object([.init(key:"modelId",value:.string("fake-model")),.init(key:"providerId",value:.string("openai")),.init(key:"xRaw",value:raw)])
        let version = try state.publicationSnapshot().required("version")
        try state.applySnapshot(.object([.init(key:"version",value:version),.init(key:"state",value:.object([.init(key:"providers",value:.object([.init(key:"openai",value:provider)])),.init(key:"favoriteModels",value:.array([favorite])),.init(key:"providerModelCache",value:.object([.init(key:"other",value:.array([raw]))])),.init(key:"xUnrelated",value:raw)]))]))
        let transport = client(), bound = record()
        var draft = try state.chatConfigDraft(); draft.config = draft.config.replacing("temperature",with:.number("0.3000"))
        let refreshed = try await state.refreshModelsForConfig(draft,providerID:"openai",client:transport,readCredential:{ _ in bound })
        XCTAssertEqual(try refreshed.config.encoded(),try draft.config.encoded())
        let current = try state.publicationSnapshot(), roots = try current.required("state")
        XCTAssertEqual(try roots.required("xUnrelated").encoded(),try raw.encoded())
        XCTAssertEqual(try roots.required("favoriteModels").array("favorites")[0].required("xRaw").encoded(),try raw.encoded())
        XCTAssertEqual(try roots.required("providerModelCache").required("other").array("cache")[0].encoded(),try raw.encoded())
        try state.saveChatConfig(refreshed)
        let saved = try state.publicationSnapshot(), disk = try Data(contentsOf:local.fileURL)
        failSave = true
        do { try await state.refreshProviderModels(providerID:"openai",expectedSnapshot:saved,client:transport,readCredential:{ _ in bound }); XCTFail("failed save published") } catch {}
        failSave = false; XCTAssertEqual(try state.publicationSnapshot().encoded(),try saved.encoded()); XCTAssertEqual(try Data(contentsOf:local.fileURL),disk)
        ProviderModelProtocol.status = 500
        do { try await state.refreshProviderModels(providerID:"openai",expectedSnapshot:saved,client:transport,readCredential:{ _ in bound }); XCTFail("HTTP error published") } catch {}
        XCTAssertEqual(try state.publicationSnapshot().encoded(),try saved.encoded())
        ProviderModelProtocol.status = 200; ProviderModelProtocol.delay = 0.1; ProviderModelProtocol.requests = []
        let cancelled = Task { try await state.refreshProviderModels(providerID:"openai",expectedSnapshot:saved,client:transport,readCredential:{ _ in bound }) }
        try await requested(); cancelled.cancel(); do { try await cancelled.value; XCTFail("cancel published") } catch {}
        XCTAssertEqual(try state.publicationSnapshot().encoded(),try saved.encoded())
        ProviderModelProtocol.requests = []
        let stale = Task { try await state.refreshProviderModels(providerID:"openai",expectedSnapshot:saved,client:transport,readCredential:{ _ in bound }) }
        try await requested()
        try state.applySnapshot(.object([.init(key:"version",value:version),.init(key:"state",value:.object([.init(key:"xDuringFetch",value:raw)]))]))
        let edited = try state.publicationSnapshot().encoded()
        do { try await stale.value; XCTFail("stale response published") } catch {}
        XCTAssertEqual(try state.publicationSnapshot().encoded(),edited)
    }
}
