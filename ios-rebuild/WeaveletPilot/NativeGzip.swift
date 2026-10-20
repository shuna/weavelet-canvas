import Foundation
import zlib
import CZstdLegacy

enum NativeLegacySnapshot {
    static func decode(_ bytes: Data) throws -> Data {
        let header = try ChatImport.call("container", fields: [
            .init(key: "header", value: .array(bytes.prefix(20).map { .number(String($0)) })),
            .init(key: "totalLength", value: .number(String(bytes.count)))])
        if case .null = header { return bytes }
        let expected = Int(try header.required("uncompressedSize").number("snapshot size"))
        let payload = bytes.dropFirst(20)
        return try payload.withUnsafeBytes { input in
            let compressedSize = ZSTD_findFrameCompressedSize(input.baseAddress, payload.count)
            guard ZSTD_isError(compressedSize) == 0, compressedSize == payload.count,
                  ZSTD_getDictID_fromFrame(input.baseAddress, payload.count) == 0 else {
                throw ExchangeError.invalid("旧iOS圧縮データが不正です")
            }
            let frameSize = ZSTD_getFrameContentSize(input.baseAddress, payload.count)
            guard frameSize == UInt64.max || frameSize == UInt64(expected) else {
                throw ExchangeError.invalid("旧iOS圧縮データの展開サイズが一致しません")
            }
            var output = Data(count: expected)
            let size = output.withUnsafeMutableBytes { destination in
                ZSTD_decompress(destination.baseAddress, expected, input.baseAddress, payload.count)
            }
            guard ZSTD_isError(size) == 0, size == expected else {
                throw ExchangeError.invalid("旧iOS圧縮データを展開できません")
            }
            return output
        }
    }
}

enum NativeGzip {
    static func isCompressed(_ bytes: Data) -> Bool { bytes.starts(with: [0x1f, 0x8b]) }
    static func compress(_ bytes: Data) throws -> Data { try process(bytes, compressing: true) }
    static func decompress(_ bytes: Data) throws -> Data { try process(bytes, compressing: false) }

    private static func process(_ bytes: Data, compressing: Bool) throws -> Data {
        guard bytes.count <= Int(UInt32.max) else { throw GzipError.invalidData }
        var stream = z_stream()
        let initialized = compressing
            ? deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, MAX_MEM_LEVEL, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            : inflateInit2_(&stream, MAX_WBITS + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard initialized == Z_OK else { throw GzipError.initialization }
        defer { if compressing { deflateEnd(&stream) } else { inflateEnd(&stream) } }
        var result = Data()
        try bytes.withUnsafeBytes { (input: UnsafeRawBufferPointer) in
            stream.next_in = input.baseAddress.map { UnsafeMutablePointer(mutating: $0.assumingMemoryBound(to: Bytef.self)) }
            stream.avail_in = uInt(bytes.count)
            var buffer = [UInt8](repeating: 0, count: 65_536)
            while true {
                let remaining = stream.avail_in
                let status = buffer.withUnsafeMutableBytes { (output: UnsafeMutableRawBufferPointer) -> Int32 in
                    stream.next_out = output.baseAddress!.assumingMemoryBound(to: Bytef.self)
                    stream.avail_out = uInt(output.count)
                    return compressing ? deflate(&stream, Z_FINISH) : inflate(&stream, Z_NO_FLUSH)
                }
                let count = buffer.count - Int(stream.avail_out)
                result.append(contentsOf: buffer.prefix(count))
                if status == Z_STREAM_END {
                    guard stream.avail_in == 0 else { throw GzipError.invalidData }
                    break
                }
                guard status == Z_OK, count > 0 || stream.avail_in < remaining else { throw GzipError.invalidData }
            }
        }
        return result
    }
}

enum GzipError: LocalizedError {
    case initialization, invalidData
    var errorDescription: String? {
        switch self {
        case .initialization: return "gzip処理を開始できません。"
        case .invalidData: return "gzipデータの圧縮または展開に失敗しました。保存データは変更していません。"
        }
    }
}
