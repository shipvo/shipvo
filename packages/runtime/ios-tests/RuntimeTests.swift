import XCTest
@testable import ShipvoCore

/// Runs against the static fake control plane written by scripts/ios-fixture.mjs and served on SHIPVO_FIXTURE_BASE.
final class RuntimeTests: XCTestCase {
  private var base = "", pub = "", bundleSha = "", tmp: URL!, meta: [String: Any] = [:]

  override func setUpWithError() throws {
    let env = ProcessInfo.processInfo.environment
    guard let b = env["SHIPVO_FIXTURE_BASE"], let dir = env["SHIPVO_FIXTURE_DIR"] else { throw XCTSkip("SHIPVO_FIXTURE_BASE / SHIPVO_FIXTURE_DIR not set") }
    base = b
    meta = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: dir).appendingPathComponent("meta.json"))) as! [String: Any]
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

  /// A device that runs release 5 (the fixture's `good` bundle) and is offered release 6.
  private func storeRunningRelease5(_ app: String) throws -> Store {
    let s = store(app)
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    let path = tmp.appendingPathComponent("r5.hbc")
    try Data(contentsOf: URL(string: "\(base)/b/good/ios-r5.hbc")!).write(to: path)
    s.currentPath = path.path; s.currentRelease = 5; s.currentSha = bundleSha
    return s
  }

  func testAppliesAPatchFromTheRunningBundle() async throws {
    let s = try storeRunningRelease5("patch")
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["via"] as? String, "patch")
    XCTAssertLessThan(r["bytes"] as! Int, 1000, "only the patch was downloaded")
    XCTAssertEqual(r["bundleBytes"] as? Int, 200_019 + 50)
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), meta["bundle2Sha"] as? String)
  }

  func testFallsBackToTheFullBundleWhenThePatchIsBroken() async throws {
    let s = try storeRunningRelease5("bad-patch")
    let r = try await Updater.check(s)
    XCTAssertEqual(r["via"] as? String, "full")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), meta["bundle2Sha"] as? String)
    XCTAssertTrue(s.consumeEvents().contains("patch_failed"))
  }

  // MARK: resumed downloads

  private func bundleBytes() throws -> Data { try Data(contentsOf: URL(string: "\(base)/b/good/ios-r5.hbc")!) }
  private func writePartial(_ s: Store, _ data: Data) throws -> URL {
    let part = Updater.partialURL(s, sha: bundleSha)
    try data.write(to: part)
    return part
  }

  func testResumesAnInterruptedDownloadFromThePartialSize() async throws {
    let s = store("good")
    let all = try bundleBytes(), cut = 120_000
    _ = try writePartial(s, all.prefix(cut))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["bytes"] as? Int, all.count - cut, "only the missing tail is sent")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testRestartsWhenTheServerIgnoresRange() async throws {
    let s = store("no-range")
    let all = try bundleBytes()
    _ = try writePartial(s, all.prefix(120_000))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["bytes"] as? Int, all.count, "a 200 answer means the whole file came again")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testCorruptPartialFailsVerificationIsDeletedAndTheNextTryWorks() async throws {
    let s = store("good")
    let all = try bundleBytes()
    let part = try writePartial(s, Data(repeating: 0xAB, count: 120_000))
    do { _ = try await Updater.check(s); XCTFail("corrupt partial must not verify") } catch let e as UpdateError { XCTAssertTrue(e.message.contains("mismatch")) }
    XCTAssertFalse(FileManager.default.fileExists(atPath: part.path))
    XCTAssertNil(s.pendingPath)
    let r = try await Updater.check(s)
    XCTAssertEqual(r["bytes"] as? Int, all.count)
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testOversizedPartialIsDiscardedAndFetchedFromZero() async throws {
    let s = store("good")
    let all = try bundleBytes()
    _ = try writePartial(s, all + Data(repeating: 0, count: 5))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["bytes"] as? Int, all.count, "a partial larger than the bundle cannot be resumed")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testCompletePartialNeedsNoDownload() async throws {
    let s = store("good")
    _ = try writePartial(s, try bundleBytes())
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["bytes"] as? Int, 0, "every byte was already on disk")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testCorruptPartialOfFullSizeIsRejectedThenRefetchedFromZero() async throws {
    let s = store("good")
    let all = try bundleBytes()
    let part = try writePartial(s, Data(repeating: 0xCD, count: all.count))
    do { _ = try await Updater.check(s); XCTFail("corrupt partial must not verify") } catch let e as UpdateError { XCTAssertTrue(e.message.contains("mismatch")) }
    XCTAssertFalse(FileManager.default.fileExists(atPath: part.path))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["bytes"] as? Int, all.count, "the retry starts from zero")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), bundleSha)
  }

  func testPartialForAnotherReleaseIsDeleted() async throws {
    let s = store("good")
    let other = s.dir.appendingPathComponent("dl-\(String(repeating: "1", count: 64)).part")
    try Data(repeating: 1, count: 10).write(to: other)
    _ = try await Updater.check(s)
    XCTAssertFalse(FileManager.default.fileExists(atPath: other.path))
  }

  func testUsesTheFullBundleWhenNothingIsRunningYet() async throws {
    let r = try await Updater.check(store("patch"))
    XCTAssertEqual(r["via"] as? String, "full")
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

  /// Promote release 5, then run it as the current release.
  private func promoted(_ s: Store) async throws {
    _ = try await Updater.check(s); _ = load(s)
    XCTAssertTrue(ShipvoBundleSelector.promoteIfRunning(s))
    _ = s.consumeEvents()
  }

  func testReleaseThatDiesAfterMarkHealthyIsReverted() async throws {
    let s = store("good"); try await promoted(s)
    s.previousPath = "/nonexistent/prev.hbc"; s.previousRelease = 3
    // Each boot reports healthy, then the process dies before the stability window ends (markStableIfHealthy is never reached).
    // The promoting boot counted as 1, so launches 2 and 3 run the release and launch 4 reverts. That is 3 runs of the bad release.
    for _ in 0..<2 {
      XCTAssertEqual(load(s)?.path, s.currentPath)
      ShipvoBundleSelector.noteHealthy()
    }
    XCTAssertNil(load(s), "the next launch reverts to the previous release (missing file, so the embedded bundle)")
    XCTAssertEqual(s.currentRelease, 3); XCTAssertEqual(s.blockedRelease, 5)
    XCTAssertTrue(s.consumeEvents().contains("crash_loop_revert:5"))
  }

  func testReloadBeforeMarkHealthyKeepsTheCount() async throws {
    let s = store("good"); try await promoted(s)
    XCTAssertEqual(s.unhealthyBoots, 1)
    _ = load(s); ShipvoBundleSelector.noteHealthy()       // load A reports healthy
    _ = load(s)                                           // reload: load B has not reported healthy
    XCTAssertFalse(ShipvoBundleSelector.markStableIfHealthy(s), "background before markHealthy must not clear the count")
    XCTAssertGreaterThan(s.unhealthyBoots, 0)
    ShipvoBundleSelector.noteHealthy()
    XCTAssertTrue(ShipvoBundleSelector.markStableIfHealthy(s))
    XCTAssertEqual(s.unhealthyBoots, 0)
  }

  func testReleaseThatSurvivesTheStabilityWindowIsKept() async throws {
    let s = store("good"); try await promoted(s)
    for _ in 0..<6 {
      XCTAssertEqual(load(s)?.path, s.currentPath)
      _ = ShipvoBundleSelector.promoteIfRunning(s)
      ShipvoBundleSelector.noteHealthy(); ShipvoBundleSelector.markStableIfHealthy(s)
    }
    XCTAssertEqual(s.currentRelease, 5); XCTAssertEqual(s.blockedRelease, 0)
    XCTAssertFalse(s.consumeEvents().contains("crash_loop_revert:5"))
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
