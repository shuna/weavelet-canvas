import XCTest
@testable import WeaveletPilot

final class FolderSyncFilesTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("weavelet-folder-sync-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testListsOnlyFilesAndDirectoriesAndRejectsSymlinks() async throws {
        let root = try directory()
        try Data("one".utf8).write(to: root.appendingPathComponent("first"))
        try FileManager.default.createDirectory(at: root.appendingPathComponent("nested"), withIntermediateDirectories: false)
        let files = try FolderSyncFiles(testingDirectoryURL: root)
        let entries = try await files.list()
        XCTAssertEqual(entries, [.init(name: "first", isDirectory: false), .init(name: "nested", isDirectory: true)])
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: FileManager.default.temporaryDirectory)
        do { _ = try await files.list(); XCTFail("symlink was listed") } catch { XCTAssertEqual(error as? FolderSyncFilesError, .symlink) }
    }

    func testAtomicCompareAndSavePreservesExistingBytesOnConflict() async throws {
        let root = try directory(), url = root.appendingPathComponent("record")
        let files = try FolderSyncFiles(testingDirectoryURL: root)
        try await files.write(name: "record", bytes: Data("first".utf8), expectedExistingData: nil)
        let first = try await files.read(name: "record")
        XCTAssertEqual(first, Data("first".utf8))
        do { try await files.write(name: "record", bytes: Data("lost".utf8), expectedExistingData: Data("other".utf8)); XCTFail("conflict accepted") } catch { XCTAssertEqual(error as? FolderSyncFilesError, .compareFailed) }
        XCTAssertEqual(try Data(contentsOf: url), Data("first".utf8))
        try await files.write(name: "record", bytes: Data(), expectedExistingData: Data("first".utf8))
        let empty = try await files.read(name: "record")
        XCTAssertEqual(empty, Data())
    }

    func testRejectsEscapesAndMalformedBookmark() async throws {
        let files = try FolderSyncFiles(testingDirectoryURL: try directory())
        for name in ["", ".", "..", "a/b", "a\\b"] {
            do { _ = try await files.read(name: name); XCTFail("invalid name accepted: \(name)") } catch { XCTAssertEqual(error as? FolderSyncFilesError, .invalidName) }
        }
        XCTAssertThrowsError(try FolderSyncFiles.resolveBookmark(Data("invalid".utf8))) { XCTAssertEqual($0 as? FolderSyncFilesError, .invalidBookmark) }
    }

    func testMissingFileRemainsDistinctFromExistingEmptyData() async throws {
        let files = try FolderSyncFiles(testingDirectoryURL: directory())
        do { _ = try await files.read(name:"missing"); XCTFail("missing file accepted") }
        catch { XCTAssertEqual(error as? FolderSyncFilesError,.missing) }
        try await files.write(name:"empty",bytes:Data(),expectedExistingData:nil)
        let empty = try await files.read(name:"empty")
        XCTAssertEqual(empty,Data())
    }
    func testDeniedScopeStopsBeforeMetadataAndDoesNotReleaseUnacquiredAccess() throws {
        // A non-existent path would fail metadata lookup if it ran before the scope check.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        var releases = 0
        XCTAssertThrowsError(try FolderSyncFiles.validateSelectedDirectory(url,beginAccess:{ _ in false },endAccess:{ _ in releases += 1 })) {
            XCTAssertEqual($0 as? FolderSyncFilesError,.accessDenied)
        }
        XCTAssertEqual(releases,0)
    }
}
