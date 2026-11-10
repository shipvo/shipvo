import XCTest
import Foundation
@testable import ShipvoCore

/// Measures peak memory of the patch step with synthetic bundles. Prints SHIPVO_APPLY_MEMORY lines that CI copies into the job summary.
final class ApplyMemoryTests: XCTestCase {
  private func le(_ v: Int) -> [UInt8] { (0..<8).map { UInt8((v >> (8 * $0)) & 0xFF) } }

  private func bzip2(_ b: [UInt8]) throws -> [UInt8] {
    let h = dlopen("libbz2.1.0.dylib", RTLD_NOW) ?? dlopen("libbz2.so.1.0", RTLD_NOW) ?? dlopen(nil, RTLD_NOW)
    typealias F = @convention(c) (UnsafeMutablePointer<CChar>?, UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<CChar>?, UInt32, Int32, Int32, Int32) -> Int32
    guard let h, let sym = dlsym(h, "BZ2_bzBuffToBuffCompress") else { throw XCTSkip("bzip2 unavailable") }
    let fn = unsafeBitCast(sym, to: F.self)
    var out = [UInt8](repeating: 0, count: b.count + b.count / 50 + 1024)
    var outLen = UInt32(out.count)
    var input = b
    let rc: Int32 = out.withUnsafeMutableBytes { o in input.withUnsafeMutableBytes { i in
      fn(o.baseAddress!.assumingMemoryBound(to: CChar.self), &outLen, i.baseAddress?.assumingMemoryBound(to: CChar.self), UInt32(i.count), 9, 0, 0) } }
    XCTAssertEqual(rc, 0)
    return Array(out[0..<Int(outLen)])
  }

  private func peakRssMB() -> Int {
    var u = rusage(); getrusage(RUSAGE_SELF, &u)
    #if os(macOS)
    return u.ru_maxrss >> 20   // bytes on macOS and iOS
    #else
    return u.ru_maxrss >> 10   // KB on Linux
    #endif
  }

  private func measure(_ mb: Int) throws {
    let size = mb << 20
    let tail = (0..<1024).map { UInt8(truncatingIfNeeded: $0 * 7) }
    var g = SystemRandomNumberGenerator()
    let base = Data((0..<size).map { _ in UInt8.random(in: 0...255, using: &g) })
    let ctrl = try bzip2(le(size) + le(tail.count) + le(0))
    let diff = try bzip2([UInt8](repeating: 0, count: size))
    let extra = try bzip2(tail)
    let patch = Data(Array("BSDIFF40".utf8) + le(ctrl.count) + le(diff.count) + le(size + tail.count) + ctrl + diff + extra)
    let before = peakRssMB()
    let t0 = Date()
    let out = try Patch.apply(old: base, patch: patch)
    let ms = Int(Date().timeIntervalSince(t0) * 1000)
    XCTAssertEqual(out.count, size + tail.count)
    XCTAssertEqual(Data(out.prefix(size)), base)
    print("SHIPVO_APPLY_MEMORY ios bundle=\(mb)MB peak_rss_before=\(before)MB peak_rss_after=\(peakRssMB())MB apply_ms=\(ms)")
  }

  func testPeakMemory20Mb() throws { try measure(20) }
  func testPeakMemory60Mb() throws { try measure(60) }
}
