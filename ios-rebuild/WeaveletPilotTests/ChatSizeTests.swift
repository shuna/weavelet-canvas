import XCTest
@testable import WeaveletPilot

final class ChatSizeTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.decode(Data(text.utf8)) }
    private func fixture(_ name: String, _ key: String) throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/\(name).json"))).required(key)
    }
    func testActualJSCUsesScalarLengthsAndExactUTF8ChatIDs() async throws {
        let longURL = String(repeating: "A", count: 200000)
        let source = try json(#"{"chats":[{"id":"é","messages":[{"content":[{"type":"text","text":"😀","raw":1.2300},{"type":"image_url","image_url":{"url":"URL","detail":"auto","unknown":9007199254740993}},{"type":"reasoning","text":"not counted"}]}]},{"id":"e\u0301","messages":[{"content":[{"type":"text","text":"longer"}]}]},{"id":"zero","messages":[]}]}"#)
        var chats = try source.required("chats").array("chats")
        var messages = try chats[0].required("messages").array("messages")
        var parts = try messages[0].required("content").array("content")
        parts[1] = parts[1].replacing("image_url", with: try parts[1].required("image_url").replacing("url", with: .string(longURL)))
        messages[0] = messages[0].replacing("content", with: .array(parts)); chats[0] = chats[0].replacing("messages", with: .array(messages))
        let input = source.replacing("chats", with: .array(chats)), before = try input.encoded()
        let projected = try ChatSize.projection(input).encoded()
        XCTAssertLessThan(projected.count, 700)
        XCTAssertFalse(String(decoding: projected, as: UTF8.self).contains(longURL))
        let worker = ChatSize(), sizes = try await worker.sizes(source: input, enabled: true)
        XCTAssertEqual(sizes[Data("é".utf8)], "200 002")
        XCTAssertEqual(sizes[Data("e\u{0301}".utf8)], "6")
        XCTAssertNil(sizes[Data("zero".utf8)])
        XCTAssertEqual(sizes.count, 2)
        XCTAssertEqual(try input.encoded(), before)
    }
    func testResolvedDeltaCountsOnlyMirroredActiveMessagesAndFlatMessages() async throws {
        let raw = try fixture("content-entry-wire", "snapshot")
        var roots = try raw.required("state"), chats = try roots.required("chats").array("chats")
        chats[0] = chats[0].replacing("branchTree", with: try chats[0].required("branchTree").replacing("activePath", with: .array([.string("left"), .string("delta")])))
        let flat = try json(#"{"id":"flat","title":"Flat","config":{"model":"fake"},"messages":[{"role":"user","content":[{"type":"text","text":"abc"},{"type":"reasoning","text":"ignored","image_url":{"url":"😀","detail":"auto"},"raw":1.2300}]}]}"#)
        chats.append(flat); roots = roots.replacing("chats", with: .array(chats))
        let document = try SyncDocument(snapshot: raw.replacing("state", with: roots)), before = try document.snapshot.encoded()
        let source = try WebExchange(source: document.uiProjection()).source
        let worker = ChatSize(), sizes = try await worker.sizes(source: source, enabled: true)
        XCTAssertEqual(sizes[Data("entry-chat".utf8)], "28")
        XCTAssertEqual(sizes[Data("flat".utf8)], "5")
        XCTAssertEqual(try document.snapshot.encoded(), before)
    }
    func testDisabledSkipsInvalidSourceAndCancelledWorkDoesNotReturnResults() async throws {
        let worker = ChatSize(), disabled = try await worker.sizes(source: .null, enabled: false)
        XCTAssertTrue(disabled.isEmpty)
        let (stream, continuation) = AsyncStream<Void>.makeStream()
        let task = Task { for await _ in stream {}; return try await worker.sizes(source: .null, enabled: true) }
        task.cancel(); continuation.finish()
        do { _ = try await task.value; XCTFail("cancelled work returned") }
        catch is CancellationError { }
        catch { XCTFail("wrong cancellation error: \(error)") }
    }
    func testDisplaySizeSaveFailureKeepsRawOptionAndOtherData() throws {
        var rejects = false
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("chat-size-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json"), store = LocalStateStore(fileURL: file) { bytes, url in
            if rejects { throw CocoaError(.fileWriteNoPermission) }; try bytes.write(to: url, options: .atomic)
        }
        let state = ChatState(store: store)
        try state.importWebData(fixture("io-corpus", "exportV3").encoded())
        XCTAssertEqual(try DisplaySettings.value(.displayChatSize, in: .object([])), try ChatImport.call("defaults").required("displayChatSize"))
        let initial = try state.publicationSnapshot()
        try state.applySnapshot(.object([.init(key: "version", value: try initial.required("version")),
            .init(key: "state", value: try json(#"{"displayChatSize":{"raw":1.2300},"other":{"value":9007199254740993}}"#))]))
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: file)
        XCTAssertEqual(try state.displaySetting(.displayChatSize), before["state"]?["displayChatSize"])
        rejects = true
        XCTAssertThrowsError(try state.saveDisplaySetting(.displayChatSize, value: .bool(true)))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: file), disk)
        rejects = false
        try state.saveDisplaySetting(.displayChatSize, value: .bool(true))
        let after = try state.publicationSnapshot().required("state"), previous = try before.required("state")
        XCTAssertEqual(after["displayChatSize"], .bool(true))
        XCTAssertEqual(try OrderedJSON.object(after.object("state").filter { $0.key != "displayChatSize" }).encoded(),
                       try OrderedJSON.object(previous.object("state").filter { $0.key != "displayChatSize" }).encoded())
    }
}
