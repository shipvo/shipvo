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

  private static func partFile(_ s: Store, _ sha: String) -> URL { s.dir.appendingPathComponent("dl-\(sha).part") }
  private static func sizeOf(_ u: URL) -> Int { (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? Int) ?? -1 }

  /// Remove partial files that belong to another release.
  private static func pruneParts(_ s: Store, keep sha: String) {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: s.dir.path)) ?? []
    for n in names where n.hasPrefix("dl-") && n.hasSuffix(".part") && n != partFile(s, sha).lastPathComponent {
      try? FileManager.default.removeItem(at: s.dir.appendingPathComponent(n))
    }
  }

  /// Download `url` into `file`, appending after a `Range` request when `file` already holds bytes.
  /// A 200 answer means the server ignored the range, so the file is rewritten. On a network error the partial file stays.
  /// Returns the bytes fetched in this call. Size and hash are checked by the caller.
  static func fetch(_ url: String, into file: URL, wantSize: Int) async throws -> Int {
    let fm = FileManager.default
    var offset = max(sizeOf(file), 0)
    if offset > wantSize { try? fm.removeItem(at: file); offset = 0 }
    if offset == wantSize && offset > 0 { return 0 }
    var req = try request(url, etag: nil)
    if offset > 0 { req.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range"); req.setValue("identity", forHTTPHeaderField: "Accept-Encoding") }
    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
    let http = resp as? HTTPURLResponse
    let code = http?.statusCode ?? 0
    if code == 206, offset > 0, contentRangeStart(http?.value(forHTTPHeaderField: "Content-Range")) == offset {
      // continue
    } else if code == 200 {
      offset = 0
    } else {
      if code == 416 { try? fm.removeItem(at: file) }
      throw UpdateError("bundle HTTP \(code)")
    }
    if offset == 0 { fm.createFile(atPath: file.path, contents: nil) }
    let h = try FileHandle(forWritingTo: file)
    defer { try? h.close() }
    try h.seekToEnd()
    var buf = Data(), total = 0
    buf.reserveCapacity(64 * 1024)
    for try await b in bytes {
      buf.append(b)
      if buf.count >= 64 * 1024 { try h.write(contentsOf: buf); total += buf.count; buf.removeAll(keepingCapacity: true) }
    }
    if !buf.isEmpty { try h.write(contentsOf: buf); total += buf.count }
    return total
  }

  /// Start byte of a "bytes <start>-<end>/<total>" header, or -1.
  static func contentRangeStart(_ h: String?) -> Int {
    guard let h, h.hasPrefix("bytes ") else { return -1 }
    return Int(h.dropFirst(6).prefix(while: { $0.isNumber })) ?? -1
  }

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
    pruneParts(s, keep: wantSha)

    var via = "full", downloadedBytes = 0
    let d0 = Store.now()
    var ready = false
    if let patch = try? await patched(s, core: core, wantSha: wantSha, wantSize: wantSize, to: tmp) {
      ready = true; via = "patch"; downloadedBytes = patch
    }
    var downloadMs = (Store.now() - d0) * 1000
    var file = tmp
    if !ready {
      // The partial file is named by the signed sha256, so a retry continues where the last attempt stopped.
      let f0 = Store.now()
      file = partFile(s, wantSha)
      let target = resolve(s, url)
      let resumed = ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0) > 0
      downloadedBytes = try await fetch(target, into: file, wantSize: wantSize)
      let resumedOk = try resumed ? (sizeOf(file) == wantSize && Verify.sha256Hex(file: file) == wantSha) : true
      if !resumedOk {
        // A bad resumed file is deleted, then one fresh download is tried before giving up.
        try? FileManager.default.removeItem(at: file); s.addEvent("verify_failed:\(release)")
        downloadedBytes = try await fetch(target, into: file, wantSize: wantSize)
      }
      downloadMs += (Store.now() - f0) * 1000
    }

    let v0 = Store.now()
    let size = sizeOf(file)
    let ok = try (size == wantSize && Verify.sha256Hex(file: file) == wantSha)
    if !ok { try? FileManager.default.removeItem(at: file); s.addEvent("verify_failed:\(release)"); throw UpdateError("bundle hash/size mismatch") }
    let verifyMs = (Store.now() - v0) * 1000 + verifyPointerMs

    let dest = s.dir.appendingPathComponent("r\(release).hbc")
    try? FileManager.default.removeItem(at: dest)
    try FileManager.default.moveItem(at: file, to: dest)
    stage(s, dest: dest, release: release, sha: wantSha, issuedAt: body["issued_at"] as? String)
    return ["status": "staged", "release": release, "bytes": downloadedBytes, "via": via, "bundleBytes": size,
            "downloadMs": Int(downloadMs), "verifyMs": Int(verifyMs), "issuedAt": body["issued_at"] as? String ?? ""]
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
