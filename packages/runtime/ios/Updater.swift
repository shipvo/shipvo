import Foundation

struct UpdateError: Error { let message: String; init(_ m: String) { message = m } }

/// Fetch, verify and stage the newest signed release for this device's band. Mirrors Android `check()`.
/// iOS downloads full bundles only for now; a pointer's `patches` are ignored (an Android-only optimisation).
enum Updater {
  private static func require(_ cond: Bool, _ msg: @autoclosure () -> String) throws { if !cond { throw UpdateError(msg()) } }

  private static func request(_ url: String, etag: String?) throws -> URLRequest {
    guard let u = URL(string: url) else { throw UpdateError("bad url \(url)") }
    var r = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    if let etag { r.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    return r
  }

  private static func resolve(_ s: Store, _ url: String) -> String { url.hasPrefix("http") ? url : "\(s.baseUrl)/\(url.drop(while: { $0 == "/" }))" }

  static func check(_ s: Store) async throws -> [String: Any] {
    try require(!s.baseUrl.isEmpty && !s.publicKey.isEmpty && !s.appId.isEmpty, "runtime not configured")
    let known = max(s.currentRelease, s.pendingRelease, s.blockedRelease)
    let (data, resp) = try await URLSession.shared.data(for: request("\(s.baseUrl)/p/\(s.appId)/\(s.shellMajor)/ios/\(s.band).json", etag: known > 0 ? "\"\(known)\"" : nil))
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 304 || code == 404 { return ["status": "none"] }
    try require(code == 200, "pointer HTTP \(code)")
    guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let bodyStr = envelope["body"] as? String, let sig = envelope["signature"] as? String else { throw UpdateError("pointer is not an envelope") }

    let t0 = Store.now()
    try require(Verify.ed25519(Data(bodyStr.utf8), signatureB64: sig, publicKeyB64: s.publicKey), "pointer signature invalid")
    guard let body = try JSONSerialization.jsonObject(with: Data(bodyStr.utf8)) as? [String: Any] else { throw UpdateError("pointer body unreadable") }
    try require(body["platform"] as? String == "ios", "pointer is not for iOS")
    try require(body["app_id"] as? String == s.appId && body["shell_major"] as? Int == s.shellMajor, "pointer for another app/shell")
    guard let release = body["release"] as? Int else { throw UpdateError("pointer has no release") }
    if release <= known { return ["status": "none"] }
    try require(!Verify.semverLess(s.shellVersion, body["min_shell_version"] as? String ?? "0.0.0"), "shell too old for release \(release)")
    let verifyPointerMs = (Store.now() - t0) * 1000

    guard let core = body["core"] as? [String: Any], let wantSha = core["sha256"] as? String,
          let wantSize = (core["size"] as? NSNumber)?.intValue, let url = core["url"] as? String else { throw UpdateError("pointer core incomplete") }
    let tmp = s.dir.appendingPathComponent("dl-\(release).tmp")
    try? FileManager.default.removeItem(at: tmp)

    let d0 = Store.now()
    let (fileURL, dresp) = try await URLSession.shared.download(for: request(resolve(s, url), etag: nil))
    let dcode = (dresp as? HTTPURLResponse)?.statusCode ?? 0
    try require(dcode == 200, "bundle HTTP \(dcode)")
    try FileManager.default.moveItem(at: fileURL, to: tmp)
    let downloadMs = (Store.now() - d0) * 1000

    let v0 = Store.now()
    let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int) ?? -1
    let ok = try (size == wantSize && Verify.sha256Hex(file: tmp) == wantSha)
    if !ok { try? FileManager.default.removeItem(at: tmp); s.addEvent("verify_failed:\(release)"); throw UpdateError("bundle hash/size mismatch") }
    let verifyMs = (Store.now() - v0) * 1000 + verifyPointerMs

    let dest = s.dir.appendingPathComponent("r\(release).hbc")
    try? FileManager.default.removeItem(at: dest)
    try FileManager.default.moveItem(at: tmp, to: dest)
    stage(s, dest: dest, release: release, sha: wantSha, issuedAt: body["issued_at"] as? String)
    return ["status": "staged", "release": release, "bytes": size, "via": "full", "bundleBytes": size,
            "downloadMs": Int(downloadMs), "verifyMs": Int(verifyMs), "issuedAt": body["issued_at"] as? String ?? ""]
  }

  /// Synchronous so the lock is never held across a suspension point.
  private static func stage(_ s: Store, dest: URL, release: Int, sha: String, issuedAt: String?) {
    Store.lock.lock(); defer { Store.lock.unlock() }
    if let p = s.pendingPath, p != dest.path { try? FileManager.default.removeItem(atPath: p) }
    s.pendingPath = dest.path; s.pendingRelease = release; s.trialBoots = 0; s.pendingSha = sha
    if s.binaryVersion == nil { s.binaryVersion = s.installedBinaryVersion }
    s.pendingIssuedAt = issuedAt
  }
}
