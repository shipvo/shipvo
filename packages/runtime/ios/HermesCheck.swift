import Foundation

/// Refuses a release built for a different Hermes bytecode version. Runs beside the signature and hash checks, never instead of them.
enum HermesCheck {
  static let reason = "hermes_bytecode_mismatch"

  /// "96,98" (the Info.plist value) to [96, 98]. Anything that is not a positive integer is dropped.
  static func parse(_ raw: String?) -> [Int] {
    (raw ?? "").split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }.filter { $0 > 0 }
  }

  /// The release field: absent or null gives nil (apply as before). Present but not a positive whole number throws, so a bad signed value is refused, never ignored.
  static func releaseVersion(_ body: [String: Any]) throws -> Int? {
    guard let raw = body["hermes_bytecode_version"], !(raw is NSNull) else { return nil }
    guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue == Double(n.intValue), n.intValue > 0 else {
      throw UpdateError("pointer has an invalid hermes_bytecode_version")
    }
    return n.intValue
  }

  /// True only when both sides say a version and they differ. A missing field on either side means apply, as before.
  static func mismatch(shell: [Int], release: Int?) -> Bool {
    guard let release, !shell.isEmpty else { return false }
    return !shell.contains(release)
  }
}
