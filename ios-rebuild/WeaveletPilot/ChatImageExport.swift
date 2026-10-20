import Foundation
import UIKit
import UniformTypeIdentifiers
import WebKit

// The bundled renderer remains the single Markdown implementation for on-screen text and exports.
@MainActor enum ChatImageExport {
    private static let width = 1_024.0
    private static let maxHeight = 16_384.0
    private static let maxImageBytes = 12 * 1_024 * 1_024
    private static let maxInputImageBytes = 32 * 1_024 * 1_024

    enum Failure: LocalizedError {
        case empty, resources, layout, tooLarge, imageTooLarge, invalidSnapshot
        var errorDescription: String? {
            switch self {
            case .empty: return "出力するメッセージがありません"
            case .resources: return "画像出力の本文リソースを読み込めません"
            case .layout: return "画像出力の描画サイズを取得できません"
            case .tooLarge: return "会話が画像出力の最大サイズを超えています"
            case .imageTooLarge: return "添付画像が画像出力の最大サイズを超えています"
            case .invalidSnapshot: return "画像出力をPNGに変換できません"
            }
        }
    }

    static func make(messages: [MessageNode], title: String, settings: OrderedJSON, dark: Bool, summaries: [Data: OrderedJSON] = [:]) async throws -> ChatExport.Artifact {
        try Task.checkCancellation()
        let advanced = try DisplaySettings.value(.advancedMode, in: settings).boolean("advancedMode")
        let visible = try DisplaySettings.messagesForDisplay(messages, advancedMode: advanced).filter { summaries[$0.identity]?["hidden"] != .bool(true) }
        guard !visible.isEmpty else { throw Failure.empty }
        let input = try await captureInput(messages: visible, title: title, settings: settings, dark: dark, summaries: summaries)
        try Task.checkCancellation()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: 1), configuration: configuration)
        let loader = Loader(webView: webView)
        webView.navigationDelegate = loader
        defer { webView.stopLoading(); webView.navigationDelegate = nil; webView.removeFromSuperview() }
        try await loader.load()
        try Task.checkCancellation()
        let size = try await webView.callAsyncJavaScript("return await window.weaveletMarkdown.capture(input)", arguments: ["input": input], in: nil, contentWorld: .page)
        try Task.checkCancellation()
        guard let values = size as? [String: Any], let renderedWidth = values["width"] as? Double,
              let renderedHeight = values["height"] as? Double, renderedWidth > 0, renderedHeight > 0,
              renderedWidth.isFinite, renderedHeight.isFinite, renderedHeight <= maxHeight else { throw renderedHeightFailure(size) }
        let snapshotConfiguration = WKSnapshotConfiguration()
        snapshotConfiguration.rect = CGRect(x: 0, y: 0, width: width, height: ceil(renderedHeight))
        snapshotConfiguration.snapshotWidth = NSNumber(value: width / UIScreen.main.scale)
        let image = try await webView.takeSnapshot(configuration: snapshotConfiguration)
        try Task.checkCancellation()
        guard let data = image.pngData() else { throw Failure.invalidSnapshot }
        return .init(data: data, filename: safeFilename(title) + ".png", contentType: .png)
    }

    private static func renderedHeightFailure(_ value: Any) -> Error {
        guard let values = value as? [String: Any], let height = values["height"] as? Double, height.isFinite else { return Failure.layout }
        return height > maxHeight ? Failure.tooLarge : Failure.layout
    }

    static func captureInput(messages: [MessageNode], title: String, settings: OrderedJSON, dark: Bool, summaries: [Data: OrderedJSON]) async throws -> [String: Any] {
        var totalImageBytes = 0
        let output = try await messages.asyncMap { node in
            let source = MessageBodyItem.items(node: node, summaryInfo: summaries[node.identity], generation: nil)
            let parts = try await source.asyncMap { item in
                try Task.checkCancellation()
                let part: MessagePart
                switch item.content {
                case .markdown(let text, _): part = .text(text)
                case .note(let text), .label(let text): return ["kind": "plain", "text": text]
                case .part(let value): part = value
                case .collapsed: return ["kind": "plain", "text": "本文を折りたたみ中"]
                }
                switch part {
                case .text(let text): return ["kind": "text", "text": text]
                case .reasoning(let text): return ["kind": "reasoning", "text": text]
                case .toolCall(let id, let name, let arguments): return ["kind": "toolCall", "id": id, "name": name, "text": arguments]
                case .toolResult(let callID, let content): return ["kind": "toolResult", "id": callID, "text": content]
                case .image(let url, let detail):
                    let image = try await AttachmentImageLoader.load(url)
                    try Task.checkCancellation()
                    guard let png = image.pngData(), png.count <= maxImageBytes else { throw Failure.imageTooLarge }
                    totalImageBytes += png.count
                    guard totalImageBytes <= maxInputImageBytes else { throw Failure.imageTooLarge }
                    return ["kind": "image", "detail": detail, "text": "data:image/png;base64," + png.base64EncodedString()]
                }
            }
            return ["role": node.role, "parts": parts]
        }
        var input: [String: Any] = ["title": title, "messages": output, "dark": dark,
                                    "isDesktopLike": ProcessInfo.processInfo.isMacCatalystApp,
                                    "saveData": ProcessInfo.processInfo.isLowPowerModeEnabled]
        if case .bool(let value) = settings["inlineLatex"] { input["inlineLatex"] = value }
        if case .bool(let value) = settings["markdownMode"] { input["markdownMode"] = value }
        if case .string(let value) = settings["streamingMarkdownPolicy"] { input["policy"] = value }
        return input
    }

    private static func safeFilename(_ title: String) -> String {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let invalid = CharacterSet(charactersIn: "/\\:")
        let cleaned = name.components(separatedBy: invalid).joined(separator: "-")
        return cleaned.isEmpty ? "weavelet-chat" : cleaned
    }

    private final class Loader: NSObject, WKNavigationDelegate {
        private weak var webView: WKWebView?
        private var continuation: CheckedContinuation<Void, Error>?
        private var resourceRoot: URL?
        init(webView: WKWebView) { self.webView = webView }
        func load() async throws {
            try await withTaskCancellationHandler(operation: {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    guard let root = Bundle.main.url(forResource: "MarkdownResources", withExtension: nil), let webView else {
                        continuation.resume(throwing: Failure.resources); return
                    }
                    resourceRoot = root; self.continuation = continuation
                    webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
                }
            }, onCancel: { [weak self] in
                Task { @MainActor in
                    self?.webView?.stopLoading()
                    self?.finish(.failure(CancellationError()))
                }
            })
        }
        private func finish(_ result: Result<Void, Error>) {
            let pending = continuation; continuation = nil; pending?.resume(with: result)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish(.success(())) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(Failure.resources)) }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let root = resourceRoot, let url = action.request.url, url.isFileURL,
                  url.path == root.path || url.path.hasPrefix(root.path + "/") else { decisionHandler(.cancel); return }
            decisionHandler(.allow)
        }
    }
}

private extension Array {
    func asyncMap<T>(_ transform: (Element) async throws -> T) async throws -> [T] {
        var values: [T] = []
        values.reserveCapacity(count)
        for value in self { values.append(try await transform(value)) }
        return values
    }
}
