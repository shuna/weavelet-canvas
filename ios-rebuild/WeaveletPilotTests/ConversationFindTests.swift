import XCTest
import SwiftUI
import WebKit
@testable import WeaveletPilot

@MainActor final class ConversationFindTests: XCTestCase {
    func testActualSharedIndexSeparatesRawAndRenderedTextBoundariesAcrossUnmountedBodies() async throws {
        let indexer = ConversationFindIndexer()
        let bodies = [
            ConversationFindBody(id:"raw",nodeID:"one",text:"banana İxİ",rendered:false,inlineLatex:false),
            ConversationFindBody(id:"rendered",nodeID:"two",text:"ba**na**na",rendered:true,inlineLatex:false),
            ConversationFindBody(id:"last",nodeID:"three",text:"ana",rendered:true,inlineLatex:false)
        ]
        let indexed = try await indexer.index(bodies,query:"ana")
        XCTAssertEqual(indexed["raw"]?.ranges,[NSRange(location:1,length:3),NSRange(location:3,length:3)])
        XCTAssertEqual(indexed["rendered"]?.count,0)
        XCTAssertEqual(indexed["last"]?.count,1)
        let syntax = try await indexer.index(bodies,query:"**")
        XCTAssertTrue(syntax.values.allSatisfy { $0.count == 0 })
        let unicode = try await indexer.index(bodies,query:"i")
        XCTAssertEqual(unicode["raw"]?.ranges,[NSRange(location:7,length:1),NSRange(location:9,length:1)])
        let blank = try await indexer.index(bodies,query:" \t ")
        XCTAssertTrue(blank.values.allSatisfy { $0.count == 0 })
        // JS trim treats NEL as literal; Swift whitespace trimming must not suppress it.
        let find = ConversationFind()
        find.configure(query:"\u{0085}",enabled:true)
        await find.search([.init(id:"nel",nodeID:"node",text:"x\u{0085}x",rendered:false,inlineLatex:false)])
        XCTAssertEqual(find.ranges["nel"],[NSRange(location:1,length:1)])
    }
    func testLateQueryResultsCannotReplaceNewResultsAndSelectionReportsAreScoped() async throws {
        var pending: [String:CheckedContinuation<[String:ConversationFindIndexer.Result],Error>] = [:]
        let find = ConversationFind(index:{ _, query in try await withCheckedThrowingContinuation { pending[query] = $0 } })
        let body = ConversationFindBody(id:"body",nodeID:"node",text:"original",rendered:false,inlineLatex:false)
        find.configure(query:"old",enabled:true)
        let old = Task { await find.search([body]) }
        await fulfillment(of:[XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in pending["old"] != nil },object:nil)],timeout:2)
        find.configure(query:"new",enabled:true)
        let new = Task { await find.search([body]) }
        await fulfillment(of:[XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in pending["new"] != nil },object:nil)],timeout:2)
        let current = try XCTUnwrap(pending["new"])
        current.resume(returning:["body":.init(count:1,ranges:[NSRange(location:0,length:1)])])
        await new.value
        XCTAssertEqual(find.selected?.nodeID,"node")
        let request = try XCTUnwrap(find.request(for:"body"))
        try XCTUnwrap(pending["old"]).resume(returning:["body":.init(count:5,ranges:[])])
        await old.value
        XCTAssertEqual(find.matches.count,1)
        XCTAssertEqual(find.request(for:"body"),request)
        find.report(bodyID:"different",index:0,rect:CGRect(x:0,y:100,width:20,height:20),height:500)
        XCTAssertNil(find.scrollTarget)
        find.report(bodyID:"body",index:0,rect:CGRect(x:0,y:100,width:20,height:20),height:500)
        XCTAssertNotNil(find.scrollTarget)
        find.step(backward:false)
        XCTAssertNil(find.scrollTarget)
        XCTAssertNotEqual(find.request(for:"body")?.requestID,request.requestID)
        let currentRequest = try XCTUnwrap(find.request(for:"body"))
        find.accept(.init(requestID:"stale",count:0,selectedIndex:nil,rect:nil),bodyID:"body")
        XCTAssertEqual(find.matches.count,1)
        let reveal = find.reveal
        find.accept(.init(requestID:currentRequest.requestID,count:2,selectedIndex:0,rect:CGRect(x:0,y:3000,width:50,height:20)),bodyID:"body")
        XCTAssertEqual(find.selected?.index,0)
        XCTAssertNotEqual(find.revision,reveal)
        find.report(bodyID:"body",index:0,rect:CGRect(x:0,y:3000,width:50,height:20),height:4000)
        XCTAssertNil(find.scrollTarget)
        let refreshed = try XCTUnwrap(find.request(for:"body"))
        find.accept(.init(requestID:refreshed.requestID,count:0,selectedIndex:nil,rect:nil),bodyID:"body")
        XCTAssertTrue(find.matches.isEmpty)
        XCTAssertEqual(find.reveal,reveal)
        XCTAssertNil(find.request(for:"unindexed"))
        find.configure(query:"",enabled:false)
        XCTAssertNil(find.request(for:"body")); XCTAssertTrue(find.matches.isEmpty)
    }
    func testDisplayProjectionUsesSelectedSummaryCollapseAndLiteralIdentity() throws {
        var node = MessageNode(id:"node",parentId:nil,createdAt:0)
        node.content = "original"
        let summary: OrderedJSON = .object([.init(key:"tab",value:.string("readable")),.init(key:"valid",value:.bool(true)),.init(key:"summary",value:.object([.init(key:"text",value:.string("summary"))]))])
        let selected = MessageBodyItem.items(node:node,summaryInfo:summary,generation:nil,context:Data("chat".utf8)).compactMap { $0.findBody(rendered:true,inlineLatex:false) }
        XCTAssertEqual(selected.map(\.text),["summary"])
        node.options.collapsed = true
        XCTAssertTrue(MessageBodyItem.items(node:node,summaryInfo:nil,generation:nil).compactMap { $0.findBody(rendered:false,inlineLatex:false) }.isEmpty)
        XCTAssertNotEqual(ConversationFindBody.key("é","content"),ConversationFindBody.key("e\u{301}","content"))
        XCTAssertNotEqual(ConversationFindBody.key("node","content",context:Data("a".utf8)),ConversationFindBody.key("node","content",context:Data("b".utf8)))
        let draft = try MessageDraft(chatID:"a",nodeID:"same",path:[],source:.object([]),originalParts:.array([]),originalRole:"user",isProtected:false,role:"user",text:"")
        XCTAssertTrue(draft.targets(chatID:"a",nodeID:"same"))
        XCTAssertFalse(draft.targets(chatID:"b",nodeID:"same"))
    }
}

private struct ConversationFindScrollFixture: View {
    @ObservedObject var find: ConversationFind
    let text: String
    var rendered = false
    @State private var height = 24.0
    @State private var failure: String?
    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack {
                        Color.clear.frame(height:500)
                        VStack(alignment:.leading) {
                            ConversationFindBodyView(find:find,bodyID:"body",text:text,rendered:rendered,input:["content":text,"markdownMode":rendered,"inlineLatex":false,"fontSize":17,"dark":false,"policy":"always","isGenerating":false,"isDesktopLike":true,"saveData":false],height:$height,failure:$failure)
                        }.id(Data("node".utf8))
                        Color.clear.frame(height:500)
                    }
                }.modifier(ConversationFindScrolling(find:find,scroll:scroll,viewportHeight:viewport.size.height))
            }
        }
    }
}

extension ConversationFindTests {
    func testLongRawBodyScrollsToMatchAndRepeatsSameSingleMatch() async throws { try await checkLongBodyScroll(rendered:false) }
    func testLongRenderedBodyScrollsToMatchAndRepeatsSameSingleMatch() async throws { try await checkLongBodyScroll(rendered:true) }
    private func checkLongBodyScroll(rendered:Bool) async throws {
        let text = String(repeating:"line of text\n",count:180) + "target"
        let find = ConversationFind()
        let host = UIHostingController(rootView:ConversationFindScrollFixture(find:find,text:text,rendered:rendered))
        let window = UIWindow(frame:CGRect(x:0,y:0,width:393,height:600))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.frame = CGRect(x:0,y:0,width:393,height:600)
        host.view.layoutIfNeeded()
        find.configure(query:"target",enabled:true)
        await find.search([.init(id:"body",nodeID:"node",text:text,rendered:rendered,inlineLatex:false)])
        func textView(_ view:UIView) -> UIView? {
            if rendered, let view = view as? WKWebView { return view }
            if !rendered, let view = view as? FindableUITextView { return view }
            return view.subviews.lazy.compactMap { textView($0) }.first
        }
        func matchIsVisible() -> Bool {
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            guard let view = textView(host.view), let target = find.scrollTarget else { return false }
            let rect = view.convert(target.rect,to:host.view)
            return rect.height > 0 && rect.minY >= host.view.bounds.minY && rect.maxY <= host.view.bounds.maxY
        }
        XCTAssertTrue(find.enabled)
        XCTAssertNotNil(find.request(for:"body"))
        let revealed = XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in matchIsVisible() },object:nil)
        await fulfillment(of:[revealed],timeout:5)
        XCTAssertNotNil(textView(host.view),"The selected lazy row must be mounted")
        XCTAssertEqual(find.matches.count,1)
        XCTAssertGreaterThan(try XCTUnwrap(find.scrollTarget).rect.minY,1000)
        find.step(backward:false)
        let repeated = XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in matchIsVisible() && find.scrollTarget?.revision == find.revision },object:nil)
        await fulfillment(of:[repeated],timeout:5)
    }
}

extension ConversationFindTests {
    func testMarkdownProcessFailureReindexesTheActualLiteralFallback() async throws {
        let text = "**emphasis**"
        let find = ConversationFind()
        find.configure(query:"**",enabled:true)
        await find.search([.init(id:"body",nodeID:"node",text:text,rendered:true,inlineLatex:false)])
        XCTAssertTrue(find.matches.isEmpty)
        let settings: OrderedJSON = .object([.init(key:"markdownMode",value:.bool(true))])
        let host = UIHostingController(rootView:MarkdownTextView(text:text)
            .environment(\.markdownSettings,settings).environment(\.conversationFind,find).environment(\.conversationFindBodyID,"body"))
        let window = UIWindow(frame:CGRect(x:0,y:0,width:393,height:600))
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.frame = CGRect(x:0,y:0,width:393,height:600)
        func webView(_ view:UIView) -> WKWebView? {
            if let view = view as? WKWebView { return view }
            return view.subviews.lazy.compactMap { webView($0) }.first
        }
        let mounted = XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            return (webView(host.view)?.navigationDelegate as? MarkdownWebView.Coordinator)?.ready == true
        },object:nil)
        await fulfillment(of:[mounted],timeout:5)
        let view = try XCTUnwrap(webView(host.view))
        let coordinator = try XCTUnwrap(view.navigationDelegate as? MarkdownWebView.Coordinator)
        coordinator.webViewWebContentProcessDidTerminate(view)
        let fallback = XCTNSPredicateExpectation(predicate:NSPredicate { _, _ in
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            return find.rawFallbacks.contains("body")
        },object:nil)
        await fulfillment(of:[fallback],timeout:5)
        await find.search([.init(id:"body",nodeID:"node",text:text,rendered:!find.rawFallbacks.contains("body"),inlineLatex:false)])
        XCTAssertEqual(find.matches.count,2)
        XCTAssertEqual(find.ranges["body"],[NSRange(location:0,length:2),NSRange(location:10,length:2)])
    }
}
