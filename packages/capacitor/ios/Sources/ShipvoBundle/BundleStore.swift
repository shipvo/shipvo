import Foundation

/// Bundles under `<root>/bundles/release-<n>/bundle.zip` and release state in `<root>/state.json`.
/// Same release rules as the TypeScript core (10, 11, 12, 14): three trial boots for a pending release,
/// more than three boots in a minute reverts the current one, rollback blocks it.
public final class BundleStore {
  public static let maxBoots = 3
  public static let windowMs = 60_000

  struct State: Codable {
    var current = 0, pending = 0, previous = 0, blocked = 0, pendingBoots = 0
    var bootTimes: [Int] = []
    var hashes: [String: String] = [:]
  }

  private let root: URL
  private let identity: Identity
  private let now: () -> Int
  private var s: State

  public init(root: URL, identity: Identity, now: @escaping () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }) throws {
    self.root = root; self.identity = identity; self.now = now
    do { try FileManager.default.createDirectory(at: root.appendingPathComponent("bundles"), withIntermediateDirectories: true) }
    catch { throw BundleError.badStorage }
    // A state file that cannot be read starts clean: no release is trusted without a verified record.
    if let d = try? Data(contentsOf: root.appendingPathComponent("state.json")), let st = try? JSONDecoder().decode(State.self, from: d) { s = st }
    else { s = State() }
  }

  public var current: Int { s.current }
  public var pending: Int { s.pending }
  public var previous: Int { s.previous }
  public var blocked: Int { s.blocked }

  public func directory(for release: Int) -> URL { root.appendingPathComponent("bundles/release-\(release)") }
  public func archiveURL(for release: Int) -> URL { directory(for: release).appendingPathComponent("bundle.zip") }

  /// Verifies, then stores the archive and makes it the pending release. A refused bundle changes nothing.
  @discardableResult
  public func stage(body: String, signature: String, archive: Data) throws -> Int {
    let release = try BundleVerify.check(body: body, signature: signature, archive: archive, identity: identity)
    if release <= max(s.current, s.pending, s.blocked) { throw BundleError.badPointer }
    let dir = directory(for: release)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try archive.write(to: archiveURL(for: release), options: .atomic)
    } catch { throw BundleError.badStorage }
    let old = s.pending
    s.hashes[String(release)] = BundleVerify.sha256Hex(archive)
    s.pending = release; s.pendingBoots = 0
    if old != 0 && old != release { drop(old) }
    try save()
    return release
  }

  /// The release to serve now, or 0 for the embedded bundle. The stored hash is re-checked before a file is chosen.
  public func boot() throws -> Int {
    let t = now()
    if s.pending != 0 {
      if s.pendingBoots >= Self.maxBoots {
        blockAndDrop(s.pending); s.pending = 0; s.pendingBoots = 0
      } else if intact(s.pending) {
        s.pendingBoots += 1; try save(); return s.pending
      } else { blockAndDrop(s.pending); s.pending = 0; s.pendingBoots = 0 }
    }
    if s.current != 0 {
      s.bootTimes = s.bootTimes.filter { t - $0 < Self.windowMs } + [t]
      if s.bootTimes.count > Self.maxBoots || !intact(s.current) {
        blockAndDrop(s.current); s.current = s.previous; s.previous = 0; s.bootTimes = []
      }
    }
    try save()
    return s.current
  }

  /// Rule 12: the pending release that is running becomes current.
  public func markHealthy(running: Int) throws {
    guard s.pending != 0, s.pending == running else { return }
    if s.previous != 0 { drop(s.previous) }
    s.previous = s.current; s.current = s.pending; s.pending = 0; s.pendingBoots = 0; s.bootTimes = []
    try save()
  }

  /// Rule 14: drop pending, block the current release, go back to the previous one.
  public func rollback() throws {
    if s.pending != 0 { drop(s.pending); s.pending = 0; s.pendingBoots = 0 }
    if s.current != 0 { blockAndDrop(s.current) }
    s.current = s.previous; s.previous = 0; s.bootTimes = []
    try save()
  }

  private func intact(_ release: Int) -> Bool {
    guard let d = try? Data(contentsOf: archiveURL(for: release)) else { return false }
    return BundleVerify.sha256Hex(d) == s.hashes[String(release)]
  }
  private func blockAndDrop(_ release: Int) { s.blocked = max(s.blocked, release); drop(release) }
  private func drop(_ release: Int) {
    s.hashes[String(release)] = nil
    try? FileManager.default.removeItem(at: directory(for: release))
  }
  private func save() throws {
    do { try JSONEncoder().encode(s).write(to: root.appendingPathComponent("state.json"), options: .atomic) }
    catch { throw BundleError.badStorage }
  }
}
