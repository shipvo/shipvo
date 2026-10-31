import XCTest
@testable import ShipvoCore

/// Runs against the static fake control plane written by scripts/ios-fixture.mjs and served on SHIPVO_FIXTURE_BASE.
final class RuntimeTests: XCTestCase {
  private var base = "", pub = "", bundleSha = "", tmp: URL!

  override func setUpWithError() throws {
    let env = ProcessInfo.processInfo.environment
    guard let b = env["SHIPVO_FIXTURE_BASE"], let dir = env["SHIPVO_FIXTURE_DIR"] else { throw XCTSkip("SHIPVO_FIXTURE_BASE / SHIPVO_FIXTURE_DIR not set") }
    base = b
    let meta = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: dir).appendingPathComponent("meta.json"))) as! [String: Any]
    pub = meta["publicKey"] as! String; bundleSha = meta["bundleSha"] as! String
    tmp = FileManager.default.temporaryDirectory.appendingPathComponent("shipvo-test-\(UUID().uuidString)")
    Store.runningRelease = 0; Store.loadsInProcess = 0; Store.selection = (nil, false); Store.bundleSelectedAt = 0
  }
  override func tearDown() { if let tmp { try? FileManager.default.removeItem(at: tmp) } }

  private func store(_ app: String, shell: String = "1.0.0", binary: String = "1.0.0/1", key: String? = nil) -> Store {
    let s = Store(overrides: .init(suite: "shipvo.test.\(UUID().uuidString)", dir: tmp, baseUrl: base, publicKey: key ?? pub, appId: app, shellMajor: 1, shellVersion: shell, binaryVersion: binary))
    s.binaryVersion = binary
    return s
  }
  /// One app load: what React Native does, asking more than once, then the app reporting healthy.
  private func load(_ s: Store, asks: Int = 3) -> URL? {
    ShipvoBundleSelector.invalidate()
    var url: URL?
    for _ in 0..<asks { url = ShipvoBundleSelector.select(s) }
    return url
  }

  func testStagesAVerifiedRelease() async throws {
    let s = store("good")
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["release"] as? Int, 5)
    XCTAssertEqual(r["via"] as? String, "full")
    XCTAssertEqual(s.pendingRelease, 5)
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testRefusesWhatItCannotTrust() async throws {
    for (app, why) in [("bad-sig", "signature"), ("bad-hash", "hash"), ("bad-size", "hash"), ("old-shell", "too old"), ("replay", "not for iOS")] {
      let s = store(app)
      do { _ = try await Updater.check(s); XCTFail("\(app) should have been refused") }
      catch let e as UpdateError { XCTAssertTrue(e.message.contains(why), "\(app): \(e.message)") }
      XCTAssertEqual(s.pendingRelease, 0, "\(app) must stage nothing")
      XCTAssertNil(s.pendingPath)
    }
  }

  func testRefusesAnotherKey() async throws {
    let s = store("good", key: Data(repeating: 7, count: 32).base64EncodedString())
    do { _ = try await Updater.check(s); XCTFail("wrong trust root must be refused") } catch let e as UpdateError { XCTAssertTrue(e.message.contains("signature")) }
  }

  func testNeverReadsTheAndroidPointer() async throws {
    let r = try await Updater.check(store("android-ptr"))
    XCTAssertEqual(r["status"] as? String, "none")
  }

  func testTrialBootsAreCountedOncePerLoad() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    let u1 = load(s, asks: 4)
    XCTAssertEqual(u1?.path, s.pendingPath)
    XCTAssertEqual(s.trialBoots, 1, "several asks in one load are one boot")
    XCTAssertEqual(Store.runningRelease, 5)
    _ = load(s)
    XCTAssertEqual(s.trialBoots, 2)
  }

  func testHealthyStartPromotesAndStopsFurtherUpdates() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    _ = load(s)
    XCTAssertTrue(ShipvoBundleSelector.promoteIfRunning(s))
    XCTAssertEqual(s.currentRelease, 5); XCTAssertEqual(s.pendingRelease, 0); XCTAssertEqual(s.currentSha, bundleSha)
    XCTAssertEqual(s.consumeEvents(), ["applied:5"])
    XCTAssertEqual(load(s)?.path, s.currentPath, "next launch runs the promoted bundle")
    let again = try await Updater.check(s)
    XCTAssertEqual(again["status"] as? String, "none", "already on release 5")
  }

  func testUnhealthyReleaseIsDroppedAfterThreeLoads() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    let path = s.pendingPath!
    for _ in 0..<3 { XCTAssertEqual(load(s)?.path, path) }
    XCTAssertNil(load(s), "fourth load falls back to the embedded bundle")
    XCTAssertEqual(s.blockedRelease, 5); XCTAssertEqual(s.pendingRelease, 0)
    XCTAssertFalse(FileManager.default.fileExists(atPath: path))
    XCTAssertTrue(s.consumeEvents().contains("crash_loop_revert:5"))
    let again = try await Updater.check(s)
    XCTAssertEqual(again["status"] as? String, "none", "a release this device refused is not fetched again")
  }

  func testNewAppBinaryDiscardsOldBundles() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    let path = s.pendingPath!
    let upgraded = Store(overrides: .init(suite: "shipvo.test.same", dir: tmp, baseUrl: base, publicKey: pub, appId: "good", shellMajor: 1, shellVersion: "1.1.0", binaryVersion: "1.1.0/2"))
    upgraded.pendingPath = path; upgraded.pendingRelease = 5; upgraded.binaryVersion = "1.0.0/1"
    XCTAssertNil(load(upgraded))
    XCTAssertEqual(upgraded.pendingRelease, 0); XCTAssertEqual(upgraded.binaryVersion, "1.1.0/2")
    XCTAssertFalse(FileManager.default.fileExists(atPath: path))
  }

  func testRollbackReturnsToThePreviousRelease() async throws {
    let s = store("good"); _ = try await Updater.check(s); _ = load(s); XCTAssertTrue(ShipvoBundleSelector.promoteIfRunning(s))
    let first = s.currentPath!
    s.previousPath = "/nonexistent/prev.hbc"; s.previousRelease = 3
    ShipvoBundleSelector.revertToPrevious(s)
    XCTAssertEqual(s.currentRelease, 3); XCTAssertEqual(s.currentPath, "/nonexistent/prev.hbc"); XCTAssertEqual(s.previousRelease, 0)
    XCTAssertFalse(FileManager.default.fileExists(atPath: first))
  }

  func testSemver() {
    XCTAssertTrue(Verify.semverLess("1.0.2", "1.1.0")); XCTAssertFalse(Verify.semverLess("1.1.0", "1.1.0")); XCTAssertFalse(Verify.semverLess("2.0.0", "1.9.9"))
    XCTAssertTrue(Verify.semverLess("1.0", "1.0.1"))
  }

  func testKnownSignatureVector() {
    // RFC 8032 test 1 (empty message): proves the CryptoKit path accepts a standard Ed25519 signature.
    let pk = Data(hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a").base64EncodedString()
    let sig = Data(hex: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b").base64EncodedString()
    XCTAssertTrue(Verify.ed25519(Data(), signatureB64: sig, publicKeyB64: pk))
    XCTAssertFalse(Verify.ed25519(Data([1]), signatureB64: sig, publicKeyB64: pk))
  }
}

private extension Data {
  init(hex: String) {
    var d = Data(); var i = hex.startIndex
    while i < hex.endIndex { let j = hex.index(i, offsetBy: 2); d.append(UInt8(hex[i..<j], radix: 16)!); i = j }
    self = d
  }
}
