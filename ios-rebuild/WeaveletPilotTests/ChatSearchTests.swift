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
    func testNodeSearchUsesDisplayedOrderAndOriginalChatIndexes() throws {
        var source = try source(), chats = try source.required("chats").array("chats")
        chats.append(chats[0].replacing("id", with: .string("second-tree")))
        source = source.replacing("chats", with: .array(chats))
        let before = try source.encoded()
        // Web BranchEditorCanvas maps chatIndices in display order; branchSearch iterates those entries.
        let results = try ChatSearch.results(in: source, query: "needle", mode: .nodes, chatIDs: ["second-tree", "tree"])
        XCTAssertEqual(results.map(\.chatID), Array(repeating: "second-tree", count: 4) + Array(repeating: "tree", count: 4))
        XCTAssertEqual(results.map(\.chatIndex), Array(repeating: 3, count: 4) + Array(repeating: 0, count: 4))
        XCTAssertTrue(try ChatSearch.results(in: source, query: "needle", mode: .nodes, chatIDs: []).isEmpty)
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .nodes, chatIDs: ["second-tree"]).map(\.chatIndex), Array(repeating: 3, count: 4))
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .library, chatIDs: []).map(\.chatID), ["flat"])
        XCTAssertEqual(try ChatSearch.results(in: source, query: "needle", mode: .grep, chatIDs: []).map(\.chatID).count, 9)
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
    func testSharedSearchHistoryResultReconciliationAndCycling() throws {
        let lone = OrderedJSON.utf16String([0xd800])
        let history = OrderedJSON.array([lone, .string("older"), .string("needle")])
        let updated = try ChatSearch.searchHistory(history, query: "  needle  ")
        XCTAssertEqual(try updated.encoded(), try OrderedJSON.array([.string("needle"), lone, .string("older")]).encoded())
        XCTAssertEqual(try ChatSearch.searchHistory(updated, query: "  ").encoded(), try updated.encoded())

        let results = try ChatSearch.results(in: source(), query: "needle", mode: .nodes)
        let previous = [results[0], results[1]]
        let preserved = try ChatSearch.resultSelection(previous: previous, index: 1, results: [results[1], results[0]])
        XCTAssertEqual(preserved.index, 0); XCTAssertFalse(preserved.shouldNavigate)
        let changedChat = ChatSearchResult(chatID: "different", nodeID: results[1].nodeID, resultID: results[1].resultID,
                                           chatIndex: 2, chatTitle: "Other", snippet: results[1].snippet,
                                           matchType: results[1].matchType, isOnActivePath: false, label: nil, starred: false, pinned: false)
        let changed = try ChatSearch.resultSelection(previous: previous, index: 1, results: [changedChat])
        XCTAssertEqual(changed.index, 0); XCTAssertTrue(changed.shouldNavigate)
        let library = try ChatSearch.results(in:source(),query:"",mode:.library)
        XCTAssertGreaterThan(library.count,2)
        let retainedLibrary = try ChatSearch.resultSelection(previous:library,index:1,results:library)
        XCTAssertEqual(retainedLibrary.index,1); XCTAssertFalse(retainedLibrary.shouldNavigate)
        XCTAssertEqual(try ChatSearch.stepResult(index:retainedLibrary.index,count:library.count,backward:false),2)
        let legacy = try XCTUnwrap(ChatSearch.results(in:source(),query:"needle",mode:.grep).last)
        XCTAssertNil(legacy.nodeID)
        let otherLegacy = ChatSearchResult(chatID:legacy.chatID,nodeID:nil,resultID:"legacy-other",chatIndex:legacy.chatIndex,
            chatTitle:legacy.chatTitle,snippet:"Other",matchType:legacy.matchType,isOnActivePath:true,label:nil,starred:false,pinned:false)
        let retainedLegacy = try ChatSearch.resultSelection(previous:[legacy,otherLegacy],index:1,results:[legacy,otherLegacy])
        XCTAssertEqual(retainedLegacy.index,1); XCTAssertFalse(retainedLegacy.shouldNavigate)
        let empty = try ChatSearch.resultSelection(previous: previous, index: 1, results: [])
        XCTAssertEqual(empty.index, -1); XCTAssertFalse(empty.shouldNavigate)
        XCTAssertEqual(try ChatSearch.stepResult(index: 1, count: 2, backward: false), 0)
        XCTAssertEqual(try ChatSearch.stepResult(index: 0, count: 2, backward: true), 1)
        XCTAssertEqual(try ChatSearch.stepResult(index: -1, count: 0, backward: false), -1)
    }
    func testHistorySaveIsAtomicAndIncludedInSyncRecordsWithoutChangingOtherRoots() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("search-history-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        var rejects = false
        let local = LocalStateStore(fileURL: directory.appendingPathComponent("state.json"), write: { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        })
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
        let state = ChatState(store: local)
        try state.importWebData(fixture.encoded())
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        rejects = true
        XCTAssertThrowsError(try state.saveSearchQueryToHistory("  needle  "))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        rejects = false
        try state.saveSearchQueryToHistory("  needle  ")
        try state.saveSearchQueryToHistory("  sidebar  ", field: .sidebarSearchHistory)
        try state.saveSearchQueryToHistory("  find  ", field: .chatFindHistory)
        let saved = try state.publicationSnapshot()
        XCTAssertEqual(try saved.required("state").required("searchHistory"), .array([.string("needle")]))
        XCTAssertEqual(try saved.required("state").required("sidebarSearchHistory"), .array([.string("sidebar")]))
        XCTAssertEqual(try saved.required("state").required("chatFindHistory"), .array([.string("find")]))
        XCTAssertEqual(try saved.required("state").required("chats").encoded(), try before.required("state").required("chats").encoded())
        XCTAssertEqual(try ChatState(store: local).publicationSnapshot().encoded(), try saved.encoded())

        let raw = OrderedJSON.array([.utf16String([0xd800]), .string("needle")])
        try state.saveDisplaySetting(.searchHistory, value: raw)
        let rawSaved = try state.publicationSnapshot()
        let records = try SyncRecords.toRecords(rawSaved)
        let restored = try SyncRecords.fromRecords(records).required("state").required("searchHistory")
        XCTAssertEqual(try restored.encoded(), try raw.encoded())
        let restoredState = try SyncRecords.fromRecords(records).required("state")
        XCTAssertEqual(try restoredState.required("sidebarSearchHistory"), .array([.string("sidebar")]))
        XCTAssertEqual(try restoredState.required("chatFindHistory"), .array([.string("find")]))
        XCTAssertEqual(try ChatState(store: local).publicationSnapshot().required("state").required("searchHistory").encoded(), try raw.encoded())
        XCTAssertThrowsError(try state.saveDisplaySetting(.searchHistory, value: .array([.number("1")])))
    }
}
