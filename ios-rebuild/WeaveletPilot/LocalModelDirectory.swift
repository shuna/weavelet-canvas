import Foundation
import CryptoKit
import Darwin

extension LocalModelFiles {
    enum ModelAssetKind: String, Codable { case modelFile, modelDirectory, downloadCache, staleStage }
    struct ModelAssetInventoryFile { let name: String; let size: UInt64; let isTemp: Bool }
    struct ModelAssetInventoryEntry {
        let kind: ModelAssetKind; let key: String; let files: [ModelAssetInventoryFile]; let total: UInt64
        fileprivate let path: URL; fileprivate let snapshot: AssetSnapshot
        fileprivate let modelsIdentity: ModelFileIdentity; fileprivate let parentIdentity: ModelFileIdentity
    }
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
    struct SelectedGGUF {
        let url: URL
        let name: String
        // `hash` verifies every source byte before staging; `fingerprint` is the
        // Web-compatible identity used when the selected model is registered.
        let hash: String
        let fingerprint: String
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
    fileprivate struct AssetSnapshot: Codable, Equatable {
        let revisions: [String: ModelFileRevision]
        let directories: [String]
    }
    fileprivate struct AssetRemoval: Codable {
        let kind: ModelAssetKind
        let key: String
        let subset: Bool
        let staged: Bool
        let rollbackRequested: Bool?
        let snapshot: AssetSnapshot
        let modelsIdentity: ModelFileIdentity
        let parentIdentity: ModelFileIdentity
    }
    fileprivate struct ModelRemovalRecord {
        let id: String
        let quarantine: String
        let entries: [String]
        let asset: AssetRemoval?
        let rollbackOnRecovery: Bool?
        init(id: String, quarantine: String, entries: [String], asset: AssetRemoval? = nil, rollbackOnRecovery: Bool? = nil) {
            self.id = id; self.quarantine = quarantine; self.entries = entries; self.asset = asset; self.rollbackOnRecovery = rollbackOnRecovery
        }
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

    private func validAssetName(_ kind: ModelAssetKind, _ name: String) -> Bool {
        func hash(_ value: String) -> Bool {
            value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
        switch kind {
        case .modelFile: return name.hasSuffix(".gguf") && hash(String(name.dropLast(5)))
        case .modelDirectory, .downloadCache: return hash(name)
        case .staleStage:
            if name.hasPrefix(".model-"), name.hasSuffix(".part") { return UUID(uuidString:String(name.dropFirst(7).dropLast(5))) != nil }
            return (name.hasSuffix(".part") || name.hasSuffix(".gguf")) && UUID(uuidString:String(name.dropLast(5))) != nil
        }
    }
    private func assetIsDirectory(_ kind: ModelAssetKind, _ key: String) -> Bool {
        kind == .modelDirectory || kind == .downloadCache || (kind == .staleStage && key.hasPrefix(".model-"))
    }
    private func assetSnapshot(_ descriptor: Int32, isDirectory: Bool) throws -> AssetSnapshot {
        var rootInfo = stat()
        guard fstat(descriptor,&rootInfo) == 0, rootInfo.st_mode & S_IFMT == (isDirectory ? S_IFDIR : S_IFREG) else { throw ExchangeError.invalid("モデル資産の形式が不正です") }
        var revisions = ["": try ModelFileRevision(descriptor)]
        var directories: [String] = isDirectory ? [""] : []
        func walk(_ parent: Int32, prefix: String) throws {
            for name in try inventoryNames(parent) {
                let path = prefix.isEmpty ? name : prefix + "/" + name
                var info = stat()
                guard fstatat(parent,name,&info,AT_SYMLINK_NOFOLLOW) == 0 else { throw modelFilePOSIXError() }
                let isDirectory = info.st_mode & S_IFMT == S_IFDIR
                guard isDirectory || info.st_mode & S_IFMT == S_IFREG else {
                    throw ExchangeError.invalid("モデル資産のリンクまたは特殊ファイルは削除できません")
                }
                let child = try ModelDirectoryAccess.descriptor(name,from:parent,directory:isDirectory)
                defer { close(child) }
                guard revisions.updateValue(try ModelFileRevision(child),forKey:path) == nil else { throw ExchangeError.invalid("モデル資産のファイル名が重複しています") }
                if isDirectory { directories.append(path); try walk(child,prefix:path) }
            }
        }
        if isDirectory { try walk(descriptor,prefix:"") }
        // Reopen every node to catch an edit or replacement during enumeration.
        for (path,revision) in revisions {
            let current = path.isEmpty ? dup(descriptor) : try ModelDirectoryAccess.descriptor(path,from:descriptor,directory:directories.contains(path))
            guard current >= 0 else { throw modelFilePOSIXError() }
            defer { close(current) }
            guard try ModelFileRevision(current) == revision else { throw ExchangeError.invalid("確認中にモデル資産が変わりました") }
        }
        return AssetSnapshot(revisions:revisions,directories:directories.sorted())
    }
    func modelAssetInventory() throws -> [ModelAssetInventoryEntry] {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        var info = stat()
        if lstat(directory.path,&info) != 0 { if errno == ENOENT { return [] }; throw modelFilePOSIXError() }
        let models = try removalModelsDirectory(create:false)
        defer { close(models) }
        let modelsIdentity = try ModelFileRevision(models).identity
        var result: [ModelAssetInventoryEntry] = []
        func add(_ kind: ModelAssetKind, _ key: String, parent: Int32, url: URL) throws {
            let isDirectory = assetIsDirectory(kind,key)
            let descriptor = try ModelDirectoryAccess.descriptor(key,from:parent,directory:isDirectory)
            defer { close(descriptor) }
            let snapshot = try assetSnapshot(descriptor,isDirectory:isDirectory)
            let current = try ModelDirectoryAccess.descriptor(key,from:parent,directory:isDirectory)
            defer { close(current) }
            guard try ModelFileRevision(current) == snapshot.revisions[""] else { throw ExchangeError.invalid("確認中にモデル資産が置き換わりました") }
            let files = snapshot.revisions.keys.filter { !snapshot.directories.contains($0) }.sorted().map { path in
                let name = isDirectory ? path : key
                return ModelAssetInventoryFile(name:name,size:snapshot.revisions[path]!.size,isTemp:name.hasSuffix(".part"))
            }
            result.append(.init(kind:kind,key:key,files:files,total:files.reduce(0) { $0 + $1.size },path:url,snapshot:snapshot,modelsIdentity:modelsIdentity,parentIdentity:try ModelFileRevision(parent).identity))
        }
        for name in try inventoryNames(models).sorted() {
            var item = stat()
            guard fstatat(models,name,&item,AT_SYMLINK_NOFOLLOW) == 0 else { throw modelFilePOSIXError() }
            if item.st_mode & S_IFMT == S_IFREG {
                if validAssetName(.modelFile,name) { try add(.modelFile,name,parent:models,url:directory.appendingPathComponent(name)) }
                else if validAssetName(.staleStage,name), !assetIsDirectory(.staleStage,name) { try add(.staleStage,name,parent:models,url:directory.appendingPathComponent(name)) }
            } else if item.st_mode & S_IFMT == S_IFDIR {
                if validAssetName(.modelDirectory,name) { try add(.modelDirectory,name,parent:models,url:directory.appendingPathComponent(name)) }
                else if validAssetName(.staleStage,name) { try add(.staleStage,name,parent:models,url:directory.appendingPathComponent(name)) }
            }
        }
        if try removalExists(".catalog-cache",in:models) {
            let cache = try ModelDirectoryAccess.descriptor(".catalog-cache",from:models,directory:true)
            defer { close(cache) }
            for name in try inventoryNames(cache).sorted() where validAssetName(.downloadCache,name) {
                var item = stat()
                guard fstatat(cache,name,&item,AT_SYMLINK_NOFOLLOW) == 0 else { throw modelFilePOSIXError() }
                if item.st_mode & S_IFMT == S_IFDIR { try add(.downloadCache,name,parent:cache,url:directory.appendingPathComponent(".catalog-cache").appendingPathComponent(name)) }
            }
        }
        return result
    }
    private func inventoryNames(_ descriptor: Int32) throws -> [String] {
        guard let stream = fdopendir(dup(descriptor)) else { throw modelFilePOSIXError() }; defer { closedir(stream) }
        var result:[String] = []; errno = 0
        while let item = readdir(stream) { let name = withUnsafePointer(to:&item.pointee.d_name) { $0.withMemoryRebound(to:CChar.self,capacity:1024) { String(validatingCString:$0) } }; guard let name else { throw ExchangeError.invalid("UTF8ではないモデル資産名です") }; if name != "." && name != ".." { result.append(name) }; errno = 0 }
        guard errno == 0 else { throw modelFilePOSIXError() }; return result
    }

    func directoryURL(modelID: String) throws -> URL {
        try url(modelID:modelID).deletingPathExtension()
    }

    func stageModelRemoval(modelID: String, expectedEntry: ModelAssetInventoryEntry? = nil, rollbackOnRestart: Bool = false) throws -> ModelRemoval {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        let models = try removalModelsDirectory(create:true)
        defer { close(models) }
        if let entry = expectedEntry {
            let names = try removalEntryNames(modelID:modelID)
            guard (entry.kind == .modelFile && entry.key.utf8.elementsEqual(names[0].utf8)) ||
                  (entry.kind == .modelDirectory && entry.key.utf8.elementsEqual(names[1].utf8)),
                  try ModelFileRevision(models).identity == entry.modelsIdentity,
                  entry.modelsIdentity == entry.parentIdentity else { throw ExchangeError.invalid("モデル一覧の資産が一致しません") }
            let source = try ModelDirectoryAccess.descriptor(entry.key,from:models,directory:entry.kind == .modelDirectory)
            defer { close(source) }
            guard try assetSnapshot(source,isDirectory:entry.kind == .modelDirectory) == entry.snapshot else { throw ExchangeError.invalid("一覧の取得後にモデル資産が変わりました") }
            let current = try ModelDirectoryAccess.descriptor(entry.key,from:models,directory:entry.kind == .modelDirectory)
            defer { close(current) }
            guard try ModelFileRevision(current) == entry.snapshot.revisions[""] else { throw ExchangeError.invalid("一覧の取得後にモデル資産が置き換わりました") }
        }
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
        let record = ModelRemovalRecord(id:modelID,quarantine:name,entries:entries,rollbackOnRecovery:rollbackOnRestart ? true : nil)
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
                    if source { guard renameatx_np(quarantine,entry,models,entry,UInt32(RENAME_EXCL)) == 0 else { restored = false; continue } }
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

    func stageUnregisteredAssetRemoval(_ entry: ModelAssetInventoryEntry, registeredIDs: [String]) throws -> ModelRemoval {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        if entry.kind == .modelFile || entry.kind == .modelDirectory {
            let names = try registeredIDs.flatMap { try removalEntryNames(modelID:$0) }
            guard !names.contains(where:{ $0.utf8.elementsEqual(entry.key.utf8) }) else {
                throw ExchangeError.invalid("登録済みのモデル資産はモデル一覧から削除してください")
            }
        }
        return try stageAssetRemoval(entry,paths:nil)
    }
    func stageAssetFileRemoval(_ entry: ModelAssetInventoryEntry, paths: [String]) throws -> ModelRemoval {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
        guard !paths.isEmpty, assetIsDirectory(entry.kind,entry.key) || entry.kind == .staleStage else { throw ExchangeError.invalid("モデル資産の削除対象が不正です") }
        try ModelDirectoryAccess.validatePaths(paths)
        let files = Set(entry.files.map { Data($0.name.utf8) })
        for path in paths where !files.contains(Data(path.utf8)) {
            let marker = path + ".part"
            guard !path.hasSuffix(".part"), paths.contains(marker), files.contains(Data(marker.utf8)) else {
                throw ExchangeError.invalid("一覧にないモデルファイルは削除できません")
            }
        }
        let selected = paths.filter { files.contains(Data($0.utf8)) }
        return try stageAssetRemoval(entry,paths:assetIsDirectory(entry.kind,entry.key) ? selected : nil)
    }
    private func assetParent(_ asset: AssetRemoval, models: Int32) throws -> Int32 {
        guard try ModelFileRevision(models).identity == asset.modelsIdentity else { throw ExchangeError.invalid("モデル資産の保存先が置き換わりました") }
        let parent = asset.kind == .downloadCache ? try ModelDirectoryAccess.descriptor(".catalog-cache",from:models,directory:true) : dup(models)
        guard parent >= 0 else { throw modelFilePOSIXError() }
        do {
            guard try ModelFileRevision(parent).identity == asset.parentIdentity else { throw ExchangeError.invalid("モデル資産の保存先が置き換わりました") }
        } catch { close(parent); throw error }
        return parent
    }
    private func assetSource(_ asset: AssetRemoval, models: Int32) throws -> Int32 {
        let parent = try assetParent(asset,models:models)
        if !asset.subset { return parent }
        defer { close(parent) }
        let source = try ModelDirectoryAccess.descriptor(asset.key,from:parent,directory:true)
        guard try ModelFileRevision(source).identity == asset.snapshot.revisions[""]?.identity else {
            close(source); throw ExchangeError.invalid("モデル資産が置き換わりました")
        }
        return source
    }
    private func stageAssetRemoval(_ entry: ModelAssetInventoryEntry, paths: [String]?) throws -> ModelRemoval {
        guard validAssetName(entry.kind,entry.key) else { throw ExchangeError.invalid("モデル資産名が不正です") }
        let models = try removalModelsDirectory(create:false)
        defer { close(models) }
        let asset = AssetRemoval(kind:entry.kind,key:entry.key,subset:paths != nil,staged:false,rollbackRequested:nil,snapshot:entry.snapshot,modelsIdentity:entry.modelsIdentity,parentIdentity:entry.parentIdentity)
        let parent = try assetParent(asset,models:models)
        defer { close(parent) }
        let source = try ModelDirectoryAccess.descriptor(entry.key,from:parent,directory:assetIsDirectory(entry.kind,entry.key))
        defer { close(source) }
        guard try assetSnapshot(source,isDirectory:assetIsDirectory(entry.kind,entry.key)) == entry.snapshot else { throw ExchangeError.invalid("一覧の取得後にモデル資産が変わりました") }
        let current = try ModelDirectoryAccess.descriptor(entry.key,from:parent,directory:assetIsDirectory(entry.kind,entry.key))
        defer { close(current) }
        guard try ModelFileRevision(current) == entry.snapshot.revisions[""] else { throw ExchangeError.invalid("一覧の取得後にモデル資産が置き換わりました") }
        let quarantines = try ModelDirectoryAccess.openOrCreateDirectory(".model-removals",from:models)
        defer { close(quarantines) }
        let name = UUID().uuidString.lowercased()
        guard mkdirat(quarantines,name,0o700) == 0 else { throw modelFilePOSIXError() }
        let record = ModelRemovalRecord(id:"",quarantine:name,entries:paths ?? [entry.key],asset:asset)
        do { try saveRemovalRecords(try removalRecords(models) + [record],models:models) }
        catch { _ = unlinkat(quarantines,name,AT_REMOVEDIR); throw error }
        do {
            try stageAssetEntries(record,models:models)
            let staged = try markAssetStaged(record,models:models)
            return ModelRemoval(owner:self,record:staged)
        } catch {
            let original = error
            do { try rollbackAssetRemoval(record,models:models) }
            catch { throw ModelRemovalRecoveryError.incompleteRollback }
            throw original
        }
    }
    private func sameMovedGeneration(_ current: ModelFileRevision, _ original: ModelFileRevision) -> Bool {
        current.identity == original.identity && current.size == original.size && current.modifiedSeconds == original.modifiedSeconds && current.modifiedNanoseconds == original.modifiedNanoseconds
    }
    private func assetNodeRevision(_ name: String, parent: Int32, directory: Bool) throws -> ModelFileRevision? {
        if !(try removalExists(name,in:parent)) { return nil }
        let descriptor = try ModelDirectoryAccess.descriptor(name,from:parent,directory:directory)
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == (directory ? S_IFDIR : S_IFREG) else { throw ExchangeError.invalid("モデル資産の形式が不正です") }
        return try ModelFileRevision(descriptor)
    }
    private func withAssetEntryParent(_ path: String, root: Int32, snapshot: AssetSnapshot?, _ body: (Int32, String) throws -> Void) throws {
        let parts = path.split(separator:"/").map(String.init)
        guard let name = parts.last else { throw ExchangeError.invalid("モデル資産の相対パスが不正です") }
        var parent = dup(root)
        guard parent >= 0 else { throw modelFilePOSIXError() }
        defer { close(parent) }
        var prefix: [String] = []
        for component in parts.dropLast() {
            prefix.append(component)
            let next = try ModelDirectoryAccess.descriptor(component,from:parent,directory:true)
            close(parent); parent = next
            guard let expected = snapshot?.revisions[prefix.joined(separator:"/")],
                  try ModelFileRevision(parent).identity == expected.identity else { throw ExchangeError.invalid("モデル資産の親ディレクトリが置き換わりました") }
        }
        try body(parent,name)
    }
    private func stageAssetEntries(_ record: ModelRemovalRecord, models: Int32) throws {
        guard let asset = record.asset else { return }
        let source = try assetSource(asset,models:models)
        defer { close(source) }
        let quarantine = try ModelDirectoryAccess.descriptor(".model-removals/" + record.quarantine,from:models,directory:true)
        defer { close(quarantine) }
        for (index,path) in record.entries.enumerated() {
            let expected = asset.snapshot.revisions[asset.subset ? path : ""]!
            let isDirectory = !asset.subset && assetIsDirectory(asset.kind,asset.key)
            try withAssetEntryParent(path,root:source,snapshot:asset.subset ? asset.snapshot : nil) { parent,name in
                let existing = try assetNodeRevision(name,parent:parent,directory:isDirectory)
                let staged = try assetNodeRevision(String(index),parent:quarantine,directory:isDirectory)
                guard !(existing != nil && staged != nil), existing != nil || staged != nil else { throw ExchangeError.invalid("削除するモデル資産が見つかりません") }
                if let staged {
                    guard sameMovedGeneration(staged,expected) else { throw ExchangeError.invalid("退避したモデル資産が変わりました") }
                } else if let existing {
                    guard sameMovedGeneration(existing,expected) else { throw ExchangeError.invalid("削除するモデル資産が変わりました") }
                    guard renameatx_np(parent,name,quarantine,String(index),UInt32(RENAME_EXCL)) == 0 else { throw modelFilePOSIXError() }
                }
            }
        }
        // No unlink occurs until every selected entry has reached quarantine.
        try validateQuarantinedAsset(record,quarantine:quarantine,completeTree:true,requireAllSlots:true)
    }
    private func markAssetStaged(_ record: ModelRemovalRecord, models: Int32) throws -> ModelRemovalRecord {
        guard let asset = record.asset else { return record }
        let staged = AssetRemoval(kind:asset.kind,key:asset.key,subset:asset.subset,staged:true,rollbackRequested:asset.rollbackRequested,snapshot:asset.snapshot,modelsIdentity:asset.modelsIdentity,parentIdentity:asset.parentIdentity)
        let result = ModelRemovalRecord(id:record.id,quarantine:record.quarantine,entries:record.entries,asset:staged,rollbackOnRecovery:record.rollbackOnRecovery)
        try saveRemovalRecords(try removalRecords(models).map { $0.quarantine == record.quarantine ? result : $0 },models:models)
        return result
    }
    private func markAssetRollback(_ record: ModelRemovalRecord, models: Int32) throws -> ModelRemovalRecord {
        guard let asset = record.asset else { return record }
        let rollback = AssetRemoval(kind:asset.kind,key:asset.key,subset:asset.subset,staged:asset.staged,rollbackRequested:true,snapshot:asset.snapshot,modelsIdentity:asset.modelsIdentity,parentIdentity:asset.parentIdentity)
        let result = ModelRemovalRecord(id:record.id,quarantine:record.quarantine,entries:record.entries,asset:rollback,rollbackOnRecovery:record.rollbackOnRecovery)
        try saveRemovalRecords(try removalRecords(models).map { $0.quarantine == record.quarantine ? result : $0 },models:models)
        return result
    }
    private func validateQuarantinedAsset(_ record: ModelRemovalRecord, quarantine: Int32, completeTree: Bool = false, requireAllSlots: Bool = false) throws {
        guard let asset = record.asset else { return }
        let slots = Set(record.entries.indices.map { String($0) })
        let actualSlots = Set(try inventoryNames(quarantine))
        guard actualSlots.isSubset(of:slots), !requireAllSlots || actualSlots == slots else { throw ExchangeError.invalid("退避先に不明なモデル資産があります") }
        for (index,path) in record.entries.enumerated() where try removalExists(String(index),in:quarantine) {
            let isDirectory = !asset.subset && assetIsDirectory(asset.kind,asset.key)
            let child = try ModelDirectoryAccess.descriptor(String(index),from:quarantine,directory:isDirectory)
            defer { close(child) }
            let current = try assetSnapshot(child,isDirectory:isDirectory)
            if completeTree && !asset.subset {
                guard Set(current.revisions.keys) == Set(asset.snapshot.revisions.keys) else { throw ExchangeError.invalid("退避したモデル資産の内容が変わりました") }
            }
            for (name,revision) in current.revisions {
                let originalPath = asset.subset ? path : name
                guard let expected = asset.snapshot.revisions[originalPath],
                      current.directories.contains(name) == (!asset.subset && asset.snapshot.directories.contains(originalPath)),
                      (current.directories.contains(name) && !completeTree ? revision.identity == expected.identity : sameMovedGeneration(revision,expected)) else {
                    throw ExchangeError.invalid("退避したモデル資産が変わりました")
                }
            }
        }
    }
    private func rollbackAssetRemoval(_ record: ModelRemovalRecord, models: Int32) throws {
        var record = record
        guard let asset = record.asset else { return }
        let source = try assetSource(asset,models:models)
        defer { close(source) }
        let quarantines = try ModelDirectoryAccess.descriptor(".model-removals",from:models,directory:true)
        defer { close(quarantines) }
        let quarantine: Int32
        do { quarantine = try ModelDirectoryAccess.descriptor(record.quarantine,from:quarantines,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT { quarantine = -1 }
        defer { if quarantine >= 0 { close(quarantine) } }
        if quarantine >= 0 { try validateQuarantinedAsset(record,quarantine:quarantine,completeTree:true) }
        // Validate every destination before restoring any bytes, and never replace a collision.
        for (index,path) in record.entries.enumerated() {
            let isDirectory = !asset.subset && assetIsDirectory(asset.kind,asset.key)
            let expected = asset.snapshot.revisions[asset.subset ? path : ""]!
            try withAssetEntryParent(path,root:source,snapshot:asset.subset ? asset.snapshot : nil) { parent,name in
                let target = try assetNodeRevision(name,parent:parent,directory:isDirectory)
                let staged = quarantine >= 0 ? try assetNodeRevision(String(index),parent:quarantine,directory:isDirectory) : nil
                guard !(target != nil && staged != nil), target != nil || staged != nil else { throw ExchangeError.invalid("復旧するモデル資産が見つかりません") }
                if let target { guard sameMovedGeneration(target,expected) else { throw ExchangeError.invalid("復旧先に別のモデル資産があります") } }
                if let staged { guard sameMovedGeneration(staged,expected) else { throw ExchangeError.invalid("退避したモデル資産が変わりました") } }
            }
        }
        if quarantine >= 0 {
            // Once restoration starts, a restart must restore the remaining marker too.
            if asset.rollbackRequested != true { record = try markAssetRollback(record,models:models) }
            for (index,path) in record.entries.enumerated() where try removalExists(String(index),in:quarantine) {
                try withAssetEntryParent(path,root:source,snapshot:asset.subset ? asset.snapshot : nil) { parent,name in
                    guard renameatx_np(quarantine,String(index),parent,name,UInt32(RENAME_EXCL)) == 0 else { throw modelFilePOSIXError() }
                }
            }
            guard unlinkat(quarantines,record.quarantine,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
        }
        try removeRemovalRecord(record,models:models)
    }
    private func commitAssetRemoval(_ record: ModelRemovalRecord, models: Int32) throws {
        var record = record
        if record.asset?.staged == false {
            do { try stageAssetEntries(record,models:models); record = try markAssetStaged(record,models:models) }
            catch {
                do { try rollbackAssetRemoval(record,models:models) }
                catch { throw ModelRemovalRecoveryError.incompleteRollback }
                throw error
            }
        }
        let quarantines = try ModelDirectoryAccess.descriptor(".model-removals",from:models,directory:true)
        defer { close(quarantines) }
        let quarantine: Int32
        do { quarantine = try ModelDirectoryAccess.descriptor(record.quarantine,from:quarantines,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT { try removeRemovalRecord(record,models:models); return }
        defer { close(quarantine) }
        try validateQuarantinedAsset(record,quarantine:quarantine)
        for index in record.entries.indices {
            let name = String(index)
            if !(try removalExists(name,in:quarantine)) { continue }
            if let asset = record.asset, !asset.subset && assetIsDirectory(asset.kind,asset.key) {
                let child = try ModelDirectoryAccess.descriptor(name,from:quarantine,directory:true)
                defer { close(child) }
                try ModelDirectoryAccess.removeContents(child)
                guard unlinkat(quarantine,name,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
            } else { guard unlinkat(quarantine,name,0) == 0 else { throw modelFilePOSIXError() } }
        }
        guard unlinkat(quarantines,record.quarantine,AT_REMOVEDIR) == 0 else { throw modelFilePOSIXError() }
        try removeRemovalRecord(record,models:models)
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
            if let rollback = record.rollbackOnRecovery {
                if rollback { try rollbackModelRemoval(record,models:models) }
                else { try commitModelRemoval(record,models:models) }
                continue
            }
            if let asset = record.asset {
                let isModel = asset.kind == .modelFile || asset.kind == .modelDirectory
                let names = isModel && !asset.subset ? try registeredIDs.flatMap { try removalEntryNames(modelID:$0) } : []
                if asset.rollbackRequested == true || names.contains(where:{ $0.utf8.elementsEqual(asset.key.utf8) }) { try rollbackModelRemoval(record,models:models) }
                else { try commitAssetRemoval(record,models:models) }
            } else if registered.contains(Data(record.id.utf8)) { try rollbackModelRemoval(record,models:models) }
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
        let records = try root.required("records").array("removal records").map { row -> ModelRemovalRecord in
            let id = try row.required("id").string("model id")
            let quarantine = try row.required("quarantine").string("quarantine")
            let entries = try row.required("entries").array("entries").map { try $0.string("entry") }
            try ModelDirectoryAccess.validatePaths(entries)
            guard UUID(uuidString:quarantine)?.uuidString.lowercased() == quarantine, !entries.isEmpty else {
                throw ExchangeError.invalid("モデル削除記録の形式が不正です")
            }
            let asset: AssetRemoval?
            if let value = row["asset"] {
                let decoded = try JSONDecoder().decode(AssetRemoval.self,from:value.encoded())
                let snapshot = decoded.snapshot
                try ModelDirectoryAccess.validatePaths(snapshot.revisions.keys.filter { !$0.isEmpty })
                guard validAssetName(decoded.kind,decoded.key), snapshot.revisions[""] != nil,
                      Set(snapshot.directories).count == snapshot.directories.count,
                      snapshot.directories.allSatisfy({ snapshot.revisions[$0] != nil }),
                      (assetIsDirectory(decoded.kind,decoded.key) ? snapshot.directories.contains("") : snapshot.directories.isEmpty && snapshot.revisions.count == 1),
                      snapshot.revisions.keys.allSatisfy({ path in
                          path.isEmpty || path.split(separator:"/").dropLast().isEmpty || snapshot.directories.contains(path.split(separator:"/").dropLast().joined(separator:"/"))
                      }),
                      (decoded.subset ? assetIsDirectory(decoded.kind,decoded.key) && entries.allSatisfy({ snapshot.revisions[$0] != nil && !snapshot.directories.contains($0) }) : entries == [decoded.key]) else {
                    throw ExchangeError.invalid("モデル削除記録の資産が不正です")
                }
                asset = decoded
            } else {
                let expected = try removalEntryNames(modelID:id)
                guard entries.allSatisfy({ entry in expected.contains { $0.utf8.elementsEqual(entry.utf8) } }) else { throw ExchangeError.invalid("モデル削除記録の形式が不正です") }
                asset = nil
            }
            let rollbackOnRecovery: Bool?
            switch row["rollbackOnRecovery"] {
            case nil: rollbackOnRecovery = nil
            case .some(.bool(let value)): rollbackOnRecovery = value
            default: throw ExchangeError.invalid("モデル削除記録の復旧方針が不正です")
            }
            return .init(id:id,quarantine:quarantine,entries:entries,asset:asset,rollbackOnRecovery:rollbackOnRecovery)
        }
        guard Set(records.map(\.quarantine)).count == records.count else { throw ExchangeError.invalid("モデル削除記録が重複しています") }
        return records
    }
    private func saveRemovalRecords(_ records: [ModelRemovalRecord], models: Int32) throws {
        let rows = try records.map { record -> OrderedJSON in
            var fields: [JSONField] = [.init(key:"id",value:.string(record.id)),.init(key:"quarantine",value:.string(record.quarantine)),.init(key:"entries",value:.array(record.entries.map(OrderedJSON.string)))]
            if let asset = record.asset { fields.append(.init(key:"asset",value:try OrderedJSON.decode(JSONEncoder().encode(asset)))) }
            if let rollback = record.rollbackOnRecovery { fields.append(.init(key:"rollbackOnRecovery",value:.bool(rollback))) }
            return .object(fields)
        }
        let bytes = try OrderedJSON.object([
            .init(key:"version",value:.number("1")),.init(key:"records",value:.array(rows))
        ]).encoded()
        guard bytes.count <= 1024 * 1024 else { throw ExchangeError.invalid("モデル削除記録が大きすぎます") }
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
    private func saveRemovalDisposition(_ record: ModelRemovalRecord, rollback: Bool, models: Int32) throws -> ModelRemovalRecord {
        let updated = ModelRemovalRecord(id:record.id,quarantine:record.quarantine,entries:record.entries,asset:record.asset,rollbackOnRecovery:rollback)
        var records = try removalRecords(models)
        if let index = records.firstIndex(where:{ $0.quarantine == record.quarantine }) { records[index] = updated }
        else { records.append(updated) }
        try saveRemovalRecords(records,models:models)
        return updated
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
        var record = record
        if record.asset != nil {
            do { try rollbackAssetRemoval(record,models:models) }
            catch { throw ModelRemovalRecoveryError.incompleteRollback }
            return
        }
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
        if record.rollbackOnRecovery != nil { record = try saveRemovalDisposition(record,rollback:true,models:models) }
        for entry in record.entries where try removalExists(entry,in:quarantine) {
            guard renameatx_np(quarantine,entry,models,entry,UInt32(RENAME_EXCL)) == 0 else { throw modelFilePOSIXError() }
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
        var record = record
        // Explicit preparation protects orphan bytes until the caller has durably saved its state.
        if record.rollbackOnRecovery == true { record = try saveRemovalDisposition(record,rollback:false,models:models) }
        if record.asset != nil { try commitAssetRemoval(record,models:models); return }
        let quarantines: Int32
        do { quarantines = try ModelDirectoryAccess.descriptor(".model-removals",from:models,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try record.rollbackOnRecovery == false || removalTargetsAbsent(record,models:models) else { throw error }
            try removeRemovalRecord(record,models:models)
            return
        }
        defer { close(quarantines) }
        let quarantine: Int32
        do { quarantine = try ModelDirectoryAccess.descriptor(record.quarantine,from:quarantines,directory:true) }
        catch let error as POSIXError where error.code == .ENOENT {
            guard try record.rollbackOnRecovery == false || removalTargetsAbsent(record,models:models) else { throw error }
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

    private func ggufFingerprintPlan(size: UInt64) throws -> (ranges: [(offset: UInt64, length: UInt64)], suffix: String) {
        let output = try SharedWebOperations.call("localModelImport",.object([
            .init(key:"operation",value:.string("fingerprintPlan")),
            .init(key:"size",value:.number(String(size)))
        ]))
        let ranges = try output.required("ranges").array("GGUF fingerprint ranges").map { item -> (offset: UInt64, length: UInt64) in
            func integer(_ key: String) throws -> UInt64 {
                let value = try item.required(key).number(key)
                guard value >= 0, value.rounded(.towardZero) == value,
                      let integer = UInt64(exactly:value) else {
                    throw ExchangeError.invalid("GGUF fingerprint range is invalid")
                }
                return integer
            }
            let offset = try integer("offset"), length = try integer("length")
            let (end,overflow) = offset.addingReportingOverflow(length)
            guard !overflow, end <= size else { throw ExchangeError.invalid("GGUF fingerprint range is invalid") }
            return (offset,length)
        }
        guard !ranges.isEmpty else { throw ExchangeError.invalid("GGUF fingerprint range is invalid") }
        return (ranges,try output.required("suffix").string("GGUF fingerprint suffix"))
    }

    private func ggufFingerprint(_ file: FileHandle, size: UInt64, fullHash: String) throws -> String {
        let plan = try ggufFingerprintPlan(size:size)
        if plan.ranges.count == 1, plan.ranges[0].offset == 0, plan.ranges[0].length == size, plan.suffix.isEmpty {
            return fullHash
        }
        var digest = SHA256()
        for range in plan.ranges {
            try file.seek(toOffset:range.offset)
            var remaining = range.length
            while remaining > 0 {
                try Task.checkCancellation()
                let count = Int(min(remaining,UInt64(1024 * 1024)))
                guard let chunk = try file.read(upToCount:count), chunk.count == count else {
                    throw ExchangeError.invalid("GGUF fingerprint read failed")
                }
                digest.update(data:chunk)
                remaining -= UInt64(chunk.count)
            }
        }
        digest.update(data:Data(plan.suffix.utf8))
        return digest.finalize().map { String(format:"%02x",$0) }.joined()
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

    func inspectSelectedGGUFs(_ selected: [URL]) throws -> [SelectedGGUF] {
        guard !selected.isEmpty else { throw ExchangeError.invalid("GGUFファイルを選択してください") }
        var names = Set<Data>()
        var identities = Set<ModelFileIdentity>()
        return try selected.map { source in
            try Task.checkCancellation()
            let name = source.lastPathComponent
            try ModelDirectoryAccess.validatePaths([name])
            guard !name.contains("/") && names.insert(Data(name.utf8)).inserted else {
                throw ExchangeError.invalid("同じGGUFファイルを重ねて選択できません")
            }
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            let descriptor = open(source.path,O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            guard descriptor >= 0 else { throw modelFilePOSIXError() }
            let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? file.close() }
            var info = stat()
            guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG else {
                throw ExchangeError.invalid("通常のGGUFファイルを選択してください")
            }
            let revision = try ModelFileRevision(descriptor)
            guard revision.size >= 4, identities.insert(revision.identity).inserted,
                  try file.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("GGUFファイルではありません")
            }
            try file.seek(toOffset:0)
            let hash = try ModelDirectoryAccess.transfer(file)
            let fingerprint = try ggufFingerprint(file,size:revision.size,fullHash:hash)
            guard try ModelFileRevision(descriptor) == revision else {
                throw ExchangeError.invalid("確認中に選択したGGUFファイルが変わりました")
            }
            return .init(url:source,name:name,hash:hash,fingerprint:fingerprint,size:revision.size,revision:revision)
        }
    }

    func checkSelectedGGUFs(_ selected: [SelectedGGUF]) throws {
        guard !selected.isEmpty else { throw ExchangeError.invalid("GGUFファイルを選択してください") }
        var names = Set<Data>(), identities = Set<ModelFileIdentity>()
        for item in selected {
            try Task.checkCancellation()
            guard item.url.lastPathComponent == item.name else {
                throw ExchangeError.invalid("選択したGGUFファイルの名前が変わりました")
            }
            try ModelDirectoryAccess.validatePaths([item.name])
            guard !item.name.contains("/"), names.insert(Data(item.name.utf8)).inserted else {
                throw ExchangeError.invalid("選択したGGUFファイルが不正です")
            }
            let scoped = item.url.startAccessingSecurityScopedResource()
            defer { if scoped { item.url.stopAccessingSecurityScopedResource() } }
            let descriptor = open(item.url.path,O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            guard descriptor >= 0 else { throw modelFilePOSIXError() }
            let file = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? file.close() }
            var info = stat()
            guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG,
                  try ModelFileRevision(descriptor) == item.revision,
                  identities.insert(item.revision.identity).inserted,
                  try file.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("選択したGGUFファイルが変わりました")
            }
        }
    }

    func stageSelectedGGUFs(_ selected: [SelectedGGUF], model: OrderedJSON) throws -> DirectoryStage {
        try Task.checkCancellation()
        try checkSelectedGGUFs(selected)
        let names = selected.map(\.name)
        let plan = try directoryPlan(model,files:names)
        let required = try plan.required("requiredFiles").array("required files").map { try $0.string("file") }
        guard required.count == selected.count else { throw ExchangeError.invalid("モデルの必須ファイルがありません") }
        let ordered = try required.map { path -> SelectedGGUF in
            guard let selected = selected.first(where: { Data($0.name.utf8) == Data(path.utf8) }) else {
                throw ExchangeError.invalid("モデルの必須ファイルがありません")
            }
            return selected
        }
        let modelID = try model.required("id").string("model id")
        let target = try directoryURL(modelID:modelID)
        guard try directoryRevision(target) == nil else {
            throw ExchangeError.invalid("同じモデルIDの端末内ファイルが既にあります")
        }
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        let pending = directory.appendingPathComponent(".model-\(UUID().uuidString).part")
        try FileManager.default.createDirectory(at:pending,withIntermediateDirectories:false)
        var staged = false
        defer { if !staged { try? FileManager.default.removeItem(at:pending) } }
        var files: [DirectoryFile] = []
        for selected in ordered {
            try Task.checkCancellation()
            let scoped = selected.url.startAccessingSecurityScopedResource()
            defer { if scoped { selected.url.stopAccessingSecurityScopedResource() } }
            let descriptor = open(selected.url.path,O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
            guard descriptor >= 0 else { throw modelFilePOSIXError() }
            let input = FileHandle(fileDescriptor:descriptor,closeOnDealloc:true)
            defer { try? input.close() }
            var info = stat()
            guard fstat(descriptor,&info) == 0, info.st_mode & S_IFMT == S_IFREG,
                  try ModelFileRevision(descriptor) == selected.revision else {
                throw ExchangeError.invalid("コピー中に選択したGGUFファイルが変わりました")
            }
            guard try input.read(upToCount:4) == Data("GGUF".utf8) else {
                throw ExchangeError.invalid("GGUFファイルではありません")
            }
            try input.seek(toOffset:0)
            let destination = pending.appendingPathComponent(selected.name)
            let outputDescriptor = open(destination.path,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
            guard outputDescriptor >= 0 else { throw modelFilePOSIXError() }
            let output = FileHandle(fileDescriptor:outputDescriptor,closeOnDealloc:true)
            defer { try? output.close() }
            let hash = try ModelDirectoryAccess.transfer(input,to:output)
            try output.synchronize()
            guard hash == selected.hash, try ModelFileRevision(descriptor) == selected.revision else {
                throw ExchangeError.invalid("コピー中に選択したGGUFファイルが変わりました")
            }
            files.append(.init(path:selected.name,hash:selected.hash,size:selected.size,revision:selected.revision))
        }
        let inspection = DirectoryInspection(declaration:try directoryPlan(model).encoded(),directories:[:],targetRevision:nil,files:files)
        let result = DirectoryStage(pending:pending,target:target,inspection:inspection)
        staged = true
        return result
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
fileprivate struct ModelFileIdentity: Hashable, Codable { let device: Int32; let inode: UInt64 }
fileprivate struct ModelFileRevision: Equatable, Codable {
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
