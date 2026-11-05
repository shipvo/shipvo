import Foundation

struct UpdateError: Error { let message: String; init(_ m: String) { message = m } }

/// Fetch, verify and stage the newest signed release for this device's band. Mirrors Android `check()`.
/// Uses a bsdiff patch when the pointer lists one from the bundle this device runs; any patch problem falls back to the full bundle.
enum Updater {
  private static func require(_ cond: Bool, _ msg: @autoclosure () -> String) throws { if !cond { throw UpdateError(msg()) } }

  private static func request(_ url: String, etag: String?) throws -> URLRequest {
    guard let u = URL(string: url) else { throw UpdateError("bad url \(url)") }
    var r = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    if let etag { r.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    return r
  }

  private static func resolve(_ s: Store, _ url: String) -> String { url.hasPrefix("http") ? url : "\(s.baseUrl)/\(url.drop(while: { $0 == "/" }))" }

  /// Pointer URL. `?hbc=` and `?nm=` are added only when the shell declares them. Scoped names are percent-encoded.
  static func pointerURL(_ s: Store) -> String {
    var url = "\(s.baseUrl)/p/\(s.appId)/\(s.shellMajor)/ios/\(s.band).json"
    func enc(_ x: String) -> String { x.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")) ?? x }
    var q: [String] = []
    let hbc = s.hermesBytecodeVersions
    if !hbc.isEmpty { q.append("hbc=" + hbc.map(String.init).joined(separator: ",")) }
    let nm = s.nativeModules
    if !nm.isEmpty { q.append("nm=" + nm.keys.sorted().map { enc($0) + "%40" + enc(nm[$0]!) }.joined(separator: ",")) }
    if !q.isEmpty { url += "?" + q.joined(separator: "&") }
    return url
  }

  static func check(_ s: Store) async throws -> [String: Any] {
    try require(!s.baseUrl.isEmpty && !s.publicKey.isEmpty && !s.appId.isEmpty, "runtime not configured")
    let known = max(s.currentRelease, s.pendingRelease, s.blockedRelease)
    let (data, resp) = try await URLSession.shared.data(for: request(pointerURL(s), etag: known > 0 ? "\"\(known)\"" : nil))
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 404 {
      // The control plane says this shell cannot run the release. Keep the current one; stage nothing.
      let text = String(data: data, encoding: .utf8) ?? ""
      let reason = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String ?? text.trimmingCharacters(in: .whitespacesAndNewlines)
      if ["hermes_bytecode_mismatch", "native_module_missing", "native_module_version"].contains(reason) { return ["status": "none", "reason": reason] }
      return ["status": "none"]
    }
    if code == 304 { return ["status": "none"] }
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
    // Beside the signature checks, not inside them: refuse a bundle built for another Hermes bytecode version.
    if let ev = HermesGuard.mismatchEvent(release: release, releaseVersion: (body["hermes_bytecode_version"] as? NSNumber)?.intValue, shellVersion: HermesGuard.shellVersion(s.appBundle)) {
      s.addEvent(ev); s.block(release)
      return ["status": "none", "reason": HermesGuard.reason]
    }

    guard let core = body["core"] as? [String: Any], let wantSha = core["sha256"] as? String,
          let wantSize = (core["size"] as? NSNumber)?.intValue, let url = core["url"] as? String else { throw UpdateError("pointer core incomplete") }
    let tmp = s.dir.appendingPathComponent("dl-\(release).tmp")
    try? FileManager.default.removeItem(at: tmp)
    let part = partialURL(s, sha: wantSha)
    dropOtherPartials(s, keep: part)

    var via = "full", downloadedBytes = 0
    let d0 = Store.now()
    var ready = false
    if let patch = try? await patched(s, core: core, wantSha: wantSha, wantSize: wantSize, to: tmp) {
      ready = true; via = "patch"; downloadedBytes = patch
    }
    var downloadMs = (Store.now() - d0) * 1000
    var resumedFrom = 0
    if !ready {
      let f0 = Store.now()
      resumedFrom = try await downloadFull(s, url: resolve(s, url), part: part, wantSize: wantSize)
      try? FileManager.default.removeItem(at: tmp)
      try FileManager.default.moveItem(at: part, to: tmp)
      downloadMs += (Store.now() - f0) * 1000
    }

    let v0 = Store.now()
    let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int) ?? -1
    if via == "full" { downloadedBytes = max(0, size - resumedFrom) }
    let ok = try (size == wantSize && Verify.sha256Hex(file: tmp) == wantSha)
    if !ok { try? FileManager.default.removeItem(at: tmp); try? FileManager.default.removeItem(at: part); s.addEvent("verify_failed:\(release)"); throw UpdateError("bundle hash/size mismatch") }
    let verifyMs = (Store.now() - v0) * 1000 + verifyPointerMs

    let dest = s.dir.appendingPathComponent("r\(release).hbc")
    try? FileManager.default.removeItem(at: dest)
    try FileManager.default.moveItem(at: tmp, to: dest)
    stage(s, dest: dest, release: release, sha: wantSha, issuedAt: body["issued_at"] as? String)
    return ["status": "staged", "release": release, "bytes": downloadedBytes, "via": via, "bundleBytes": size,
            "downloadMs": Int(downloadMs), "verifyMs": Int(verifyMs), "issuedAt": body["issued_at"] as? String ?? ""]
  }

  /// Partial full-bundle download, named by the release sha256 so a different release never reuses it.
  static func partialURL(_ s: Store, sha: String) -> URL { s.dir.appendingPathComponent("dl-\(sha).part") }

  /// The release changed: partial files for other hashes can never complete.
  private static func dropOtherPartials(_ s: Store, keep: URL) {
    let files = (try? FileManager.default.contentsOfDirectory(at: s.dir, includingPropertiesForKeys: nil)) ?? []
    for f in files where f.pathExtension == "part" && f.lastPathComponent != keep.lastPathComponent { try? FileManager.default.removeItem(at: f) }
  }

  /// Download the full bundle into `part`, resuming with `Range: bytes=<n>-` when a partial file exists.
  /// A 200 answer means the server ignored the range: start over. Returns how many bytes were already on disk.
  /// If the connection drops, the partial file stays for the next attempt. The caller still checks the signed hash.
  private static func downloadFull(_ s: Store, url: String, part: URL, wantSize: Int) async throws -> Int {
    let fm = FileManager.default
    func have() -> Int { (try? fm.attributesOfItem(atPath: part.path)[.size] as? Int) ?? 0 }
    var offset = have()
    if offset > wantSize { try? fm.removeItem(at: part); offset = 0 }
    if offset == wantSize { return offset }
    for attempt in 0..<2 {
      var req = try request(url, etag: nil)
      if offset > 0 { req.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range") }
      let (stream, resp) = try await URLSession.shared.bytes(for: req)
      let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
      if code == 416 && offset > 0 && attempt == 0 { try? fm.removeItem(at: part); offset = 0; continue }
      try require(code == 200 || (code == 206 && offset > 0), "bundle HTTP \(code)")
      if code == 200 { try? fm.removeItem(at: part); offset = 0 }
      if !fm.fileExists(atPath: part.path) { try require(fm.createFile(atPath: part.path, contents: nil), "cannot create partial file") }
      let h = try FileHandle(forWritingTo: part)
      defer { try? h.close() }
      try h.seekToEnd()
      var buf = Data(); buf.reserveCapacity(64 * 1024)
      for try await b in stream {
        buf.append(b)
        if buf.count >= 64 * 1024 { try h.write(contentsOf: buf); buf.removeAll(keepingCapacity: true) }
      }
      if !buf.isEmpty { try h.write(contentsOf: buf) }
      return offset
    }
    throw UpdateError("bundle download failed")
  }

  /// Try the patch from the bundle this device runs. Writes the rebuilt bundle to `tmp` and returns the patch size,
  /// or throws (nothing left behind) so the caller can fetch the full bundle. The caller still checks the signed hash.
  private static func patched(_ s: Store, core: [String: Any], wantSha: String, wantSize: Int, to tmp: URL) async throws -> Int {
    guard let base = s.currentPath, s.currentSha != nil, FileManager.default.fileExists(atPath: base),
          let list = core["patches"] as? [[String: Any]],
          let entry = list.first(where: { $0["from_sha256"] as? String == s.currentSha }),
          let purl = entry["url"] as? String, let psha = entry["sha256"] as? String, let psize = (entry["size"] as? NSNumber)?.intValue,
          psize > 0, psize < wantSize else { throw UpdateError("no usable patch") }
    do {
      let (data, resp) = try await URLSession.shared.data(for: request(resolve(s, purl), etag: nil))
      try require((resp as? HTTPURLResponse)?.statusCode == 200 && data.count == psize && Verify.sha256Hex(data) == psha, "patch download invalid")
      let old = try Data(contentsOf: URL(fileURLWithPath: base))
      try require(Verify.sha256Hex(old) == s.currentSha, "current bundle changed on disk")
      let new = try Patch.apply(old: old, patch: data)
      try require(new.count == wantSize && Verify.sha256Hex(new) == wantSha, "patched bundle does not match")
      try new.write(to: tmp)
      return psize
    } catch {
      try? FileManager.default.removeItem(at: tmp); s.addEvent("patch_failed"); throw error
    }
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
