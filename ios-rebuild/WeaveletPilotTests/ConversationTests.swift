import XCTest
@testable import WeaveletPilot

final class ConversationTests: XCTestCase {
    func testSharedSiblingFixture() throws {
        struct Fixture: Decodable {
            let version: Int
            let cases: [Case]
            struct Case: Decodable {
                let name: String
                let scope: String
                let nodeId: String
                let nodes: [MessageNode]
                let expectedIds: [String]
            }
        }
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/branch-siblings.json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        XCTAssertEqual(fixture.version, 1)
        let shared = fixture.cases.filter { $0.scope == "shared" }
        XCTAssertEqual(shared.count, 8)
        for test in shared {
            let original = test.nodes
            XCTAssertEqual(try siblings(of: test.nodeId, in: test.nodes).map(\.id), test.expectedIds, test.name)
            XCTAssertEqual(test.nodes, original, test.name)
        }
    }

    func testIntegerKeyBounds() throws {
        let nodes = ["4294967295", "01", "4294967294", "0", "枝"].map { MessageNode(id: $0, parentId: nil, createdAt: 0) }
        XCTAssertEqual(try siblings(of: "枝", in: nodes).map(\.id), ["0", "4294967294", "4294967295", "01", "枝"])
    }

    func testStyleAndSiblingSelectionShareConversationState() {
        let state = ChatState()
        XCTAssertEqual(state.conversation!.visibleMessages.map(\.id), ["system", "question", "2"])
        state.selectSibling("10", of: "2")
        let selected = state.conversation!.visibleMessages
        state.style = .bubbles
        XCTAssertEqual(state.conversation!.visibleMessages, selected)
        state.style = .stream
        XCTAssertEqual(state.conversation!.visibleMessages.map(\.id), ["system", "question", "10"])
        state.selectSibling("question", of: "question")
        XCTAssertEqual(state.conversation!.selectedLeafID, "10")
        state.selectSibling("system", of: "10")
        XCTAssertEqual(state.conversation!.selectedLeafID, "10")
        state.selectedConversationID = "sample-2"
        state.selectedConversationID = "sample-1"
        XCTAssertEqual(state.conversation!.selectedLeafID, "10")
    }
}
