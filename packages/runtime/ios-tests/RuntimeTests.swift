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

  private func store(_ app: String, shell: String = "1.0.0", binary: String = "1.0.0/1", key: String? = nil, hbc: [Int] = [], hbe: String? = nil, nm: [String: String] = [:], bundle: Bundle = .main) -> Store {
    let s = Store(bundle: bundle, overrides: .init(suite: "shipvo.test.\(UUID().uuidString)", dir: tmp, baseUrl: base, publicKey: key ?? pub, appId: app, shellMajor: 1, shellVersion: shell, binaryVersion: binary, hermesBytecodeVersions: hbc, hermesEngine: hbe, nativeModules: nm))
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
  private func storeRunningRelease5(_ app: String, hbc: [Int] = [], nm: [String: String] = [:]) throws -> Store {
    let s = store(app, hbc: hbc, nm: nm)
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

  /// A device on its first install: no downloaded release, and `main.jsbundle` inside the app is the fixture's release 5 bundle.
  private func storeOnEmbedded(_ app: String) throws -> Store {
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    let b = tmp.appendingPathComponent("Shell.bundle")
    try FileManager.default.createDirectory(at: b, withIntermediateDirectories: true)
    try Data(contentsOf: URL(string: "\(base)/b/good/ios-r5.hbc")!).write(to: b.appendingPathComponent("main.jsbundle"))
    let s = store(app, bundle: Bundle(path: b.path)!)
    XCTAssertNil(s.currentPath)
    return s
  }

  func testAppliesAPatchFromTheEmbeddedBundle() async throws {
    let s = try storeOnEmbedded("patch")
    XCTAssertEqual(s.embeddedSha(), bundleSha)
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(r["via"] as? String, "patch")
    XCTAssertEqual(r["bytes"] as? Int, meta["patchSize"] as? Int, "only the patch was downloaded")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), meta["bundle2Sha"] as? String)
  }

  func testEmbeddedBaseFallsBackToFullOnACorruptPatch() async throws {
    let s = try storeOnEmbedded("bad-patch")
    let r = try await Updater.check(s)
    XCTAssertEqual(r["via"] as? String, "full")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), meta["bundle2Sha"] as? String)
    XCTAssertTrue(s.consumeEvents().contains("patch_failed"))
  }

  func testEmbeddedBaseFallsBackToFullWhenNoPatchHasThatBase() async throws {
    let s = try storeOnEmbedded("wrong-base")
    let r = try await Updater.check(s)
    XCTAssertEqual(r["via"] as? String, "full")
    XCTAssertEqual(try Verify.sha256Hex(file: URL(fileURLWithPath: s.pendingPath!)), meta["bundle2Sha"] as? String)
  }

  func testEmbeddedBaseWithAWrongResultHashStagesNothing() async throws {
    let s = try storeOnEmbedded("wrong-result")
    do { _ = try await Updater.check(s); XCTFail("a bundle that is not the signed hash must not stage") } catch let e as UpdateError { XCTAssertTrue(e.message.contains("mismatch")) }
    XCTAssertNil(s.pendingPath)
    XCTAssertTrue(s.consumeEvents().contains("patch_failed"))
  }

  func testNoEmbeddedBundleMeansAFullDownload() async throws {
    let r = try await Updater.check(store("patch"))
    XCTAssertEqual(r["via"] as? String, "full")
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

  func testPointerUrlHasNoQueryWithoutDeclaredVersions() {
    XCTAssertFalse(Updater.pointerURL(store("good")).contains("?"))
  }

  func testPointerUrlCarriesBytecodeVersionsAndEncodedNativeModules() {
    let url = Updater.pointerURL(store("good", hbc: [96, 98], nm: ["@scope/pkg": "1.2.3", "other": "2.0.0"]))
    XCTAssertTrue(url.hasSuffix(".json?hbc=96,98&nm=%40scope%2Fpkg%401.2.3,other%402.0.0"), url)
    XCTAssertFalse(Updater.pointerURL(store("good", nm: ["a": "1.0.0"])).contains("hbc="))
    XCTAssertTrue(Updater.pointerURL(store("good", hbc: [96], hbe: "250829098.0.10", nm: ["a": "1.0.0"])).hasSuffix(".json?hbc=96&hbe=250829098.0.10&nm=a%401.0.0"))
    XCTAssertFalse(Updater.pointerURL(store("good", hbc: [96])).contains("hbe="))
    XCTAssertFalse(Updater.pointerURL(store("good", hbe: "  ")).contains("hbe="))
  }

  func testPointerUrlIsSentAndAMismatchKeepsTheCurrentRelease() async throws {
    for reason in ["hermes_bytecode_mismatch", "native_module_missing", "native_module_version"] {
      let s = try storeRunningRelease5("good", hbc: [96], nm: ["@scope/pkg": "1.0.0"])
      StubPointer.seen = []; StubPointer.reply = (404, "{\"error\":\"\(reason)\"}")
      URLProtocol.registerClass(StubPointer.self); defer { URLProtocol.unregisterClass(StubPointer.self) }
      let r = try await Updater.check(s)
      XCTAssertEqual(r["status"] as? String, "none")
      XCTAssertEqual(r["reason"] as? String, reason)
      XCTAssertEqual(StubPointer.seen.first?.query, "hbc=96&nm=%40scope%2Fpkg%401.0.0")
      XCTAssertEqual(s.currentRelease, 5)
      XCTAssertEqual(s.pendingRelease, 0)
      XCTAssertNil(s.pendingPath)
    }
  }

  // MARK: Hermes guard through Updater.check

  /// A directory that acts as the app bundle: `main.jsbundle` holds `head` (or is absent).
  private func appBundle(_ head: Data?) throws -> Bundle {
    let dir = tmp.appendingPathComponent("app-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    if let head { try (head + Data(count: 64)).write(to: dir.appendingPathComponent("main.jsbundle")) }
    return Bundle(path: dir.path)!
  }
  private func hbc(_ v: Int) -> Data {
    Data([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)])
  }

  func testCheckRefusesAReleaseBuiltForAnotherHermesVersion() async throws {
    let s = store("hbc-mismatch", bundle: try appBundle(hbc(96)))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "none")
    XCTAssertEqual(r["reason"] as? String, "hermes_bytecode_mismatch")
    XCTAssertEqual(s.pendingRelease, 0)
    XCTAssertNil(s.pendingPath)
    XCTAssertEqual(s.blockedRelease, 5)
    XCTAssertEqual(s.consumeEvents(), ["hermes_bytecode_mismatch:5:release=98:shell=96"])
  }

  func testCheckStagesWhenTheHermesVersionMatches() async throws {
    let s = store("hbc-match", bundle: try appBundle(hbc(96)))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
    XCTAssertEqual(s.pendingRelease, 5)
    XCTAssertEqual(s.blockedRelease, 0)
  }

  func testCheckStagesWhenTheReleaseHasNoHermesField() async throws {
    let s = store("good", bundle: try appBundle(hbc(96)))
    let r = try await Updater.check(s)
    XCTAssertEqual(r["status"] as? String, "staged")
  }

  func testCheckStagesWhenTheShellBundleIsNotHermesOrMissing() async throws {
    for head in [Data("var a = 1;".utf8), nil] {
      let s = store("hbc-mismatch", bundle: try appBundle(head))
      let r = try await Updater.check(s)
      XCTAssertEqual(r["status"] as? String, "staged")
    }
  }

  func testShellVersionReadsMainJsbundleHeader() throws {
    XCTAssertEqual(HermesGuard.shellVersion(try appBundle(hbc(96))), 96)
    XCTAssertNil(HermesGuard.shellVersion(try appBundle(nil)), "no main.jsbundle")
    XCTAssertNil(HermesGuard.shellVersion(try appBundle(Data("var a;".utf8))))
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

  func testBackgroundLoadsDoNotUseUpTrialBoots() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    let path = s.pendingPath!
    for _ in 0..<3 {
      ShipvoBundleSelector.invalidate()
      XCTAssertEqual(ShipvoBundleSelector.select(s, visible: false)?.path, path, "a background load runs the staged code")
    }
    XCTAssertEqual(s.trialBoots, 0); XCTAssertEqual(s.pendingRelease, 5)
    ShipvoBundleSelector.settleDeferred(s, visible: true, crashed: false)
    XCTAssertEqual(s.trialBoots, 1, "the app becoming active counts the load once")
    ShipvoBundleSelector.settleDeferred(s, visible: true, crashed: false)
    XCTAssertEqual(s.trialBoots, 1)
    XCTAssertEqual(load(s)?.path, path); XCTAssertEqual(s.trialBoots, 2)
  }

  /// UIScene lifecycle: React starts from the scene delegate, so the first scene activation and `didBecomeActive` can both
  /// fire for one load. Together they must count one trial boot, and a load with no activation counts none.
  func testSceneActivationAndAppActivationCountOneTrialBoot() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    ShipvoReactDelegateHandler.makeStore = { s }
    defer { ShipvoReactDelegateHandler.makeStore = { Store() } }
    ShipvoReactDelegateHandler.watchForeground()
    ShipvoBundleSelector.invalidate()
    _ = ShipvoBundleSelector.select(s, visible: false)
    await MainActor.run {}
    XCTAssertEqual(s.trialBoots, 0, "no scene connected: nothing counted")
    NotificationCenter.default.post(name: UIScene.didActivateNotification, object: nil)
    await MainActor.run {} // observers run on the main queue
    XCTAssertEqual(s.trialBoots, 1, "scene activation counts the trial boot")
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
    await MainActor.run {}
    XCTAssertEqual(s.trialBoots, 1, "app activation for the same load does not count again")
  }

  func testUiSeenStaysTrueAfterTheAppGoesToBackground() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    ShipvoBundleSelector.resetUiSeen()
    ShipvoBundleSelector.invalidate()
    _ = ShipvoBundleSelector.select(s, visible: false)
    XCTAssertFalse(ShipvoBundleSelector.hasShownUi, "a background load has not shown a screen")
    ShipvoBundleSelector.settleDeferred(s, visible: true, crashed: false) // became active
    XCTAssertTrue(ShipvoBundleSelector.hasShownUi)
    // The app is backgrounded before JS calls markHealthy: the flag is sticky, so the release still promotes.
    XCTAssertTrue(ShipvoBundleSelector.hasShownUi)
    XCTAssertTrue(ShipvoBundleSelector.promoteIfRunning(s))
    ShipvoBundleSelector.resetUiSeen()
  }

  func testBackgroundLoadThatThrowsStillCountsOneFailedBoot() async throws {
    let s = store("good"); _ = try await Updater.check(s)
    ShipvoBundleSelector.invalidate()
    _ = ShipvoBundleSelector.select(s, visible: false)
    ShipvoBundleSelector.settleDeferred(s, visible: false, crashed: true)
    XCTAssertEqual(s.trialBoots, 1)
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

/// Needs no fixture server: the Hermes bytecode version rule is pure.
final class HermesGuardTests: XCTestCase {
  private func hbc(_ v: Int) -> Data {
    Data([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)])
  }

  func testReadsVersionFromHeader() {
    XCTAssertEqual(HermesGuard.version(of: hbc(96)), 96)
    XCTAssertEqual(HermesGuard.version(of: hbc(300)), 300)
    XCTAssertNil(HermesGuard.version(of: Data("var a = 1; // js".utf8)))
    XCTAssertNil(HermesGuard.version(of: Data(count: 4)))
  }

  func testMismatchIsRefusedWithTypedReason() {
    XCTAssertEqual(HermesGuard.mismatchEvent(release: 7, releaseVersion: 98, shellVersion: 96), "hermes_bytecode_mismatch:7:release=98:shell=96")
  }

  func testVersionFieldMustBeAWholePositiveNumber() {
    XCTAssertEqual(HermesGuard.releaseVersionOf(96 as NSNumber), 96)
    XCTAssertNil(HermesGuard.releaseVersionOf(96.5 as NSNumber))
    XCTAssertNil(HermesGuard.releaseVersionOf("96"))
    XCTAssertNil(HermesGuard.releaseVersionOf(0 as NSNumber))
    XCTAssertNil(HermesGuard.releaseVersionOf(-3 as NSNumber))
    XCTAssertNil(HermesGuard.releaseVersionOf(true as NSNumber))
    XCTAssertNil(HermesGuard.releaseVersionOf(nil))
  }

  func testMatchIsAccepted() { XCTAssertNil(HermesGuard.mismatchEvent(release: 7, releaseVersion: 96, shellVersion: 96)) }

  func testMissingFieldIsAccepted() {
    XCTAssertNil(HermesGuard.mismatchEvent(release: 7, releaseVersion: nil, shellVersion: 96))
    XCTAssertNil(HermesGuard.mismatchEvent(release: 7, releaseVersion: 96, shellVersion: nil))
  }
}

/// Answers pointer requests with a fixed reply and records their URLs. Everything else goes to the real fixture server.
final class StubPointer: URLProtocol {
  nonisolated(unsafe) static var seen: [URL] = []
  nonisolated(unsafe) static var reply: (Int, String) = (404, "")
  override class func canInit(with request: URLRequest) -> Bool { request.url?.path.hasSuffix(".json") == true && request.url?.path.contains("/ios/b") == true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let url = request.url!
    Self.seen.append(url)
    let resp = HTTPURLResponse(url: url, statusCode: Self.reply.0, httpVersion: "HTTP/1.1", headerFields: nil)!
    client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(Self.reply.1.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
