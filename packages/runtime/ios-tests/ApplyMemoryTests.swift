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

  /// Current physical footprint in MB. Unlike ru_maxrss it falls when buffers are freed.
  private func footprintMB() -> Int {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { p in
      p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return kr == KERN_SUCCESS ? Int(info.phys_footprint >> 20) : 0
  }

  /// Writes the inputs to disk and returns their paths; every setup buffer is freed on return.
  private func writeInputs(_ mb: Int) throws -> (URL, URL) {
    let size = mb << 20
    let tail = (0..<1024).map { UInt8(truncatingIfNeeded: $0 * 7) }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("apply-mem-\(mb)-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let baseURL = dir.appendingPathComponent("base.bin"), patchURL = dir.appendingPathComponent("patch.bin")
    var g = SystemRandomNumberGenerator()
    try Data((0..<size).map { _ in UInt8.random(in: 0...255, using: &g) }).write(to: baseURL)
    let ctrl = try bzip2(le(size) + le(tail.count) + le(0))
    let diff = try bzip2([UInt8](repeating: 0, count: size))
    let extra = try bzip2(tail)
    try Data(Array("BSDIFF40".utf8) + le(ctrl.count) + le(diff.count) + le(size + tail.count) + ctrl + diff + extra).write(to: patchURL)
    return (baseURL, patchURL)
  }

  private func measure(_ mb: Int) throws {
    let size = mb << 20
    let (baseURL, patchURL) = try writeInputs(mb)
    defer { try? FileManager.default.removeItem(at: baseURL.deletingLastPathComponent()) }
    let base = try Data(contentsOf: baseURL, options: .alwaysMapped)
    let patch = try Data(contentsOf: patchURL)
    let before = footprintMB()
    let peak = Atomic()
    peak.raise(before)
    let sampler = Thread { while !peak.done { peak.raise(self.footprintMB()); Thread.sleep(forTimeInterval: 0.002) } }
    sampler.start()
    let t0 = Date()
    let out = try Patch.apply(old: base, patch: patch)
    let ms = Int(Date().timeIntervalSince(t0) * 1000)
    peak.done = true
    peak.raise(footprintMB())
    XCTAssertEqual(out.count, size + 1024)
    XCTAssertEqual(Data(out.prefix(size)), base)
    XCTAssertEqual(Array(out.suffix(1024)), (0..<1024).map { UInt8(truncatingIfNeeded: $0 * 7) })
    print("SHIPVO_APPLY_MEMORY ios bundle=\(mb)MB footprint_before=\(before)MB peak_footprint_sampled_delta=\(peak.value - before)MB apply_ms=\(ms)")
  }

  private final class Atomic {
    private let lock = NSLock()
    private var v = 0
    private var d = false
    var value: Int { lock.lock(); defer { lock.unlock() }; return v }
    var done: Bool { get { lock.lock(); defer { lock.unlock() }; return d } set { lock.lock(); d = newValue; lock.unlock() } }
    func raise(_ x: Int) { lock.lock(); v = max(v, x); lock.unlock() }
  }

  func testPeakMemory20Mb() throws { try measure(20) }
  func testPeakMemory60Mb() throws { try measure(60) }
}
