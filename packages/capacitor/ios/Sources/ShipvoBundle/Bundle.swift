#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
import Foundation

public enum BundleError: Error, Equatable {
  case badSignature, badPointer, badHash, badStorage, shellTooOld
  /// Same codes as `expect` in test-vectors/bundle.json.
  public var code: String {
    switch self {
    case .badSignature: return "bad_signature"
    case .badPointer: return "bad_pointer"
    case .badHash: return "bad_hash"
    case .badStorage: return "bad_storage"
    case .shellTooOld: return "shell_too_old"
    }
  }
}

/// Fields of a signed web release pointer that the bundle check reads.
struct Pointer: Decodable {
  struct Core: Decodable { let sha256: String; let size: Int }
  let kind: String, platform: String?, app_id: String, shell_major: Int, band: String, release: Int, min_shell_version: String, core: Core
}

public struct Identity {
  public var appId: String, shellMajor: Int, band: String
  /// Installed app version, x.y.z.
  public var shellVersion: String
  /// Ed25519 public key (base64) built into the app. Never read from the network.
  public var publicKey: String
  public init(appId: String, shellMajor: Int, band: String, shellVersion: String, publicKey: String) {
    self.appId = appId; self.shellMajor = shellMajor; self.band = band; self.shellVersion = shellVersion; self.publicKey = publicKey
  }
}

/// a < b for x.y.z. Pre-release tags are ignored. Same as `semverLess` in the TypeScript core.
func semverLess(_ a: String, _ b: String) -> Bool {
  func parts(_ v: String) -> [Int] { String(v.split(separator: "-", omittingEmptySubsequences: false).first ?? "").split(separator: ".", omittingEmptySubsequences: false).map { Int($0) ?? 0 } }
  let pa = parts(a), pb = parts(b)
  for i in 0..<3 {
    let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
    if x != y { return x < y }
  }
  return false
}

public enum BundleVerify {
  public static func sha256Hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

  static func signatureOK(body: String, signature: String, publicKey: String) -> Bool {
    guard let sig = Data(base64Encoded: signature), let raw = Data(base64Encoded: publicKey),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
    return key.isValidSignature(sig, for: Data(body.utf8))
  }

  /// Same order as the TypeScript core: signature over the exact body bytes first, then the body, then the minimum shell version, then size and sha-256.
  /// Returns the release number. Any failure throws and nothing is stored.
  public static func check(body: String, signature: String, archive: Data, identity: Identity) throws -> Int {
    guard signatureOK(body: body, signature: signature, publicKey: identity.publicKey) else { throw BundleError.badSignature }
    guard let p = try? JSONDecoder().decode(Pointer.self, from: Data(body.utf8)),
          p.kind == "web", (p.platform ?? "android") == "ios", p.app_id == identity.appId,
          p.shell_major == identity.shellMajor, p.band == identity.band, p.release > 0 else { throw BundleError.badPointer }
    // Rule 5: minimum shell version.
    if semverLess(identity.shellVersion, p.min_shell_version) { throw BundleError.shellTooOld }
    guard archive.count == p.core.size, sha256Hex(archive) == p.core.sha256 else { throw BundleError.badHash }
    return p.release
  }
}
