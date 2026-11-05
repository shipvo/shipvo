import Foundation

/// Refuses a release built for a different Hermes bytecode version than the shell runs. Runs in addition to the
/// signature and hash checks, never instead of them.
enum HermesGuard {
  static let reason = "hermes_bytecode_mismatch"
  // Same magic and layout as the CLI code that writes `hermes_bytecode_version` on publish.
  private static let magic: [UInt8] = [0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]

  /// The bytecode version in a bundle header (8-byte magic, then a 32-bit little-endian version), or nil for plain JS.
  static func version(of head: Data) -> Int? {
    let b = [UInt8](head.prefix(12))
    guard b.count >= 12, Array(b[0..<8]) == magic else { return nil }
    let v = (0..<4).reduce(0) { $0 | Int(b[8 + $1]) << (8 * $1) }
    return v > 0 ? v : nil
  }

  /// The release's version field, or nil ("unknown") unless it is a whole number from 1 to Int32.max.
  /// Same rule as `releaseVersionOf` on Android: rejects Bool, fractions, strings, zero and negatives.
  static func releaseVersionOf(_ value: Any?) -> Int? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    guard d == d.rounded(), d > 0, d <= Double(Int32.max) else { return nil }
    return Int(d)
  }

  /// The event to log when the release must be refused, or nil when it may be staged.
  /// A missing field on either side means "unknown", so the release is applied as before.
  static func mismatchEvent(release: Int, releaseVersion: Int?, shellVersion: Int?) -> String? {
    guard let r = releaseVersion, let s = shellVersion, r != s else { return nil }
    return "\(reason):\(release):release=\(r):shell=\(s)"
  }

  /// The version of the bundle embedded in the app, read from its header.
  static func shellVersion(_ bundle: Bundle) -> Int? {
    guard let url = bundle.url(forResource: "main", withExtension: "jsbundle"), let h = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? h.close() }
    return version(of: (try? h.read(upToCount: 12)) ?? Data())
  }
}
