import Foundation
import Combine

@MainActor final class GoogleSyncController: ObservableObject {
    enum Status: Equatable { case disconnected, locked, ready, syncing, conflict, recoveryRequired, failed }
    enum Resolution: String { case merge, local, cloud }
    @Published private(set) var status: Status = .disconnected
    @Published private(set) var dataset: String?
    @Published private(set) var conflictKeys: [String] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var isUnlocked = false
    var isBusy: Bool { task != nil }
    private let chatState: ChatState
    private let drive: any SyncDrive
    private let store: SyncStateStore
    private let keyStore: any SyncKeyStore
    private var session: SyncSession?
    private var task: Task<Void, Error>?
    private var idleWaiters: [CheckedContinuation<Void,Never>] = []

    init(chatState: ChatState, drive: any SyncDrive, store: SyncStateStore = .applicationStore, keyStore: any SyncKeyStore = KeychainSyncKeyStore()) {
        self.chatState = chatState; self.drive = drive; self.store = store; self.keyStore = keyStore
        do { dataset = try store.selectedDataset(); status = dataset == nil ? .disconnected : .locked }
        catch { status = .failed; errorMessage = error.localizedDescription }
    }
    private func getSession() throws -> SyncSession {
        if let session { return session }
        let created = try SyncSession(drive: drive, store: store, keyStore: keyStore)
        session = created; return created
    }
    private func perform(_ operation: @escaping @MainActor () async throws -> Void) async throws {
        guard task == nil else { throw SyncSessionError.invalid("Google sync operation is already running") }
        errorMessage = nil; conflictKeys = []; status = .syncing
        let task = Task { try await operation() }; self.task = task
        defer { self.task = nil; let waiters = idleWaiters; idleWaiters.removeAll(); waiters.forEach { $0.resume() } }
        do { try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() } }
        catch {
            errorMessage = error.localizedDescription
            if let error = error as? SyncSessionError, !error.conflictKeys.isEmpty {
                conflictKeys = error.conflictKeys; status = .conflict
            } else if let dataset, (try? store.publication(dataset: dataset)) != nil { status = .recoveryRequired }
            else { status = .failed }
            throw error
        }
    }
    func create(password: String, folderName: String? = nil) async throws {
        try await perform {
            guard self.dataset == nil else { throw SyncSessionError.invalid("Disconnect the current dataset before creating another") }
            let session = try self.getSession()
            let file = try await session.create(password: password, folderName: folderName)
            let dataset = try file.required("id").string("dataset")
            // Preserve the newly created identity before the first upload can fail.
            self.dataset = dataset; self.isUnlocked = true
            try self.store.selectDataset(dataset)
            try await self.publish(replace: true)
        }
    }
    func open(dataset: String) async throws {
        try await perform {
            guard self.dataset == nil || self.dataset == dataset else { throw SyncSessionError.invalid("Disconnect the current dataset before switching") }
            try await self.getSession().open(dataset: dataset)
            try self.store.selectDataset(dataset)
            self.dataset = dataset; self.isUnlocked = false; self.status = .locked
        }
    }
    func unlock(password: String) async throws {
        try await perform {
            guard let dataset = self.dataset else { throw SyncSessionError.invalid("Select a Google dataset first") }
            let session = try self.getSession()
            try await session.open(dataset: dataset)
            try await session.unlock(password: password)
            self.isUnlocked = true
            self.status = try self.store.publication(dataset: dataset) == nil ? .ready : .recoveryRequired
        }
    }
    func restoreKey() async throws -> Bool {
        var restored = false
        try await perform {
            guard let dataset = self.dataset else { throw SyncSessionError.invalid("Select a Google dataset first") }
            let session = try self.getSession()
            try await session.open(dataset: dataset)
            restored = try await session.restoreKey()
            self.isUnlocked = restored
            self.status = restored ? (try self.store.publication(dataset: dataset) == nil ? .ready : .recoveryRequired) : .locked
        }
        return restored
    }
    func synchronize() async throws { try await perform { try await self.publish() } }
    func download() async throws { try await perform { try await self.publish(download: true) } }
    func resolve(_ mode: Resolution) async throws { try await perform { try await self.publish(resolution: mode) } }
    private func publish(replace: Bool = false, download: Bool = false, resolution: Resolution? = nil) async throws {
        guard isUnlocked, let dataset, let session else { throw SyncSessionError.invalid("Unlock Google sync first") }
        if resolution == nil, try store.publication(dataset: dataset) != nil {
            try await finishRecovery(dataset: dataset, session: session)
            // A journal without a received result is an interrupted shared operation.
            if try store.publication(dataset: dataset) == nil { status = .ready; return }
        }
        let interrupted = try store.publication(dataset:dataset)
        let actualResolution = resolution ?? interrupted.flatMap { Resolution(rawValue:$0.mode) }
        let actualDownload = download || (resolution == nil && interrupted?.mode == "download")
        let actualReplace = replace || (resolution == nil && interrupted?.replace == true)
        let mode = actualResolution?.rawValue ?? (actualDownload ? "download" : "sync")
        let input = try chatState.syncInputSnapshot()
        // Retrying an interrupted download must not silently adopt a newer local input.
        if resolution == nil, let interrupted, input != interrupted.input {
            throw SyncSessionError.invalid("Local data changed after an interrupted sync. Choose how to resolve local and cloud changes.")
        }
        try store.savePublication(dataset: dataset,.init(input: input,received:nil,target:nil,mode:mode,replace:actualReplace))
        let received: OrderedJSON
        if let actualResolution { received = try await session.resolveForPublication(input,mode:actualResolution.rawValue) }
        else if actualDownload { received = try await session.pull() }
        else { received = try await session.synchronizeForPublication(input,replace:actualReplace) }
        try store.savePublication(dataset:dataset,.init(input:input,received:received,target:nil,mode:mode,replace:actualReplace))
        try Task.checkCancellation()
        let target = try SyncDocument(snapshot:input).synchronizingSnapshot(received).snapshot
        try store.savePublication(dataset:dataset,.init(input:input,received:received,target:target,mode:mode,replace:actualReplace))
        try await finishRecovery(dataset:dataset,session:session)
        status = .ready
    }
    private func finishRecovery(dataset: String, session: SyncSession) async throws {
        guard let journal = try store.publication(dataset:dataset), let received = journal.received else { return }
        let target = try journal.target ?? SyncDocument(snapshot:journal.input).synchronizingSnapshot(received).snapshot
        if journal.target == nil {
            try store.savePublication(dataset:dataset,.init(input:journal.input,received:received,target:target,mode:journal.mode,replace:journal.replace))
        }
        let current = try chatState.syncInputSnapshot()
        if current == journal.input {
            try chatState.applySynchronizedSnapshot(received,expected:journal.input)
        } else if current != target {
            throw SyncSessionError.invalid("Local data changed while a received snapshot was awaiting save. Resolve the latest local and cloud data before retrying.")
        }
        // If local persistence already succeeded, restart retries only the baseline save.
        try await session.acceptPublication(target)
        try store.savePublication(dataset:dataset,nil)
    }
    func recover() async throws {
        try await perform {
            guard self.isUnlocked, let dataset = self.dataset, let session = self.session else { throw SyncSessionError.invalid("Unlock Google sync first") }
            if let journal = try self.store.publication(dataset:dataset), journal.received != nil {
                try await self.finishRecovery(dataset:dataset,session:session)
            } else { try await self.publish() }
            self.status = .ready
        }
    }
    func cancel() { task?.cancel() }
    func disconnect() async throws {
        cancel()
        if task != nil { await withCheckedContinuation { idleWaiters.append($0) } }
        try await perform {
            if let session = self.session { try await session.close(); self.isUnlocked = false }
            try self.store.selectDataset(nil)
            self.session = nil; self.dataset = nil; self.status = .disconnected
        }
    }
}
