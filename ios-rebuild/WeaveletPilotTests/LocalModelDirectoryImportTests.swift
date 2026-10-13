import XCTest
@testable import WeaveletPilot

@MainActor final class LocalModelDirectoryImportTests: XCTestCase {
    private func fixture() throws -> (URL,LocalStateStore,ChatState,OrderedJSON) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("directory-import-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        let store = LocalStateStore(fileURL:root.appendingPathComponent("state.json"))
        let state = ChatState(store:store,localGenerate: { _,_,_ in try await Task.sleep(nanoseconds:60_000_000_000) })
        try state.importWebData(ChatLibrary.emptySource.encoded())
        let model = try OrderedJSON.decode(Data(#"{"id":"é/classifier","engine":"transformers.js","label":"Existing classifier","tasks":["analysis","moderation"],"origin":"https://never-fetch.invalid/model","manifest":{"kind":"multi-file","entrypoint":"onnx/model.onnx","requiredFiles":["config.json","onnx/model.onnx"],"xOpaque":1.00},"xRaw":9007199254740993,"xUnicode":"é"}"#.utf8))
        let snapshot = try state.publicationSnapshot()
        let roots = try snapshot.required("state").replacing("localModels",with:.array([model]))
            .replacing("activeLocalModels",with:try OrderedJSON.decode(Data(#"{"generation":"keep","analysis":"é/classifier","moderation":"keep-extra","xRaw":1.00}"#.utf8)))
            .replacing("savedModelMeta",with:try OrderedJSON.decode(Data(#"{"é/classifier":{"storedBytes":9007199254740993,"xRaw":1e02}}"#.utf8)))
            .replacing("xUnknown",with:.number("1.2300"))
        try state.applySnapshot(snapshot.replacing("state",with:roots))
        return (root,store,state,model)
    }
    private func source(_ root: URL, _ name: String) throws -> URL {
        let dir = root.appendingPathComponent(name)
        try FileManager.default.createDirectory(at:dir.appendingPathComponent("onnx"),withIntermediateDirectories:true)
        try Data("{\"opaque\":1.00}".utf8).write(to:dir.appendingPathComponent("config.json"))
        try Data(("binary\0"+name).utf8).write(to:dir.appendingPathComponent("onnx/model.onnx"))
        try Data("extra".utf8).write(to:dir.appendingPathComponent("tokenizer_config.json"))
        return dir
    }
    private func stage(_ source: URL, _ state: ChatState, _ model: OrderedJSON) throws -> LocalModelFiles.DirectoryStage {
        let files = state.localModelFiles
        return try files.stageDirectory(source,model:model,inspection:files.inspectDirectory(source,model:model))
    }
    private func originalTarget(_ root: URL, _ state: ChatState, _ model: OrderedJSON) throws -> Data {
        let source = try source(root,"original")
        let files = state.localModelFiles
        try files.installDirectory(source,model:model,inspection:files.inspectDirectory(source,model:model))
        return try targetBytes(state,model)
    }
    private func targetBytes(_ state: ChatState, _ model: OrderedJSON) throws -> Data {
        let id = try model.required("id").string("id")
        return try Data(contentsOf:state.localModelFiles.directoryURL(modelID:id).appendingPathComponent("onnx/model.onnx"))
    }
    private func noPending(_ state: ChatState) throws {
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath:state.localModelFiles.directory.path).contains { $0.hasSuffix(".part") })
    }
    func testAsyncFolderImportPreservesFullSnapshotDiskAndRestartMetadata() async throws {
        let (root,store,state,model) = try fixture(), source = try source(root,"selected")
        let snapshot = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        XCTAssertFalse(try state.localModelFiles.directoryIsPresent(modelID:"é/classifier"))
        let id = try await state.importModelDirectory(source,model:model)
        XCTAssertEqual(id,"é/classifier")
        XCTAssertEqual(try state.publicationSnapshot().encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        let restarted = ChatState(store:store)
        XCTAssertEqual(try restarted.publicationSnapshot().encoded(),snapshot)
        XCTAssertTrue(try restarted.localModelFiles.directoryIsPresent(modelID:id))
        let entries = Dictionary(uniqueKeysWithValues:try restarted.localModelFiles.directoryEntries(model:model).map { ($0.path,$0.data) })
        XCTAssertEqual(entries["onnx/model.onnx"],Data("binary\0selected".utf8))
        XCTAssertEqual(entries["tokenizer_config.json"],Data("extra".utf8))
    }
    func testModelChangedAfterPickerAndAfterStageRejectsWithoutChangingCurrentState() async throws {
        let (root,store,state,model) = try fixture(), original = try originalTarget(root,state,model)
        let replacement = try source(root,"replacement"), staged = try stage(replacement,state,model)
        defer { staged.discard() }
        let snapshot = try state.publicationSnapshot()
        let changed = model.replacing("xRaw",with:.number("9007199254740993.0"))
        try state.applySnapshot(snapshot.replacing("state",with:try snapshot.required("state").replacing("localModels",with:.array([changed]))))
        let current = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        do { _ = try await state.importModelDirectory(replacement,model:model); XCTFail("stale picker model accepted") } catch { }
        XCTAssertThrowsError(try state.publishModelDirectory(staged,model:model))
        XCTAssertEqual(try state.publicationSnapshot().encoded(),current)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertEqual(try targetBytes(state,model),original)
        staged.discard(); try noPending(state)
    }
    func testCancellationAfterStageKeepsOriginalTargetAndMetadataAndDiscardsOnlyPending() async throws {
        let (root,store,state,model) = try fixture(), original = try originalTarget(root,state,model)
        let staged = try stage(source(root,"replacement"),state,model)
        let snapshot = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        let task = Task { @MainActor in try state.publishModelDirectory(staged,model:model) }
        task.cancel()
        do { try await task.value; XCTFail("cancelled stage published") } catch is CancellationError { } catch { XCTFail("unexpected error: \(error)") }
        staged.discard(); try noPending(state)
        XCTAssertEqual(try targetBytes(state,model),original)
        XCTAssertEqual(try state.publicationSnapshot().encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        let cancelledImport = Task { @MainActor in try await state.importModelDirectory(source(root,"cancelled"),model:model) }
        cancelledImport.cancel()
        do { _ = try await cancelledImport.value; XCTFail("cancelled import accepted") } catch is CancellationError { } catch { XCTFail("unexpected error: \(error)") }
        XCTAssertEqual(try targetBytes(state,model),original)
        try noPending(state)
    }
    func testCopyFailureAndMarkedSourceKeepOriginalStateAndTarget() async throws {
        let (root,store,state,model) = try fixture(), original = try originalTarget(root,state,model)
        let replacement = try source(root,"replacement"), files = state.localModelFiles
        let inspection = try files.inspectDirectory(replacement,model:model)
        try Data("modified after inspect".utf8).write(to:replacement.appendingPathComponent("onnx/model.onnx"))
        let snapshot = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        XCTAssertThrowsError(try files.stageDirectory(replacement,model:model,inspection:inspection))
        try Data().write(to:replacement.appendingPathComponent("onnx/model.onnx.part"))
        do { _ = try await state.importModelDirectory(replacement,model:model); XCTFail("marked source accepted") } catch { }
        XCTAssertEqual(try state.publicationSnapshot().encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        XCTAssertEqual(try targetBytes(state,model),original)
        try noPending(state)
    }
    func testStaleTargetRejectsStageAndDoesNotRevertNewGeneration() throws {
        let (root,store,state,model) = try fixture()
        _ = try originalTarget(root,state,model)
        let staged = try stage(source(root,"replacement"),state,model)
        defer { staged.discard() }
        let files = state.localModelFiles, newer = try source(root,"newer")
        try files.installDirectory(newer,model:model,inspection:files.inspectDirectory(newer,model:model))
        let snapshot = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        XCTAssertThrowsError(try state.publishModelDirectory(staged,model:model))
        XCTAssertEqual(try targetBytes(state,model),Data("binary\0newer".utf8))
        XCTAssertEqual(try state.publicationSnapshot().encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        staged.discard(); try noPending(state)
    }
    func testGenerationStartedAfterStagePreventsPublication() throws {
        let (root,store,state,model) = try fixture(), original = try originalTarget(root,state,model)
        let staged = try stage(source(root,"replacement"),state,model)
        defer { staged.discard() }
        try state.createChat(id:"busy-chat",now:1)
        var draft = try state.chatConfigDraft()
        draft.config = draft.config.replacing("modelSource",with:.string("local")).replacing("model",with:.string("busy-gguf"))
            .replacing("max_tokens",with:.number("8")).replacing("temperature",with:.number("0"))
        try state.saveChatConfig(draft)
        let gguf = root.appendingPathComponent("busy.gguf")
        try Data("GGUF fixture".utf8).write(to:gguf)
        try state.localModelFiles.install(gguf,modelID:"busy-gguf")
        try state.startGeneration(input:"busy input")
        defer { state.stopGeneration() }
        XCTAssertNotNil(state.generation)
        let snapshot = try state.publicationSnapshot().encoded(), disk = try Data(contentsOf:store.fileURL)
        XCTAssertThrowsError(try state.publishModelDirectory(staged,model:model))
        XCTAssertEqual(try targetBytes(state,model),original)
        XCTAssertEqual(try state.publicationSnapshot().encoded(),snapshot)
        XCTAssertEqual(try Data(contentsOf:store.fileURL),disk)
        staged.discard(); try noPending(state)
    }
}
