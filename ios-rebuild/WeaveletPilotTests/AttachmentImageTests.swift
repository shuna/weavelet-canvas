import XCTest
import ImageIO
@testable import WeaveletPilot

final class AttachmentImageTests: XCTestCase {
    func testStandardPNGDataURIAndInvalidImageBoundary() throws {
        let base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOUYAAAAASUVORK5CYII="
        let data = try AttachmentImageLoader.dataURI("data:image/png;base64," + base64)
        let percentEncoded = data.map { String(format:"%%%02X", $0) }.joined()
        XCTAssertEqual(try AttachmentImageLoader.dataURI("data:image/png," + percentEncoded),data)
        let image = try AttachmentImageLoader.decode(data)
        XCTAssertEqual(image.cgImage?.width, 1); XCTAssertEqual(image.cgImage?.height, 1)
        XCTAssertThrowsError(try AttachmentImageLoader.dataURI("data:image/png;base64,%%%"))
        XCTAssertThrowsError(try AttachmentImageLoader.decode(Data("not an image".utf8)))
    }
    func testLargeImageIsDownsampledAtDecodeBoundary() throws {
        let width = 4096, height = 2
        let bytes = Data(repeating:255,count:width * height * 4)
        let provider = try XCTUnwrap(CGDataProvider(data:bytes as CFData))
        let original = try XCTUnwrap(CGImage(width:width,height:height,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:width * 4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.premultipliedLast.rawValue),provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent))
        let data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data,"public.png" as CFString,1,nil))
        CGImageDestinationAddImage(destination,original,nil); XCTAssertTrue(CGImageDestinationFinalize(destination))
        let decoded = try AttachmentImageLoader.decode(data as Data)
        XCTAssertLessThanOrEqual(try XCTUnwrap(decoded.cgImage).width,2048)
    }
}
