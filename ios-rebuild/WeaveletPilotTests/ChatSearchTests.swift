import XCTest
@testable import WeaveletPilot

final class ChatSearchTests: XCTestCase {
    private func source() throws -> OrderedJSON {
        try OrderedJSON.decode(Data(#"""
        {"xRoot":{"number":9007199254740993,"raw":1.234567890123456789},"chats":[
          {"id":"tree","title":"Other title","folder":"child","xChat":9007199254740993,"messages":[],"branchTree":{"rootId":"root","activePath":["root","a"],"nodes":{
            "root":{"id":"root","parentId":null,"contentHash":"root"},
            "b":{"id":"b","parentId":"root","contentHash":"b","label":"Needle label","starred":true},
            "a":{"id":"a","parentId":"root","contentHash":"a","pinned":true},
            "orphan":{"id":"orphan","parentId":"missing","contentHash":"orphan","starred":true,"pinned":true}
          }}},
          {"id":"flat","title":"Needle title","messages":[{"role":"user","xMessage":9007199254740993,"content":[{"type":"text","text":"Needle flat","xPart":1.000000000000000001},{"type":"reasoning","text":"Reasoning only"},{"type":"tool_result","tool_call_id":"tool","content":"Tool only"}]}]},
          {"id":"selected","title":"Unmatched","messages":[]}
        ],"folders":{"parent":{"id":"parent","name":"Work","order":0,"xFolder":9007199254740993},"child":{"id":"child","name":"Nested","parentId":"parent","order":1}},
        "contentStore":{
          "root":{"content":[{"type":"text","text":"Needle root"}],"refCount":1},
          "b":{"content":[{"type":"text","text":"No body match"}],"refCount":1},
          "a":{"content":[{"type":"text","text":"Needle active"}],"refCount":1},
          "orphan":{"content":[{"type":"text","text":"Needle orphan"}],"refCount":1}
        }}
        """#.utf8))
    }
    func testLibraryTitleFolderAncestorsCurrentSelectionAndRawSourcePreservation() throws {
        let source = try source(), before = try source.encoded()
        let title = try ChatSearch.results(in: source, query: "needle", mode: .library)
        XCTAssertEqual(title.map(\.chatID), ["flat"]); XCTAssertNil(title[0].nodeID)
        XCTAssertEqual(title[0].snippet, "Needle title")
        XCTAssertEqual(try ChatSearch.results(in: source, query: "WORK", mode: .library).map(\.chatID), ["tree"])
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .library, currentChatID: "selected").map(\.chatID), ["flat", "selected"])
        XCTAssertEqual(try ChatSearch.results(in: source, query: "", mode: .library).map(\.chatID), ["tree", "flat", "selected"])
        XCTAssertEqual(try source.encoded(), before)
    }
    func testActualDFSLabelStarOrphanAndActivePathScope() throws {
        let source = try source(), before = try source.encoded()
        let results = try ChatSearch.results(in: source, query: "NEEDLE", mode: .nodes)
        XCTAssertEqual(results.map(\.nodeID), ["root", "b", "a", "orphan"])
        XCTAssertEqual(results.map(\.matchType), ["content", "label", "content", "content"])
        XCTAssertEqual(results[1].label, "Needle label"); XCTAssertEqual(results[1].snippet, "No body match")
        XCTAssertTrue(results[1].starred); XCTAssertFalse(results[1].isOnActivePath)
        XCTAssertTrue(results[3].pinned)
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .nodes, scope: .activePath).map(\.nodeID), ["root", "a"])
        XCTAssertEqual(try ChatSearch.results(in: source, query: "", mode: .nodes, starredOnly: true).map(\.nodeID), ["b", "orphan"])
        XCTAssertTrue(try ChatSearch.results(in: source, query: "", mode: .nodes).isEmpty)
        XCTAssertTrue(try ChatSearch.results(in: source, query: " needle ", mode: .nodes).isEmpty)
        XCTAssertEqual(try source.encoded(), before)
    }
    func testGrepTrimTextOnlyAndLegacyChatNavigation() throws {
        let source = try source(), before = try source.encoded()
        let results = try ChatSearch.results(in: source, query: "  needle  ", mode: .grep)
        XCTAssertEqual(results.map(\.chatID), ["tree", "tree", "tree", "tree", "flat"])
        XCTAssertEqual(results.map(\.nodeID), ["root", "b", "a", "orphan", nil])
        XCTAssertEqual(results.last?.resultID, "legacy-0")
        XCTAssertEqual(results.last?.chatIndex, 1)
        XCTAssertTrue(try ChatSearch.results(in: source, query: "Reasoning only", mode: .grep).isEmpty)
        XCTAssertTrue(try ChatSearch.results(in: source, query: "Tool only", mode: .grep).isEmpty)
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .grep, chatID: "flat").map(\.resultID), ["legacy-0"])
        XCTAssertEqual(try source.encoded(), before)
    }
    func testExistingHandDefinedWireDeltaIsSearchedWithoutRewritingRawEntries() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/content-entry-wire.json")))
        let source = try fixture.required("snapshot").required("state"), before = try source.encoded()
        let results = try ChatSearch.results(in: source, query: "FAKE TEST body", mode: .nodes)
        XCTAssertEqual(results.map(\.nodeID), ["left", "right", "delta"])
        XCTAssertEqual(results.map(\.snippet), ["FAKE TEST body", "FAKE TEST body", "FAKE TEST body"])
        XCTAssertEqual(try source.encoded(), before)
    }
    func testSplitEmojiSnippetUsesWebDisplayReplacementAndWholePairsRemain() throws {
        var source = try source()
        let store = try source.required("contentStore"), entry = try store.required("b")
        func body(_ text: String) -> OrderedJSON { .array([.object([.init(key: "type", value: .string("text")), .init(key: "text", value: .string(text))])]) }
        source = source.replacing("contentStore", with: store.replacing("b", with: entry.replacing("content", with: body(String(repeating: "a", count: 79) + "🙂"))))
        let before = try source.encoded()
        XCTAssertEqual(try ChatSearch.results(in: source, query: "label", mode: .nodes).first?.snippet, String(repeating: "a", count: 79) + "\u{FFFD}...")
        XCTAssertEqual(try source.encoded(), before)
        source = source.replacing("contentStore", with: store.replacing("b", with: entry.replacing("content", with: body(String(repeating: "a", count: 78) + "🙂"))))
        XCTAssertEqual(try ChatSearch.results(in: source, query: "label", mode: .nodes).first?.snippet, String(repeating: "a", count: 78) + "🙂")
    }
}
