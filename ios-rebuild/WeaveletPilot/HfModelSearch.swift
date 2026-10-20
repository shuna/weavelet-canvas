import Foundation
import Combine

struct HfModelSearchPage {
    let results: [OrderedJSON]
    let nextPageURL: String?
}

struct HfModelVariants {
    let variants: [OrderedJSON]
    let recommendedFile: String?
    let lastModified: String?
}

final class HfModelSearchClient {
    private let session: URLSession
    private let ownsSession: Bool

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
            ownsSession = false
        } else {
            ownsSession = true
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = false
            configuration.httpCookieStorage = nil
            configuration.urlCredentialStorage = nil
            self.session = URLSession(configuration: configuration, delegate: RemoteRedirectPolicy(), delegateQueue: nil)
        }
    }

    deinit {
        if ownsSession { session.finishTasksAndInvalidate() }
    }

    static func validatedURL(_ text: String, kind: Kind) throws -> URL {
        guard let url = URL(string: text), let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https", components.host?.lowercased() == "huggingface.co",
              components.port == nil || components.port == 443, components.user == nil, components.password == nil,
              components.fragment == nil else {
            throw ExchangeError.invalid("Hugging Face の取得先が不正です")
        }
        let path = components.percentEncodedPath
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard parts.first == "api", parts.dropFirst().first == "models" else {
            throw ExchangeError.invalid("Hugging Face API の取得先が不正です")
        }
        switch kind {
        case .search:
            guard parts.count == 2 else { throw ExchangeError.invalid("Hugging Face 検索の取得先が不正です") }
        case .repository:
            guard parts.count == 4, !parts[2].isEmpty, !parts[3].isEmpty else {
                throw ExchangeError.invalid("Hugging Face リポジトリの取得先が不正です")
            }
        }
        return url
    }

    enum Kind { case search, repository }

    private func request(plan: OrderedJSON, kind: Kind) throws -> URLRequest? {
        if plan["empty"] == .bool(true) { return nil }
        let text = try plan.required("url").string("Hugging Face URL")
        let validated = try Self.validatedURL(text, kind: kind)
        guard var components = URLComponents(url: validated, resolvingAgainstBaseURL: false) else {
            throw ExchangeError.invalid("Hugging Face URL を処理できません")
        }
        var items = components.queryItems ?? []
        if let parameters = plan["parameters"] {
            for parameter in try parameters.array("Hugging Face parameters") {
                let pair = try parameter.array("Hugging Face parameter")
                guard pair.count == 2 else { throw ExchangeError.invalid("Hugging Face parameter が不正です") }
                items.append(.init(name: try pair[0].string("parameter key"), value: try pair[1].string("parameter value")))
            }
        }
        components.queryItems = items.isEmpty ? nil : items
        guard let url = components.url else { throw ExchangeError.invalid("Hugging Face URL を処理できません") }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func data(for request: URLRequest) async throws -> (data: Data, response: HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw ExchangeError.invalid("Hugging Face の応答を取得できませんでした")
        }
        return (data, response)
    }

    private static func nullableString(_ value: OrderedJSON?, field: String) throws -> String? {
        guard let value, value != .null else { return nil }
        return try value.string(field)
    }

    func search(query: OrderedJSON, sortResults: Bool = true) async throws -> HfModelSearchPage {
        let plan = try SharedWebOperations.call("hfSearchOperation", .object([
            .init(key: "operation", value: .string("searchPlan")), .init(key: "query", value: query),
        ]))
        guard let request = try request(plan: plan, kind: .search) else { return .init(results: [], nextPageURL: nil) }
        let response = try await data(for: request)
        let parsed = try OrderedJSON.decode(response.data)
        let link = response.response.value(forHTTPHeaderField: "Link").map(OrderedJSON.string) ?? .null
        let output = try SharedWebOperations.call("hfSearchOperation", .object([
            .init(key: "operation", value: .string("searchResponse")), .init(key: "query", value: query),
            .init(key: "data", value: parsed), .init(key: "link", value: link),
        ]))
        let next = try Self.nullableString(output["nextPageUrl"], field: "next page URL")
        if let next { _ = try Self.validatedURL(next, kind: .search) }
        let results = try output.required("results").array("Hugging Face results")
        guard sortResults else { return .init(results: results, nextPageURL: next) }
        let sort = try query.required("sort"), sortDirection = try query.required("sortDir")
        let sorted = try SharedWebOperations.call("hfSearchOperation", .object([
            .init(key: "operation", value: .string("sortResults")), .init(key: "results", value: .array(results)),
            .init(key: "sort", value: sort), .init(key: "sortDir", value: sortDirection),
        ])).array("sorted Hugging Face results")
        return .init(results: sorted, nextPageURL: next)
    }

    func variants(repoID: String) async throws -> HfModelVariants? {
        let plan = try SharedWebOperations.call("hfSearchOperation", .object([
            .init(key: "operation", value: .string("repoPlan")), .init(key: "repoID", value: .string(repoID)),
        ]))
        guard let request = try request(plan: plan, kind: .repository) else { return nil }
        let response = try await data(for: request)
        let output = try SharedWebOperations.call("hfSearchOperation", .object([
            .init(key: "operation", value: .string("variants")), .init(key: "data", value: try OrderedJSON.decode(response.data)),
        ]))
        guard output != .null else { return nil }
        return try .init(variants: output.required("variants").array("GGUF variants"),
                         recommendedFile: try Self.nullableString(output["recommendedFile"], field: "recommended GGUF"),
                         lastModified: try Self.nullableString(output["lastModified"], field: "repository date"))
    }

}

@MainActor final class HfModelSearch: ObservableObject {
    @Published var query = "" { didSet { invalidateSearch() } }
    @Published var engine = "all" { didSet { invalidateSearch() } }
    @Published var sort = "lastModified" { didSet { invalidateSearch() } }
    @Published var sortDirection = "desc" { didSet { invalidateSearch() } }
    @Published private(set) var results: [OrderedJSON] = []
    @Published private(set) var variantsByRepository: [Data: HfModelVariants] = [:]
    @Published private(set) var selectedFiles: [Data: String] = [:]
    @Published private(set) var variantFailures: Set<Data> = []
    @Published private(set) var searching = false
    @Published private(set) var loadingMore = false
    @Published private(set) var error: String?
    @Published private(set) var nextPageURL: String?

    private let client: HfModelSearchClient
    private var searchToken = UUID()
    private var searchTask: Task<Void, Never>?
    private var loadMoreTask: Task<Void, Never>?
    private var variantTasks: [Data: Task<Void, Never>] = [:]

    init(client: HfModelSearchClient = .init()) { self.client = client }
    deinit { searchTask?.cancel(); loadMoreTask?.cancel(); variantTasks.values.forEach { $0.cancel() } }

    private func invalidateSearch() {
        searchTask?.cancel(); loadMoreTask?.cancel(); variantTasks.values.forEach { $0.cancel() }
        searchToken = UUID()
        results = []; variantsByRepository = [:]; selectedFiles = [:]; variantFailures = []
        nextPageURL = nil; error = nil; searching = false; loadingMore = false; variantTasks = [:]
    }

    func cancel() { invalidateSearch() }

    private func queryJSON(nextURL: String? = nil) -> OrderedJSON {
        var fields: [JSONField] = [
            .init(key: "query", value: .string(query.trimmingCharacters(in: .whitespacesAndNewlines))),
            .init(key: "engine", value: .string(engine)), .init(key: "sort", value: .string(sort)),
            .init(key: "sortDir", value: .string(sortDirection)),
        ]
        if let nextURL { fields.append(.init(key: "nextUrl", value: .string(nextURL))) }
        return .object(fields)
    }

    func search() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        invalidateSearch()
        guard !text.isEmpty else { return }
        let token = searchToken, request = queryJSON()
        searching = true
        searchTask = Task { [weak self, client] in
            do {
                let page = try await client.search(query: request)
                guard !Task.isCancelled, let self, self.searchToken == token else { return }
                self.results = page.results; self.nextPageURL = page.nextPageURL; self.searching = false
            } catch is CancellationError { }
            catch {
                guard let self, self.searchToken == token else { return }
                self.searching = false; self.error = error.localizedDescription
            }
        }
    }

    func loadMore() {
        guard !loadingMore, let nextPageURL else { return }
        let token = searchToken, request = queryJSON(nextURL: nextPageURL)
        loadingMore = true
        loadMoreTask = Task { [weak self, client] in
            do {
                let page = try await client.search(query: request, sortResults: false)
                guard !Task.isCancelled, let self, self.searchToken == token else { return }
                let existing = Set(self.results.compactMap { result -> Data? in
                    guard let id = try? result.required("repoId").string("repo ID") else { return nil }
                    return Data(id.utf8)
                })
                self.results += page.results.filter { result in
                    guard let id = try? result.required("repoId").string("repo ID") else { return false }
                    return !existing.contains(Data(id.utf8))
                }
                self.nextPageURL = page.nextPageURL; self.loadingMore = false; self.loadMoreTask = nil
            } catch is CancellationError { }
            catch {
                guard let self, self.searchToken == token else { return }
                self.loadingMore = false; self.error = error.localizedDescription; self.loadMoreTask = nil
            }
        }
    }

    func variants(for result: OrderedJSON) -> HfModelVariants? {
        guard let repository = try? result.required("repoId").string("repo ID") else { return nil }
        return variantsByRepository[Data(repository.utf8)]
    }

    func loadVariants(for result: OrderedJSON) {
        guard let repository = try? result.required("repoId").string("repo ID") else { return }
        let key = Data(repository.utf8)
        guard variantsByRepository[key] == nil, variantTasks[key] == nil else { return }
        let token = searchToken
        variantTasks[key] = Task { [weak self, client] in
            do {
                let variants = try await client.variants(repoID: repository)
                guard !Task.isCancelled, let self, self.searchToken == token else { return }
                self.variantTasks.removeValue(forKey: key)
                guard let variants else { self.variantFailures.insert(key); return }
                self.variantsByRepository[key] = variants
                if let preferred = variants.recommendedFile { self.selectedFiles[key] = preferred }
            } catch is CancellationError { }
            catch {
                guard let self, self.searchToken == token else { return }
                self.variantTasks.removeValue(forKey: key); self.variantFailures.insert(key)
            }
        }
    }

    func selectedVariant(for result: OrderedJSON) -> OrderedJSON? {
        guard let repository = try? result.required("repoId").string("repo ID"), let selected = selectedFiles[Data(repository.utf8)] else { return nil }
        return variants(for: result)?.variants.first { (try? $0.required("fileName").string("GGUF file"))?.utf8.elementsEqual(selected.utf8) == true }
    }

    func select(variant: OrderedJSON, for result: OrderedJSON) {
        guard let repository = try? result.required("repoId").string("repo ID"), let file = try? variant.required("fileName").string("GGUF file") else { return }
        selectedFiles[Data(repository.utf8)] = file
    }
}
