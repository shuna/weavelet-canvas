import XCTest
import UniformTypeIdentifiers
@testable import WeaveletPilot

final class ImageInputTests: XCTestCase {
    private let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOUYAAAAASUVORK5CYII="
    func testImageDataURIKeepsOriginalBytesAndDetectsMIME() async throws {
        let bytes = try XCTUnwrap(Data(base64Encoded:png))
        XCTAssertEqual(try ImageInput.dataURI(bytes),"data:image/png;base64," + png)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bin")
        try bytes.write(to:url); defer { try? FileManager.default.removeItem(at:url) }
        let result = try await ImageInput.fromFile(url)
        XCTAssertEqual(result,"data:image/png;base64," + png)
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier:UTType.png.identifier,visibility:.all) { completion in completion(bytes,nil); return nil }
        let pasted = try await ImageInput.fromProvider(provider)
        XCTAssertEqual(pasted,result)
    }
    func testNonImageAndTruncatedImageAreRejected() throws {
        XCTAssertThrowsError(try ImageInput.dataURI(Data("not an image".utf8)))
        let bytes = try XCTUnwrap(Data(base64Encoded:png))
        XCTAssertThrowsError(try ImageInput.dataURI(Data(bytes.prefix(20))))
    }
}
