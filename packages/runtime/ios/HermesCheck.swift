import Foundation

/// Refuses a release built for a different Hermes bytecode version. Runs beside the signature and hash checks, never instead of them.
enum HermesCheck {
  static let reason = "hermes_bytecode_mismatch"

  /// "96,98" (the Info.plist value) to [96, 98]. Anything that is not a positive integer is dropped.
  static func parse(_ raw: String?) -> [Int] {
    (raw ?? "").split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }.filter { $0 > 0 }
  }

  /// True only when both sides say a version and they differ. A missing field on either side means apply, as before.
  static func mismatch(shell: [Int], release: Int?) -> Bool {
    guard let release, !shell.isEmpty else { return false }
    return !shell.contains(release)
  }
}
