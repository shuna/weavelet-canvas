import SwiftUI
import ImageIO
import UIKit
import CoreFoundation

// Retrieval and decoding are platform work; message URLs and part order remain unchanged.
enum AttachmentImageLoader {
    enum Failure: LocalizedError {
        case invalidSource, response, invalidImage
        var errorDescription: String? {
            switch self {
            case .invalidSource: return "画像URLの形式を読み込めません"
            case .response: return "画像を取得できませんでした"
            case .invalidImage: return "画像データを表示できません"
            }
        }
    }
    static func dataURI(_ text: String) throws -> Data {
        guard let comma = text.firstIndex(of: ","), text[..<comma].lowercased().hasPrefix("data:image/") else { throw Failure.invalidSource }
        let header = text[..<comma], payload = String(text[text.index(after: comma)...])
        if header.lowercased().hasSuffix(";base64") {
            guard let decoded = Data(base64Encoded: payload) else { throw Failure.invalidImage }
            return decoded
        }
        // ISO Latin-1 maps percent-decoded binary bytes without interpreting them as UTF-8.
        guard let decoded = CFURLCreateStringByReplacingPercentEscapesUsingEncoding(nil, payload as CFString, "" as CFString, CFStringConvertNSStringEncodingToEncoding(String.Encoding.isoLatin1.rawValue)),
              let data = (decoded as String).data(using: .isoLatin1) else { throw Failure.invalidImage }
        return data
    }
    static func decode(_ data: Data) throws -> UIImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2048,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw Failure.invalidImage }
        return UIImage(cgImage: image)
    }
    static func load(_ text: String, session: URLSession = .shared) async throws -> UIImage {
        let data: Data
        if text.lowercased().hasPrefix("data:image/") {
            data = try await Task.detached { try dataURI(text) }.value
        } else {
            guard let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { throw Failure.invalidSource }
            let (bytes, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw Failure.response }
            data = bytes
        }
        try Task.checkCancellation()
        let image = try await Task.detached { try decode(data) }.value
        try Task.checkCancellation()
        return image
    }
}

struct AttachmentImageView: View {
    let url: String
    let detail: String
    var allowsExpansion = true
    @State private var image: UIImage?
    @State private var failure: String?
    @State private var expanded = false

    var body: some View {
        Group {
            if let image {
                if allowsExpansion {
                    Button { expanded = true } label: {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 320, maxHeight: 180)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("添付画像（\(detail)）を拡大")
                } else {
                    Image(uiImage:image).resizable().scaledToFit().frame(maxHeight:384)
                        .accessibilityLabel("添付画像（\(detail)）")
                }
            } else if let failure {
                Label(failure, systemImage: "photo.badge.exclamationmark").font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView("画像を読み込み中")
            }
        }
        .task(id: url) {
            image = nil; failure = nil; expanded = false
            do { image = try await AttachmentImageLoader.load(url) }
            catch { if !Task.isCancelled { failure = error.localizedDescription } }
        }
        .sheet(isPresented: $expanded) {
            NavigationStack {
                VStack {
                    if let image { Image(uiImage: image).resizable().scaledToFit().padding() }
                }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { expanded = false } } }
            }
        }
    }
}
