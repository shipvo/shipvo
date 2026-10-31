import Foundation

/// The bundle-choice rules. Kept free of Expo and React imports so they run under `swift test` on a plain Mac.
enum ShipvoBundleSelector {
  static let maxBoots = 3
  static let windowSeconds: TimeInterval = 60

  /// Idempotent per load: React Native asks for the URL more than once, and only the first ask counts as a boot.
  static func select(_ s: Store) -> URL? {
    Store.lock.lock(); defer { Store.lock.unlock() }
    if Store.selection.set { return Store.selection.url }
    let url = choose(s)
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
      s.previousRelease = s.currentRelease; s.previousPath = s.currentPath
      s.currentRelease = s.pendingRelease; s.currentPath = s.pendingPath; s.currentSha = s.pendingSha
      s.pendingRelease = 0; s.pendingPath = nil; s.trialBoots = 0
      s.addEvent("applied:\(s.currentRelease)")
      promoted = true
    }
    s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
    return promoted
  }

  /// Called before a reload so the next ask is a fresh load.
  static func invalidate() { Store.lock.lock(); Store.selection = (nil, false); Store.lock.unlock() }

  private static func exists(_ path: String?) -> Bool { path != nil && FileManager.default.fileExists(atPath: path!) }
  private static func remove(_ path: String?) { if let p = path { try? FileManager.default.removeItem(atPath: p) } }

  private static func choose(_ s: Store) -> URL? {
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
        s.pendingPath = nil; s.pendingRelease = 0; s.trialBoots = 0
      } else {
        s.trialBoots += 1
        Store.runningRelease = s.pendingRelease
        return URL(fileURLWithPath: pending)
      }
    }

    if exists(s.currentPath) {
      let now = Store.now()
      if now - s.firstUnhealthyAt > windowSeconds { s.firstUnhealthyAt = now; s.unhealthyBoots = 0 }
      s.unhealthyBoots += 1
      if s.unhealthyBoots > maxBoots {
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
    s.currentPath = s.previousPath; s.currentRelease = s.previousRelease; s.currentSha = nil
    s.previousPath = nil; s.previousRelease = 0
    s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
  }
}
