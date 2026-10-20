import XCTest
import UIKit
@testable import WeaveletPilot

final class ChatScrollControlsTests: XCTestCase {
    @MainActor func testSharedRestorationDeltaUsesNativeScrollBoundsAndRetainsHorizontalPosition() throws {
        let view = UIScrollView(frame:CGRect(x:0,y:0,width:400,height:600))
        view.contentSize = CGSize(width:500,height:2000)
        view.contentOffset = CGPoint(x:17,y:800)
        let offset = ChatScrollOffset(); offset.attach(view)
        let desired = try SharedWebOperations.Session().call("bubbleScroll",.object([
            .init(key:"operation",value:.string("restore")),
            .init(key:"anchor",value:.object([.init(key:"wasAtBottom",value:.bool(false)),.init(key:"offsetWithinItem",value:.number("225"))])),
            .init(key:"scrollTop",value:.number("800")),.init(key:"scrollHeight",value:.number("2000")),
            .init(key:"clientHeight",value:.number("600")),.init(key:"itemTop",value:.number("-150"))]))
        offset.move(by:CGFloat(try desired.number("scroll top")) - 800)
        XCTAssertEqual(view.contentOffset,CGPoint(x:17,y:875))
        offset.move(by:10_000)
        XCTAssertEqual(view.contentOffset.y,1400)
        offset.move(by:-10_000)
        XCTAssertEqual(view.contentOffset,CGPoint(x:17,y:0))
    }

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
