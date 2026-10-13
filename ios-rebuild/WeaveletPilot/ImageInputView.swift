import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

// The original bytes are encoded directly, without rendering or transcoding.
enum ImageInput {
    enum Failure: LocalizedError {
        case invalidImage, unavailable
        var errorDescription: String? {
            switch self {
            case .invalidImage: return "画像の形式を読み取れませんでした"
            case .unavailable: return "画像データを読み込めませんでした"
            }
        }
    }
    static func dataURI(_ bytes: Data) throws -> String {
        guard let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache:false] as CFDictionary),
              CGImageSourceGetCount(source) > 0,
              CGImageSourceGetStatus(source) == .statusComplete,
              let identifier = CGImageSourceGetType(source), let type = UTType(identifier as String),
              type.conforms(to: .image), let mime = type.preferredMIMEType,
              CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways:true,
                kCGImageSourceThumbnailMaxPixelSize:1,
                kCGImageSourceShouldCacheImmediately:true
              ] as CFDictionary) != nil else { throw Failure.invalidImage }
        return "data:\(mime);base64," + bytes.base64EncodedString()
    }
    static func fromFile(_ url: URL) async throws -> String {
        try await Task.detached {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            return try dataURI(Data(contentsOf:url))
        }.value
    }
    static func fromBytes(_ bytes: Data) async throws -> String {
        try await Task.detached { try dataURI(bytes) }.value
    }
    static func fromProvider(_ provider: NSItemProvider) async throws -> String {
        guard let identifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to:.image) == true }) else { throw Failure.unavailable }
        let bytes: Data = try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier:identifier) { bytes, error in
                if let error { continuation.resume(throwing:error) }
                else if let bytes { continuation.resume(returning:bytes) }
                else { continuation.resume(throwing:Failure.unavailable) }
            }
        }
        return try await fromBytes(bytes)
    }
}

@MainActor
struct ImageInputView: View {
    let destinationID: String
    let onAdd: (String, [String]) -> Void
    private struct Delivery {
        let id: String
        let receive: (String, [String]) -> Void
    }
    @State private var delivery: Delivery?
    @State private var showsInput = false
    @State private var filePresented = false
    @State private var photosPresented = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var loading = false
    @State private var failure: String?

    private func begin() {
        delivery = Delivery(id:destinationID,receive:onAdd)
        failure = nil
    }
    private func load(_ recipient: Delivery, operation: @escaping () async throws -> [String]) {
        loading = true; failure = nil
        Task {
            do {
                let urls = try await operation()
                if !urls.isEmpty { recipient.receive(recipient.id,urls) }
            } catch { failure = error.localizedDescription }
            loading = false
        }
    }
    var body: some View {
        Button("画像を添付", systemImage: "paperclip") { showsInput = true }
            .labelStyle(.iconOnly)
            .frame(width:44,height:44)
            .popover(isPresented:$showsInput,arrowEdge:.bottom) {
                inputPanel
                    .padding(16)
                    .frame(minWidth:220,idealWidth:260,maxWidth:320)
                    .presentationCompactAdaptation(.popover)
            }
            .onChange(of:photosPresented) { _, presented in
                guard !presented, !photos.isEmpty, let recipient = delivery else { return }
                let items = photos
                load(recipient) {
                    var urls: [String] = []
                    for item in items {
                        guard let bytes = try await item.loadTransferable(type:Data.self) else { throw ImageInput.Failure.unavailable }
                        urls.append(try await ImageInput.fromBytes(bytes))
                    }
                    return urls
                }
            }
    }

    private var inputPanel: some View {
        VStack(alignment:.leading,spacing:8) {
            VStack(alignment:.leading,spacing:8) {
                Button("画像ファイル",systemImage:"photo.badge.plus") { begin(); filePresented = true }
                    .frame(maxWidth:.infinity,minHeight:44,alignment:.leading)
                Button("写真",systemImage:"photo.on.rectangle") { begin(); photos = []; photosPresented = true }
                    .frame(maxWidth:.infinity,minHeight:44,alignment:.leading)
                PasteButton(supportedContentTypes:[.image]) { providers in
                    let recipient = Delivery(id:destinationID,receive:onAdd)
                    load(recipient) {
                        var urls: [String] = []
                        for provider in providers { urls.append(try await ImageInput.fromProvider(provider)) }
                        return urls
                    }
                }
                .frame(minHeight:44)
            }
            .disabled(loading)
            if loading { ProgressView("画像を読み込み中") }
            if let failure { Text(failure).font(.caption).foregroundStyle(.red) }
        }
        .fileImporter(isPresented:$filePresented,allowedContentTypes:[.image],allowsMultipleSelection:true) { result in
            guard let recipient = delivery else { return }
            switch result {
            case .success(let files):
                load(recipient) {
                    var urls: [String] = []
                    for file in files { urls.append(try await ImageInput.fromFile(file)) }
                    return urls
                }
            case .failure(let error): failure = error.localizedDescription
            }
        }
        .photosPicker(isPresented:$photosPresented,selection:$photos,matching:.images,preferredItemEncoding:.current)

    }
}
