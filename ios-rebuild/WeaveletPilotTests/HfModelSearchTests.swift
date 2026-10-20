import XCTest
import Combine
@testable import WeaveletPilot

private final class HfSearchProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (status: Int, headers: [String: String], body: Data))?
    static var held: HfSearchProtocol?
    static var holdSearch = false
    static var onHeld: (() -> Void)?

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "huggingface.co" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if Self.holdSearch, request.url?.query?.contains("search=old") == true { Self.held = self; Self.onHeld?(); return }
        respond()
    }
    override func stopLoading() {}
    static func releaseHeld() { let held = held; self.held = nil; held?.respond() }
    private func respond() {
        do {
            let response = try Self.handler?(request) ?? (status: 500, headers: [:], body: Data())
            let http = HTTPURLResponse(url: request.url!, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: response.headers)!
            client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.body)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
}

@MainActor final class HfModelSearchTests: XCTestCase {
    private func client() -> HfModelSearchClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HfSearchProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock { session.invalidateAndCancel(); HfSearchProtocol.handler = nil; HfSearchProtocol.held = nil; HfSearchProtocol.holdSearch = false; HfSearchProtocol.onHeld = nil }
        return HfModelSearchClient(session: session)
    }

    func testOnlyHuggingFaceModelAPIURLsAreAccepted() throws {
        XCTAssertEqual(try HfModelSearchClient.validatedURL("https://huggingface.co/api/models?search=smollm", kind:.search).host, "huggingface.co")
        XCTAssertEqual(try HfModelSearchClient.validatedURL("https://huggingface.co/api/models/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF?blobs=true", kind:.repository).path, "/api/models/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF")
        for text in [
            "http://huggingface.co/api/models",
            "https://evil.example/api/models",
            "https://huggingface.co/api/models/owner/repo",
            "https://user@huggingface.co/api/models",
        ] {
            XCTAssertThrowsError(try HfModelSearchClient.validatedURL(text, kind:.search), text)
        }
    }

    func testSearchUsesSharedParametersAndRejectsStaleResponse() async throws {
        let oldRequest = expectation(description: "old request")
        let newRequest = expectation(description: "new request")
        let publishedNewResult = expectation(description: "new result")
        let stalePublished = expectation(description: "stale result")
        stalePublished.isInverted = true
        HfSearchProtocol.holdSearch = true; HfSearchProtocol.onHeld = { oldRequest.fulfill() }
        HfSearchProtocol.handler = { request in
            guard let components = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false) else { throw URLError(.badURL) }
            XCTAssertEqual(components.path, "/api/models")
            let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(query["sort"], "downloads")
            XCTAssertEqual(query["direction"], "-1")
            XCTAssertEqual(query["filter"], "gguf")
            let name = query["search"] ?? ""
            if name == "new" { newRequest.fulfill() }
            let body = #"[{"id":"owner/\#(name)-GGUF","tags":["gguf"],"downloads":2}]"#
            return (200, ["Content-Type": "application/json"], Data(body.utf8))
        }
        let search = HfModelSearch(client: client())
        let observer = search.$results.dropFirst().sink { results in
            let id = try? results.first?.required("repoId").string("repo ID")
            if id?.utf8.elementsEqual("owner/new-GGUF".utf8) == true { publishedNewResult.fulfill() }
            if id?.utf8.elementsEqual("owner/old-GGUF".utf8) == true { stalePublished.fulfill() }
        }
        defer { observer.cancel() }
        search.query = "old"; search.engine = "wllama"; search.sort = "downloads"; search.search()
        await fulfillment(of: [oldRequest], timeout: 2)
        search.query = "new" // Input mutation itself invalidates the delayed old request.
        search.search()
        await fulfillment(of: [newRequest, publishedNewResult], timeout: 2)
        HfSearchProtocol.releaseHeld()
        await fulfillment(of: [stalePublished], timeout: 0.1)
        XCTAssertEqual(try search.results.first?.required("repoId").string("repo ID"), "owner/new-GGUF")
    }

    func testEmptyResponsesAndHTTPFailurePreserveBoundaryMeaning() async throws {
        let client = client()
        let query = try OrderedJSON.decode(Data(#"{"query":"missing","engine":"wllama","sort":"downloads","sortDir":"desc"}"#.utf8))
        HfSearchProtocol.handler = { request in
            let body = request.url?.path == "/api/models" ? "[]" : #"{"siblings":[]}"#
            return (200, [:], Data(body.utf8))
        }
        let page = try await client.search(query: query)
        XCTAssertTrue(page.results.isEmpty)
        XCTAssertNil(page.nextPageURL)
        let variants = try await client.variants(repoID: "owner/empty")
        XCTAssertNotNil(variants)
        XCTAssertTrue(variants?.variants.isEmpty == true)
        XCTAssertNil(variants?.recommendedFile)
        HfSearchProtocol.handler = { _ in (503, [:], Data("private server detail".utf8)) }
        do {
            _ = try await client.search(query: query)
            XCTFail("HTTP failure must not become a successful empty page")
        } catch {
            XCTAssertFalse(error.localizedDescription.contains("private server detail"))
        }
    }

    func testRepositoryPlanRejectsSearchAndRedirectURLs() {
        XCTAssertThrowsError(try HfModelSearchClient.validatedURL("https://huggingface.co/api/models", kind:.repository))
        XCTAssertThrowsError(try HfModelSearchClient.validatedURL("https://huggingface.co/owner/repo/resolve/main/model.gguf", kind:.repository))
        XCTAssertThrowsError(try HfModelSearchClient.validatedURL("https://huggingface.co:444/api/models/owner/repo", kind:.repository))
    }
}
