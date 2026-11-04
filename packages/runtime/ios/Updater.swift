import Foundation

struct UpdateError: Error { let message: String; init(_ m: String) { message = m } }

/// Fetch, verify and stage the newest signed release for this device's band. Mirrors Android `check()`.
/// Uses a bsdiff patch when the pointer lists one from the bundle this device runs; any patch problem falls back to the full bundle.
enum Updater {
  static func require(_ cond: Bool, _ msg: @autoclosure () -> String) throws { if !cond { throw UpdateError(msg()) } }

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
    removeStalePartials(s, keep: wantSha)

    var via = "full", downloadedBytes = 0
    let d0 = Store.now()
    var ready = false
    if let patch = try? await patched(s, core: core, wantSha: wantSha, wantSize: wantSize, to: tmp) {
      ready = true; via = "patch"; downloadedBytes = patch
    }
    var downloadMs = (Store.now() - d0) * 1000
    var built = tmp
    if !ready {
      let f0 = Store.now()
      built = partialFile(s, sha: wantSha)
      downloadedBytes = try await downloadFull(request(resolve(s, url), etag: nil), to: built, size: wantSize)
      downloadMs += (Store.now() - f0) * 1000
    }

    let v0 = Store.now()
    let size = (try? FileManager.default.attributesOfItem(atPath: built.path)[.size] as? Int) ?? -1
    let ok = try (size == wantSize && Verify.sha256Hex(file: built) == wantSha)
    if !ok { try? FileManager.default.removeItem(at: built); s.addEvent("verify_failed:\(release)"); throw UpdateError("bundle hash/size mismatch") }
    let verifyMs = (Store.now() - v0) * 1000 + verifyPointerMs

    let dest = s.dir.appendingPathComponent("r\(release).hbc")
    try? FileManager.default.removeItem(at: dest)
    try FileManager.default.moveItem(at: built, to: dest)
    stage(s, dest: dest, release: release, sha: wantSha, issuedAt: body["issued_at"] as? String)
    return ["status": "staged", "release": release, "bytes": downloadedBytes, "via": via, "bundleBytes": size,
            "downloadMs": Int(downloadMs), "verifyMs": Int(verifyMs), "issuedAt": body["issued_at"] as? String ?? ""]
  }

  /// The partial full-bundle download, named by the release sha256 so a different release never reuses it.
  static func partialFile(_ s: Store, sha: String) -> URL { s.dir.appendingPathComponent("dl-\(sha).part") }

  /// A partial file for any other release is useless now.
  static func removeStalePartials(_ s: Store, keep sha: String) {
    let keepName = partialFile(s, sha: sha).lastPathComponent
    for f in (try? FileManager.default.contentsOfDirectory(atPath: s.dir.path)) ?? [] where f.hasPrefix("dl-") && f.hasSuffix(".part") && f != keepName {
      try? FileManager.default.removeItem(at: s.dir.appendingPathComponent(f))
    }
  }

  /// Download the full bundle into `file`, resuming with `Range` when a partial file exists. Returns the bytes fetched by this call.
  /// An interrupted download keeps its partial file. A 200 answer to a Range request means the server ignored it: start over.
  /// The caller verifies size, sha256 and signature of the finished file as for any other download.
  static func downloadFull(_ base: URLRequest, to file: URL, size: Int) async throws -> Int {
    let fm = FileManager.default
    try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    var have = (try? fm.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
    if have > size { try? fm.removeItem(at: file); have = 0 }
    if have == size { return 0 }
    var r = base
    r.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    if have > 0 { r.setValue("bytes=\(have)-", forHTTPHeaderField: "Range") }
    let (stream, resp) = try await URLSession.shared.bytes(for: r)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    if code == 416 { try? fm.removeItem(at: file); throw UpdateError("bundle HTTP 416") }
    try require(code == 200 || (code == 206 && have > 0), "bundle HTTP \(code)")
    if code == 206 {
      let range = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Range") ?? ""
      if !range.hasPrefix("bytes \(have)-") { try? fm.removeItem(at: file); throw UpdateError("bundle range mismatch") }
    } else {
      try? fm.removeItem(at: file); have = 0
    }
    if !fm.fileExists(atPath: file.path) { fm.createFile(atPath: file.path, contents: nil) }
    let h = try FileHandle(forWritingTo: file)
    defer { try? h.close() }
    try h.seekToEnd()
    var buf = Data(), got = 0
    do {
      for try await b in stream {
        buf.append(b)
        if buf.count >= 64 * 1024 { try h.write(contentsOf: buf); got += buf.count; buf.removeAll(keepingCapacity: true) }
      }
    } catch {
      if !buf.isEmpty { try? h.write(contentsOf: buf) }
      throw error
    }
    if !buf.isEmpty { try h.write(contentsOf: buf); got += buf.count }
    return got
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
