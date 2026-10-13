import XCTest
import SwiftUI
import WebKit
@testable import WeaveletPilot

@MainActor final class MarkdownViewTests: XCTestCase {
    func testBundledRendererReceivesLiteralTextAndNativeDisplayUpdates() async throws {
        let measured = expectation(description: "Web content height reaches native")
        var height = 0.0, hasMeasured = false, failure: String?
        let literal = "日本語🙂 </script><script>window.injected=true</script>"
        var input: [String: Any] = ["content": "# Heading\n\n" + literal + "\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```swift\nlet value = 1\n```\n\n$$x^2$$", "inlineLatex": true, "markdownMode": true, "fontSize": 17, "dark": false, "policy": "always", "isGenerating": false, "isDesktopLike": true, "saveData": false]
        let parent = MarkdownWebView(input: input, height: Binding(get: { height }, set: { height = $0; if !hasMeasured { hasMeasured = true; measured.fulfill() } }), failure: Binding(get: { failure }, set: { failure = $0 }))
        let coordinator = MarkdownWebView.Coordinator(parent)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(coordinator, name: "markdown")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 420, height: 800), configuration: configuration)
        view.navigationDelegate = coordinator; coordinator.webView = view
        let root = try XCTUnwrap(Bundle.main.url(forResource: "MarkdownResources", withExtension: nil))
        coordinator.resourceRoot = root
        view.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        defer { view.stopLoading(); configuration.userContentController.removeScriptMessageHandler(forName: "markdown") }
        await fulfillment(of: [measured], timeout: 15)
        XCTAssertNil(failure); XCTAssertGreaterThan(height, 20)
        // ContentBody lazy-loads its renderer; wait for that real DOM transition, not a fixed delay.
        _ = try await view.callAsyncJavaScript("await new Promise((resolve,reject) => { if(document.querySelector('.katex')) return resolve(true); const observer=new MutationObserver(() => {if(document.querySelector('.katex')) {observer.disconnect();clearTimeout(timer);resolve(true);}}); const timer=setTimeout(() => {observer.disconnect();reject(Error('Renderer did not load'));},5000); observer.observe(document.body,{childList:true,subtree:true}); });", arguments: [:], in: nil, contentWorld: .page)
        let result = try await view.evaluateJavaScript("({text:document.body.textContent,table:!!document.querySelector('table'),math:!!document.querySelector('.katex'),code:!!document.querySelector('code'),injected:window.injected===true})") as? [String: Any]
        XCTAssertTrue((result?["text"] as? String)?.contains("日本語🙂") == true)
        XCTAssertEqual(result?["table"] as? Bool, true); XCTAssertEqual(result?["math"] as? Bool, true)
        XCTAssertEqual(result?["code"] as? Bool, true); XCTAssertEqual(result?["injected"] as? Bool, false)
        // Verify the OS clipboard boundary without retaining or exposing the user's previous clipboard.
        let clipboard = UIPasteboard.general
        let previousItems = clipboard.items
        defer { clipboard.items = previousItems }
        let copied = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in clipboard.string == "let value = 1\n" }, object: nil)
        _ = try await view.evaluateJavaScript("document.querySelector('button[aria-label=\"copy codeblock\"]').click()")
        await fulfillment(of: [copied], timeout: 5)
        // Update the same host rather than reload it; Markdown is now literal and the native font size changes.
        input["content"] = literal; input["markdownMode"] = false; input["fontSize"] = 28
        _ = try await view.callAsyncJavaScript("await new Promise((resolve,reject) => { const observer=new MutationObserver(check); const timer=setTimeout(() => {observer.disconnect();reject(Error('Raw display did not update'));},5000); function check(){if(document.getElementById('root').textContent===input.content){observer.disconnect();clearTimeout(timer);resolve(true);}} observer.observe(document.body,{childList:true,subtree:true,characterData:true}); window.weaveletMarkdown.update(input); check(); });", arguments: ["input": input], in: nil, contentWorld: .page)
        let updated = try await view.evaluateJavaScript("({text:document.body.textContent,table:!!document.querySelector('table'),font:document.documentElement.style.fontSize,injected:window.injected===true})") as? [String: Any]
        XCTAssertTrue((updated?["text"] as? String)?.contains(literal) == true)
        XCTAssertEqual(updated?["font"] as? String, "28px")
        XCTAssertEqual(updated?["table"] as? Bool, false); XCTAssertEqual(updated?["injected"] as? Bool, false)
        coordinator.webViewWebContentProcessDidTerminate(view)
        XCTAssertEqual(failure, "本文表示が終了しました。原文を表示しています。")
    }
}
