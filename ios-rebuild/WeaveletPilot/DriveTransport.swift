import Foundation
import CryptoKit

protocol SyncDrive: Sendable {
    func call(_ method: String, args: [OrderedJSON]) async throws -> OrderedJSON
}

enum DriveTransportError: LocalizedError, Equatable {
    case notFound, invalidResponse, http(Int), collision
    var errorDescription: String? {
        switch self {
        case .notFound: return "Google Driveの同期ファイルが見つかりません。"
        case .invalidResponse: return "Google Driveの応答形式が不正です。"
        case .http(let status): return "Google Drive HTTP \(status)"
        case .collision: return "Google Driveのfile IDが異なるデータと衝突しました。"
        }
    }
}

// OAuth lives outside the protocol. Tests inject a fake token and an isolated URLSession.
actor DriveTransport: SyncDrive {
    let session: URLSession
    let token: @Sendable (Bool) async throws -> String
    private let api = "https://www.googleapis.com/drive/v3"

    init(session: URLSession = .shared, token: @escaping @Sendable (Bool) async throws -> String) {
        self.session = session; self.token = token
    }

    private func url(_ path: String, query: [URLQueryItem] = [], upload: Bool = false) throws -> URL {
        var parts = URLComponents(string: (upload ? "https://www.googleapis.com/upload/drive/v3" : api) + path)!
        if !query.isEmpty { parts.queryItems = query }
        guard let result = parts.url else { throw DriveTransportError.invalidResponse }
        return result
    }
    private func component(_ id: String) throws -> String {
        guard !id.isEmpty, let encoded = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw DriveTransportError.invalidResponse }
        return encoded
    }
    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        func authorized(_ force: Bool) async throws -> URLRequest {
            let access = try await token(force)
            guard !access.isEmpty else { throw DriveTransportError.invalidResponse }
            var next = request; next.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
            return next
        }
        var (data, response) = try await session.data(for: authorized(false))
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            (data, response) = try await session.data(for: authorized(true))
        }
        guard let http = response as? HTTPURLResponse else { throw DriveTransportError.invalidResponse }
        return (data, http)
    }
    private func json(_ path: String, query: [URLQueryItem] = [], body: OrderedJSON? = nil) async throws -> OrderedJSON {
        var request = URLRequest(url: try url(path, query: query))
        if let body {
            request.httpMethod = "POST"; request.httpBody = try body.encoded()
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await send(request)
        guard (200...299).contains(response.statusCode) else { throw DriveTransportError.http(response.statusCode) }
        return try OrderedJSON.decode(data)
    }
    private func read(_ id: String) async throws -> Data {
        let (bytes, response) = try await send(URLRequest(url: url("/files/\(component(id))", query: [URLQueryItem(name: "alt", value: "media")])))
        if response.statusCode == 404 { throw DriveTransportError.notFound }
        guard (200...299).contains(response.statusCode) else { throw DriveTransportError.http(response.statusCode) }
        return bytes
    }
    private func put(_ id: String, dataset: String, kind: String, bytes: Data) async throws {
        let boundary = "weavelet-\(UUID().uuidString)"
        let metadata = OrderedJSON.object([
            JSONField(key: "id", value: .string(id)), JSONField(key: "name", value: .string("\(id).bin")),
            JSONField(key: "mimeType", value: .string("application/octet-stream")), JSONField(key: "parents", value: .array([.string(dataset)])),
            JSONField(key: "appProperties", value: .object([JSONField(key: "dataset", value: .string(dataset)), JSONField(key: "kind", value: .string(kind))]))
        ])
        var body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8)
        body.append(try metadata.encoded())
        body.append(Data("\r\n--\(boundary)\r\nContent-Type: application/octet-stream\r\n\r\n".utf8)); body.append(bytes)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: try url("/files", query: [URLQueryItem(name: "uploadType", value: "multipart")], upload: true))
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("multipart/related; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await send(request)
        if response.statusCode == 409 {
            guard SHA256.hash(data: try await read(id)) == SHA256.hash(data: bytes) else { throw DriveTransportError.collision }
            return
        }
        guard (200...299).contains(response.statusCode) else { throw DriveTransportError.http(response.statusCode) }
    }
    private func list(_ dataset: String, kind: String) async throws -> OrderedJSON {
        var ids: [OrderedJSON] = []; var page: String?; var seen = Set<String>()
        let escaped = dataset.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        repeat {
            var query = [URLQueryItem(name: "q", value: "'\(escaped)' in parents and trashed = false and appProperties has { key='kind' and value='\(kind)' }"),
                         URLQueryItem(name: "fields", value: "nextPageToken,incompleteSearch,files(id)"), URLQueryItem(name: "pageSize", value: "1000")]
            if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
            let result = try await json("/files", query: query)
            guard result["incompleteSearch"] != .bool(true) else { throw DriveTransportError.invalidResponse }
            for file in try result.required("files").array("files") { ids.append(.string(try file.required("id").string("id"))) }
            page = try result["nextPageToken"].map { try $0.string("nextPageToken") }
            if let page { guard !page.isEmpty, seen.insert(page).inserted else { throw DriveTransportError.invalidResponse } }
        } while page != nil
        return .array(ids)
    }

    // Listing rules and names come from the same Web helper; URLSession owns paging and transport.
    func listDatasets() async throws -> OrderedJSON {
        let definition = try SharedWebOperations.call("driveListing", .array([]))
        let parameters = try definition.required("parameters").object("parameters")
        var files: [OrderedJSON] = []; var page: String?; var seen = Set<String>()
        repeat {
            var query = try parameters.map { URLQueryItem(name: try $0.key.native("query key"), value: try $0.value.string("query value")) }
            if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
            let result = try await json("/files", query: query)
            guard result["incompleteSearch"] != .bool(true) else { throw DriveTransportError.invalidResponse }
            files += try result.required("files").array("files")
            page = try result["nextPageToken"].map { try $0.string("nextPageToken") }
            if page == "" { page = nil }
            if let page { guard seen.insert(page).inserted else { throw DriveTransportError.invalidResponse } }
        } while page != nil
        return .array(files)
    }

    func call(_ method: String, args: [OrderedJSON]) async throws -> OrderedJSON {
        switch method {
        case "ids":
            let count = try args[0].number("count")
            guard count >= 1, count.rounded() == count, count <= Double(Int.max) else { throw DriveTransportError.invalidResponse }
            var ids: [OrderedJSON] = []
            while ids.count < Int(count) {
                let batch = min(1000, Int(count) - ids.count)
                let result = try await json("/files/generateIds", query: [URLQueryItem(name: "count", value: String(batch)), URLQueryItem(name: "space", value: "drive"), URLQueryItem(name: "type", value: "files")])
                let next = try result.required("ids").array("ids")
                guard next.count == batch else { throw DriveTransportError.invalidResponse }
                for id in next { guard try !id.string("id").isEmpty else { throw DriveTransportError.invalidResponse } }
                ids += next
            }
            guard Set(try ids.map { try Data($0.string("id").utf8) }).count == ids.count else { throw DriveTransportError.invalidResponse }
            return .array(ids)
        case "keyHeader":
            let file = try await call("metadata", args: args)
            return try SharedWebOperations.call("driveHeaderID", file)
        case "metadata":
            let file = try await json("/files/\(component(args[0].string("id")))", query: [URLQueryItem(name: "fields", value: "id,name,mimeType,appProperties,trashed")])
            guard file["trashed"] != .bool(true) else { throw DriveTransportError.notFound }; return file
        case "folder":
            let id = try args[0].string("id"), header = try args[1].string("headerId")
            let name = try (args.count > 2 && args[2] != .null ? args[2].string("name") : SharedWebOperations.call("driveFolderName", .string(id)).string("name")).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { throw DriveTransportError.invalidResponse }
            return try await json("/files", query: [URLQueryItem(name: "fields", value: "id,name,mimeType,appProperties")], body: .object([
                JSONField(key: "id", value: .string(id)), JSONField(key: "name", value: .string(name)), JSONField(key: "mimeType", value: .string("application/vnd.google-apps.folder")),
                JSONField(key: "appProperties", value: .object([JSONField(key: "weaveletSync", value: .string("1")), JSONField(key: "headerId", value: .string(header))]))
            ]))
        case "read": return .syncBytes(try await read(args[0].string("id")))
        case "put": try await put(args[0].string("id"), dataset: args[1].string("dataset"), kind: args[2].string("kind"), bytes: args[3].syncData()); return .null
        case "startToken": return try await json("/changes/startPageToken").required("startPageToken")
        case "commits", "packs": return try await list(args[0].string("dataset"), kind: method == "commits" ? "commit" : "pack")
        case "changes":
            var page = try args[0].string("token"); var seen = Set([page]); var changes: [OrderedJSON] = []
            while true {
                let result = try await json("/changes", query: [URLQueryItem(name: "pageToken", value: page), URLQueryItem(name: "pageSize", value: "1000"), URLQueryItem(name: "fields", value: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,trashed,appProperties))")])
                changes += try result.required("changes").array("changes")
                if let next = result["nextPageToken"] {
                    page = try next.string("pageToken")
                    guard !page.isEmpty, seen.insert(page).inserted else { throw DriveTransportError.invalidResponse }
                }
                else { return .object([JSONField(key: "token", value: try result.required("newStartPageToken")), JSONField(key: "changes", value: .array(changes))]) }
            }
        case "remove":
            var request = URLRequest(url: try url("/files/\(component(args[0].string("id")))")); request.httpMethod = "DELETE"
            let (_, response) = try await send(request)
            guard (200...299).contains(response.statusCode) || response.statusCode == 404 else { throw DriveTransportError.http(response.statusCode) }; return .null
        default: throw DriveTransportError.invalidResponse
        }
    }
}
