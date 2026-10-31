import CryptoKit
import Foundation

enum Verify {
  static func ed25519(_ message: Data, signatureB64: String, publicKeyB64: String) -> Bool {
    guard let sig = Data(base64Encoded: signatureB64), let raw = Data(base64Encoded: publicKeyB64),
          let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
    return key.isValidSignature(sig, for: message)
  }

  static func sha256Hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

  static func sha256Hex(file url: URL) throws -> String {
    let h = try FileHandle(forReadingFrom: url); defer { try? h.close() }
    var hasher = SHA256()
    while let chunk = try h.read(upToCount: 64 * 1024), !chunk.isEmpty { hasher.update(data: chunk) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  /// a < b for x.y.z
  static func semverLess(_ a: String, _ b: String) -> Bool {
    func parts(_ s: String) -> [Int] { s.split(separator: "-")[0].split(separator: ".").map { Int($0) ?? 0 } }
    let pa = parts(a), pb = parts(b)
    for i in 0..<3 {
      let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
      if x != y { return x < y }
    }
    return false
  }
}
