#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
import Foundation

public enum BundleError: Error, Equatable {
  case badSignature, badPointer, badHash, badStorage
  /// Same codes as `expect` in test-vectors/bundle.json.
  public var code: String {
    switch self {
    case .badSignature: return "bad_signature"
    case .badPointer: return "bad_pointer"
    case .badHash: return "bad_hash"
    case .badStorage: return "bad_storage"
    }
  }
}

/// Fields of a signed web release pointer that the bundle check reads.
struct Pointer: Decodable {
  struct Core: Decodable { let sha256: String; let size: Int }
  let kind: String, platform: String?, app_id: String, shell_major: Int, band: String, release: Int, core: Core
}

public struct Identity {
  public var appId: String, shellMajor: Int, band: String
  /// Ed25519 public key (base64) built into the app. Never read from the network.
  public var publicKey: String
  public init(appId: String, shellMajor: Int, band: String, publicKey: String) {
    self.appId = appId; self.shellMajor = shellMajor; self.band = band; self.publicKey = publicKey
  }
}

public enum BundleVerify {
  public static func sha256Hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

  /// Same order as the TypeScript core: signature over the exact body bytes first, then the body, then size and sha-256.
  /// Returns the release number. Any failure throws and nothing is stored.
  public static func check(body: String, signature: String, archive: Data, identity: Identity) throws -> Int {
    guard let sig = Data(base64Encoded: signature), let raw = Data(base64Encoded: identity.publicKey),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw),
          key.isValidSignature(sig, for: Data(body.utf8)) else { throw BundleError.badSignature }
    guard let p = try? JSONDecoder().decode(Pointer.self, from: Data(body.utf8)),
          p.kind == "web", (p.platform ?? "android") == "ios", p.app_id == identity.appId,
          p.shell_major == identity.shellMajor, p.band == identity.band, p.release > 0 else { throw BundleError.badPointer }
    guard archive.count == p.core.size, sha256Hex(archive) == p.core.sha256 else { throw BundleError.badHash }
    return p.release
  }
}
