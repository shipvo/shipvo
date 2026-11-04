import Foundation

/// bspatch for the standard BSDIFF40 format (same as Android `Patch.kt`): a 32-byte header, then bzip2 ctrl, diff and extra blocks.
/// bzip2 comes from the system libbz2 (present in the iOS SDK and on macOS), loaded at run time so no build setting changes.
enum Patch {
  private typealias BuffDecompress = @convention(c) (UnsafeMutablePointer<CChar>?, UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<CChar>?, UInt32, Int32, Int32) -> Int32

  private static let decompressFn: BuffDecompress? = {
    let handle = dlopen("libbz2.1.0.dylib", RTLD_NOW) ?? dlopen("libbz2.so.1.0", RTLD_NOW) ?? dlopen(nil, RTLD_NOW)
    guard let h = handle, let sym = dlsym(h, "BZ2_bzBuffToBuffDecompress") else { return nil }
    return unsafeBitCast(sym, to: BuffDecompress.self)
  }()

  private static let maxOutput = 64 << 20

  private static func offtin(_ b: [UInt8], _ o: Int) -> Int64 {
    var y = Int64(b[o + 7] & 0x7F)
    for i in stride(from: 6, through: 0, by: -1) { y = (y << 8) | Int64(b[o + i]) }
    return (b[o + 7] & 0x80) != 0 ? -y : y
  }

  /// Decompress one whole bzip2 stream. Grows the output buffer until it fits, up to `maxOutput`.
  private static func bunzip(_ src: [UInt8], expectAtLeast: Int) throws -> [UInt8] {
    guard let fn = decompressFn else { throw UpdateError("bzip2 unavailable") }
    var cap = max(expectAtLeast, 4096)
    var input = src
    while true {
      var out = [UInt8](repeating: 0, count: cap)
      var outLen = UInt32(cap)
      let rc: Int32 = out.withUnsafeMutableBytes { o in
        input.withUnsafeMutableBytes { i in
          fn(o.baseAddress!.assumingMemoryBound(to: CChar.self), &outLen, i.baseAddress?.assumingMemoryBound(to: CChar.self), UInt32(i.count), 0, 0)
        }
      }
      if rc == 0 { return Array(out[0..<Int(outLen)]) }
      if rc == -8 /* BZ_OUTBUFF_FULL */ && cap < maxOutput * 4 { cap *= 4; continue }
      throw UpdateError("patch block is not valid bzip2 (\(rc))")
    }
  }

  static func apply(old: Data, patch: Data) throws -> Data {
    let p = [UInt8](patch)
    guard p.count >= 32, String(decoding: p[0..<8], as: UTF8.self) == "BSDIFF40" else { throw UpdateError("not a BSDIFF40 patch") }
    let ctrlLen = offtin(p, 8), diffLen = offtin(p, 16), newSize = offtin(p, 24)
    guard ctrlLen >= 0, diffLen >= 0, newSize >= 0, newSize <= Int64(maxOutput), 32 + ctrlLen + diffLen <= Int64(p.count) else { throw UpdateError("bad patch header") }
    let n = Int(newSize), c0 = 32, d0 = 32 + Int(ctrlLen), e0 = d0 + Int(diffLen)
    let ctrl = try bunzip(Array(p[c0..<d0]), expectAtLeast: 24)
    let diff = try bunzip(Array(p[d0..<e0]), expectAtLeast: n)
    let extra = try bunzip(Array(p[e0...]), expectAtLeast: 16)
    let oldBytes = [UInt8](old)

    var out = [UInt8](repeating: 0, count: n)
    var oldPos: Int64 = 0, newPos = 0, ci = 0, di = 0, ei = 0
    while newPos < n {
      guard ci + 24 <= ctrl.count else { throw UpdateError("patch truncated") }
      let x = offtin(ctrl, ci), y = offtin(ctrl, ci + 8), z = offtin(ctrl, ci + 16)
      ci += 24
      guard x >= 0, y >= 0, Int64(newPos) + x + y <= newSize, di + Int(x) <= diff.count, ei + Int(y) <= extra.count else { throw UpdateError("corrupt patch control") }
      for i in 0..<Int(x) {
        let op = oldPos + Int64(i)
        let base: UInt8 = (op >= 0 && op < Int64(oldBytes.count)) ? oldBytes[Int(op)] : 0
        out[newPos + i] = diff[di + i] &+ base
      }
      di += Int(x); newPos += Int(x); oldPos += x
      for i in 0..<Int(y) { out[newPos + i] = extra[ei + i] }
      ei += Int(y); newPos += Int(y); oldPos += z
    }
    return Data(out)
  }
}
