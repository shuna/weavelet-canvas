import XCTest
import CryptoKit
import Darwin
@testable import WeaveletPilot

@MainActor final class LocalModelDirectoryTests: XCTestCase {
    private func setup() throws -> (URL,LocalModelFiles) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("model-directory-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        return (root,LocalModelFiles(directory:root.appendingPathComponent("models")))
    }
    private func model(_ id: String = "org/classifier", required: [String] = ["config.json","onnx/model.onnx"]) -> OrderedJSON {
        .object([
            .init(key:"id",value:.string(id)),.init(key:"engine",value:.string("transformers.js")),
            .init(key:"origin",value:.string("https://never-request.invalid/model")),
            .init(key:"manifest",value:.object([
                .init(key:"kind",value:.string("multi-file")),.init(key:"entrypoint",value:.string(required.last ?? "onnx/model.onnx")),
                .init(key:"requiredFiles",value:.array(required.map(OrderedJSON.string))),.init(key:"opaque",value:.number("1.00"))
            ])),.init(key:"unknown",value:.object([.init(key:"bytes",value:.number("1e02"))]))
        ])
    }
    private func shardedModel(_ id: String = "org/split") -> OrderedJSON {
        let shards = ["model-00001-of-00002.gguf","model-00002-of-00002.gguf"]
        return .object([
            .init(key:"id",value:.string(id)),.init(key:"engine",value:.string("wllama")),
            .init(key:"manifest",value:.object([
                .init(key:"kind",value:.string("gguf-sharded")),.init(key:"entrypoint",value:.string(shards[0])),
                .init(key:"shards",value:.array(shards.map(OrderedJSON.string))),.init(key:"totalSize",value:.number("18"))
            ]))
        ])
    }
    private func write(_ root: URL, _ path: String, _ bytes: Data) throws {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        try bytes.write(to:url)
    }
    private func source(_ root: URL, name: String = "source", suffix: String = "original") throws -> URL {
        let dir = root.appendingPathComponent(name)
        try write(dir,"config.json",Data("{\"opaque\":1.00}".utf8))
        try write(dir,"onnx/model.onnx",Data(("binary\0"+suffix).utf8))
        return dir
    }
    private func shardSource(_ root: URL, name: String = "shards", suffix: String = "original") throws -> URL {
        let dir = root.appendingPathComponent(name)
        try write(dir,"model-00001-of-00002.gguf",Data("GGUFfirst-\(suffix)".utf8))
        try write(dir,"model-00002-of-00002.gguf",Data("GGUFsecond-\(suffix)".utf8))
        return dir
    }
    private func install(_ dir: URL, _ files: LocalModelFiles, _ model: OrderedJSON) throws {
        try files.installDirectory(dir,model:model,inspection:files.inspectDirectory(dir,model:model))
    }
    func testFullHashesNestedAndAdditionalFilesPreserveBytesAndMetadata() throws {
        let (root,files) = try setup(), metadata = model("é/分類"), original = try metadata.encoded()
        let dir = try source(root)
        let extra = Data([0,255,1,2,3])
        try write(dir,"tokenizer_config.json",extra)
        try write(dir,"optional.empty",Data())
        try write(dir,"é%2F.bin",extra)
        try write(dir,"unfinished.onnx.part",Data("partial".utf8))
        let inspection = try files.inspectDirectory(dir,model:metadata)
        XCTAssertEqual(inspection.files.count,5)
        XCTAssertEqual(inspection.files.first(where:{$0.path == "tokenizer_config.json"})?.hash,SHA256.hash(data:extra).map { String(format:"%02x",$0) }.joined())
        try files.installDirectory(dir,model:metadata,inspection:inspection)
        let entries = Dictionary(uniqueKeysWithValues:try files.directoryEntries(model:metadata).map { ($0.path,$0.data) })
        XCTAssertEqual(entries["onnx/model.onnx"],try Data(contentsOf:dir.appendingPathComponent("onnx/model.onnx")))
        XCTAssertEqual(entries["tokenizer_config.json"],extra)
        XCTAssertEqual(entries["optional.empty"],Data())
        XCTAssertEqual(entries["é%2F.bin"],extra)
        XCTAssertNil(entries["unfinished.onnx.part"])
        XCTAssertEqual(try metadata.encoded(),original)
        XCTAssertEqual(try files.directoryURL(modelID:"é/分類").lastPathComponent,try files.url(modelID:"é/分類").deletingPathExtension().lastPathComponent)
        XCTAssertNotEqual(try files.directoryURL(modelID:"é"),try files.directoryURL(modelID:"e\u{301}"))
        let gguf = root.appendingPathComponent("one.gguf")
        try Data("GGUFsingle".utf8).write(to:gguf)
        try files.install(gguf,modelID:"é/分類")
        try files.removeDirectory(modelID:"é/分類")
        XCTAssertThrowsError(try files.directoryEntries(model:metadata))
        XCTAssertEqual(try Data(contentsOf:files.installed(modelID:"é/分類")),Data("GGUFsingle".utf8))
    }
    func testUnsafeAndAliasedRequiredPathsCannotReplaceOldGeneration() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try install(dir,files,metadata)
        let original = try files.directoryEntries(model:metadata).map(\.data)
        for path in ["/etc/passwd","../config.json","onnx/../config.json","./config.json","onnx//model.onnx","bad\0name"] {
            XCTAssertThrowsError(try files.inspectDirectory(dir,model:model(required:["config.json",path])))
        }
        XCTAssertThrowsError(try files.inspectDirectory(dir,model:model(required:["config.json","config.json"])))
        XCTAssertEqual(try files.directoryEntries(model:metadata).map(\.data),original)
    }
    func testSymlinkRootFileAndNestedDirectoryAreRejectedWithoutEscaping() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try install(dir,files,metadata)
        let outside = try source(root,name:"outside",suffix:"outside")
        let linkedRoot = root.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at:linkedRoot,withDestinationURL:outside)
        XCTAssertThrowsError(try files.inspectDirectory(linkedRoot,model:metadata))
        try FileManager.default.removeItem(at:dir.appendingPathComponent("onnx/model.onnx"))
        try FileManager.default.createSymbolicLink(at:dir.appendingPathComponent("onnx/model.onnx"),withDestinationURL:outside.appendingPathComponent("onnx/model.onnx"))
        XCTAssertThrowsError(try files.inspectDirectory(dir,model:metadata))
        try FileManager.default.removeItem(at:dir.appendingPathComponent("onnx"))
        try FileManager.default.createSymbolicLink(at:dir.appendingPathComponent("onnx"),withDestinationURL:outside.appendingPathComponent("onnx"))
        XCTAssertThrowsError(try files.inspectDirectory(dir,model:metadata))
        XCTAssertEqual(try files.directoryEntries(model:metadata).last?.data,Data("binary\0original".utf8))
    }
    func testHardLinkAliasAndMissingRequiredFileAreRejected() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try FileManager.default.linkItem(at:dir.appendingPathComponent("config.json"),to:dir.appendingPathComponent("duplicate.json"))
        XCTAssertThrowsError(try files.inspectDirectory(dir,model:metadata))
        try FileManager.default.removeItem(at:dir.appendingPathComponent("duplicate.json"))
        try FileManager.default.removeItem(at:dir.appendingPathComponent("onnx/model.onnx"))
        XCTAssertThrowsError(try files.inspectDirectory(dir,model:metadata))
        XCTAssertFalse(FileManager.default.fileExists(atPath:try files.directoryURL(modelID:"org/classifier").path))
    }
    func testChangedSourceAfterInspectionLeavesOldGenerationAndNoPartialCopy() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try install(dir,files,metadata)
        let replacement = try source(root,name:"replacement",suffix:"replacement")
        let inspection = try files.inspectDirectory(replacement,model:metadata)
        // config is copied before the later ONNX file fails its generation check.
        try write(replacement,"onnx/model.onnx",Data("changed-after-inspection".utf8))
        XCTAssertThrowsError(try files.installDirectory(replacement,model:metadata,inspection:inspection))
        XCTAssertEqual(try files.directoryEntries(model:metadata).last?.data,Data("binary\0original".utf8))
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath:files.directory.path).contains { $0.hasSuffix(".part") })
    }
    func testRequiredPartMarkerRejectsSourceAndStoredReadAndKeepsOldTarget() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try install(dir,files,metadata)
        let target = try files.directoryURL(modelID:"org/classifier")
        let original = try Data(contentsOf:target.appendingPathComponent("onnx/model.onnx"))
        let replacement = try source(root,name:"replacement",suffix:"incomplete")
        let inspection = try files.inspectDirectory(replacement,model:metadata)
        try write(replacement,"onnx/model.onnx.part",Data())
        XCTAssertThrowsError(try files.inspectDirectory(replacement,model:metadata))
        XCTAssertThrowsError(try files.installDirectory(replacement,model:metadata,inspection:inspection))
        XCTAssertEqual(try Data(contentsOf:target.appendingPathComponent("onnx/model.onnx")),original)
        XCTAssertTrue(FileManager.default.fileExists(atPath:replacement.appendingPathComponent("onnx/model.onnx.part").path))
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath:files.directory.path).contains { $0.hasSuffix(".part") })
        try write(target,"onnx/model.onnx.part",Data())
        XCTAssertThrowsError(try files.directoryEntries(model:metadata))
        XCTAssertEqual(try Data(contentsOf:target.appendingPathComponent("onnx/model.onnx")),original)
        XCTAssertTrue(FileManager.default.fileExists(atPath:target.appendingPathComponent("onnx/model.onnx.part").path))
    }

    func testWrongModelAndStaleTargetInspectionCannotOverwriteNewGeneration() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        try install(dir,files,metadata)
        let next = try source(root,name:"next",suffix:"next"), later = try source(root,name:"later",suffix:"later")
        let stale = try files.inspectDirectory(next,model:metadata)
        XCTAssertThrowsError(try files.installDirectory(next,model:model("other/model"),inspection:stale))
        try install(later,files,metadata)
        XCTAssertThrowsError(try files.installDirectory(next,model:metadata,inspection:stale))
        XCTAssertEqual(try files.directoryEntries(model:metadata).last?.data,Data("binary\0later".utf8))
    }
    func testReplacedSourceRootAndInstalledFileSymlinkAreRejected() throws {
        let (root,files) = try setup(), metadata = model(), dir = try source(root)
        let inspection = try files.inspectDirectory(dir,model:metadata)
        try FileManager.default.moveItem(at:dir,to:root.appendingPathComponent("old-source"))
        _ = try source(root)
        XCTAssertThrowsError(try files.installDirectory(dir,model:metadata,inspection:inspection))
        try install(dir,files,metadata)
        let target = try files.directoryURL(modelID:"org/classifier").appendingPathComponent("onnx/model.onnx")
        try FileManager.default.removeItem(at:target)
        try FileManager.default.createSymbolicLink(at:target,withDestinationURL:dir.appendingPathComponent("onnx/model.onnx"))
        XCTAssertThrowsError(try files.directoryEntries(model:metadata))
    }
    func testShardedGGUFInstalledRequiresEveryFinalShardAndHeader() throws {
        let (root,files) = try setup(), metadata = shardedModel(), source = try shardSource(root)
        try install(source,files,metadata)
        let entrypoint = try files.installed(model:metadata)
        XCTAssertEqual(entrypoint.lastPathComponent,"model-00001-of-00002.gguf")
        XCTAssertEqual(try Data(contentsOf:entrypoint),Data("GGUFfirst-original".utf8))

        let target = try files.directoryURL(modelID:"org/split")
        try write(target,"model-00002-of-00002.gguf.part",Data())
        XCTAssertThrowsError(try files.installed(model:metadata))
        try FileManager.default.removeItem(at:target.appendingPathComponent("model-00002-of-00002.gguf.part"))
        try write(target,"model-00002-of-00002.gguf",Data("BAD!second".utf8))
        XCTAssertThrowsError(try files.installed(model:metadata))

        let single = OrderedJSON.object([
            .init(key:"id",value:.string("org/single")),.init(key:"engine",value:.string("wllama")),
            .init(key:"manifest",value:.object([.init(key:"kind",value:.string("single-file")),.init(key:"entrypoint",value:.string("single.gguf"))]))
        ])
        let singleURL = root.appendingPathComponent("single.gguf")
        try Data("GGUFsingle".utf8).write(to:singleURL)
        try files.install(singleURL,modelID:"org/single")
        XCTAssertEqual(try files.installed(model:single),try files.installed(modelID:"org/single"))
    }
    func testSelectedGGUFsFollowSharedManifestOrderWithoutReorderingSelection() throws {
        let (root,files) = try setup(), model = shardedModel(), source = try shardSource(root)
        let first = source.appendingPathComponent("model-00001-of-00002.gguf")
        let second = source.appendingPathComponent("model-00002-of-00002.gguf")
        let inspected = try files.inspectSelectedGGUFs([second,first])
        XCTAssertEqual(inspected.map(\.name),[second.lastPathComponent,first.lastPathComponent])

        let staged = try files.stageSelectedGGUFs(inspected,model:model)
        try files.publishDirectory(staged,model:model)
        staged.discard()
        let entries = Dictionary(uniqueKeysWithValues:try files.directoryEntries(model:model).map { ($0.path,$0.data) })
        XCTAssertEqual(entries[first.lastPathComponent],Data("GGUFfirst-original".utf8))
        XCTAssertEqual(entries[second.lastPathComponent],Data("GGUFsecond-original".utf8))
    }
    func testSelectedGGUFsRejectChangedSourceAndExistingTargetWithoutReplacingAssets() throws {
        let (root,files) = try setup(), model = shardedModel(), source = try shardSource(root)
        let first = source.appendingPathComponent("model-00001-of-00002.gguf")
        let second = source.appendingPathComponent("model-00002-of-00002.gguf")
        let inspected = try files.inspectSelectedGGUFs([first,second])
        try Data("GGUFchanged".utf8).write(to:second)
        XCTAssertThrowsError(try files.checkSelectedGGUFs(inspected))
        XCTAssertThrowsError(try files.stageSelectedGGUFs(inspected,model:model))
        XCTAssertFalse(try files.directoryIsPresent(modelID:"org/split"))

        let original = try shardSource(root,name:"original",suffix:"kept")
        try install(original,files,model)
        let replacement = try shardSource(root,name:"replacement",suffix:"replacement")
        let selected = try files.inspectSelectedGGUFs([
            replacement.appendingPathComponent("model-00001-of-00002.gguf"),
            replacement.appendingPathComponent("model-00002-of-00002.gguf")
        ])
        XCTAssertThrowsError(try files.stageSelectedGGUFs(selected,model:model))
        XCTAssertEqual(try Data(contentsOf:try files.installed(model:model)),Data("GGUFfirst-kept".utf8))
    }
    func testSelectedGGUFsUseWebSampledFingerprintForLargeFiles() throws {
        let (root,files) = try setup()
        let size = 64 * 1024 * 1024 + 1
        func sparseGGUF(_ name: String, middle: UInt8) throws -> URL {
            let url = root.appendingPathComponent(name)
            let descriptor = open(url.path,O_WRONLY | O_CREAT | O_TRUNC,0o600)
            guard descriptor >= 0 else { throw POSIXError(.EIO) }
            defer { close(descriptor) }
            guard ftruncate(descriptor,off_t(size)) == 0 else { throw POSIXError(.EIO) }
            let header = Array("GGUF".utf8)
            guard header.withUnsafeBytes({ pwrite(descriptor,$0.baseAddress,$0.count,0) }) == header.count else { throw POSIXError(.EIO) }
            var changed = middle
            guard withUnsafeBytes(of:&changed,{ pwrite(descriptor,$0.baseAddress,1,off_t(32 * 1024 * 1024)) }) == 1 else { throw POSIXError(.EIO) }
            return url
        }
        let first = try sparseGGUF("first.gguf",middle:1)
        let second = try sparseGGUF("second.gguf",middle:2)
        let inspected = try files.inspectSelectedGGUFs([first,second])
        XCTAssertNotEqual(inspected[0].hash,inspected[1].hash)
        XCTAssertEqual(inspected[0].fingerprint,inspected[1].fingerprint)

        // Web's documented 64 MiB + 1 vector: 1 MiB GGUF head, 1 MiB zero tail, then the size suffix.
        XCTAssertEqual(inspected[0].fingerprint,"74637616f096571c9a89ca82e8bcd2a8584c48883c6e16d5ba8e5268d073e92a")
    }
    func testDirectoryRollbackRestoresPreviousGenerationOrRemovesNewGeneration() throws {
        let (root,files) = try setup(), metadata = shardedModel(), old = try shardSource(root,suffix:"old")
        try install(old,files,metadata)
        let replacement = try shardSource(root,name:"replacement",suffix:"replacement")
        let inspection = try files.inspectDirectory(replacement,model:metadata)
        let staged = try files.stageDirectory(replacement,model:metadata,inspection:inspection)
        try files.publishDirectory(staged,model:metadata)
        XCTAssertEqual(try Data(contentsOf:files.installed(model:metadata)),Data("GGUFfirst-replacement".utf8))
        try files.rollbackDirectory(staged,model:metadata)
        staged.discard()
        XCTAssertEqual(try Data(contentsOf:files.installed(model:metadata)),Data("GGUFfirst-old".utf8))

        let fresh = shardedModel("org/fresh-split")
        let freshInspection = try files.inspectDirectory(replacement,model:fresh)
        let freshStage = try files.stageDirectory(replacement,model:fresh,inspection:freshInspection)
        try files.publishDirectory(freshStage,model:fresh)
        try files.rollbackDirectory(freshStage,model:fresh)
        freshStage.discard()
        XCTAssertFalse(try files.directoryIsPresent(modelID:"org/fresh-split"))
    }
    func testFailedDirectoryRollbackPreservesPendingPreviousGeneration() throws {
        let (root,files) = try setup(), metadata = shardedModel(), old = try shardSource(root,suffix:"old")
        try install(old,files,metadata)
        let replacement = try shardSource(root,name:"replacement",suffix:"replacement")
        let inspection = try files.inspectDirectory(replacement,model:metadata)
        let staged = try files.stageDirectory(replacement,model:metadata,inspection:inspection)
        try files.publishDirectory(staged,model:metadata)
        let target = try files.directoryURL(modelID:"org/split")
        try FileManager.default.moveItem(at:target,to:root.appendingPathComponent("external-generation"))
        try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true)
        try write(target,"replacement.gguf",Data("GGUFexternal".utf8))

        XCTAssertThrowsError(try files.rollbackDirectory(staged,model:metadata))
        staged.discard()
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath:files.directory.path).contains { $0.hasSuffix(".part") })
        XCTAssertTrue(FileManager.default.fileExists(atPath:target.appendingPathComponent("replacement.gguf").path))
    }
    func testDownloadCacheRejectsRootAndIntermediateSymlinksWithoutTouchingOutsideFiles() throws {
        let (root,files) = try setup()
        try FileManager.default.createDirectory(at:files.directory,withIntermediateDirectories:true)
        let outside = root.appendingPathComponent("outside")
        try write(outside,"kept.gguf",Data("GGUFoutside".utf8))
        let cacheRoot = files.directory.appendingPathComponent(".catalog-cache")
        try FileManager.default.createSymbolicLink(at:cacheRoot,withDestinationURL:outside)
        XCTAssertThrowsError(try files.openDownloadCache(name:"plan"))
        XCTAssertEqual(try Data(contentsOf:outside.appendingPathComponent("kept.gguf")),Data("GGUFoutside".utf8))

        try FileManager.default.removeItem(at:cacheRoot)
        let cache = try files.openDownloadCache(name:"plan")
        try FileManager.default.createSymbolicLink(at:cache.url.appendingPathComponent("nested"),withDestinationURL:outside)
        let downloaded = root.appendingPathComponent("download.gguf")
        try Data("GGUFdownload".utf8).write(to:downloaded)
        XCTAssertThrowsError(try cache.install(downloaded,path:"nested/model.gguf"))
        XCTAssertEqual(try Data(contentsOf:outside.appendingPathComponent("kept.gguf")),Data("GGUFoutside".utf8))

        try FileManager.default.removeItem(at:cache.url.appendingPathComponent("nested"))
        try FileManager.default.createDirectory(at:cache.url.appendingPathComponent("nested"),withIntermediateDirectories:false)
        try FileManager.default.createSymbolicLink(at:cache.url.appendingPathComponent("nested/model.gguf"),withDestinationURL:outside.appendingPathComponent("kept.gguf"))
        let installed = try cache.install(downloaded,path:"nested/model.gguf")
        XCTAssertEqual(installed.hash,SHA256.hash(data:Data("GGUFdownload".utf8)).map { String(format:"%02x",$0) }.joined())
        XCTAssertEqual(try Data(contentsOf:cache.url.appendingPathComponent("nested/model.gguf")),Data("GGUFdownload".utf8))
        XCTAssertEqual(try Data(contentsOf:outside.appendingPathComponent("kept.gguf")),Data("GGUFoutside".utf8))
    }
    func testModelRemovalStagesBothAssetsThenRollsBackOrCommits() throws {
        let (root,files) = try setup(), id = "remove/é", metadata = model(id)
        let gguf = root.appendingPathComponent("remove.gguf")
        try Data("GGUFremove".utf8).write(to:gguf)
        try files.install(gguf,modelID:id)
        try install(try source(root),files,metadata)

        let staged = try files.stageModelRemoval(modelID:id)
        XCTAssertThrowsError(try files.installed(modelID:id))
        XCTAssertFalse(try files.directoryIsPresent(modelID:id))
        try staged.rollback()
        XCTAssertEqual(try Data(contentsOf:files.installed(modelID:id)),Data("GGUFremove".utf8))
        XCTAssertTrue(try files.directoryIsPresent(modelID:id))

        let committed = try files.stageModelRemoval(modelID:id)
        try committed.commit()
        XCTAssertThrowsError(try files.installed(modelID:id))
        XCTAssertFalse(try files.directoryIsPresent(modelID:id))
    }
    func testModelRemovalRecoveryRespectsRegistrationAndNeverOverwritesNewGeneration() throws {
        let (root,files) = try setup(), id = "recover/model"
        let first = root.appendingPathComponent("first.gguf")
        try Data("GGUFfirst".utf8).write(to:first)
        try files.install(first,modelID:id)
        _ = try files.stageModelRemoval(modelID:id)
        try files.recoverModelRemovals(registeredIDs:[id])
        XCTAssertEqual(try Data(contentsOf:files.installed(modelID:id)),Data("GGUFfirst".utf8))

        _ = try files.stageModelRemoval(modelID:id)
        try files.recoverModelRemovals(registeredIDs:[])
        XCTAssertThrowsError(try files.installed(modelID:id))

        try files.install(first,modelID:id)
        let stale = try files.stageModelRemoval(modelID:id)
        let replacement = try files.url(modelID:id)
        try Data("GGUFnew".utf8).write(to:replacement)
        XCTAssertThrowsError(try stale.rollback())
        XCTAssertEqual(try Data(contentsOf:replacement),Data("GGUFnew".utf8))
        XCTAssertTrue(FileManager.default.fileExists(atPath:files.directory.appendingPathComponent(".model-removals-journal.json").path))
    }
    func testModelRemovalRecoveryClearsCompletedRollbackJournalWithoutDeletingRestoredAsset() throws {
        let (root,files) = try setup(), id = "recover/completed"
        let first = root.appendingPathComponent("first.gguf")
        try Data("GGUFfirst".utf8).write(to:first)
        try files.install(first,modelID:id)
        _ = try files.stageModelRemoval(modelID:id)

        let quarantines = files.directory.appendingPathComponent(".model-removals")
        let quarantine = try XCTUnwrap(try FileManager.default.contentsOfDirectory(at:quarantines,includingPropertiesForKeys:nil).first)
        let target = try files.url(modelID:id)
        try FileManager.default.moveItem(at:quarantine.appendingPathComponent(target.lastPathComponent),to:target)
        try FileManager.default.removeItem(at:quarantine)

        try files.recoverModelRemovals(registeredIDs:[id])
        try files.recoverModelRemovals(registeredIDs:[])
        XCTAssertEqual(try Data(contentsOf:files.installed(modelID:id)),Data("GGUFfirst".utf8))
    }
}
