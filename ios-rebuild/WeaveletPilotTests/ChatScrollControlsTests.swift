import XCTest
@testable import WeaveletPilot

final class ChatScrollControlsTests: XCTestCase {
    func testNativeMeasuredCoordinatesUseSharedWebTargetsWithoutChangingFrames() throws {
        let ids = [Data("é".utf8), Data("e\u{0301}".utf8), Data("last".utf8)]
        let frames: [ChatScrollMarker: CGRect] = [
            .content: CGRect(x:0,y:-100,width:400,height:1400),
            .message(ids[0]): CGRect(x:0,y:-100,width:400,height:300),
            .message(ids[1]): CGRect(x:0,y:200,width:400,height:300),
            .message(ids[2]): CGRect(x:0,y:500,width:400,height:300)]
        let before = frames
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:ids,frames:frames,height:600,bridge:SharedWebOperations.Session()),
                       .init(previous:0,next:1))
        XCTAssertEqual(frames,before)
        XCTAssertNotEqual(ids[0],ids[1])
    }

    func testLazyTallRowCanReachFollowingUnmaterializedID() throws {
        let ids = [Data("first".utf8),Data("next".utf8)]
        let frames: [ChatScrollMarker: CGRect] = [
            .content: CGRect(x:0,y:-100,width:400,height:3000),
            .message(ids[0]): CGRect(x:0,y:-100,width:400,height:2000)]
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:ids,frames:frames,height:600,bridge:SharedWebOperations.Session()),
                       .init(previous:0,next:1))
    }

    func testShortContentAndRemovedIDsHaveNoNavigationTarget() throws {
        let id = Data("first".utf8)
        let frames: [ChatScrollMarker: CGRect] = [
            .content: CGRect(x:0,y:0,width:400,height:200),
            .message(id): CGRect(x:0,y:0,width:400,height:100)]
        let bridge = try SharedWebOperations.Session()
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:[id],frames:frames,height:600,bridge:bridge),.init())
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:[],frames:frames,height:600,bridge:bridge),.init())
    }

    func testResizedViewportAndUnmaterializedPreviousRow() throws {
        let ids = [Data("before".utf8),Data("aligned".utf8),Data("after".utf8)]
        let bridge = try SharedWebOperations.Session()
        let frames: [ChatScrollMarker: CGRect] = [
            .content: CGRect(x:0,y:0,width:400,height:700),
            .message(ids[0]): CGRect(x:0,y:0,width:400,height:300),
            .message(ids[1]): CGRect(x:0,y:300,width:400,height:300)]
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:ids,frames:frames,height:800,bridge:bridge).next,-1)
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:ids,frames:frames,height:600,bridge:bridge).next,1)
        let lazy: [ChatScrollMarker: CGRect] = [
            .content: CGRect(x:0,y:-1200,width:400,height:3000),
            .message(ids[1]): CGRect(x:0,y:0,width:400,height:1200)]
        XCTAssertEqual(try ChatScrollTargets.resolve(ids:ids,frames:lazy,height:600,bridge:bridge),.init(previous:0,next:2))
    }
}
