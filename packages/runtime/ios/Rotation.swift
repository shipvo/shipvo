import Foundation

/// Time source for rotation. No rotation code reads the system time directly (design section 9).
protocol Clock { func now() -> Date }
struct SystemClock: Clock { func now() -> Date { Date() } }

/// Signing key rotation (docs/design/key-rotation.md, sections 3 to 9).
/// A statement is an envelope `{body, signature}` signed by the pinned root key. It replaces the current release key.
/// The pointer check in `Updater` uses `Rotation.currentKey`; nothing else about that check changes.
enum Rotation {
  static let maxEntries = 8
  static let maxBodyBytes = 1024
  static let maxAheadDays = 90.0

  struct Statement { let body: String, signature: String, sequence: Int, newKey: String, validFrom: Date }
  struct Result: Equatable { let ok: Bool; let reason: String? }
  struct Outcome { var rejectedWhole = false; var results: [Result] = [] }
  struct State { var releaseKey: String, sequence: Int, pinnedKey: String, pending: [Statement] }

  /// Test hook: how many root signature checks ran (design test 7).
  static var signatureChecks = 0

  // MARK: reading

  /// The key that pointer signatures are checked against now: the pinned release key, or the one a root statement named.
  /// Statements that came due since the last call are applied first.
  static func currentKey(_ s: Store) -> String {
    guard enabled(s) else { return s.publicKey }
    return sync(s).releaseKey
  }

  static func enabled(_ s: Store) -> Bool { !s.rootKey.isEmpty }

  /// Load the stored state and apply every pending statement that is due. Run on every launch and every fetch.
  @discardableResult
  static func sync(_ s: Store) -> State {
    let before = load(s)
    var st = before
    settle(&st, incoming: [], now: s.clock.now())
    if !same(st, before) { save(s, st) }
    return st
  }

  // MARK: delivery

  /// Handle the `rotations` array of a pointer response, before the pointer is looked at.
  /// More than 8 entries are refused whole before any signature check.
  @discardableResult
  static func process(_ s: Store, rotations: Any?) -> Outcome {
    var out = Outcome()
    guard enabled(s), let list = rotations as? [Any] else { return out }
    if list.count > maxEntries { out.rejectedWhole = true; return out }
    let now = s.clock.now()
    var st = load(s)
    let effective = max(st.sequence, s.minSequence)
    var incoming: [Statement] = []
    for item in list {
      let r = check(item, root: s.rootKey, appId: s.appId, ctx: (effective, now))
      switch r {
      case .failure(let f): out.results.append(Result(ok: false, reason: f.reason))
      case .success(let stmt):
        // Rule 4: the same sequence with other bytes does not replace the first one accepted.
        if st.pending.contains(where: { $0.sequence == stmt.sequence }) || incoming.contains(where: { $0.sequence == stmt.sequence }) {
          out.results.append(Result(ok: false, reason: "replay"))
        } else { incoming.append(stmt); out.results.append(Result(ok: true, reason: nil)) }
      }
    }
    let before = st
    settle(&st, incoming: incoming, now: now)
    if !same(st, before) { save(s, st) }
    return out
  }

  // MARK: checks

  struct Failure: Error { let reason: String }

  /// Section 8 order: envelope shape, root signature, then the field rules of section 3.
  /// `ctx` nil skips the replay and 90-day rules (used for statements already accepted and stored).
  static func check(_ item: Any, root: String, appId: String, ctx: (effective: Int, now: Date)?) -> Swift.Result<Statement, Failure> {
    guard let e = item as? [String: Any], let body = e["body"] as? String, let sig = e["signature"] as? String,
          body.utf8.count <= maxBodyBytes else { return .failure(Failure(reason: "bad_envelope")) }
    signatureChecks += 1
    guard Verify.ed25519(Data(body.utf8), signatureB64: sig, publicKeyB64: root) else { return .failure(Failure(reason: "bad_signature")) }
    guard let b = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any] else { return .failure(Failure(reason: "bad_body")) }
    guard b["type"] as? String == "key-rotation" else { return .failure(Failure(reason: "wrong_type")) }
    guard b["appId"] as? String == appId else { return .failure(Failure(reason: "wrong_app")) }
    guard let seq = b["sequence"] as? Int, seq >= 1, seq <= 9_007_199_254_740_991 else { return .failure(Failure(reason: "bad_sequence")) }
    if let ctx, seq <= ctx.effective { return .failure(Failure(reason: "replay")) }
    guard let vf = (b["validFrom"] as? String).flatMap(parseDate) else { return .failure(Failure(reason: "bad_body")) }
    if let ctx, vf.timeIntervalSince(ctx.now) > maxAheadDays * 86_400 { return .failure(Failure(reason: "too_far")) }
    guard let key = b["newKey"] as? String, Data(base64Encoded: key)?.count == 32 else { return .failure(Failure(reason: "bad_key")) }
    return .success(Statement(body: body, signature: sig, sequence: seq, newKey: key, validFrom: vf))
  }

  static func parseDate(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
  }

  // MARK: section 7

  /// Apply the due statement with the highest sequence, then keep the later ones (at most 8, lowest sequences first).
  private static func settle(_ st: inout State, incoming: [Statement], now: Date) {
    let known = (st.pending + incoming).sorted { $0.sequence < $1.sequence }
    if let top = known.last(where: { $0.validFrom <= now }), top.sequence > st.sequence {
      st.releaseKey = top.newKey; st.sequence = top.sequence
    }
    st.pending = Array(known.filter { $0.sequence > st.sequence }.prefix(maxEntries))
  }

  // MARK: storage (one atomic UserDefaults write of a single dictionary)

  private static func same(_ a: State, _ b: State) -> Bool {
    a.releaseKey == b.releaseKey && a.sequence == b.sequence && a.pinnedKey == b.pinnedKey && a.pending.map { $0.body + $0.signature } == b.pending.map { $0.body + $0.signature }
  }

  private static func load(_ s: Store) -> State {
    let pin = s.publicKey
    let fresh = State(releaseKey: pin, sequence: 0, pinnedKey: pin, pending: [])
    guard let d = s.rotationRecord else { return fresh }
    // Missing or unreadable values fall back to the pinned key, never to "no check".
    guard let seq = d["rotation.sequence"] as? Int, seq >= 0 else { return fresh }
    var st = fresh; st.sequence = seq
    // A new store build pinning another release key drops the stored key and keeps the sequence.
    if d["rotation.pinnedKey"] as? String == pin, let k = d["rotation.releaseKey"] as? String, Data(base64Encoded: k)?.count == 32 { st.releaseKey = k }
    if let raw = d["rotation.pending"] {
      var list: [Statement] = []
      var good = (raw as? [Any]) != nil
      for item in (raw as? [Any]) ?? [] {
        if case .success(let stmt) = check(item, root: s.rootKey, appId: s.appId, ctx: nil), stmt.sequence > seq { list.append(stmt) } else { good = false; break }
      }
      st.pending = good && list.count <= maxEntries ? list : []   // a corrupt list is cleared, key and sequence are kept
    }
    return st
  }

  private static func save(_ s: Store, _ st: State) {
    s.rotationRecord = [
      "rotation.releaseKey": st.releaseKey, "rotation.sequence": st.sequence, "rotation.pinnedKey": st.pinnedKey,
      "rotation.pending": st.pending.map { ["body": $0.body, "signature": $0.signature] },
    ]
  }
}
