import XCTest
import UIKit
@testable import WeaveletPilot

@MainActor final class ChatImageExportTests: XCTestCase {
    func testBundledRendererExportsKnownMarkdownAndAttachmentAsPNG() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.systemTeal.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
        let attachment = try XCTUnwrap(image.pngData()).base64EncodedString()
        let messages = [
            MessageNode(id: "system", parentId: nil, createdAt: 0, role: "system", parts: [.text("# 見出し\n\n**Markdown** 本文")]),
            MessageNode(id: "assistant", parentId: "system", createdAt: 1, role: "assistant", parts: [.reasoning("reasoning"), .image(url: "data:image/png;base64,\(attachment)", detail: "low"), .toolCall(id: "call-1", name: "search", arguments: "{\"q\":\"text\"}"), .toolResult(callID: "call-1", content: "result")])
        ]
        let settings = OrderedJSON.object([.init(key: "advancedMode", value: .bool(true)), .init(key: "markdownMode", value: .bool(true)), .init(key: "inlineLatex", value: .bool(true)), .init(key: "streamingMarkdownPolicy", value: .string("always"))])
        let artifact = try await ChatImageExport.make(messages: messages, title: "Export", settings: settings, dark: false)
        try artifact.data.write(to: URL(fileURLWithPath: "/private/tmp/weavelet-png-export-proof.png"), options: .atomic)
        let rendered = try XCTUnwrap(UIImage(data: artifact.data))
        XCTAssertEqual(artifact.contentType, .png)
        XCTAssertEqual(artifact.filename, "Export.png")
        XCTAssertEqual(rendered.size.width, 1024, accuracy: 1)
        XCTAssertGreaterThan(rendered.size.height, 100)
    }

    func testLongCodeWrapsAndOversizeOutputIsRejectedWithoutTruncation() async throws {
        let settings = OrderedJSON.object([.init(key: "advancedMode", value: .bool(true)), .init(key: "markdownMode", value: .bool(true))])
        let code = "```text\n" + String(repeating: "LongCode", count: 180) + "\n```"
        let image = try await ChatImageExport.make(messages: [.init(id: "code", parentId: nil, createdAt: 0, parts: [.text(code)])], title: "Code", settings: settings, dark: true)
        let decoded = try XCTUnwrap(UIImage(data: image.data))
        XCTAssertEqual(decoded.size.width, 1024, accuracy: 1)
        XCTAssertGreaterThan(decoded.size.height, 300)
        let tall = String(repeating: "Line\n", count: 2000)
        do {
            _ = try await ChatImageExport.make(messages: [.init(id: "tall", parentId: nil, createdAt: 0, parts: [.text(tall)])], title: "Tall", settings: settings, dark: false)
            XCTFail("Oversized export was truncated or accepted")
        } catch let error as ChatImageExport.Failure { XCTAssertEqual(error.errorDescription, ChatImageExport.Failure.tooLarge.errorDescription) }
    }
    func testCancelledExportAndBrokenMarkdownImageCannotProducePNG() async throws {
        let settings = OrderedJSON.object([.init(key: "advancedMode", value: .bool(true)), .init(key: "markdownMode", value: .bool(true))])
        let task = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await ChatImageExport.make(messages: [], title: "", settings: settings, dark: false)
        }
        do { _ = try await task.value; XCTFail("Cancelled export accepted") } catch is CancellationError { }
        do {
            _ = try await ChatImageExport.make(messages: [.init(id: "broken", parentId: nil, createdAt: 0, parts: [.text("![broken](data:image/png;base64,AA==)")])], title: "Broken", settings: settings, dark: false)
            XCTFail("Broken Markdown image was silently omitted")
        } catch { }
    }
    func testLabelsKeepPlainTextAndPresentationUsesExistingBodyProjection() async throws {
        var collapsed = MessageNode(id: "collapsed", parentId: nil, createdAt: 0, parts: [.text("Must remain collapsed")])
        collapsed.options.label = "<draft> ![label](https://example.invalid/private)"
        collapsed.options.collapsed = true
        let input = try await ChatImageExport.captureInput(messages: [collapsed], title: "", settings: .object([]), dark: false, summaries: [:])
        let messages = try XCTUnwrap(input["messages"] as? [[String: Any]])
        let parts = try XCTUnwrap(messages.first?["parts"] as? [[String: String]])
        XCTAssertEqual(parts, [["kind": "plain", "text": collapsed.options.label], ["kind": "plain", "text": "本文を折りたたみ中"]])
        let summary = try OrderedJSON.decode(Data(#"{"tab":"summary","valid":true,"summary":{"text":"Selected summary"}}"#.utf8))
        let projected = try await ChatImageExport.captureInput(messages: [collapsed], title: "", settings: .object([]), dark: false, summaries: [collapsed.identity: summary])
        let projectedMessages = try XCTUnwrap(projected["messages"] as? [[String: Any]])
        let summaryParts = try XCTUnwrap(projectedMessages.first?["parts"] as? [[String: String]])
        XCTAssertEqual(summaryParts.last, ["kind": "text", "text": "Selected summary"])
        XCTAssertFalse(summaryParts.contains { $0["text"] == "Must remain collapsed" })
    }
    func testRejectsAnEmptyVisibleConversation() async {
        let settings = OrderedJSON.object([.init(key: "advancedMode", value: .bool(true))])
        do {
            _ = try await ChatImageExport.make(messages: [], title: "", settings: settings, dark: false)
            XCTFail("Expected image export to reject an empty conversation")
        } catch let error as ChatImageExport.Failure {
            XCTAssertEqual(error.errorDescription, ChatImageExport.Failure.empty.errorDescription)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
