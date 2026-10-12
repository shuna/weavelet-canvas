import AuthenticationServices
import CryptoKit
import Foundation
import Security

struct GoogleAuthenticationConfiguration {
    let clientID: String
    let redirectScheme: String
    var redirectURI: String { "\(redirectScheme):/oauth2redirect" }
    static let scope = "https://www.googleapis.com/auth/drive.file"

    init(clientID: String, redirectScheme: String) throws {
        guard clientID.hasSuffix(".apps.googleusercontent.com"), !clientID.hasPrefix("."),
              redirectScheme == clientID.split(separator: ".").reversed().joined(separator: "."),
              redirectScheme.range(of: "^[A-Za-z][A-Za-z0-9.+-]*$", options: .regularExpression) != nil else {
            throw GoogleAuthenticationError.configuration
        }
        self.clientID = clientID; self.redirectScheme = redirectScheme
    }
    static func bundled(_ bundle: Bundle = .main) throws -> Self {
        guard let client = bundle.object(forInfoDictionaryKey: "GOOGLE_CLIENT_ID") as? String,
              let scheme = bundle.object(forInfoDictionaryKey: "GOOGLE_REDIRECT_SCHEME") as? String,
              let types = bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]],
              types.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains(scheme) == true }) else {
            throw GoogleAuthenticationError.configuration
        }
        return try Self(clientID: client, redirectScheme: scheme)
    }
}

enum GoogleAuthenticationError: LocalizedError, Equatable {
    case configuration, cancelled, callback, invalidResponse, reconnectRequired, connectionChanged, authenticationInProgress, http(Int), keychain(OSStatus)
    var errorDescription: String? {
        switch self {
        case .configuration: return "GoogleのiOSクライアント設定がありません。"
        case .cancelled: return "Google認証をキャンセルしました。"
        case .callback: return "Google認証の戻り先またはstateが一致しません。"
        case .invalidResponse: return "Google認証の応答形式が不正です。"
        case .reconnectRequired: return "Googleへ再接続してください。"
        case .connectionChanged: return "Google接続が変更されたため古い応答を破棄しました。"
        case .authenticationInProgress: return "Google認証が進行中です。"
        case .http(let status): return "Google認証 HTTP \(status)"
        case .keychain(let status): return "Google認証情報のKeychain操作に失敗しました（\(status)）。"
        }
    }
}

struct GoogleAuthenticationCredential: Codable, Equatable {
    let clientID: String
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
}
protocol GoogleAuthenticationStorage {
    func load() throws -> GoogleAuthenticationCredential?
    func save(_ credential: GoogleAuthenticationCredential) throws
    func remove() throws
}
struct GoogleAuthenticationKeychain: GoogleAuthenticationStorage {
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.weavelet.nativepilot.google", kSecAttrAccount as String: "oauth"] }
    func load() throws -> GoogleAuthenticationCredential? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw GoogleAuthenticationError.keychain(status) }
        return try JSONDecoder().decode(GoogleAuthenticationCredential.self, from: data)
    }
    func save(_ credential: GoogleAuthenticationCredential) throws {
        // One Keychain item commits access/refresh/expiry together, including rotation.
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw GoogleAuthenticationError.keychain(status) }
        var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw GoogleAuthenticationError.keychain(added) }
    }
    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw GoogleAuthenticationError.keychain(status) }
    }
}

@MainActor protocol GoogleAuthenticationBrowser: AnyObject {
    func authenticate(_ url: URL, scheme: String) async throws -> URL
    func cancel()
}
@MainActor final class GoogleSystemAuthenticationBrowser: NSObject, GoogleAuthenticationBrowser, ASWebAuthenticationPresentationContextProviding {
    private let anchor: ASPresentationAnchor
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    init(anchor: ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor }
    func authenticate(_ url: URL, scheme: String) async throws -> URL {
        try Task.checkCancellation()
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] url, error in
                    Task { @MainActor in
                        if let url { self?.finish(.success(url)) }
                        else { self?.finish(.failure(error ?? GoogleAuthenticationError.cancelled)) }
                    }
                }
                self.session = session
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = false
                if !session.start() { finish(.failure(GoogleAuthenticationError.cancelled)) }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }
    func cancel() { session?.cancel(); finish(.failure(GoogleAuthenticationError.cancelled)) }
    private func finish(_ result: Result<URL, Error>) {
        let pending = continuation; continuation = nil; session = nil
        pending?.resume(with: result)
    }
}

@MainActor final class GoogleAuthentication {
    private let configuration: GoogleAuthenticationConfiguration?
    private let session: URLSession
    private let storage: GoogleAuthenticationStorage
    private let browserFactory: @MainActor (ASPresentationAnchor) -> GoogleAuthenticationBrowser
    private let now: () -> Date
    private var credential: GoogleAuthenticationCredential?
    private var generation = 0
    private var browser: GoogleAuthenticationBrowser?
    private var refresh: (generation: Int, task: Task<String, Error>)?

    var isConfigured: Bool { configuration != nil }

    init(configuration: GoogleAuthenticationConfiguration? = nil, session: URLSession = .shared,
         storage: GoogleAuthenticationStorage = GoogleAuthenticationKeychain(), now: @escaping () -> Date = Date.init,
         browserFactory: @escaping @MainActor (ASPresentationAnchor) -> GoogleAuthenticationBrowser = { GoogleSystemAuthenticationBrowser(anchor: $0) }) throws {
        self.configuration = configuration; self.session = session; self.storage = storage
        self.now = now; self.browserFactory = browserFactory
        if let configuration, let saved = try storage.load(), saved.clientID == configuration.clientID, !saved.accessToken.isEmpty, !saved.refreshToken.isEmpty { credential = saved }
    }
    nonisolated static func challenge(_ verifier: String) -> String { base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    nonisolated private static func base64URL(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw GoogleAuthenticationError.invalidResponse }
        return base64URL(Data(bytes))
    }
    func signIn(presentationAnchor: ASPresentationAnchor) async throws {
        guard let configuration else { throw GoogleAuthenticationError.configuration }
        generation += 1; let expected = generation
        browser?.cancel(); refresh?.task.cancel(); refresh = nil
        let currentBrowser = browserFactory(presentationAnchor); browser = currentBrowser
        defer { if expected == generation { browser = nil } }
        let verifier = try Self.random(), state = try Self.random()
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = ["client_id": configuration.clientID, "redirect_uri": configuration.redirectURI,
            "response_type": "code", "scope": GoogleAuthenticationConfiguration.scope, "code_challenge": Self.challenge(verifier),
            "code_challenge_method": "S256", "state": state, "access_type": "offline", "prompt": "consent"].map { URLQueryItem(name: $0.key, value: $0.value) }
        let callback = try await currentBrowser.authenticate(components.url!, scheme: configuration.redirectScheme)
        try check(expected)
        let code = try authorizationCode(callback, state: state)
        let next = try await request(["client_id": configuration.clientID, "redirect_uri": configuration.redirectURI,
            "code": code, "code_verifier": verifier, "grant_type": "authorization_code"], previousRefresh: nil)
        try check(expected)
        try storage.save(next); credential = next
    }
    func cancelSignIn() { generation += 1; browser?.cancel(); browser = nil; refresh?.task.cancel(); refresh = nil }
    func disconnect() throws {
        cancelSignIn(); credential = nil
        try storage.remove()
    }
    func token(force: Bool) async throws -> String {
        guard let configuration else { throw GoogleAuthenticationError.configuration }
        try Task.checkCancellation()
        guard browser == nil else { throw GoogleAuthenticationError.authenticationInProgress }
        guard let old = credential else { throw GoogleAuthenticationError.reconnectRequired }
        if !force && old.expiresAt.timeIntervalSince(now()) > 60 { return old.accessToken }
        if let refresh {
            let result = try await refresh.task.value
            try Task.checkCancellation(); try check(refresh.generation)
            return result
        }
        let expected = generation
        let task = Task { @MainActor in
            do {
                let next = try await self.request(["client_id": configuration.clientID, "refresh_token": old.refreshToken,
                    "grant_type": "refresh_token"], previousRefresh: old.refreshToken)
                try self.check(expected)
                try self.storage.save(next); self.credential = next
                return next.accessToken
            } catch GoogleAuthenticationError.reconnectRequired {
                try self.check(expected)
                self.credential = nil; try self.storage.remove()
                throw GoogleAuthenticationError.reconnectRequired
            }
        }
        refresh = (expected, task)
        defer { if refresh?.generation == expected { refresh = nil } }
        let result = try await task.value
        try Task.checkCancellation(); try check(expected)
        return result
    }
    private func check(_ expected: Int) throws {
        guard expected == generation else { throw GoogleAuthenticationError.connectionChanged }
        try Task.checkCancellation()
    }
    private func authorizationCode(_ callback: URL, state: String) throws -> String {
        guard let configuration else { throw GoogleAuthenticationError.configuration }
        guard let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.scheme == configuration.redirectScheme, parts.host == nil, parts.path == "/oauth2redirect",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil else { throw GoogleAuthenticationError.callback }
        let items = parts.queryItems ?? []
        func single(_ key: String) -> String? { let values = items.filter { $0.name == key }; return values.count == 1 ? values[0].value : nil }
        guard let returned = single("state"), returned.utf8.elementsEqual(state.utf8) else { throw GoogleAuthenticationError.callback }
        if single("error") != nil { throw GoogleAuthenticationError.cancelled }
        guard let code = single("code"), !code.isEmpty, !items.contains(where: { $0.name == "error" }) else { throw GoogleAuthenticationError.callback }
        return code
    }
    private func request(_ values: [String: String], previousRefresh: String?) async throws -> GoogleAuthenticationCredential {
        guard let configuration else { throw GoogleAuthenticationError.configuration }
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"; request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        request.httpBody = values.sorted(by: { $0.key < $1.key }).map { "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&").data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw GoogleAuthenticationError.invalidResponse }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if response.statusCode == 400, json?["error"] as? String == "invalid_grant" { throw GoogleAuthenticationError.reconnectRequired }
        guard response.statusCode == 200 else { throw GoogleAuthenticationError.http(response.statusCode) }
        if let rotated = json?["refresh_token"], !(rotated is String) { throw GoogleAuthenticationError.invalidResponse }
        guard let access = json?["access_token"] as? String, !access.isEmpty,
              let type = json?["token_type"] as? String, type.lowercased() == "bearer",
              let expiry = json?["expires_in"] as? NSNumber, CFGetTypeID(expiry) != CFBooleanGetTypeID(),
              expiry.doubleValue.isFinite, expiry.doubleValue > 0,
              let refresh = (json?["refresh_token"] as? String) ?? previousRefresh, !refresh.isEmpty else { throw GoogleAuthenticationError.invalidResponse }
        if let scope = json?["scope"] as? String, !scope.split(separator: " ").contains(Substring(GoogleAuthenticationConfiguration.scope)) { throw GoogleAuthenticationError.invalidResponse }
        let expiresAt = now().addingTimeInterval(expiry.doubleValue)
        guard expiresAt.timeIntervalSince1970.isFinite else { throw GoogleAuthenticationError.invalidResponse }
        return GoogleAuthenticationCredential(clientID: configuration.clientID, accessToken: access, refreshToken: refresh, expiresAt: expiresAt)
    }
}
