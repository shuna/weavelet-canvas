import Foundation

enum FolderSyncFilesError: LocalizedError, Equatable {
    case invalidName, missing, notFile, symlink, compareFailed, accessDenied, notDirectory, invalidBookmark, staleBookmark, downloadPending
    var errorDescription: String? {
        switch self {
        case .invalidName: return "同期ファイル名が不正です。"
        case .missing: return "同期ファイルがまだ到着していません。"
        case .notFile, .notDirectory: return "選択した保存先のファイル形式が不正です。"
        case .symlink: return "同期フォルダー内のリンクを使用できません。"
        case .compareFailed: return "別の処理が同期ファイルを変更しました。上書きを停止しました。"
        case .accessDenied: return "フォルダーのアクセス権を取得できません。選択し直してください。"
        case .invalidBookmark, .staleBookmark: return "保存先への参照を復元できません。フォルダーを選択し直してください。"
        case .downloadPending: return "iCloud Driveからのダウンロードを開始しました。到着後に再試行してください。"
        }
    }
}

actor FolderSyncFiles {
    struct Entry: Equatable, Sendable {
        let name: String
        let isDirectory: Bool
    }

    private let folderURL: URL
    private let requiresSecurityScope: Bool

    init(selectedFolderURL: URL) throws {
        try Self.validateSelectedDirectory(selectedFolderURL)
        folderURL = selectedFolderURL; requiresSecurityScope = true
    }

    init(restoringBookmark data: Data) throws {
        let resolved = try Self.resolveBookmark(data)
        guard !resolved.isStale else { throw FolderSyncFilesError.staleBookmark }
        try Self.validateSelectedDirectory(resolved.url)
        folderURL = resolved.url; requiresSecurityScope = true
    }

    // Unit tests use an app-owned temporary directory, which has no security scope.
    init(testingDirectoryURL: URL) throws {
        try Self.validateDirectory(testingDirectoryURL)
        folderURL = testingDirectoryURL; requiresSecurityScope = false
    }

    static func makeBookmark(for url: URL) throws -> Data {
        try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    func bookmarkData() throws -> Data {
        try withAccess { try Self.makeBookmark(for: folderURL) }
    }

    static func resolveBookmark(_ data: Data) throws -> (url: URL, isStale: Bool) {
        var isStale = false
        do { return (try URL(resolvingBookmarkData: data, bookmarkDataIsStale: &isStale), isStale) }
        catch { throw FolderSyncFilesError.invalidBookmark }
    }

    func list() throws -> [Entry] {
        try withAccess {
            try ensureAvailable(folderURL)
            return try FileManager.default.contentsOfDirectory(at: folderURL, includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey], options: []).map { url in
                let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
                if values.isSymbolicLink == true { throw FolderSyncFilesError.symlink }
                try ensureAvailable(url)
                if values.isDirectory == true { return Entry(name: url.lastPathComponent, isDirectory: true) }
                if values.isRegularFile == true { return Entry(name: url.lastPathComponent, isDirectory: false) }
                throw FolderSyncFilesError.notFile
            }.sorted { $0.name < $1.name }
        }
    }

    func read(name: String) throws -> Data {
        let url = try fileURL(name)
        do { return try withAccess {
            try ensureAvailable(url)
            var coordinationError: NSError?, result: Result<Data, Error>?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
                result = Result { try self.readFile(coordinatedURL) }
            }
            if let coordinationError { throw coordinationError }
            return try result?.get() ?? { throw FolderSyncFilesError.missing }()
        } } catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile {
            throw FolderSyncFilesError.missing
        }
    }

    func write(name: String, bytes: Data, expectedExistingData: Data?) throws {
        let url = try fileURL(name)
        try withAccess {
            try ensureAvailable(folderURL)
            var coordinationError: NSError?, result: Result<Void, Error>?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
                result = Result {
                    let exists = FileManager.default.fileExists(atPath: coordinatedURL.path)
                    if exists { try self.ensureAvailable(coordinatedURL) }
                    switch (expectedExistingData, exists) {
                    case (nil, true), (.some, false): throw FolderSyncFilesError.compareFailed
                    case (nil, false): break
                    case let (.some(expected), true):
                        let existing = try self.readFile(coordinatedURL)
                        guard existing == expected else { throw FolderSyncFilesError.compareFailed }
                        if existing == bytes { return }
                    }
                    try bytes.write(to: coordinatedURL, options: .atomic)
                }
            }
            if let coordinationError { throw coordinationError }
            _ = try result?.get() ?? { throw FolderSyncFilesError.missing }()
        }
    }

    static func validateSelectedDirectory(_ url: URL, beginAccess: (URL) -> Bool = { $0.startAccessingSecurityScopedResource() }, endAccess: (URL) -> Void = { $0.stopAccessingSecurityScopedResource() }) throws {
        guard beginAccess(url) else { throw FolderSyncFilesError.accessDenied }
        defer { endAccess(url) }
        try validateDirectory(url)
    }
    private static func validateDirectory(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isSymbolicLink != true else { throw FolderSyncFilesError.symlink }
        guard values.isDirectory == true else { throw FolderSyncFilesError.notDirectory }
    }

    private func withAccess<T>(_ body: () throws -> T) throws -> T {
        let accessed = folderURL.startAccessingSecurityScopedResource()
        defer { if accessed { folderURL.stopAccessingSecurityScopedResource() } }
        if requiresSecurityScope && !accessed { throw FolderSyncFilesError.accessDenied }
        try Self.validateDirectory(folderURL)
        return try body()
    }

    private func fileURL(_ name: String) throws -> URL {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\\"), !name.contains("\0") else { throw FolderSyncFilesError.invalidName }
        return folderURL.appendingPathComponent(name, isDirectory: false)
    }

    private func readFile(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        if values.isSymbolicLink == true { throw FolderSyncFilesError.symlink }
        guard values.isRegularFile == true else {
            if !FileManager.default.fileExists(atPath: url.path) { throw FolderSyncFilesError.missing }
            throw FolderSyncFilesError.notFile
        }
        return try Data(contentsOf: url)
    }

    private func ensureAvailable(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
        if values.isSymbolicLink == true { throw FolderSyncFilesError.symlink }
        guard values.isDirectory != true, values.isUbiquitousItem == true, values.ubiquitousItemDownloadingStatus != .current else { return }
        try FileManager.default.startDownloadingUbiquitousItem(at: url)
        throw FolderSyncFilesError.downloadPending
    }
}
