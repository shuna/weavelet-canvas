import Foundation
import CryptoKit
import JavaScriptCore

struct SyncSessionError: LocalizedError {
    let message: String
    let conflictKeys: [String]
    static func invalid(_ message: String) -> SyncSessionError { SyncSessionError(message: message, conflictKeys: []) }
    var errorDescription: String? { message }
}

// Actor isolation serializes the JSC VM and the session; network awaits never run inside JSC.
actor SyncSession {
    enum TransportMode: String { case drive, filesystem }
    private let transportMode: TransportMode
    private let drive: any SyncDrive
    private let store: SyncStateStore
    private let host: SyncNativeHost
    private let context: JSContext
    private let bridge: JSValue
    private let diagnosticsChanged: (@Sendable (OrderedJSON) async -> Void)?
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(drive: any SyncDrive, store: SyncStateStore = .applicationStore, keyStore: any SyncKeyStore = KeychainSyncKeyStore(), transportMode: TransportMode = .drive, diagnosticsChanged: (@Sendable (OrderedJSON) async -> Void)? = nil) throws {
        self.drive = drive; self.store = store; self.transportMode = transportMode; self.diagnosticsChanged = diagnosticsChanged
        let host = SyncNativeHost(store: store, keys: keyStore)
        self.host = host
        guard let context = JSContext() else { throw SyncSessionError.invalid("JavaScriptCore unavailable") }
        let callback: @convention(block) (String) -> String = { host.call($0) }
        context.setObject(callback, forKeyedSubscript: "nativeSyncCall" as NSString)
        let bundle = Bundle(for: SyncSessionResource.self)
        guard let url = bundle.url(forResource: "GoogleSync.bundle", withExtension: "js") else { throw SyncSessionError.invalid("Missing fixed sync resource") }
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
        guard context.exception == nil, let bridge = context.objectForKeyedSubscript("WeaveletGoogleSync") else { throw SyncSessionError.invalid("Invalid fixed sync resource") }
        self.context = context; self.bridge = bridge
    }
    private func acquire() async {
        if busy { await withCheckedContinuation { waiters.append($0) } }
        else { busy = true }
    }
    private func release() {
        if waiters.isEmpty { busy = false }
        else { waiters.removeFirst().resume() }
    }
    private func invoke(_ name: String, _ arguments: [Any] = []) throws -> JSValue {
        context.exception = nil
        guard let value = bridge.invokeMethod(name, withArguments: arguments), context.exception == nil else {
            throw SyncSessionError.invalid("Fixed sync operation failed")
        }
        return value
    }
    private func invokeJSON(_ name: String) throws -> OrderedJSON {
        guard let json = try invoke(name).toString() else { throw SyncSessionError.invalid("Missing sync result") }
        return try OrderedJSON.decode(Data(json.utf8))
    }
    private func run(_ operation: String, args: OrderedJSON = .object([])) async throws -> OrderedJSON {
        await acquire(); defer { host.stagedAccepted.removeAll(); host.nextRawAccepted = nil; release() }
        if ["acceptLocal", "synchronize", "resolveForPublication", "push", "resolve"].contains(operation) {
            host.nextRawAccepted = args["snapshot"]
        }
        _ = try invoke("start", [operation, String(decoding: try args.replacing("transportMode",with:.string(transportMode.rawValue)).encoded(), as: UTF8.self)])
        var cancellation: Error?
        while true {
            if let diagnosticsChanged, let snapshot = try? invokeJSON("syncDiagnostics") { await diagnosticsChanged(snapshot) }
            let result = try invokeJSON("result")
            switch try result.required("status").string("status") {
            case "done":
                if let cancellation { throw cancellation }
                return try OrderedJSON.decode(Data(result.required("valueJSON").string("valueJSON").utf8))
            case "error":
                if let cancellation { throw cancellation }
                let keys = try (result["conflictKeys"] ?? .array([])).array("conflictKeys").map { try $0.string("key") }
                throw SyncSessionError(message: try result.required("error").string("error"), conflictKeys: keys)
            default: break
            }
            let requests = try invokeJSON("drain").array("requests")
            guard !requests.isEmpty else { throw SyncSessionError.invalid("Sync promise did not produce a result or a native request") }
            for request in requests {
                let id = try request.required("id").number("id")
                let response: OrderedJSON
                do {
                    try Task.checkCancellation()
                    let value: OrderedJSON
                    if try request.required("method").string("method") == "yieldHistory" {
                        await Task.yield()
                        value = .null
                    } else {
                        value = try await drive.call(request.required("method").string("method"), args: request.required("args").array("args"))
                    }
                    try Task.checkCancellation()
                    response = .object([JSONField(key: "ok", value: .bool(true)), JSONField(key: "value", value: value)])
                } catch {
                    if error is CancellationError || Task.isCancelled { cancellation = CancellationError() }
                    let folderMissing: Bool
                    if case .missing? = error as? FolderSyncFilesError { folderMissing = true } else { folderMissing = false }
                    response = .object([JSONField(key: "ok", value: .bool(false)), JSONField(key: "error", value: .string(error.localizedDescription)),
                        JSONField(key: "notFound", value: .bool((error as? DriveTransportError) == .notFound || folderMissing)),
                        JSONField(key: "invalidFileId", value: .bool((error as? DriveTransportError) == .invalidFileId))])
                }
                _ = try invoke("settle", [id, String(decoding: try response.encoded(), as: UTF8.self)])
            }
        }
    }
    func create(password: String, folderName: String? = nil, partBytes: Int? = nil) async throws -> OrderedJSON {
        var options = OrderedJSON.object([])
        if let folderName { options = options.replacing("folderName", with: .string(folderName)) }
        if let partBytes {
            guard partBytes > 0 else { throw SyncSessionError.invalid("Invalid part size") }
            options = options.replacing("partBytes", with: .number(String(partBytes)))
        }
        return try await run("create", args: .object([JSONField(key: "password", value: .string(password)), JSONField(key: "options", value: options)]))
    }
    func open(dataset: String, partBytes: Int? = nil) async throws {
        guard !dataset.isEmpty else { throw SyncSessionError.invalid("Missing dataset") }
        var options = OrderedJSON.object([])
        if let partBytes { guard partBytes > 0 else { throw SyncSessionError.invalid("Invalid part size") }; options = options.replacing("partBytes", with: .number(String(partBytes))) }
        _ = try await run("open", args: .object([JSONField(key: "dataset", value: .string(dataset)), JSONField(key: "options", value: options)]))
    }
    func inspectFolder() async throws -> OrderedJSON {
        guard transportMode == .filesystem else { throw SyncSessionError.invalid("フォルダー同期ではありません") }
        return try await run("inspectFolder")
    }
    func unlock(password: String) async throws { _ = try await run("unlock", args: .object([JSONField(key: "password", value: .string(password))])) }
    func restoreKey() async throws -> Bool { try await run("restoreKey").boolean("restoreKey") }
    func push(_ snapshot: OrderedJSON, replace: Bool = false) async throws {
        _ = try await run("push", args: .object([JSONField(key: "snapshot", value: snapshot), JSONField(key: "replace", value: .bool(replace))]))
    }
    func synchronizeForPublication(_ snapshot: OrderedJSON, replace: Bool = false, initializeIfEmpty: Bool = false) async throws -> OrderedJSON {
        try await run("synchronize", args: .object([.init(key: "snapshot", value: snapshot), .init(key: "replace", value: initializeIfEmpty ? .string("if-empty") : .bool(replace))]))
    }
    func resolveForPublication(_ snapshot: OrderedJSON, mode: String) async throws -> OrderedJSON {
        guard ["merge", "local", "cloud"].contains(mode) else { throw SyncSessionError.invalid("Invalid resolution") }
        return try await run("resolveForPublication", args: .object([.init(key: "snapshot", value: snapshot), .init(key: "mode", value: .string(mode))]))
    }
    func acceptPublication(_ snapshot: OrderedJSON) async throws {
        _ = try await run("acceptLocal", args: .object([.init(key: "snapshot", value: snapshot)]))
    }
    func pull() async throws -> OrderedJSON { try await run("pull") }
    // Receive and baseline are committed together; a failed write leaves the previous accepted state intact.
    func receiveAndSave() async throws -> OrderedJSON { try await run("receive") }
    func resolveAndSave(_ snapshot: OrderedJSON, mode: String) async throws -> OrderedJSON {
        guard ["merge", "local", "cloud"].contains(mode) else { throw SyncSessionError.invalid("Invalid resolution") }
        return try await run("resolve", args: .object([JSONField(key: "snapshot", value: snapshot), JSONField(key: "mode", value: .string(mode))]))
    }
    func compactHistory() async throws {
        guard transportMode == .drive else { throw SyncSessionError.invalid("History compaction is not supported by this transport") }
        _ = try await run("compactHistory")
    }
    func diagnosticsSnapshot() throws -> OrderedJSON { try invokeJSON("syncDiagnostics") }
    func close() async throws { _ = try await run("close"); host.key = nil }
}

private final class SyncNativeHost {
    let store: SyncStateStore
    let keys: any SyncKeyStore
    var key: SymmetricKey?
    var expected: [Data: OrderedJSON] = [:]
    var stagedAccepted: [Data: OrderedJSON] = [:]
    var nextRawAccepted: OrderedJSON?
    private let descriptor = OrderedJSON.object([
        JSONField(key: "type", value: .string("secret")), JSONField(key: "extractable", value: .bool(false)),
        JSONField(key: "algorithm", value: .object([JSONField(key: "name", value: .string("AES-GCM")), JSONField(key: "length", value: .number("256"))])),
        JSONField(key: "usages", value: .array([.string("encrypt"), .string("decrypt")]))
    ])
    init(store: SyncStateStore, keys: any SyncKeyStore) { self.store = store; self.keys = keys }
    func call(_ json: String) -> String {
        let response: OrderedJSON
        do {
            let request = try OrderedJSON.decode(Data(json.utf8))
            let operation = try request.required("operation").string("operation")
            let args = try request.required("args").array("args").enumerated().map { index,value in
                if operation == "stageAccepted", index == 1, let raw = nextRawAccepted { return raw }
                return try OrderedJSON.decode(Data(value.string("argument JSON").utf8))
            }
            response = .object([JSONField(key: "ok", value: .bool(true)), JSONField(key: "value", value: try perform(operation, args))])
        } catch { response = .object([JSONField(key: "ok", value: .bool(false)), JSONField(key: "error", value: .string(error.localizedDescription))]) }
        return String(decoding: try! response.encoded(), as: UTF8.self)
    }
    private func perform(_ operation: String, _ args: [OrderedJSON]) throws -> OrderedJSON {
        switch operation {
        case "uuid": return .string(UUID().uuidString.lowercased())
        case "monotonic": return .number(String(ProcessInfo.processInfo.systemUptime * 1000))
        case "utf8": return .syncBytes(Data(try args[0].string("text").utf8))
        case "text":
            guard let text = String(data: try args[0].syncData(), encoding: .utf8) else { throw SyncSessionError.invalid("Invalid UTF8") }; return .string(text)
        case "digest":
            let bytes: Data
            if case .string(let text) = args[0] { bytes = Data(text.utf8) } else { bytes = try args[0].syncData() }
            return .string(SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
        case "encode": return .syncBytes(try SyncRecords.encodeWire(args[0]))
        case "decode": return try SyncRecords.decodeWire(args[0].syncData())
        case "createKeyEnvelope":
            let created = try SyncCrypto.createKeyEnvelope(password: args[0].string("password"), dataset: args[1].string("dataset"))
            key = created.key
            return .object([JSONField(key: "key", value: descriptor), JSONField(key: "envelope", value: try OrderedJSON.decode(JSONEncoder().encode(created.envelope)))])
        case "unlockKey":
            let envelope = try JSONDecoder().decode(SyncKeyEnvelope.self, from: args[0].encoded())
            key = try SyncCrypto.unlockKey(envelope, password: args[1].string("password"), dataset: args[2].string("dataset")); return descriptor
        case "encrypt", "decrypt":
            guard args[0] == descriptor, let key else { throw SyncSessionError.invalid("Missing sync key") }
            let bytes = try args[1].syncData(), context = try args[2].string("context")
            return .syncBytes(try operation == "encrypt" ? SyncCrypto.encrypt(key: key, bytes: bytes, context: context) : SyncCrypto.decrypt(key: key, bytes: bytes, context: context))
        case "syncCache":
            let dataset = try args[0].string("dataset")
            let cache = try store.dataset(dataset)["cache"] ?? .null
            expected[Data(dataset.utf8)] = cache; return cache
        case "readSyncEntries":
            let entries = try store.dataset(args[0].string("dataset"))["entries"] ?? .object([])
            return .array(try args[1].array("keys").map { try entries[$0.string("key")] ?? .null })
        case "writeSyncCache":
            let dataset = try args[0].string("dataset"), id = Data(dataset.utf8)
            let entries = try args[2].array("entries").map { value -> JSONField in
                let pair = try value.array("entry")
                guard pair.count == 2 else { throw SyncSessionError.invalid("Invalid cache entry") }
                _ = try pair[1].syncData()
                return JSONField(key: try pair[0].string("entry key"), value: pair[1])
            }
            if args[1] != .null { _ = try args[1].syncData() }
            try store.transaction(dataset: dataset, expectedCache: expected[id] ?? .null, cache: args[1] == .null ? nil : args[1], entries: entries,
                                  remove: args[3].array("remove").map { try $0.string("key") }, accepted: args[1] == .null ? nil : stagedAccepted[id])
            if args[1] != .null { expected[id] = args[1]; stagedAccepted[id] = nil }
            return .null
        case "rememberedSyncKey":
            let dataset = try args[0].string("dataset")
            if args[1] != .null {
                guard args[1] == descriptor, let key else { throw SyncSessionError.invalid("Missing sync key") }
                try keys.save(key, dataset: dataset)
            } else { key = try keys.load(dataset: dataset) }
            return key == nil ? .null : descriptor
        case "stageAccepted":
            stagedAccepted[Data(try args[0].string("dataset").utf8)] = nextRawAccepted ?? args[1]; nextRawAccepted = nil; return .null
        default: throw SyncSessionError.invalid("Unknown native sync operation")
        }
    }
}
private final class SyncSessionResource: NSObject {}
