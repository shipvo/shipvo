import Foundation

/// Persistent runtime state. Every bundle decision goes through here so the host handler and the module agree.
/// Mirrors the Android `Store`: same fields, same meaning.
final class Store {
  /// Replaces what the app's Info.plist and file system would say. Tests use it; the app never does.
  struct Overrides {
    var suite: String, dir: URL, baseUrl: String, publicKey: String, appId: String, shellMajor: Int, shellVersion: String, binaryVersion: String
  }

  private let d: UserDefaults
  private let bundle: Bundle
  private let o: Overrides?

  init(bundle: Bundle = .main, overrides: Overrides? = nil) {
    self.bundle = bundle; self.o = overrides
    self.d = UserDefaults(suiteName: overrides?.suite ?? "shipvo.runtime") ?? .standard
  }

  var dir: URL {
    let base = o?.dir ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("shipvo", isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  // MARK: cohort and band
  var cohort: Int {
    if d.object(forKey: "cohort") == nil { d.set(Int.random(in: 0..<1000), forKey: "cohort") }
    return d.integer(forKey: "cohort")
  }
  var band: String { let c = cohort; return c < 10 ? "b0" : (c < 100 ? "b1" : "b2") }

  // MARK: releases
  var currentRelease: Int { get { d.integer(forKey: "current_release") } set { d.set(newValue, forKey: "current_release") } }
  var currentPath: String? { get { d.string(forKey: "current_path") } set { d.set(newValue, forKey: "current_path") } }
  var currentSha: String? { get { d.string(forKey: "current_sha") } set { d.set(newValue, forKey: "current_sha") } }
  var previousRelease: Int { get { d.integer(forKey: "previous_release") } set { d.set(newValue, forKey: "previous_release") } }
  var previousPath: String? { get { d.string(forKey: "previous_path") } set { d.set(newValue, forKey: "previous_path") } }
  var pendingRelease: Int { get { d.integer(forKey: "pending_release") } set { d.set(newValue, forKey: "pending_release") } }
  var pendingPath: String? { get { d.string(forKey: "pending_path") } set { d.set(newValue, forKey: "pending_path") } }
  var pendingSha: String? { get { d.string(forKey: "pending_sha") } set { d.set(newValue, forKey: "pending_sha") } }
  var pendingIssuedAt: String? { get { d.string(forKey: "pending_issued_at") } set { d.set(newValue, forKey: "pending_issued_at") } }
  /// Highest release this device refused (crash-looped or rolled back). Only newer releases are fetched.
  var blockedRelease: Int { get { d.integer(forKey: "blocked_release") } set { d.set(newValue, forKey: "blocked_release") } }
  /// Shell binary the stored OTA bundles were downloaded under.
  var binaryVersion: String? { get { d.string(forKey: "binary_version") } set { d.set(newValue, forKey: "binary_version") } }
  func block(_ release: Int) { if release > blockedRelease { blockedRelease = release } }

  var trialBoots: Int { get { d.integer(forKey: "trial_boots") } set { d.set(newValue, forKey: "trial_boots") } }
  var unhealthyBoots: Int { get { d.integer(forKey: "unhealthy_boots") } set { d.set(newValue, forKey: "unhealthy_boots") } }
  var firstUnhealthyAt: Double { get { d.double(forKey: "first_unhealthy_at") } set { d.set(newValue, forKey: "first_unhealthy_at") } }

  var installedBinaryVersion: String {
    if let o { return o.binaryVersion }
    let v = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    let b = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    return "\(v)/\(b)"
  }
  /// The marketing version alone, compared against `min_shell_version`.
  var shellVersion: String { if let o { return o.shellVersion }; return bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }

  /// After a shell (app binary) update, bundles built for the old native code must not run.
  func resetForNewShell() {
    if let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
      for f in files { try? FileManager.default.removeItem(at: f) }
    }
    for k in ["current_release", "current_path", "current_sha", "previous_release", "previous_path", "pending_release", "pending_path",
              "pending_sha", "pending_issued_at", "trial_boots", "unhealthy_boots", "first_unhealthy_at", "blocked_release"] { d.removeObject(forKey: k) }
    binaryVersion = installedBinaryVersion
  }

  // MARK: events
  func addEvent(_ e: String) {
    var list = (d.string(forKey: "events") ?? "").split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    list = Array(list.suffix(49)) + [e]
    d.set(list.joined(separator: "\n"), forKey: "events")
  }
  func consumeEvents() -> [String] {
    let list = (d.string(forKey: "events") ?? "").split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    d.removeObject(forKey: "events"); return list
  }

  // MARK: trust root (Info.plist, written by the config plugin; an OTA bundle cannot change these)
  private func plist(_ key: String) -> String? { bundle.object(forInfoDictionaryKey: key) as? String }
  var baseUrl: String { var s = o?.baseUrl ?? plist("ShipvoBaseURL") ?? ""; while s.hasSuffix("/") { s.removeLast() }; return s }
  var publicKey: String { o?.publicKey ?? plist("ShipvoPublicKey") ?? "" }
  var appId: String { o?.appId ?? plist("ShipvoAppId") ?? "" }
  var shellMajor: Int { if let o { return o.shellMajor }; return Int(plist("ShipvoShellMajor") ?? "1") ?? 1 }

  // MARK: per-process state
  /// Which release the JS running right now came from (set when the bundle is selected).
  static var runningRelease = 0
  static var bundleSelectedAt: TimeInterval = 0
  /// How many times a bundle was selected in this process: 1 = cold start, more = in-process reload.
  static var loadsInProcess = 0
  /// The URL chosen for the current load. React Native asks for the bundle URL more than once per load,
  /// so the choice (and its trial-boot accounting) is made once and cached until a reload clears it.
  static var selection: (url: URL?, set: Bool) = (nil, false)
  static let lock = NSRecursiveLock()

  static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
}
