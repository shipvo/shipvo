import Foundation

/// The bundle-choice rules. Kept free of Expo and React imports so they run under `swift test` on a plain Mac.
enum ShipvoBundleSelector {
  static let maxBoots = 3
  static let windowSeconds: TimeInterval = 60
  /// A release is stable once its process has stayed in the foreground this long after `markHealthy`. Android uses the same value.
  static let stabilitySeconds: TimeInterval = 30

  /// Whether a load counts as a boot the moment its bundle is chosen. Only a load that can show a screen does. A silent push
  /// or background task can start the process with no UI; counting those would use up a release's trial boots.
  static func countsAtSelection(visible: Bool) -> Bool { visible }

  /// Whether a load that was not counted at selection counts now: once the app becomes active, or after an uncaught JS
  /// error in that load (a crashing background load must still count against the release). Counts at most once.
  static func countsLater(deferred: Bool, visible: Bool, crashed: Bool) -> Bool { deferred && (visible || crashed) }

  /// The release whose load was chosen without UI and is not counted yet (0 = none), and whether it was a trial.
  private static var deferredRelease = 0
  private static var deferredIsTrial = false

  /// True once this process has had a screen: the load was visible at selection, or the app became active. It stays true
  /// if the app goes to the background later, so `markHealthy` still counts after a slow first render.
  private static var uiSeen = false
  static var hasShownUi: Bool { Store.lock.lock(); defer { Store.lock.unlock() }; return uiSeen }
  /// Test hook: forget the screen state, as a new process would.
  static func resetUiSeen() { Store.lock.lock(); uiSeen = false; Store.lock.unlock() }

  /// Counts the deferred load, if one is waiting. Call on `didBecomeActive` (`crashed: false`) and on an uncaught JS error
  /// (`crashed: true`). The release keeps running the same bundle; a trial release that now reaches its limit is reverted
  /// at the next selection.
  static func settleDeferred(_ s: Store, visible: Bool, crashed: Bool) {
    Store.lock.lock(); defer { Store.lock.unlock() }
    if visible { uiSeen = true }
    let release = deferredRelease
    guard release != 0, countsLater(deferred: true, visible: visible, crashed: crashed) else { return }
    deferredRelease = 0
    if deferredIsTrial {
      if s.pendingRelease == release { s.trialBoots += 1 }
    } else if s.currentRelease == release {
      countCurrentBoot(s)
    }
  }

  /// Idempotent per load: React Native asks for the URL more than once, and only the first ask counts as a boot.
  /// `visible` is false when the app is in the background at load time (a silent push or background task).
  static func select(_ s: Store, visible: Bool = true) -> URL? {
    Store.lock.lock(); defer { Store.lock.unlock() }
    if Store.selection.set { return Store.selection.url }
    let url = choose(s, visible: visible)
    Store.selection = (url, true)
    return url
  }

  /// The app reports a healthy start: a pending release that is the one running becomes current. Returns whether it was promoted.
  @discardableResult
  static func promoteIfRunning(_ s: Store) -> Bool {
    Store.lock.lock(); defer { Store.lock.unlock() }
    var promoted = false
    if s.pendingRelease != 0 && Store.runningRelease == s.pendingRelease {
      if let old = s.previousPath, old != s.currentPath { remove(old) }
      s.promoteStateVersion()
      s.previousRelease = s.currentRelease; s.previousPath = s.currentPath
      s.currentRelease = s.pendingRelease; s.currentPath = s.pendingPath; s.currentSha = s.pendingSha
      s.pendingRelease = 0; s.pendingPath = nil; s.trialBoots = 0
      s.addEvent("applied:\(s.currentRelease)")
      // The promoting boot was a trial boot and was not counted. Count it now, until the stability window ends.
      s.unhealthyBoots = 1; s.firstUnhealthyAt = Store.now()
      promoted = true
    }
    // The boot counter is not cleared here: `markStableIfHealthy` does that after the stability window.
    return promoted
  }

  /// The load that last reported healthy. `markStableIfHealthy` only acts for that load.
  private static var healthyLoad = 0

  /// Called from `markHealthy`: the current load reached its first screen.
  static func noteHealthy() { Store.lock.lock(); healthyLoad = Store.loadsInProcess; Store.lock.unlock() }

  /// Clears the count only if the current load reported healthy. After a reload, the new load has not, so a crash
  /// before its `markHealthy` still counts. Returns whether the count was cleared.
  @discardableResult
  static func markStableIfHealthy(_ s: Store) -> Bool {
    Store.lock.lock(); defer { Store.lock.unlock() }
    guard healthyLoad != 0, healthyLoad == Store.loadsInProcess else { return false }
    s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
    return true
  }

  /// Called before a reload so the next ask is a fresh load.
  static func invalidate() { Store.lock.lock(); Store.selection = (nil, false); Store.lock.unlock() }

  private static func exists(_ path: String?) -> Bool { path != nil && FileManager.default.fileExists(atPath: path!) }
  private static func remove(_ path: String?) { if let p = path { try? FileManager.default.removeItem(atPath: p) } }

  /// Counts one boot of the current release. Returns true when the release must be reverted.
  @discardableResult
  private static func countCurrentBoot(_ s: Store) -> Bool {
    let now = Store.now()
    if now - s.firstUnhealthyAt > windowSeconds { s.firstUnhealthyAt = now; s.unhealthyBoots = 0 }
    s.unhealthyBoots += 1
    return s.unhealthyBoots > maxBoots
  }

  private static func choose(_ s: Store, visible: Bool) -> URL? {
    deferredRelease = 0
    if visible { uiSeen = true }
    Store.bundleSelectedAt = Store.now()
    Store.loadsInProcess += 1

    let installed = s.installedBinaryVersion
    if s.binaryVersion != installed {
      let hadBundles = s.currentPath != nil || s.pendingPath != nil
      s.resetForNewShell()
      if hadBundles { s.addEvent("shell_changed:0") }
    }

    if let pending = s.pendingPath {
      if s.trialBoots >= maxBoots || !exists(pending) {
        s.addEvent("crash_loop_revert:\(s.pendingRelease)")
        s.block(s.pendingRelease)
        remove(pending)
        s.pendingPath = nil; s.pendingRelease = 0; s.trialBoots = 0; s.pendingStateVersion = 0
      } else {
        if countsAtSelection(visible: visible) { s.trialBoots += 1 }
        else { deferredRelease = s.pendingRelease; deferredIsTrial = true }
        Store.runningRelease = s.pendingRelease
        return URL(fileURLWithPath: pending)
      }
    }

    if exists(s.currentPath) {
      if !countsAtSelection(visible: visible) {
        deferredRelease = s.currentRelease; deferredIsTrial = false
      } else if countCurrentBoot(s) {
        s.addEvent("crash_loop_revert:\(s.currentRelease)")
        s.block(s.currentRelease)
        revertToPrevious(s)
        return currentOrEmbedded(s)
      }
      Store.runningRelease = s.currentRelease
      return URL(fileURLWithPath: s.currentPath!)
    }
    Store.runningRelease = 0
    return nil // the embedded bundle
  }

  private static func currentOrEmbedded(_ s: Store) -> URL? {
    if exists(s.currentPath) { Store.runningRelease = s.currentRelease; return URL(fileURLWithPath: s.currentPath!) }
    Store.runningRelease = 0; return nil
  }

  static func revertToPrevious(_ s: Store) {
    if let c = s.currentPath, c != s.previousPath { remove(c) }
    s.revertStateVersion()
    s.currentPath = s.previousPath; s.currentRelease = s.previousRelease; s.currentSha = nil
    s.previousPath = nil; s.previousRelease = 0
    s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
  }
}
