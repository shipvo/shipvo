import Foundation
import XCTest
@testable import ShipvoBundle

/// Runs the shared vectors in packages/capacitor/test-vectors/bundle.json, the file the TypeScript tests use.
final class ShipvoBundleTests: XCTestCase {
  struct Case: Decodable { let name: String, body: String, signature: String, archive: String, expect: String }
  struct Vectors: Decodable { let publicKey: String, appId: String, shellMajor: Int, band: String, shellVersion: String; let cases: [Case] }

  var vectors: Vectors!
  var root: URL!
  var clock = 1_000_000

  override func setUpWithError() throws {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("test-vectors/bundle.json")
    vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    root = FileManager.default.temporaryDirectory.appendingPathComponent("shipvo-" + UUID().uuidString)
    clock = 1_000_000
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }

  func store() throws -> BundleStore {
    let id = Identity(appId: vectors.appId, shellMajor: vectors.shellMajor, band: vectors.band, shellVersion: vectors.shellVersion, publicKey: vectors.publicKey)
    return try BundleStore(root: root, identity: id, now: { self.clock })
  }
  func good() -> Case { vectors.cases.first { $0.expect == "ok" }! }
  func stageGood(_ s: BundleStore) throws -> Int {
    let c = good(); return try s.stage(body: c.body, signature: c.signature, archive: Data(base64Encoded: c.archive)!)
  }

  func testEveryVectorGivesItsExpectedResult() throws {
    for c in vectors.cases {
      let s = try store()
      let archive = Data(base64Encoded: c.archive)!
      if c.expect == "ok" {
        XCTAssertEqual(try s.stage(body: c.body, signature: c.signature, archive: archive), 2, c.name)
        XCTAssertEqual(try Data(contentsOf: s.archiveURL(for: 2)), archive, c.name)
      } else {
        XCTAssertThrowsError(try s.stage(body: c.body, signature: c.signature, archive: archive), c.name) {
          XCTAssertEqual(($0 as? BundleError)?.code, c.expect, c.name)
        }
        XCTAssertEqual(s.pending, 0, c.name)
        XCTAssertFalse(FileManager.default.fileExists(atPath: s.directory(for: 2).path), c.name)
      }
      try? FileManager.default.removeItem(at: root)
    }
  }

  func testBadHashBlocksThatReleaseButANewerOneStages() throws {
    let s = try store()
    let bad = vectors.cases.first { $0.name == "bad hash refused" }!
    XCTAssertThrowsError(try s.stage(body: bad.body, signature: bad.signature, archive: Data(base64Encoded: bad.archive)!))
    XCTAssertEqual(s.blocked, 2)
    // The same release is not accepted again, even with the right bytes.
    XCTAssertThrowsError(try stageGood(s)) { XCTAssertEqual(($0 as? BundleError)?.code, "bad_pointer") }
    // A bad signature does not block anything.
    let sig = vectors.cases.first { $0.expect == "bad_signature" }!
    let t = try { root = root.appendingPathComponent("b"); return try store() }()
    XCTAssertThrowsError(try t.stage(body: sig.body, signature: sig.signature, archive: Data(base64Encoded: sig.archive)!))
    XCTAssertEqual(t.blocked, 0)
  }

  func testSemverCompare() {
    XCTAssertTrue(semverLess("1.0.0", "1.1.0"))
    XCTAssertTrue(semverLess("1.9.9", "2.0.0"))
    XCTAssertFalse(semverLess("1.1.0", "1.1.0"))
    XCTAssertFalse(semverLess("1.2.0-beta", "1.2.0"))
    XCTAssertFalse(semverLess("2", "1.9.9"))
  }

  func testGoodBundleIsPromotedAndSurvivesRestart() throws {
    var s = try store()
    XCTAssertEqual(try stageGood(s), 2)
    XCTAssertEqual(try s.boot(), 2)
    try s.markHealthy(running: 2)
    s = try store()
    XCTAssertEqual(s.current, 2)
    XCTAssertEqual(try s.boot(), 2)
  }

  func testPendingThatNeverGetsHealthyIsDroppedAfterThreeBoots() throws {
    let s = try store()
    _ = try stageGood(s)
    for _ in 0..<3 { XCTAssertEqual(try s.boot(), 2) }
    XCTAssertEqual(try s.boot(), 0)
    XCTAssertEqual(s.blocked, 2)
    XCTAssertFalse(FileManager.default.fileExists(atPath: s.directory(for: 2).path))
    XCTAssertThrowsError(try stageGood(s))
  }

  func testCrashLoopRollsBackToThePreviousBundle() throws {
    let s = try store()
    // The only vector release is 2, so the previous slot is the embedded bundle (0).
    _ = try stageGood(s); _ = try s.boot(); try s.markHealthy(running: 2)
    for _ in 0..<BundleStore.maxBoots { XCTAssertEqual(try s.boot(), 2); clock += 1000 }
    XCTAssertEqual(try s.boot(), 0)
    XCTAssertEqual(s.current, 0)
    XCTAssertEqual(s.blocked, 2)
  }

  func testBootsOutsideTheWindowDoNotCount() throws {
    let s = try store()
    _ = try stageGood(s); _ = try s.boot(); try s.markHealthy(running: 2)
    for _ in 0..<10 { XCTAssertEqual(try s.boot(), 2); clock += BundleStore.windowMs + 1 }
  }

  func testRollbackBlocksCurrentAndPending() throws {
    let s = try store()
    _ = try stageGood(s); _ = try s.boot(); try s.markHealthy(running: 2)
    try s.rollback()
    XCTAssertEqual(s.current, 0)
    XCTAssertEqual(s.blocked, 2)
    XCTAssertFalse(FileManager.default.fileExists(atPath: s.directory(for: 2).path))
  }

  func testTamperedFileOnDiskIsNotServed() throws {
    let s = try store()
    _ = try stageGood(s)
    try Data("tampered".utf8).write(to: s.archiveURL(for: 2))
    XCTAssertEqual(try s.boot(), 0)
    XCTAssertEqual(s.blocked, 2)
  }
}
