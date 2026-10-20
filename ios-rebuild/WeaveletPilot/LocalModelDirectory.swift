import Foundation
import CryptoKit
import Darwin

extension LocalModelFiles {
    struct DirectoryInspection {
        fileprivate let declaration: Data
        fileprivate let directories: [String: ModelFileRevision]
        fileprivate let targetRevision: ModelFileRevision?
        let files: [DirectoryFile]
    }
    struct DirectoryFile {
        let path: String
        let hash: String
        let size: UInt64
        fileprivate let revision: ModelFileRevision
    }
    final class DirectoryStage {
        fileprivate let pending: URL
        fileprivate let target: URL
        fileprivate let inspection: DirectoryInspection
        fileprivate var published = false
        fileprivate var publishedTargetRevision: ModelFileRevision?
        fileprivate var preservesPending = false
        fileprivate init(pending: URL, target: URL, inspection: DirectoryInspection) {
            self.pending = pending; self.target = target; self.inspection = inspection
        }
        func discard() {
            guard !preservesPending else { return }
            try? FileManager.default.removeItem(at:pending)
        }
        deinit { discard() }
    }
    fileprivate struct ModelRemovalRecord {
        let id: String
        let quarantine: String
        let entries: [String]
    }
    enum ModelRemovalRecoveryError: Error {
        case incompleteRollback
    }
    final class ModelRemoval {
        private let owner: LocalModelFiles
        fileprivate let record: ModelRemovalRecord?
        fileprivate init(owner: LocalModelFiles, record: ModelRemovalRecord?) { self.owner = owner; self.record = record }
        // Deliberately no deinit cleanup: the journal decides recovery after an interrupted save.
        func rollback() throws { if let record { try owner.rollbackModelRemoval(record) } }
        func commit() throws { if let record { try owner.commitModelRemoval(record) } }
    }
    final class DownloadCache {
        let url: URL
        private let cacheParent: Int32
        private let root: Int32
        private let parts: Int32
        private let name: String
        private var closed = false

        fileprivate init(url: URL, cacheParent: Int32, root: Int32, parts: Int32, name: String) {
            self.url = url; self.cacheParent = cacheParent; self.root = root; self.parts = parts; self.name = name
        }
        deinit { closeDescriptors() }

        func readHashes() throws -> OrderedJSON {
            let descriptor = openat(root,"verified.json",O_RDONLY | O_NOFOLLOW)
            if descriptor < 0 {
                if errno == ENOENT { return .object([]) }
                throw modelFilePOSIXError()
            }
            let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? file.close() }
            var info = stat()
            guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG else {
                throw ExchangeError.invalid("モデルキャッシュの検証情報が不正です")
            }
            let revision = try ModelFileRevision(descriptor)
            guard revision.size <= 1024 * 1024 else { throw ExchangeError.invalid("モデルキャッシュの検証情報が大きすぎます") }
            guard let data = try file.readToEnd(), UInt64(data.count) == revision.size else {
                throw ExchangeError.invalid("モデルキャッシュの検証情報を読み込めません")
            }
            return try OrderedJSON.decode(data)
        }

        func writeHashes(_ hashes: OrderedJSON) throws {
            let bytes = try hashes.encoded()
            let temporary = ".verified-\(UUID().uuidString).part"
            let descriptor = openat(root,temporary,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
            guard descriptor >= 0 else { throw modelFilePOSIXError() }
            var committed = false
            defer { if !committed { _ = unlinkat(root,temporary,0) } }
            let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? file.close() }
            try file.write(contentsOf:bytes)
            try file.synchronize()
            guard renameat(root,temporary,root,"verified.json") == 0 else { throw modelFilePOSIXError() }
            committed = true
        }

        func inspect(path: String, expectedHash: OrderedJSON? = nil) throws -> (name: String, hash: String, size: Int64)? {
            try ModelDirectoryAccess.validatePaths([path])
            let descriptor: Int32
            do { descriptor = try ModelDirectoryAccess.descriptor(path,from:parts,directory:false) }
            catch let error as POSIXError where error.code == .ENOENT { return nil }
            let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? file.close() }
            var info = stat()
            guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG else {
                throw ExchangeError.invalid("モデルキャッシュには通常のファイルのみ使用できます")
            }
            let revision = try ModelFileRevision(descriptor)
            guard revision.size >= 4, try file.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("GGUFファイルではありません")
            }
            try file.seek(toOffset:0)
            let hash = try ModelDirectoryAccess.transfer(file)
            guard try ModelFileRevision(descriptor) == revision else {
                throw ExchangeError.invalid("確認中にモデルキャッシュのファイルが変わりました")
            }
            guard expectedHash == nil || expectedHash == .string(hash) else { return nil }
            return (path,hash,Int64(revision.size))
        }

        func install(_ source: URL, path: String) throws -> (name: String, hash: String, size: Int64) {
            try ModelDirectoryAccess.validatePaths([path])
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            let sourceDescriptor = open(source.path,O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            guard sourceDescriptor >= 0 else { throw modelFilePOSIXError() }
            let input = FileHandle(fileDescriptor:sourceDescriptor,closeOnDealloc:true)
            defer { try? input.close() }
            var sourceInfo = stat()
            guard fstat(sourceDescriptor,&sourceInfo) == 0, sourceInfo.st_mode & S_IFMT == S_IFREG else {
                throw ExchangeError.invalid("ダウンロードしたモデルファイルが不正です")
            }
            let sourceRevision = try ModelFileRevision(sourceDescriptor)
            guard sourceRevision.size >= 4, try input.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("GGUFファイルではありません")
            }
            try input.seek(toOffset:0)
            let components = path.split(separator:"/").map(String.init)
            guard let filename = components.last else { throw ExchangeError.invalid("モデルファイル名が不正です") }
            let parent = try ModelDirectoryAccess.openOrCreateDirectory(components.dropLast().joined(separator:"/"),from:parts)
            defer { close(parent) }
            let temporary = ".download-\(UUID().uuidString).part"
            let destination = openat(parent,temporary,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
            guard destination >= 0 else { throw modelFilePOSIXError() }
            defer { _ = unlinkat(parent,temporary,0) }
            let output = FileHandle(fileDescriptor:destination,closeOnDealloc:true)
            defer { try? output.close() }
            let hash = try ModelDirectoryAccess.transfer(input,to:output)
            try output.synchronize()
            guard try ModelFileRevision(sourceDescriptor) == sourceRevision else {
                throw ExchangeError.invalid("コピー中にダウンロードしたモデルファイルが変わりました")
            }
            // The temporary entry is descriptor-relative; rename replaces only this cache entry,
            // including a stale symlink, and never follows a target outside the cache.
            guard renameat(parent,temporary,parent,filename) == 0 else { throw modelFilePOSIXError() }
            return (path,hash,Int64(sourceRevision.size))
        }

        func discard() {
            guard !closed else { return }
            do { try ModelDirectoryAccess.removeContents(root) }
            catch { return }
            close(parts); close(root)
            _ = unlinkat(cacheParent,name,AT_REMOVEDIR)
            closed = true
            close(cacheParent)
        }

        private func closeDescriptors() {
            guard !closed else { return }
            closed = true
            close(parts); close(root); close(cacheParent)
        }
    }
    private static let directoryLock = NSLock()

    func directoryURL(modelID: String) throws -> URL {
        try url(modelID:modelID).deletingPathExtension()
    }

    func stageModelRemoval(modelID: String) throws -> ModelRemoval {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        let models = try removalModelsDirectory(create:true)
        defer { close(models) }
        let entries = try removalEntries(modelID:modelID,models:models)
        guard !entries.isEmpty else { return ModelRemoval(owner:self,record:nil) }
        let quarantines = try ModelDirectoryAccess.openOrCreateDirectory(".model-removals",from:models)
        defer { close(quarantines) }
        let name = UUID().uuidString.lowercased()
        guard mkdirat(quarantines,name,0o700) == 0 else { throw modelFilePOSIXError() }
        let quarantine = openat(quarantines,name,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard quarantine >= 0 else {
            _ = unlinkat(quarantines,name,AT_REMOVEDIR)
            throw modelFilePOSIXError()
        }
        defer { close(quarantine) }
        let record = ModelRemovalRecord(id:modelID,quarantine:name,entries:entries)
        var records = try removalRecords(models)
        records.append(record)
        do { try saveRemovalRecords(records,models:models) }
        catch {
            _ = unlinkat(quarantines,name,AT_REMOVEDIR)
            throw error
        }
        do {
            for entry in entries {
                guard renameat(models,entry,quarantine,entry) == 0 else { throw modelFilePOSIXError() }
            }
        } catch {
            let original = error
            var restored = true
            for entry in entries.reversed() {
                do {
                    let source = try removalExists(entry,in:quarantine)
                    let target = try removalExists(entry,in:models)
                    guard !(source && target), source || target else { restored = false; continue }
                    if source { guard renameat(quarantine,entry,models,entry) == 0 else { restored = false; continue } }
                } catch { restored = false }
            }
            if restored {
                do {
                    guard unlinkat(quarantines,name,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
                    try removeRemovalRecord(record,models:models)
                } catch {
                    // The byte rollback completed, but leave the journal for idempotent cleanup.
                    throw ModelRemovalRecoveryError.incompleteRollback
                }
            }
            // The journal remains authoritative until recovery has restored every entry.
            if restored { throw original }
            throw ModelRemovalRecoveryError.incompleteRollback
        }
        return ModelRemoval(owner:self,record:record)
    }

    func recoverModelRemovals(registeredIDs: [String]) throws {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        var info = stat()
        if lstat(directory.path,&info) != 0 {
            if errno == ENOENT { return }
            throw modelFilePOSIXError()
        }
        let models = try removalModelsDirectory(create:false)
        defer { close(models) }
        let registered = Set(registeredIDs.map { Data($0.utf8) })
        for record in try removalRecords(models) {
            if registered.contains(Data(record.id.utf8)) { try rollbackModelRemoval(record,models:models) }
            else { try commitModelRemoval(record,models:models) }
        }
    }

    func openDownloadCache(name: String) throws -> DownloadCache {
        try ModelDirectoryAccess.validatePaths([name])
        guard !name.contains("/") else { throw ExchangeError.invalid("モデルキャッシュ名が不正です") }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let models = open(directory.path,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard models >= 0 else { throw modelFilePOSIXError() }
        var cacheParent: Int32 = -1, root: Int32 = -1, parts: Int32 = -1
        do {
            cacheParent = try ModelDirectoryAccess.openOrCreateDirectory(".catalog-cache",from:models)
            root = try ModelDirectoryAccess.openOrCreateDirectory(name,from:cacheParent)
            parts = try ModelDirectoryAccess.openOrCreateDirectory("parts",from:root)
        } catch {
            if parts >= 0 { close(parts) }
            if root >= 0 { close(root) }
            if cacheParent >= 0 { close(cacheParent) }
            close(models)
            throw error
        }
        close(models)
        return DownloadCache(url:directory.appendingPathComponent(".catalog-cache").appendingPathComponent(name).appendingPathComponent("parts"),cacheParent:cacheParent,root:root,parts:parts,name:name)
    }

    private func removalModelsDirectory(create: Bool) throws -> Int32 {
        if create { try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true) }
        let descriptor = open(directory.path,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw modelFilePOSIXError() }
        return descriptor
    }
    private func removalEntryNames(modelID: String) throws -> [String] {
        let names = [try url(modelID:modelID).lastPathComponent, try directoryURL(modelID:modelID).lastPathComponent]
        guard names[0] != names[1] else { throw ExchangeError.invalid("モデルの削除先が不正です") }
        try ModelDirectoryAccess.validatePaths(names)
        return names
    }
    private func removalEntries(modelID: String, models: Int32) throws -> [String] {
        let names = try removalEntryNames(modelID:modelID)
        var result: [String] = []
        for (index,name) in names.enumerated() {
            var info = stat()
            if fstatat(models,name,&info,AT_SYMLINK_NOFOLLOW) != 0 {
                if errno == ENOENT { continue }
                throw modelFilePOSIXError()
            }
            let expected = index == 0 ? S_IFREG : S_IFDIR
            guard info.st_mode & S_IFMT == expected else { throw ExchangeError.invalid("モデル資産の形式が不正です") }
            result.append(name)
        }
        return result
    }
    private func removalExists(_ name: String, in directory: Int32) throws -> Bool {
        var info = stat()
        if fstatat(directory,name,&info,AT_SYMLINK_NOFOLLOW) == 0 { return true }
        if errno == ENOENT { return false }
        throw modelFilePOSIXError()
    }
    private func removalRecords(_ models: Int32) throws -> [ModelRemovalRecord] {
        let descriptor = openat(models,".model-removals-journal.json",O_RDONLY | O_NOFOLLOW)
        if descriptor < 0 {
            if errno == ENOENT { return [] }
            throw modelFilePOSIXError()
        }
        let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
        defer { try? file.close() }
        var info = stat()
        guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_size <= 1024 * 1024,
              let data = try file.readToEnd(), data.count == Int(info.st_size) else {
            throw ExchangeError.invalid("モデル削除記録が不正です")
        }
        let root = try OrderedJSON.decode(data)
        guard root["version"] == .number("1") else { throw ExchangeError.invalid("モデル削除記録の形式が不正です") }
        return try root.required("records").array("removal records").map { row in
            let id = try row.required("id").string("model id")
            let quarantine = try row.required("quarantine").string("quarantine")
            let entries = try row.required("entries").array("entries").map { try $0.string("entry") }
            let expected = try removalEntryNames(modelID:id)
            let entryBytes = Set(entries.map { Data($0.utf8) })
            try ModelDirectoryAccess.validatePaths([quarantine] + entries)
            guard UUID(uuidString:quarantine)?.uuidString.lowercased() == quarantine,
                  !entries.isEmpty, entryBytes.count == entries.count,
                  entries.allSatisfy({ entry in expected.contains { Data($0.utf8) == Data(entry.utf8) } }) else {
                throw ExchangeError.invalid("モデル削除記録の形式が不正です")
            }
            return .init(id:id,quarantine:quarantine,entries:entries)
        }
    }
    private func saveRemovalRecords(_ records: [ModelRemovalRecord], models: Int32) throws {
        let bytes = try OrderedJSON.object([
            .init(key:"version",value:.number("1")),.init(key:"records",value:.array(records.map { record in
                .object([.init(key:"id",value:.string(record.id)),.init(key:"quarantine",value:.string(record.quarantine)),.init(key:"entries",value:.array(record.entries.map(OrderedJSON.string)))])
            }))
        ]).encoded()
        let temporary = ".model-removals-\(UUID().uuidString).part"
        let descriptor = openat(models,temporary,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
        guard descriptor >= 0 else { throw modelFilePOSIXError() }
        var saved = false
        defer { if !saved { _ = unlinkat(models,temporary,0) } }
        let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
        defer { try? file.close() }
        try file.write(contentsOf:bytes); try file.synchronize()
        guard renameat(models,temporary,models,".model-removals-journal.json") == 0 else { throw modelFilePOSIXError() }
        saved = true
    }
    private func removeRemovalRecord(_ record: ModelRemovalRecord, models: Int32) throws {
        try saveRemovalRecords(try removalRecords(models).filter { $0.quarantine != record.quarantine },models:models)
    }
    private func removalEntryHasExpectedType(_ entry: String, record: ModelRemovalRecord, directory: Int32) throws -> Bool {
        let names = try removalEntryNames(modelID:record.id)
        guard let index = names.firstIndex(where: { Data($0.utf8) == Data(entry.utf8) }) else { return false }
        var info = stat()
        guard fstatat(directory,entry,&info,AT_SYMLINK_NOFOLLOW) == 0 else {
            if errno == ENOENT { return false }
            throw modelFilePOSIXError()
        }
        return info.st_mode & S_IFMT == (index == 0 ? S_IFREG : S_IFDIR)
    }
    private func removalTargetsRestored(_ record: ModelRemovalRecord, models: Int32) throws -> Bool {
        try record.entries.allSatisfy { try removalEntryHasExpectedType($0,record:record,directory:models) }
    }
    private func removalTargetsAbsent(_ record: ModelRemovalRecord, models: Int32) throws -> Bool {
        try record.entries.allSatisfy { !(try removalExists($0,in:models)) }
    }
    private func rollbackModelRemoval(_ record: ModelRemovalRecord) throws {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        let models = try removalModelsDirectory(create:false)
        defer { close(models) }
        try rollbackModelRemoval(record,models:models)
    }
    private func rollbackModelRemoval(_ record: ModelRemovalRecord, models: Int32) throws {
        let quarantines: Int32
        do { quarantines = try ModelDirectoryAccess.descriptor(".model-removals",from:models,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try removalTargetsRestored(record,models:models) else { throw error }
            try removeRemovalRecord(record,models:models)
            return
        }
        defer { close(quarantines) }
        let quarantine: Int32
        do { quarantine = try ModelDirectoryAccess.descriptor(record.quarantine,from:quarantines,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try removalTargetsRestored(record,models:models) else { throw error }
            try removeRemovalRecord(record,models:models)
            return
        }
        defer { close(quarantine) }
        for entry in record.entries {
            let source = try removalExists(entry,in:quarantine), target = try removalExists(entry,in:models)
            guard !(source && target), source || target else { throw ExchangeError.invalid("削除したモデル資産が見つかりません") }
            if source {
                guard try removalEntryHasExpectedType(entry,record:record,directory:quarantine) else {
                    throw ExchangeError.invalid("削除したモデル資産の形式が不正です")
                }
            } else {
                guard try removalEntryHasExpectedType(entry,record:record,directory:models) else {
                    throw ExchangeError.invalid("削除したモデル資産の形式が不正です")
                }
            }
        }
        for entry in record.entries where try removalExists(entry,in:quarantine) {
            guard renameat(quarantine,entry,models,entry) == 0 else { throw modelFilePOSIXError() }
        }
        guard unlinkat(quarantines,record.quarantine,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
        try removeRemovalRecord(record,models:models)
    }
    private func commitModelRemoval(_ record: ModelRemovalRecord) throws {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        let models = try removalModelsDirectory(create:false)
        defer { close(models) }
        try commitModelRemoval(record,models:models)
    }
    private func commitModelRemoval(_ record: ModelRemovalRecord, models: Int32) throws {
        let quarantines: Int32
        do { quarantines = try ModelDirectoryAccess.descriptor(".model-removals",from:models,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try removalTargetsAbsent(record,models:models) else { throw error }
            try removeRemovalRecord(record,models:models)
            return
        }
        defer { close(quarantines) }
        let quarantine: Int32
        do { quarantine = try ModelDirectoryAccess.descriptor(record.quarantine,from:quarantines,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try removalTargetsAbsent(record,models:models) else { throw error }
            try removeRemovalRecord(record,models:models)
            return
        }
        defer { close(quarantine) }
        for entry in record.entries {
            var info = stat()
            if fstatat(quarantine,entry,&info,AT_SYMLINK_NOFOLLOW) != 0 {
                if errno == ENOENT { continue }
                throw modelFilePOSIXError()
            }
            if info.st_mode & S_IFMT == S_IFDIR {
                let child = try ModelDirectoryAccess.descriptor(entry,from:quarantine,directory:true)
                defer { close(child) }
                try ModelDirectoryAccess.removeContents(child)
                guard unlinkat(quarantine,entry,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
            } else if info.st_mode & S_IFMT == S_IFREG {
                guard unlinkat(quarantine,entry,0) == 0 else { throw modelFilePOSIXError() }
            } else { throw ExchangeError.invalid("削除したモデル資産の形式が不正です") }
        }
        guard unlinkat(quarantines,record.quarantine,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
        try removeRemovalRecord(record,models:models)
    }

    private func directoryPlan(_ model: OrderedJSON, files: [String] = []) throws -> OrderedJSON {
        // Only the existing Web declaration enters JS; opaque metadata stays untouched.
        let projected = OrderedJSON.object(try ["id", "engine", "manifest"].map { .init(key:$0,value:try model.required($0)) })
        return try SharedWebOperations.call("localModelFiles",.object([
            .init(key:"model",value:projected),.init(key:"files",value:.array(files.map(OrderedJSON.string)))
        ]))
    }

    func inspectDirectory(_ source: URL, model: OrderedJSON) throws -> DirectoryInspection {
        try Task.checkCancellation()
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let reader = try ModelDirectoryAccess(source)
        let names = try reader.enumerate()
        let plan = try directoryPlan(model,files:names)
        let selected = try plan.required("files").array("files").map { try $0.string("file") }
        let required = try plan.required("requiredFiles").array("requiredFiles").map { try $0.string("file") }
        try ModelDirectoryAccess.validatePaths(required)
        guard required.allSatisfy({ path in selected.contains { Data($0.utf8) == Data(path.utf8) } }) else {
            throw ExchangeError.invalid("モデルの必須ファイルがありません")
        }
        var identities = Set<ModelFileIdentity>()
        let files = try selected.map { path -> DirectoryFile in
            let handle = try reader.openFile(path)
            defer { try? handle.close() }
            let revision = try ModelFileRevision(handle.fileDescriptor)
            guard (revision.size > 0 || !required.contains { Data($0.utf8) == Data(path.utf8) }), identities.insert(revision.identity).inserted else {
                throw ExchangeError.invalid("モデルファイルが空か同じファイルの別名です")
            }
            let digest = try ModelDirectoryAccess.transfer(handle)
            try reader.check(path,revision:revision)
            return DirectoryFile(path:path,hash:digest,size:revision.size,revision:revision)
        }
        try reader.checkDirectories()
        try reader.checkRootPath()
        let target = try directoryURL(modelID:model.required("id").string("id"))
        let targetRevision = try directoryRevision(target)
        let declaration = try directoryPlan(model).encoded()
        return DirectoryInspection(declaration:declaration,directories:reader.directories,targetRevision:targetRevision,files:files)
    }

    func installDirectory(_ source: URL, model: OrderedJSON, inspection: DirectoryInspection) throws {
        let staged = try stageDirectory(source,model:model,inspection:inspection)
        defer { staged.discard() }
        try publishDirectory(staged,model:model)
    }

    func stageDirectory(_ source: URL, model: OrderedJSON, inspection: DirectoryInspection) throws -> DirectoryStage {
        try Task.checkCancellation()
        guard try directoryPlan(model).encoded() == inspection.declaration else {
            throw ExchangeError.invalid("確認したモデルと登録先のモデルが一致しません")
        }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let reader = try ModelDirectoryAccess(source)
        _ = try reader.enumerate()
        guard reader.directories == inspection.directories else {
            throw ExchangeError.invalid("登録中にモデルのディレクトリが変わりました")
        }
        let modelID = try model.required("id").string("model id")
        let target = try directoryURL(modelID:modelID)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let pending = directory.appendingPathComponent(".model-\(UUID().uuidString).part")
        try FileManager.default.createDirectory(at:pending,withIntermediateDirectories:false)
        var staged = false
        defer { if !staged { try? FileManager.default.removeItem(at:pending) } }
        for file in inspection.files {
            try Task.checkCancellation()
            let handle = try reader.openFile(file.path)
            defer { try? handle.close() }
            guard try ModelFileRevision(handle.fileDescriptor) == file.revision else {
                throw ExchangeError.invalid("登録中にモデルのファイルが変わりました")
            }
            let destination = pending.appendingPathComponent(file.path)
            try FileManager.default.createDirectory(at:destination.deletingLastPathComponent(),withIntermediateDirectories:true)
            let descriptor = open(destination.path,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
            guard descriptor >= 0 else { throw modelFilePOSIXError() }
            let output = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? output.close() }
            let hash = try ModelDirectoryAccess.transfer(handle,to:output)
            try output.synchronize()
            guard hash == file.hash else { throw ExchangeError.invalid("コピーしたモデルのハッシュが一致しません") }
            try reader.check(file.path,revision:file.revision)
        }
        for file in inspection.files { try reader.check(file.path,revision:file.revision) }
        try reader.checkDirectories()
        try reader.checkRootPath()
        try Task.checkCancellation()
        let result = DirectoryStage(pending:pending,target:target,inspection:inspection)
        staged = true
        return result
    }

    func publishDirectory(_ staged: DirectoryStage, model: OrderedJSON) throws {
        guard Self.directoryLock.try() else { throw ExchangeError.invalid("端末内のモデルファイルを処理中です。もう一度選択してください") }
        defer { Self.directoryLock.unlock() }
        try Task.checkCancellation()
        guard !staged.published, try directoryPlan(model).encoded() == staged.inspection.declaration,
              try directoryURL(modelID:model.required("id").string("id")) == staged.target else {
            throw ExchangeError.invalid("確認したモデルと登録先のモデルが一致しません")
        }
        guard try directoryRevision(staged.target) == staged.inspection.targetRevision else {
            throw ExchangeError.invalid("確認後に登録先のモデルが変わりました")
        }
        // Darwin exchanges directories atomically; the previous generation becomes pending.
        let flags: UInt32
        if FileManager.default.fileExists(atPath:staged.target.path) {
            flags = UInt32(RENAME_SWAP)
        } else { flags = UInt32(RENAME_EXCL) }
        guard renamex_np(staged.pending.path,staged.target.path,flags) == 0 else { throw modelFilePOSIXError() }
        staged.published = true
        do {
            guard let revision = try directoryRevision(staged.target) else {
                throw ExchangeError.invalid("登録したモデルのディレクトリが見つかりません")
            }
            staged.publishedTargetRevision = revision
        } catch {
            staged.preservesPending = true
            throw error
        }
    }

    func rollbackDirectory(_ staged: DirectoryStage, model: OrderedJSON) throws {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        guard staged.published else {
            throw ExchangeError.invalid("登録済みのモデルディレクトリを選択してください")
        }
        do {
            guard try directoryPlan(model).encoded() == staged.inspection.declaration,
                  try directoryURL(modelID:model.required("id").string("id")) == staged.target,
                  let publishedTargetRevision = staged.publishedTargetRevision,
                  try directoryRevision(staged.target) == publishedTargetRevision else {
                throw ExchangeError.invalid("登録後にモデルのディレクトリが変わりました")
            }
            if staged.inspection.targetRevision != nil {
                guard renamex_np(staged.pending.path,staged.target.path,UInt32(RENAME_SWAP)) == 0 else { throw modelFilePOSIXError() }
            } else {
                guard rename(staged.target.path,staged.pending.path) == 0 else { throw modelFilePOSIXError() }
            }
        } catch {
            staged.preservesPending = true
            throw error
        }
        staged.published = false
        staged.publishedTargetRevision = nil
    }

    func installed(model: OrderedJSON) throws -> URL {
        let id = try model.required("id").string("id")
        guard try model.required("engine").string("engine") == "wllama" else {
            throw ExchangeError.invalid("GGUF モデルを選択してください")
        }
        let manifest = try model.required("manifest")
        let kind = try manifest.required("kind").string("manifest kind")
        if kind == "single-file" { return try installed(modelID:id) }
        guard kind == "gguf-sharded" else {
            throw ExchangeError.invalid("GGUF モデルを選択してください")
        }
        let plan = try directoryPlan(model)
        let required = try plan.required("requiredFiles").array("required files").map { try $0.string("file") }
        let entrypoint = try plan.required("entrypoint").string("entrypoint")
        try ModelDirectoryAccess.validatePaths(required)
        let root = try directoryURL(modelID:id)
        let reader = try ModelDirectoryAccess(root)
        let names = try reader.enumerate()
        let selected = try directoryPlan(model,files:names).required("files").array("files").map { try $0.string("file") }
        guard required.allSatisfy({ path in selected.contains { Data($0.utf8) == Data(path.utf8) } }) else {
            throw ExchangeError.invalid("モデルの必須ファイルがありません")
        }
        var identities = Set<ModelFileIdentity>()
        for path in required {
            let file = try reader.openFile(path)
            defer { try? file.close() }
            let revision = try ModelFileRevision(file.fileDescriptor)
            guard revision.size >= 4, identities.insert(revision.identity).inserted else {
                throw ExchangeError.invalid("GGUF ファイルが不正です")
            }
            guard try file.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("GGUF ファイルが不正です")
            }
            try reader.check(path,revision:revision)
        }
        try reader.checkDirectories()
        try reader.checkRootPath()
        return root.appendingPathComponent(entrypoint)
    }

    func directoryEntries(model: OrderedJSON) throws -> [(path: String, data: Data)] {
        let plan = try directoryPlan(model)
        let reader = try ModelDirectoryAccess(directoryURL(modelID:plan.required("id").string("id")))
        let names = try reader.enumerate()
        let files = try directoryPlan(model,files:names).required("files").array("files").map { try $0.string("file") }
        let required = try plan.required("requiredFiles").array("required files").map { try $0.string("file") }
        try ModelDirectoryAccess.validatePaths(required)
        guard required.allSatisfy({ path in files.contains { Data($0.utf8) == Data(path.utf8) } }) else {
            throw ExchangeError.invalid("モデルの必須ファイルがありません")
        }
        var identities = Set<ModelFileIdentity>()
        let entries = try files.map { path -> (path:String,data:Data) in
            let handle = try reader.openFile(path)
            defer { try? handle.close() }
            let revision = try ModelFileRevision(handle.fileDescriptor)
            guard (revision.size > 0 || !required.contains { Data($0.utf8) == Data(path.utf8) }), identities.insert(revision.identity).inserted else {
                throw ExchangeError.invalid("モデルファイルが空か同じファイルの別名です")
            }
            let data = try handle.readToEnd() ?? Data()
            guard UInt64(data.count) == revision.size else { throw ExchangeError.invalid("モデルファイルの読み込みが不完全です") }
            try reader.check(path,revision:revision)
            return (path,data)
        }
        try reader.checkDirectories()
        try reader.checkRootPath()
        return entries
    }

    func directoryIsPresent(modelID: String) throws -> Bool {
        try directoryRevision(directoryURL(modelID:modelID)) != nil
    }

    private func directoryRevision(_ target: URL) throws -> ModelFileRevision? {
        var info = stat()
        if lstat(target.path,&info) != 0 {
            if errno == ENOENT { return nil }
            throw modelFilePOSIXError()
        }
        return try ModelDirectoryAccess(target).directories[""]
    }

    func removeDirectory(modelID: String) throws {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        let target = try directoryURL(modelID:modelID)
        let reader = try ModelDirectoryAccess(target)
        try reader.checkRootPath()
        try FileManager.default.removeItem(at:target)
    }
}

private func modelFilePOSIXError() -> POSIXError { POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
fileprivate struct ModelFileIdentity: Hashable { let device: Int32; let inode: UInt64 }
fileprivate struct ModelFileRevision: Equatable {
    let identity: ModelFileIdentity
    let size: UInt64
    let modifiedSeconds: Int
    let modifiedNanoseconds: Int
    let changedSeconds: Int
    let changedNanoseconds: Int
    init(_ descriptor: Int32) throws {
        var info = stat()
        guard fstat(descriptor,&info) == 0 else { throw modelFilePOSIXError() }
        identity = .init(device:info.st_dev,inode:info.st_ino)
        size = UInt64(info.st_size)
        modifiedSeconds = info.st_mtimespec.tv_sec; modifiedNanoseconds = info.st_mtimespec.tv_nsec
        changedSeconds = info.st_ctimespec.tv_sec; changedNanoseconds = info.st_ctimespec.tv_nsec
    }
}

private final class ModelDirectoryAccess {
    let url: URL
    let root: Int32
    var directories: [String:ModelFileRevision] = [:]
    init(_ url: URL) throws {
        guard url.isFileURL else { throw ExchangeError.invalid("端末内のモデルディレクトリを選択してください") }
        self.url = url
        root = open(url.path,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard root >= 0 else { throw modelFilePOSIXError() }
        do { directories[""] = try ModelFileRevision(root) }
        catch { close(root); throw error }
    }
    deinit { close(root) }
    static func validatePaths(_ paths: [String]) throws {
        var unique = Set<Data>()
        for path in paths {
            let components = path.split(separator:"/",omittingEmptySubsequences:false)
            guard !path.utf8.contains(0), !components.isEmpty,
                  components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
                  unique.insert(Data(path.utf8)).inserted else {
                throw ExchangeError.invalid("モデルの相対ファイルパスが不正です")
            }
        }
    }
    static func descriptor(_ path: String, from root: Int32, directory: Bool) throws -> Int32 {
        if path.isEmpty && directory { return dup(root) }
        try Self.validatePaths([path])
        let components = path.split(separator:"/").map(String.init)
        var current = dup(root)
        guard current >= 0 else { throw modelFilePOSIXError() }
        for (index,name) in components.enumerated() {
            let isDirectory = directory || index < components.count - 1
            let next = openat(current,name,O_RDONLY | O_NOFOLLOW | (isDirectory ? O_DIRECTORY : O_NONBLOCK))
            close(current)
            guard next >= 0 else { throw modelFilePOSIXError() }
            current = next
        }
        return current
    }
    func descriptor(_ path: String, directory: Bool) throws -> Int32 {
        try Self.descriptor(path,from:root,directory:directory)
    }
    static func openOrCreateDirectory(_ path: String, from root: Int32) throws -> Int32 {
        if path.isEmpty { return dup(root) }
        try validatePaths([path])
        var current = dup(root)
        guard current >= 0 else { throw modelFilePOSIXError() }
        for name in path.split(separator:"/").map(String.init) {
            if mkdirat(current,name,0o700) != 0, errno != EEXIST {
                close(current); throw modelFilePOSIXError()
            }
            let next = openat(current,name,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            close(current)
            guard next >= 0 else { throw modelFilePOSIXError() }
            current = next
        }
        return current
    }
    func openFile(_ path: String) throws -> FileHandle {
        let descriptor = try descriptor(path,directory:false)
        var info = stat()
        guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG else {
            close(descriptor); throw ExchangeError.invalid("モデルには通常のファイルのみ使用できます")
        }
        return FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
    }
    func enumerate() throws -> [String] {
        var paths: [String] = []
        func walk(_ descriptor: Int32, _ prefix: String) throws {
            guard let stream = fdopendir(dup(descriptor)) else { throw modelFilePOSIXError() }
            defer { closedir(stream) }
            errno = 0
            while let item = readdir(stream) {
                try Task.checkCancellation()
                let name = withUnsafePointer(to:&item.pointee.d_name) { pointer in
                    pointer.withMemoryRebound(to:CChar.self,capacity:1024) { String(validatingCString:$0) }
                }
                guard let name else { throw ExchangeError.invalid("UTF8ではないモデルファイル名です") }
                if name == "." || name == ".." { continue }
                let path = prefix.isEmpty ? name : prefix + "/" + name
                var info = stat()
                guard fstatat(descriptor,name,&info,AT_SYMLINK_NOFOLLOW) == 0 else { throw modelFilePOSIXError() }
                if info.st_mode & S_IFMT == S_IFDIR {
                    let child = openat(descriptor,name,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                    guard child >= 0 else { throw modelFilePOSIXError() }
                    defer { close(child) }
                    directories[path] = try ModelFileRevision(child)
                    try walk(child,path)
                } else if info.st_mode & S_IFMT == S_IFREG { paths.append(path) }
                else { throw ExchangeError.invalid("モデルのリンクまたは特殊ファイルは使用できません") }
                errno = 0
            }
            guard errno == 0 else { throw modelFilePOSIXError() }
        }
        try walk(root,"")
        try Self.validatePaths(paths)
        return paths.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
    }
    static func transfer(_ input: FileHandle, to output: FileHandle? = nil) throws -> String {
        var hash = SHA256()
        while let chunk = try input.read(upToCount:1024 * 1024), !chunk.isEmpty {
            try Task.checkCancellation()
            hash.update(data:chunk)
            try output?.write(contentsOf:chunk)
        }
        return hash.finalize().map { String(format:"%02x",$0) }.joined()
    }
    static func removeContents(_ descriptor: Int32) throws {
        guard let stream = fdopendir(dup(descriptor)) else { throw modelFilePOSIXError() }
        defer { closedir(stream) }
        errno = 0
        while let item = readdir(stream) {
            let name = withUnsafePointer(to:&item.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to:CChar.self,capacity:1024) { String(validatingCString:$0) }
            }
            guard let name else { throw ExchangeError.invalid("UTF8ではないモデルファイル名です") }
            if name == "." || name == ".." { continue }
            var info = stat()
            guard fstatat(descriptor,name,&info,AT_SYMLINK_NOFOLLOW) == 0 else { throw modelFilePOSIXError() }
            if info.st_mode & S_IFMT == S_IFDIR {
                let child = openat(descriptor,name,O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                guard child >= 0 else { throw modelFilePOSIXError() }
                do { try removeContents(child) }
                catch { close(child); throw error }
                close(child)
                guard unlinkat(descriptor,name,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
            } else {
                guard unlinkat(descriptor,name,0) == 0 else { throw modelFilePOSIXError() }
            }
            errno = 0
        }
        guard errno == 0 else { throw modelFilePOSIXError() }
    }
    func check(_ path: String, revision: ModelFileRevision) throws {
        let file = try openFile(path)
        defer { try? file.close() }
        guard try ModelFileRevision(file.fileDescriptor) == revision else {
            throw ExchangeError.invalid("登録中にモデルのファイルが変わりました")
        }
    }
    func checkDirectories() throws {
        for (path,revision) in directories {
            let current = try descriptor(path,directory:true)
            defer { close(current) }
            guard try ModelFileRevision(current) == revision else {
                throw ExchangeError.invalid("モデルのディレクトリが変わりました")
            }
        }
    }
    func checkRootPath() throws {
        let current = try ModelDirectoryAccess(url)
        guard current.directories[""] == directories[""] else {
            throw ExchangeError.invalid("モデルのディレクトリが置き換わりました")
        }
    }
}
