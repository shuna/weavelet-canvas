import XCTest
@testable import WeaveletPilot

final class BranchNavigationTests: XCTestCase {
    private func fixture() throws -> OrderedJSON {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }
    func testAnyNodeSiblingAndLegacyViewingPathUseSharedTargetsAndRetainUnknownRawFields() throws {
        let original=try fixture(), store=try original.required("contentStore"), inactive=try store.required("inactive")
        var parts=try inactive.required("content").array("parts")
        parts[0]=parts[0].replacing("xHuge",with:.number("9007199254740993"))
        let source=original.replacing("xHuge",with:.number("9007199254740993")).replacing("contentStore",with:store.replacing("inactive",with:inactive.replacing("content",with:.array(parts))))
        let target=try BranchNavigation.navigate(in:source,chatID:"chat-a",nodeID:"n-user")
        XCTAssertEqual(target.status,.reached); XCTAssertEqual(target.path,["n-system","n-user","n-inactive"])
        XCTAssertEqual(target.source["xHuge"],.number("9007199254740993")); XCTAssertEqual(target.source["contentStore"],source["contentStore"])
        let displayed=try target.source.required("chats").array("chats")[0].required("messages").array("messages")
        XCTAssertEqual(try displayed.last?.required("content").array("parts")[0]["xHuge"],.number("9007199254740993"))
        let searched=try BranchNavigation.navigate(in:source,chatID:"chat-a",nodeID:"n-user",source:.search,viewingPath:["n-system","n-user","n-inactive"])
        XCTAssertEqual(searched.path,["n-system","n-user","n-inactive"])
        XCTAssertEqual(try searched.source.required("chats").array("chats")[0].required("branchTree")["activePath"],.array(searched.path.map(OrderedJSON.string)))
        XCTAssertEqual(try BranchNavigation.navigate(in:source,chatID:"absent").status,.chatMissing)
        XCTAssertEqual(try BranchNavigation.navigate(in:source,chatID:"chat-b",nodeID:"message-0").status,.nodeMissing)
    }
    func testAllNodeCandidateBatchUsesExactUnicodeIDsAndSiblingOrder() throws {
        let source=try fixture(), candidates=try BranchNavigation.candidates(in:source)
        let chat=try XCTUnwrap(candidates.first { $0.chatID == "chat-a" })
        XCTAssertEqual(chat.candidates(for:"n-assistant")?.siblingIDs,["n-inactive","n-assistant"])
        XCTAssertEqual(chat.candidates(for:"n-assistant")?.selectedIndex,1)
        let unicodeIDs=["é","e\u{301}"]
        let nodes=OrderedJSON.object(unicodeIDs.map { id in .init(key:id,value:.object([.init(key:"id",value:.string(id)),.init(key:"parentId",value:.null),.init(key:"createdAt",value:.number("1"))])) })
        let unicode=OrderedJSON.object([.init(key:"chats",value:.array([.object([.init(key:"id",value:.string("unicode")),.init(key:"branchTree",value:.object([.init(key:"nodes",value:nodes),.init(key:"activePath",value:.array([.string("é")]))]))])]))])
        let result=try XCTUnwrap(BranchNavigation.candidates(in:unicode).first)
        XCTAssertEqual(result.candidates(for:"e\u{301}")?.selectedIndex,1)
        XCTAssertEqual(result.nodeIDs.map { Data($0.utf8) },unicodeIDs.map { Data($0.utf8) })
    }
    func testSharedHistoryBackForwardAndInvalidRestorePath() throws {
        let source=try fixture()
        var history=try BranchNavigation.emptyHistory()
        let initialized=try BranchNavigation.history(history,action:.initialize,in:source,chatID:"chat-a",view:"chat",key:"first")
        history=initialized.history
        let second=try BranchNavigation.navigate(in:source,chatID:"chat-b",source:.chatSwitch)
        let anchor=OrderedJSON.object([.init(key:"firstVisibleItemIndex",value:.number("2")),.init(key:"offsetWithinItem",value:.number("123")),.init(key:"wasAtBottom",value:.bool(false))])
        history=try BranchNavigation.history(history,action:.capture,in:source,scrollAnchor:anchor).history
        let pushed=try BranchNavigation.history(history,action:.push,in:source,target:second,view:"chat",navigationSource:.chatSwitch,key:"second")
        XCTAssertTrue(pushed.canBack); XCTAssertFalse(pushed.canForward)
        let back=try BranchNavigation.history(pushed.history,action:.back,in:source)
        XCTAssertEqual(back.entry?["chatId"],.string("chat-a")); XCTAssertTrue(back.canForward)
        XCTAssertEqual(back.entry?["scrollAnchor"],anchor)
        let forward=try BranchNavigation.history(back.history,action:.forward,in:source)
        XCTAssertEqual(forward.entry?["chatId"],.string("chat-b"))
        let invalid=OrderedJSON.object([.init(key:"chatId",value:.string("chat-a")),.init(key:"activePath",value:.array([.string("n-user"),.string("n-system")]))])
        XCTAssertEqual(try BranchNavigation.restore(in:source,entry:invalid).source,source)
    }
}
