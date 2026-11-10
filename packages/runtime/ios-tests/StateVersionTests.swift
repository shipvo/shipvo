import XCTest
@testable import ShipvoCore

/// The state version follows a release through stage, apply and revert in the real Store. No network.
final class StateVersionTests: XCTestCase {
  private func store() -> Store {
    Store(bundle: .main, overrides: .init(suite: "shipvo.test.\(UUID().uuidString)", dir: FileManager.default.temporaryDirectory, baseUrl: "http://x", publicKey: "", appId: "a",
      shellMajor: 1, shellVersion: "1.0.0", binaryVersion: "1.0.0/1"))
  }
  private func stage(_ s: Store, _ release: Int, _ sv: Any?) { s.pendingRelease = release; s.stageStateVersion(sv) }
  private func apply(_ s: Store) {
    s.promoteStateVersion(); s.previousRelease = s.currentRelease; s.currentRelease = s.pendingRelease; s.pendingRelease = 0
  }
  private func revert(_ s: Store) { s.revertStateVersion(); s.currentRelease = s.previousRelease; s.previousRelease = 0 }

  func testStagedThenAppliedReleaseKeepsItsVersion() {
    let s = store(); stage(s, 5, 3); apply(s)
    XCTAssertEqual(s.appliedStateVersion(running: 5), 3)
  }
  func testReleaseWithoutAVersionReturnsNil() {
    let s = store(); stage(s, 5, nil); apply(s)
    XCTAssertNil(s.appliedStateVersion(running: 5))
  }
  func testANewReleaseWithoutAVersionDoesNotInheritTheOldOne() {
    let s = store(); stage(s, 5, 3); apply(s); stage(s, 6, nil); apply(s)
    XCTAssertNil(s.appliedStateVersion(running: 6))
  }
  func testEmbeddedBundleReturnsNil() {
    let s = store(); stage(s, 5, 3); apply(s)
    XCTAssertNil(s.appliedStateVersion(running: 0))
  }
  func testRevertToEmbeddedReturnsNil() {
    let s = store(); stage(s, 5, 3); apply(s); revert(s)
    XCTAssertNil(s.appliedStateVersion(running: 0))
    XCTAssertEqual(s.currentStateVersion, 0)
  }
  func testRevertToPreviousReleaseReturnsItsVersion() {
    let s = store(); stage(s, 5, 2); apply(s); stage(s, 6, 3); apply(s)
    XCTAssertEqual(s.appliedStateVersion(running: 6), 3)
    revert(s)
    XCTAssertEqual(s.appliedStateVersion(running: 5), 2)
  }
  func testInvalidVersionsStayAbsent() {
    let s = store()
    for bad in [("3" as Any), 0, -1] { stage(s, 5, bad); XCTAssertNil(s.appliedStateVersion(running: 5)) }
  }
}
