import XCTest
import CryptoKit
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
}
