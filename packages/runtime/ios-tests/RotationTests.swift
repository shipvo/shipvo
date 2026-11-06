import CryptoKit
import XCTest
@testable import ShipvoCore

/// Runs the shared vectors (test-vectors/rotation.json, the same file the CLI and Android tests use)
/// through the real Store and Rotation code, with a test clock. No test sleeps.
final class RotationTests: XCTestCase {
  final class TestClock: Clock { var date: Date; init(_ d: Date) { date = d }; func now() -> Date { date } }

  private var vectors: [String: Any] = [:]
  private var keysByName: [String: String] = [:]   // K1 -> public key
  private var seeds: [String: String] = [:]        // K1 -> seed

  override func setUpWithError() throws {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("test-vectors/rotation.json")
    vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    for (n, k) in vectors["keys"] as! [String: [String: String]] { keysByName[n] = k["publicKey"]; seeds[n] = k["seed"] }
  }

  private func iso(_ s: String) -> Date { Rotation.parseDate(s)! }
  private var rootKey: String { (vectors["root"] as! [String: String])["publicKey"]! }

  private func makeStore(suite: String, clock: TestClock, appId: String? = nil, minSequence: Int? = nil) -> Store {
    let s = Store(bundle: .main, overrides: .init(suite: suite, dir: FileManager.default.temporaryDirectory, baseUrl: "http://x", publicKey: keysByName["K1"]!, appId: appId ?? (vectors["appId"] as! String),
      shellMajor: 1, shellVersion: "1.0.0", binaryVersion: "1.0.0/1", rootKey: rootKey, minSequence: minSequence ?? (vectors["minSequence"] as! Int), clock: clock))
    return s
  }

  private func name(of key: String) -> String? { keysByName.first { $0.value == key }?.key }

  /// A pointer-style signature by the seed of `name` must verify only against that key.
  private func assertCurrent(_ s: Store, _ expected: String, file: StaticString = #filePath, line: UInt = #line) throws {
    XCTAssertEqual(name(of: Rotation.currentKey(s)), expected, file: file, line: line)
    let msg = Data("pointer".utf8)
    for (n, seed) in seeds {
      let sig = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(base64Encoded: seed)!).signature(for: msg).base64EncodedString()
      XCTAssertEqual(Verify.ed25519(msg, signatureB64: sig, publicKeyB64: Rotation.currentKey(s)), n == expected, "pointer signed by \(n)", file: file, line: line)
    }
  }

  func testSharedVectors() throws {
    for c in vectors["cases"] as! [[String: Any]] {
      let suite = "shipvo.test.rotation.\(UUID().uuidString)"
      let clock = TestClock(iso(vectors["startTime"] as! String))
      var s = makeStore(suite: suite, clock: clock)
      let id = c["id"] as! Int
      for (i, step) in (c["steps"] as! [[String: Any]]).enumerated() {
        let tag = "case \(id) step \(i)"
        clock.date = iso(step["now"] as! String)
        if step["relaunch"] as? Bool == true { s = makeStore(suite: suite, clock: clock) }
        Rotation.sync(s)   // what a launch does before the first pointer check
        Rotation.signatureChecks = 0
        let out = Rotation.process(s, rotations: step["deliver"])
        if step["rejectedWhole"] as? Bool == true {
          XCTAssertTrue(out.rejectedWhole, tag)
          XCTAssertEqual(Rotation.signatureChecks, step["signatureChecks"] as? Int, tag)
        } else {
          XCTAssertFalse(out.rejectedWhole, tag)
          let want = (step["verify"] as! [[String: Any]]).map { Rotation.Result(ok: $0["ok"] as! Bool, reason: $0["reason"] as? String) }
          XCTAssertEqual(out.results, want, tag)
        }
        let expect = step["expect"] as! [String: Any]
        try assertCurrent(s, expect["currentKey"] as! String)
        XCTAssertEqual(s.rotationRecord?["rotation.sequence"] as? Int ?? 0, expect["sequence"] as? Int, tag)
        let pending = (s.rotationRecord?["rotation.pending"] as? [[String: String]] ?? []).map { (try! JSONSerialization.jsonObject(with: Data($0["body"]!.utf8)) as! [String: Any])["sequence"] as! Int }
        XCTAssertEqual(pending, expect["pending"] as? [Int], tag)
      }
    }
  }

  private func envelopes(case id: Int) -> [[String: Any]] {
    ((vectors["cases"] as! [[String: Any]]).first { $0["id"] as? Int == id }!["steps"] as! [[String: Any]])[0]["deliver"] as! [[String: Any]]
  }

  func testDisabledWithoutARootKey() throws {
    let clock = TestClock(iso(vectors["startTime"] as! String))
    let s = Store(bundle: .main, overrides: .init(suite: "shipvo.test.\(UUID().uuidString)", dir: FileManager.default.temporaryDirectory, baseUrl: "http://x", publicKey: keysByName["K1"]!, appId: "tide", shellMajor: 1, shellVersion: "1.0.0", binaryVersion: "1.0.0/1", clock: clock))
    Rotation.process(s, rotations: envelopes(case: 1))
    XCTAssertEqual(Rotation.currentKey(s), keysByName["K1"])
    XCTAssertNil(s.rotationRecord)
  }

  func testCorruptPendingIsClearedAndKeyAndSequenceKept() throws {
    let suite = "shipvo.test.rotation.\(UUID().uuidString)"
    let clock = TestClock(iso(vectors["startTime"] as! String))
    let s = makeStore(suite: suite, clock: clock)
    Rotation.process(s, rotations: envelopes(case: 1))   // applies K2, sequence 1
    var rec = s.rotationRecord!
    rec["rotation.pending"] = "garbage"
    s.rotationRecord = rec
    XCTAssertEqual(name(of: Rotation.currentKey(s)), "K2")
    XCTAssertEqual(Rotation.sync(s).sequence, 1)
    XCTAssertTrue(Rotation.sync(s).pending.isEmpty)
  }

  func testMinSequenceBlocksReplayAtOrBelowIt() throws {
    let clock = TestClock(iso(vectors["startTime"] as! String))
    let s = makeStore(suite: "shipvo.test.rotation.\(UUID().uuidString)", clock: clock, minSequence: 1)
    let out = Rotation.process(s, rotations: envelopes(case: 1))
    XCTAssertEqual(out.results, [Rotation.Result(ok: false, reason: "replay")])
    XCTAssertEqual(name(of: Rotation.currentKey(s)), "K1")
  }

  func testNewPinnedKeyDropsStoredKeyButKeepsSequence() throws {
    let suite = "shipvo.test.rotation.\(UUID().uuidString)"
    let clock = TestClock(iso(vectors["startTime"] as! String))
    let s = makeStore(suite: suite, clock: clock)
    Rotation.process(s, rotations: envelopes(case: 1))
    // A later store build pins K2 as its release key.
    let s2 = Store(bundle: .main, overrides: .init(suite: suite, dir: FileManager.default.temporaryDirectory, baseUrl: "http://x", publicKey: keysByName["K2"]!, appId: "tide", shellMajor: 1, shellVersion: "1.0.0", binaryVersion: "1.0.0/1", rootKey: rootKey, minSequence: 0, clock: clock))
    XCTAssertEqual(Rotation.currentKey(s2), keysByName["K2"])
    let out = Rotation.process(s2, rotations: envelopes(case: 1))   // statement 1 names K2 again: replay, sequence kept
    XCTAssertEqual(out.results, [Rotation.Result(ok: false, reason: "replay")])
    XCTAssertEqual(Rotation.sync(s2).sequence, 1)
  }

  func testTamperedBodyAndNonStringsAreRejected() throws {
    let clock = TestClock(iso(vectors["startTime"] as! String))
    let s = makeStore(suite: "shipvo.test.rotation.\(UUID().uuidString)", clock: clock)
    var e = envelopes(case: 1)[0]
    let tampered = (e["body"] as! String).replacingOccurrences(of: "\"sequence\":1", with: "\"sequence\":2")
    e["body"] = tampered
    let out = Rotation.process(s, rotations: [e, ["body": 1, "signature": 2], ["body": String(repeating: "x", count: 1025), "signature": "AAAA"]])
    XCTAssertEqual(out.results.map { $0.reason }, ["bad_signature", "bad_envelope", "bad_envelope"])
    XCTAssertEqual(name(of: Rotation.currentKey(s)), "K1")
  }
}
