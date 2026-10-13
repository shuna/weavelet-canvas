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
    private static let directoryLock = NSLock()

    func directoryURL(modelID: String) throws -> URL {
        try url(modelID:modelID).deletingPathExtension()
    }

    private func directoryPlan(_ model: OrderedJSON, files: [String] = []) throws -> OrderedJSON {
        // Only the existing Web declaration enters JS; opaque metadata stays untouched.
        let projected = OrderedJSON.object(try ["id", "engine", "manifest"].map { .init(key:$0,value:try model.required($0)) })
        return try SharedWebOperations.call("localModelFiles",.object([
            .init(key:"model",value:projected),.init(key:"files",value:.array(files.map(OrderedJSON.string)))
        ]))
    }

    func inspectDirectory(_ source: URL, model: OrderedJSON) throws -> DirectoryInspection {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
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
            let digest = try reader.transfer(handle)
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
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
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
        defer { try? FileManager.default.removeItem(at:pending) }
        for file in inspection.files {
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
            let hash = try reader.transfer(handle,to:output)
            try output.synchronize()
            guard hash == file.hash else { throw ExchangeError.invalid("コピーしたモデルのハッシュが一致しません") }
            try reader.check(file.path,revision:file.revision)
        }
        for file in inspection.files { try reader.check(file.path,revision:file.revision) }
        try reader.checkDirectories()
        try reader.checkRootPath()
        guard try directoryRevision(target) == inspection.targetRevision else {
            throw ExchangeError.invalid("確認後に登録先のモデルが変わりました")
        }
        // Darwin exchanges directories atomically; the previous generation becomes pending.
        let flags: UInt32
        if FileManager.default.fileExists(atPath:target.path) {
            flags = UInt32(RENAME_SWAP)
        } else { flags = UInt32(RENAME_EXCL) }
        guard renamex_np(pending.path,target.path,flags) == 0 else { throw modelFilePOSIXError() }
    }

    func directoryEntries(model: OrderedJSON) throws -> [(path: String, data: Data)] {
        Self.directoryLock.lock(); defer { Self.directoryLock.unlock() }
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
    func descriptor(_ path: String, directory: Bool) throws -> Int32 {
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
    func transfer(_ input: FileHandle, to output: FileHandle? = nil) throws -> String {
        var hash = SHA256()
        while let chunk = try input.read(upToCount:1024 * 1024), !chunk.isEmpty {
            hash.update(data:chunk)
            try output?.write(contentsOf:chunk)
        }
        return hash.finalize().map { String(format:"%02x",$0) }.joined()
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
