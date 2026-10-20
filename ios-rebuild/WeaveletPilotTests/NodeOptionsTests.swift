import XCTest
@testable import WeaveletPilot

final class NodeOptionsTests: XCTestCase {
    private let now:Double=1700000000123
    private func fixture(_ name:String="io-corpus",key:String="exportV3") throws -> OrderedJSON {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf:root.appendingPathComponent("tests/fixtures/web-native/\(name).json"))).required(key)
    }
    private func chat(_ source:OrderedJSON,_ id:String) throws -> OrderedJSON {
        try XCTUnwrap(source.required("chats").array("chats").first { $0["id"] == .string(id) })
    }
    private func sourceWithRawMetadata() throws -> OrderedJSON {
        let original=try fixture(), rawChat=try chat(original,"chat-a"), tree=try rawChat.required("branchTree"), nodes=try tree.required("nodes")
        let node=try nodes.required("n-user").replacing("xHuge",with:.number("9007199254740993")).replacing("xDecimal",with:.number("1.234567890123456789"))
        let changed=rawChat.replacing("xHuge",with:.number("9007199254740995")).replacing("branchTree",with:tree.replacing("nodes",with:nodes.replacing("n-user",with:node)))
        var chats=try original.required("chats").array("chats"); chats[0]=changed
        return original.replacing("chats",with:.array(chats)).replacing("xRoot",with:.object([.init(key:"z",value:.number("9007199254740993")),.init(key:"a",value:.string("e\u{301}"))]))
    }
    func testExplicitOtherChatDraftPreservesRawMetadataAndSelection() throws {
        let rawLabel = OrderedJSON.utf16String([0x41, 0xd800, 0x42])
        var source = try sourceWithRawMetadata(), chats = try source.required("chats").array("chats")
        let targetTree = try chats[0].required("branchTree"), targetNodes = try targetTree.required("nodes")
        chats[0] = chats[0].replacing("branchTree", with: targetTree.replacing("nodes", with: targetNodes.replacing("n-user", with: try targetNodes.required("n-user").replacing("label", with: rawLabel))))
        source = source.replacing("chats", with: .array(chats))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("explicit-node-options-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStateStore(fileURL: directory.appendingPathComponent("state.json")), state = ChatState(store: store)
        try state.importWebData(source.encoded())
        state.selectedConversationID = "chat-b"
        var draft = try state.nodeOptionsDraft(nodeID: "n-user", chatID: "chat-a")
        XCTAssertEqual(draft.chatID, "chat-a")
        XCTAssertEqual(draft.value.label, "A�B")
        // The actual I/O corpus starts n-user starred and unpinned.
        XCTAssertTrue(draft.value.starred); XCTAssertFalse(draft.value.pinned)
        draft.value.starred = false; draft.value.pinned = true
        try state.saveNodeOptions(draft, now: now)

        XCTAssertEqual(state.selectedConversationID, "chat-b")
        let changed = try XCTUnwrap(state.exchange?.source), originalTarget = try chat(source, "chat-a"), target = try chat(changed, "chat-a")
        let node = try target.required("branchTree").required("nodes").required("n-user")
        XCTAssertEqual(node["label"], rawLabel)
        // Web setNodeStar removes the field on false (branch-slice.ts); typed read remains false.
        XCTAssertNil(node["starred"]); XCTAssertEqual(node["pinned"], .bool(true))
        XCTAssertEqual(node["xHuge"], .number("9007199254740993")); XCTAssertEqual(node["xDecimal"], .number("1.234567890123456789"))
        XCTAssertEqual(try NodeOptions.read(chat: target, nodeID: "n-user"), draft.value)
        XCTAssertEqual(target["xHuge"], originalTarget["xHuge"])
        XCTAssertEqual(changed["xRoot"], source["xRoot"])
        XCTAssertEqual(try chat(changed, "chat-b").encoded(), try chat(source, "chat-b").encoded())
        XCTAssertEqual(try ChatState(store: store).exportWebData(), try state.exportWebData())
    }

    func testTypedReadMatchesSharedWebProjectionWithoutCreatingVMForUIRows() throws {
        let source=try fixture(), treeChat=try chat(source,"chat-a")
        for id in ["n-system","n-user","n-inactive","n-assistant"] {
            let value=try NodeOptions.read(chat:treeChat,nodeID:id)
            let shared=try SharedWebOperations.call("nodeOptions",.object([.init(key:"operation",value:.string("read")),.init(key:"chat",value:treeChat),.init(key:"contentStore",value:try source.required("contentStore")),.init(key:"nodeId",value:.string(id))])).required("value")
            XCTAssertEqual(value.label,try shared.required("label").string("label"))
            XCTAssertEqual(value.starred,try shared.required("starred").boolean("starred"))
            XCTAssertEqual(value.pinned,try shared.required("pinned").boolean("pinned"))
            XCTAssertEqual(value.collapsed,try shared.required("collapsed").boolean("collapsed"))
            XCTAssertEqual(value.omitted,try shared.required("omitted").boolean("omitted"))
            XCTAssertEqual(value.protected,try shared.required("protected").boolean("protected"))
        }
        let flat=try chat(source,"chat-b"), value=try NodeOptions.read(chat:flat,nodeID:"message-0")
        XCTAssertEqual(value.label,""); XCTAssertFalse(value.starred); XCTAssertFalse(value.pinned)
        XCTAssertThrowsError(try NodeOptions.read(chat:flat,nodeID:"message-01"))
        XCTAssertThrowsError(try NodeOptions.read(chat:treeChat,nodeID:"missing"))
        XCTAssertNotEqual(NodeOptions.Value(label:"é"),NodeOptions.Value(label:"e\u{301}"))
    }
    func testUneditedLoneUTF16DisplayFieldsSurviveStarAndRenameSaves() throws {
        let raw = OrderedJSON.utf16String([0x41,0xd800,0x42])
        var source = try fixture(), chats = try source.required("chats").array("chats")
        let tree = try chats[0].required("branchTree"), nodes = try tree.required("nodes")
        chats[0] = chats[0].replacing("title",with:raw).replacing("branchTree",with:tree.replacing("nodes",with:nodes.replacing("n-user",with:try nodes.required("n-user").replacing("label",with:raw))))
        source = source.replacing("chats",with:.array(chats))
        let folders = try source.required("folders"), folder = try folders.object("folders").first!
        source = source.replacing("folders",with:folders.replacing(folder.key,with:folder.value.replacing("name",with:raw)))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("utf16-options-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:dir) }
        let store = LocalStateStore(fileURL:dir.appendingPathComponent("state.json")), state = ChatState(store:store)
        try state.importWebData(source.encoded())
        var draft = try state.nodeOptionsDraft(nodeID:"n-user")
        XCTAssertEqual(draft.value.label,"A�B")
        draft.value.starred.toggle()
        try state.saveNodeOptions(draft,now:now)
        var exported = try OrderedJSON.decode(state.exportWebData())
        XCTAssertEqual(try exported.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["n-user"]?["label"],raw)
        try state.renameChat(id:"chat-a",title:state.conversation!.title,now:now)
        let row = try ChatFolders.rows(in:state.exchange!.source).first { $0.id.utf8.elementsEqual(folder.key.text.utf8) }!
        try state.applyFolder(.rename(id:row.id,name:row.name),now:now)
        exported = try OrderedJSON.decode(state.exportWebData())
        XCTAssertEqual(try exported.required("chats").array("chats")[0]["title"],raw)
        XCTAssertEqual(exported["folders"]?[folder.key]?["name"],raw)
        XCTAssertEqual(try ChatState(store:store).exportWebData(),try state.exportWebData())
        let changed = try NodeOptions.save(in:exported,chatID:"chat-a",nodeID:"n-user",value:draft.value,now:now)
        XCTAssertEqual(try changed.source.required("chats").array("chats")[0]["branchTree"]?["nodes"]?["n-user"]?["label"],raw)
    }

    func testSixChangesUseSharedSettersAndPreserveAllUnmodifiedRawMetadataAndOrder() throws {
        let source=try sourceWithRawMetadata(), before=try chat(source,"chat-a")
        let value=NodeOptions.Value(label:"",starred:false,pinned:true,collapsed:true,omitted:true,protected:true)
        let result=try NodeOptions.save(in:source,chatID:"chat-a",nodeID:"n-user",value:value,now:now)
        XCTAssertEqual(result.status,.updated)
        XCTAssertEqual(result.nodeID,"n-user")
        let changed=try chat(result.source,"chat-a"), node=try changed.required("branchTree").required("nodes").required("n-user")
        XCTAssertNil(node["label"]); XCTAssertNil(node["starred"]); XCTAssertEqual(node["pinned"],.bool(true))
        XCTAssertEqual(node["xHuge"],.number("9007199254740993")); XCTAssertEqual(node["xDecimal"],.number("1.234567890123456789"))
        XCTAssertEqual(try NodeOptions.read(chat:changed,nodeID:"n-user"),value)
        XCTAssertEqual(changed["xHuge"],before["xHuge"])
        XCTAssertEqual(try result.source.required("xRoot").encoded(),try source.required("xRoot").encoded())
        XCTAssertEqual(try result.source.required("contentStore").encoded(),try source.required("contentStore").encoded())
        XCTAssertEqual(try changed.required("branchTree").required("nodes").object("nodes").map { Data($0.key.text.utf8) },try before.required("branchTree").required("nodes").object("nodes").map { Data($0.key.text.utf8) })
        for id in ["n-system","n-inactive","n-assistant"] { XCTAssertEqual(changed["branchTree"]?["nodes"]?[id],before["branchTree"]?["nodes"]?[id]) }
        XCTAssertEqual(try chat(result.source,"chat-b").encoded(),try chat(source,"chat-b").encoded())
        var cleared=value; cleared.pinned=false; cleared.collapsed=false; cleared.omitted=false; cleared.protected=false
        let removed=try NodeOptions.save(in:result.source,chatID:"chat-a",nodeID:"n-user",value:cleared,now:now)
        let clearedChat=try chat(removed.source,"chat-a")
        XCTAssertNil(clearedChat["branchTree"]?["nodes"]?["n-user"]?["pinned"])
        for field in ["collapsedNodes","omittedNodes","protectedNodes"] { XCTAssertNil(clearedChat[field]?["n-user"]) }
        XCTAssertEqual(try NodeOptions.read(chat:clearedChat,nodeID:"n-user"),cleared)
    }
    func testUnchangedSixFieldSaveDoesNotRewriteExplicitFalseFieldsOrOriginalRawBytes() throws {
        let source=try sourceWithRawMetadata(), before=try chat(source,"chat-a")
        let value=try NodeOptions.read(chat:before,nodeID:"n-user")
        let result=try NodeOptions.save(in:source,chatID:"chat-a",nodeID:"n-user",value:value,now:now)
        XCTAssertEqual(result.status,.unchanged)
        XCTAssertEqual(try result.source.encoded(),try source.encoded())
    }
    func testFlatNoOpAndMapOnlyRemainFlatWhileNodeFieldChangeUsesActualTreeConversion() throws {
        let source=try fixture(), original=try chat(source,"chat-b")
        let unchanged=try NodeOptions.save(in:source,chatID:"chat-b",nodeID:"message-0",value:NodeOptions.read(chat:original,nodeID:"message-0"),now:now)
        XCTAssertEqual(unchanged.status,.unchanged); XCTAssertEqual(unchanged.source,source)
        var maps=try NodeOptions.read(chat:original,nodeID:"message-0"); maps.collapsed=true; maps.omitted=true; maps.protected=true
        let mapped=try NodeOptions.save(in:source,chatID:"chat-b",nodeID:"message-0",value:maps,now:now)
        let flat=try chat(mapped.source,"chat-b")
        XCTAssertNil(flat["branchTree"]); XCTAssertEqual(mapped.nodeID,"message-0")
        XCTAssertEqual(flat["collapsedNodes"]?["0"],.bool(true)); XCTAssertEqual(flat["omittedNodes"]?["0"],.bool(true)); XCTAssertEqual(flat["protectedNodes"]?["0"],.bool(true))
        var fields=maps; fields.label="e\u{301}"; fields.starred=true; fields.pinned=true
        let ids=try original.required("messages").array("messages").indices.map { "converted-\($0)" }
        let converted=try NodeOptions.save(in:mapped.source,chatID:"chat-b",nodeID:"message-0",value:fields,newIDs:ids,now:now)
        let treeChat=try chat(converted.source,"chat-b"), tree=try treeChat.required("branchTree")
        XCTAssertEqual(converted.nodeID,"converted-0"); XCTAssertEqual(converted.path,ids)
        XCTAssertEqual(try NodeOptions.read(chat:treeChat,nodeID:"converted-0"),fields)
        XCTAssertNil(treeChat["collapsedNodes"]?["0"]); XCTAssertEqual(treeChat["collapsedNodes"]?["converted-0"],.bool(true))
        XCTAssertEqual(try tree.required("nodes").required("converted-0").required("label").string("label").data(using:.utf8),fields.label.data(using:.utf8))
        let missing=try NodeOptions.save(in:source,chatID:"chat-b",nodeID:"message-999",value:.init(),newIDs:ids,now:now)
        XCTAssertEqual(missing.status,.nodeMissing); XCTAssertEqual(missing.source,source)
    }
    func testUntouchedDeltaRepresentationIsPreservedByNodeMetadataChanges() throws {
        let snapshot=try fixture("content-entry-wire",key:"snapshot"), state=try snapshot.required("state")
        let source=OrderedJSON.object([.init(key:"version",value:.number("3")),.init(key:"chats",value:try state.required("chats")),.init(key:"contentStore",value:try state.required("contentStore")),.init(key:"folders",value:state["folders"] ?? .object([]))])
        let first=try source.required("chats").array("chats")[0], id=try first.required("id").string("chat ID"), nodeID=try first.required("branchTree").required("activePath").array("path")[0].string("node ID")
        var value=try NodeOptions.read(chat:first,nodeID:nodeID); value.label="metadata only"
        let result=try NodeOptions.save(in:source,chatID:id,nodeID:nodeID,value:value,now:now)
        XCTAssertEqual(try result.source.required("contentStore").encoded(),try source.required("contentStore").encoded())
        XCTAssertEqual(result.source["contentStore"]?["delta"]?["delta"],source["contentStore"]?["delta"]?["delta"])
    }
}
