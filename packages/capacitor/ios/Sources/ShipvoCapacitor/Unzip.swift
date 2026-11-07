import Compression
import Foundation

/// Reads a zip archive held in memory (stored and deflate entries). Entries that would leave the target directory are refused.
enum Unzip {
  struct Failure: Error, LocalizedError { let message: String; var errorDescription: String? { message } }
  static let maxEntryBytes = 256 * 1024 * 1024

  static func extract(_ zip: Data, to target: URL) throws {
    let b = [UInt8](zip)
    func u16(_ o: Int) -> Int { Int(b[o]) | Int(b[o + 1]) << 8 }
    func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
    guard b.count >= 22 else { throw Failure(message: "bad entry in bundle") }
    // End of central directory record: the last 22+ bytes, signature 0x06054b50.
    var eocd = -1
    var i = b.count - 22
    while i >= max(0, b.count - 22 - 65_535) { if u32(i) == 0x0605_4b50 { eocd = i; break }; i -= 1 }
    guard eocd >= 0 else { throw Failure(message: "bad entry in bundle") }
    let count = u16(eocd + 10)
    var p = u32(eocd + 16)
    let root = target.standardizedFileURL.path + "/"
    let fm = FileManager.default
    for _ in 0..<count {
      guard p + 46 <= b.count, u32(p) == 0x0201_4b50 else { throw Failure(message: "bad entry in bundle") }
      let method = u16(p + 10), csize = u32(p + 20), usize = u32(p + 24)
      let nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32), local = u32(p + 42)
      guard p + 46 + nlen <= b.count, local + 30 <= b.count, u32(local) == 0x0403_4b50, usize <= maxEntryBytes else { throw Failure(message: "bad entry in bundle") }
      let name = String(decoding: b[(p + 46)..<(p + 46 + nlen)], as: UTF8.self)
      p += 46 + nlen + elen + clen
      let out = target.appendingPathComponent(name).standardizedFileURL
      guard out.path.hasPrefix(root) else { throw Failure(message: "bad entry in bundle") }
      if name.hasSuffix("/") { try fm.createDirectory(at: out, withIntermediateDirectories: true); continue }
      let start = local + 30 + u16(local + 26) + u16(local + 28)
      guard start + csize <= b.count else { throw Failure(message: "bad entry in bundle") }
      let raw = Data(b[start..<(start + csize)])
      var data: Data
      if method == 0 { data = raw }
      else if method == 8 {
        var dst = [UInt8](repeating: 0, count: max(usize, 1))
        let n = raw.withUnsafeBytes { src in
          compression_decode_buffer(&dst, dst.count, src.bindMemory(to: UInt8.self).baseAddress!, raw.count, nil, COMPRESSION_ZLIB)
        }
        guard n == usize else { throw Failure(message: "bad entry in bundle") }
        data = Data(dst.prefix(n))
      } else { throw Failure(message: "bad entry in bundle") }
      try fm.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: out)
    }
  }
}
