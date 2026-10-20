import XCTest
import AuthenticationServices
@testable import WeaveletPilot

@MainActor final class GoogleAuthenticationTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1000)
    private func config() throws -> GoogleAuthenticationConfiguration {
        try .init(clientID: "FAKE-ios.apps.googleusercontent.com", redirectScheme: "com.googleusercontent.apps.FAKE-ios")
    }
    private func old() -> GoogleAuthenticationCredential {
        .init(clientID: "FAKE-ios.apps.googleusercontent.com", accessToken: "FAKE OLD", refreshToken: "FAKE REFRESH", expiresAt: clock.addingTimeInterval(3600))
    }
    private func session(_ handler: @escaping (URLRequest) throws -> (Int, String)) -> URLSession {
        GoogleAuthURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [GoogleAuthURLProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock { session.invalidateAndCancel(); GoogleAuthURLProtocol.handler = nil; GoogleAuthURLProtocol.holdFirst = false; GoogleAuthURLProtocol.onHeld = nil; GoogleAuthURLProtocol.held = nil }
        return session
    }
    private func auth(_ storage: GoogleAuthTestStorage, browser: GoogleAuthTestBrowser? = nil, session: URLSession) throws -> GoogleAuthentication {
        let browser = browser ?? GoogleAuthTestBrowser()
        return try GoogleAuthentication(configuration: config(), session: session, storage: storage, now: { self.clock }, browserFactory: { _ in browser })
    }
    nonisolated private let response = "{\"access_token\":\"FAKE NEW\",\"refresh_token\":\"FAKE ROTATED\",\"expires_in\":3600,\"token_type\":\"Bearer\",\"scope\":\"https://www.googleapis.com/auth/drive.file\"}"
    nonisolated private func form(_ request: URLRequest) -> [String: String] {
        let body = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open(); defer { stream.close() }
            var data = Data(), buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            return data
        } ?? Data()
        let text = String(data: body, encoding: .utf8) ?? ""
        return Dictionary(uniqueKeysWithValues: text.split(separator: "&").map { item in
            let pair = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            return (String(pair[0]).removingPercentEncoding!, String(pair[1]).removingPercentEncoding!)
        })
    }
    func testPKCEAndOfflineScopeExchangePersistOneCredential() async throws {
        XCTAssertEqual(GoogleAuthentication.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let storage = GoogleAuthTestStorage(), browser = GoogleAuthTestBrowser()
        var exchangedVerifier = ""
        let auth = try auth(storage, browser: browser, session: session { request in
            XCTAssertEqual(request.url?.absoluteString, "https://oauth2.googleapis.com/token")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
            let values = self.form(request)
            exchangedVerifier = values["code_verifier"]!
            XCTAssertEqual(values["code"], "FAKE CODE&=+/?")
            XCTAssertEqual(values["grant_type"], "authorization_code")
            XCTAssertEqual(values["redirect_uri"], "com.googleusercontent.apps.FAKE-ios:/oauth2redirect")
            XCTAssertEqual(values["code_verifier"]?.count, 43)
            XCTAssertNil(values["client_secret"])
            return (200, self.response)
        })
        try await auth.signIn(presentationAnchor: ASPresentationAnchor())
        let params = browser.parameters
        XCTAssertEqual(GoogleAuthentication.challenge(exchangedVerifier), params["code_challenge"])
        XCTAssertEqual(params["scope"], GoogleAuthenticationConfiguration.scope)
        XCTAssertEqual(params["code_challenge_method"], "S256")
        XCTAssertEqual(params["access_type"], "offline")
        XCTAssertEqual(params["state"]?.count, 43)
        XCTAssertEqual(storage.writes, 1)
        XCTAssertEqual(storage.value?.refreshToken, "FAKE ROTATED")
        XCTAssertEqual(storage.value?.expiresAt, clock.addingTimeInterval(3600))
        let token = try await auth.token(force: false)
        XCTAssertEqual(token, "FAKE NEW")
    }
    func testMigrationAuthorizationIsEphemeralAndDoesNotReplaceSyncCredentials() async throws {
        let normal = GoogleAuthTestStorage(); normal.value = old()
        let browser = GoogleAuthTestBrowser(), memory = LegacyGoogleCredentialStorage()
        let source = try ChatImport.call("legacyGoogleSource")
        let scope = try source.required("scope").string("scope")
        let config = try GoogleAuthenticationConfiguration(clientID: old().clientID, redirectScheme: "com.googleusercontent.apps.FAKE-ios", requestedScope: scope)
        let response = self.response.replacingOccurrences(of: GoogleAuthenticationConfiguration.scope, with: scope)
        let isolated = session { _ in (200, response) }
        let auth = try GoogleAuthentication(configuration: config, session: isolated, storage: memory, now: { self.clock }, browserFactory: { _ in browser })
        try await auth.signIn(presentationAnchor: ASPresentationAnchor())
        XCTAssertEqual(browser.parameters["scope"], scope)
        let token = try await auth.token(force: false)
        XCTAssertEqual(token, "FAKE NEW")
        XCTAssertEqual(normal.value, old()); XCTAssertEqual(normal.writes, 0)
        XCTAssertNil(try LegacyGoogleCredentialStorage().load())
        try auth.disconnect()
        XCTAssertNil(try memory.load()); XCTAssertEqual(normal.value, old())
        let wrongScope = try GoogleAuthentication(configuration: config, session: session { _ in (200, self.response) }, storage: memory, browserFactory: { _ in browser })
        do { try await wrongScope.signIn(presentationAnchor: ASPresentationAnchor()); XCTFail("Missing migration scope accepted") }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .invalidResponse) }
        XCTAssertNil(try memory.load())
    }
    func testUnconfiguredDoesNotLoadCredentialsOrStartBrowser() async throws {
        let storage = GoogleAuthTestStorage(), browser = GoogleAuthTestBrowser()
        let auth = try GoogleAuthentication(storage: storage, browserFactory: { _ in browser })
        XCTAssertFalse(auth.isConfigured); XCTAssertEqual(storage.loads, 0)
        do { try await auth.signIn(presentationAnchor: ASPresentationAnchor()); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .configuration) }
        XCTAssertTrue(browser.parameters.isEmpty)
        XCTAssertThrowsError(try GoogleAuthenticationConfiguration(clientID: "FAKE-ios.apps.googleusercontent.com", redirectScheme: "wrong.scheme"))
    }
    func testCallbackRejectsWrongStateSchemePathAndDuplicateValuesWithoutExchange() async throws {
        for mutation in ["state", "scheme", "path", "duplicate-state", "duplicate-code", "fragment", "host", "error-with-code"] {
            let browser = GoogleAuthTestBrowser(); browser.mutation = mutation
            let storage = GoogleAuthTestStorage(); storage.value = old()
            let auth = try auth(storage, browser: browser, session: session { _ in XCTFail("Callback must not exchange"); return (500, "") })
            do { try await auth.signIn(presentationAnchor: ASPresentationAnchor()); XCTFail(mutation) } catch {}
            XCTAssertEqual(storage.value, old(), mutation); XCTAssertEqual(storage.writes, 0)
        }
    }
    func testConsentDenialAndCancelLeaveStoredCredential() async throws {
        let browser = GoogleAuthTestBrowser(); browser.mutation = "denied"
        let storage = GoogleAuthTestStorage(); storage.value = old()
        let auth = try auth(storage, browser: browser, session: session { _ in XCTFail(); return (500, "") })
        do { try await auth.signIn(presentationAnchor: ASPresentationAnchor()); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .cancelled) }
        browser.suspended = true
        let signIn = Task { try await auth.signIn(presentationAnchor: ASPresentationAnchor()) }
        while browser.pending == nil { await Task.yield() }
        auth.cancelSignIn()
        do { try await signIn.value; XCTFail() } catch {}
        XCTAssertEqual(browser.cancellations, 1); XCTAssertEqual(storage.value, old())
    }
    func testExpiryRefreshRotationAndRestartReusePersistedToken() async throws {
        let storage = GoogleAuthTestStorage()
        storage.value = .init(clientID: old().clientID, accessToken: old().accessToken, refreshToken: old().refreshToken, expiresAt: clock.addingTimeInterval(59))
        var calls = 0
        let session = session { request in
            calls += 1; XCTAssertEqual(self.form(request)["refresh_token"], "FAKE REFRESH")
            return (200, self.response)
        }
        let auth = try auth(storage, session: session)
        let token = try await auth.token(force: false)
        XCTAssertEqual(token, "FAKE NEW")
        XCTAssertEqual(storage.value?.refreshToken, "FAKE ROTATED")
        let restarted = try self.auth(storage, session: session)
        let restartedToken = try await restarted.token(force: false)
        XCTAssertEqual(restartedToken, "FAKE NEW")
        XCTAssertEqual(calls, 1)
    }
    func testRefreshWithoutRotationKeepsRefreshTokenAndConcurrentRequestsCoalesce() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old()
        var calls = 0
        let auth = try auth(storage, session: session { _ in calls += 1; return (200, "{\"access_token\":\"FAKE NEW\",\"expires_in\":3600,\"token_type\":\"Bearer\"}") })
        async let a = auth.token(force: true), b = auth.token(force: true)
        let values = try await [a, b]
        XCTAssertEqual(values, ["FAKE NEW", "FAKE NEW"])
        XCTAssertEqual(calls, 1); XCTAssertEqual(storage.value?.refreshToken, "FAKE REFRESH")
    }
    func testDrive401ForcesSingleRefreshAndRetriesWithNewBearer() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old()
        var tokens = 0, driveCalls = 0
        let session = session { request in
            if request.url?.host == "oauth2.googleapis.com" { tokens += 1; return (200, self.response) }
            driveCalls += 1
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer FAKE OLD" { return (401, "") }
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer FAKE NEW")
            return (200, "{\"startPageToken\":\"FAKE PAGE\"}")
        }
        let auth = try auth(storage, session: session)
        let drive = DriveTransport(session: session, token: { force in try await auth.token(force: force) })
        let page = try await drive.call("startToken", args: [])
        XCTAssertEqual(page, .string("FAKE PAGE")); XCTAssertEqual(tokens, 1); XCTAssertEqual(driveCalls, 2)
    }
    func testRefreshInvalidGrantClearsCredentialsAndRequiresReconnect() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old()
        let auth = try auth(storage, session: session { _ in (400, "{\"error\":\"invalid_grant\"}") })
        do { _ = try await auth.token(force: true); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .reconnectRequired) }
        XCTAssertNil(storage.value)
        do { _ = try await auth.token(force: false); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .reconnectRequired) }
    }
    func testInvalidTokenResponsesAndNetworkErrorsCannotCommit() async throws {
        for response in ["{\"access_token\":\"FAKE\",\"expires_in\":true,\"token_type\":\"Bearer\"}", "{\"access_token\":\"FAKE\",\"expires_in\":0,\"token_type\":\"Bearer\"}", "{\"access_token\":\"FAKE\",\"expires_in\":3600,\"token_type\":\"mac\"}", "{\"access_token\":\"FAKE\",\"expires_in\":3600,\"token_type\":\"Bearer\",\"scope\":\"openid\"}"] {
            let storage = GoogleAuthTestStorage(); storage.value = old()
            let auth = try auth(storage, session: session { _ in (200, response) })
            do { _ = try await auth.token(force: true); XCTFail() } catch {}
            XCTAssertEqual(storage.value, old()); XCTAssertEqual(storage.writes, 0)
        }
        let storage = GoogleAuthTestStorage(); storage.value = old()
        let auth = try auth(storage, session: session { _ in throw URLError(.notConnectedToInternet) })
        do { _ = try await auth.token(force: true); XCTFail() } catch {}
        XCTAssertEqual(storage.value, old())
    }
    func testSaveFailurePreservesOldRecordAndDoesNotReturnNewToken() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old(); storage.failSave = true
        let auth = try auth(storage, session: session { _ in (200, self.response) })
        do { _ = try await auth.token(force: true); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .keychain(-1)) }
        XCTAssertEqual(storage.value, old())
        let token = try await auth.token(force: false)
        XCTAssertEqual(token, "FAKE OLD")
    }
    func testReauthenticationCancelsPendingRefreshWithoutOverwritingNewCredential() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old()
        let held = expectation(description: "refresh request suspended")
        let isolated = session { _ in (200, self.response) }
        GoogleAuthURLProtocol.holdFirst = true; GoogleAuthURLProtocol.onHeld = { held.fulfill() }
        let auth = try auth(storage, session: isolated)
        let refresh = Task { try await auth.token(force: true) }
        await fulfillment(of: [held], timeout: 2)
        try await auth.signIn(presentationAnchor: ASPresentationAnchor())
        do { _ = try await refresh.value; XCTFail("Superseded refresh returned a token") } catch {}
        XCTAssertEqual(storage.value?.accessToken, "FAKE NEW")
        XCTAssertEqual(storage.value?.refreshToken, "FAKE ROTATED")
        XCTAssertEqual(storage.writes, 1)
    }
    func testDisconnectCancelsBrowserAndDoesNotSaveCredential() async throws {
        let storage = GoogleAuthTestStorage(); storage.value = old()
        let browser = GoogleAuthTestBrowser(); browser.suspended = true
        let auth = try auth(storage, browser: browser, session: session { _ in (200, self.response) })
        let signIn = Task { try await auth.signIn(presentationAnchor: ASPresentationAnchor()) }
        while browser.pending == nil { await Task.yield() }
        do { _ = try await auth.token(force: true); XCTFail() }
        catch { XCTAssertEqual(error as? GoogleAuthenticationError, .authenticationInProgress) }
        try auth.disconnect()
        do { try await signIn.value; XCTFail() } catch {}
        XCTAssertNil(storage.value); XCTAssertEqual(storage.writes, 0)
    }
}

private final class GoogleAuthTestStorage: GoogleAuthenticationStorage {
    var value: GoogleAuthenticationCredential?, loads = 0, writes = 0
    var failSave = false
    func load() throws -> GoogleAuthenticationCredential? { loads += 1; return value }
    func save(_ credential: GoogleAuthenticationCredential) throws { if failSave { throw GoogleAuthenticationError.keychain(-1) }; writes += 1; value = credential }
    func remove() throws { value = nil }
}
@MainActor private final class GoogleAuthTestBrowser: GoogleAuthenticationBrowser {
    var parameters: [String: String] = [:], mutation = "", suspended = false, cancellations = 0
    var pending: CheckedContinuation<URL, Error>?
    func authenticate(_ url: URL, scheme: String) async throws -> URL {
        parameters = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        if suspended { return try await withCheckedThrowingContinuation { pending = $0 } }
        var parts = URLComponents(string: "\(scheme):/oauth2redirect")!
        parts.queryItems = [URLQueryItem(name: "state", value: parameters["state"]), URLQueryItem(name: "code", value: "FAKE CODE&=+/?")]
        switch mutation {
        case "state": parts.queryItems![0].value = "FAKE wrong"
        case "scheme": parts.scheme = "wrong.scheme"
        case "path": parts.path = "/other"
        case "duplicate-state": parts.queryItems!.append(parts.queryItems![0])
        case "duplicate-code": parts.queryItems!.append(parts.queryItems![1])
        case "fragment": parts.fragment = "code=FAKE"
        case "host": parts.host = "untrusted.example"
        case "error-with-code": parts.queryItems!.append(URLQueryItem(name: "error", value: "access_denied"))
        case "denied": parts.queryItems![1] = URLQueryItem(name: "error", value: "access_denied")
        default: break
        }
        return parts.url!
    }
    func cancel() { cancellations += 1; let continuation = pending; pending = nil; continuation?.resume(throwing: GoogleAuthenticationError.cancelled) }
}
private final class GoogleAuthURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, String))?
    static var holdFirst = false
    static var onHeld: (() -> Void)?
    static var held: GoogleAuthURLProtocol?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if Self.holdFirst {
            Self.holdFirst = false; Self.held = self; Self.onHeld?(); return
        }
        do {
            let (status, body) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
