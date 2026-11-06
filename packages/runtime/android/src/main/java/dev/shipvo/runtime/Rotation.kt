package dev.shipvo.runtime

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** What Rotation needs from storage. [commit] writes all three values in one atomic step. */
internal interface RotationState {
  val storedReleaseKey: String?
  val storedSequence: Long
  val storedPinnedKey: String?
  val storedPending: String?
  fun commit(releaseKey: String?, sequence: Long, pinnedKey: String?, pending: String?)
}

/**
 * Root-signed release key rotation (docs/design/key-rotation.md, sections 3 to 9).
 * A statement is an envelope {body, signature}; the signature is by the pinned root key over the exact body string.
 */
internal class Rotation(
  private val state: RotationState,
  private val appId: String,
  private val pinnedReleaseKey: String,
  private val rootKey: String,
  private val minSequence: Long,
  private val clock: Clock = Clock.Wall,
  private val verify: (ByteArray, String, String) -> Boolean = Verify::ed25519,
  private val decode: (String) -> ByteArray = { Base64.decode(it, Base64.DEFAULT) },
) {
  class Result(val ok: Boolean, val reason: String? = null)

  private class Stmt(val body: String, val signature: String, val sequence: Long, val newKey: String, val validFrom: Long)

  /** Signature checks made so far (tests count them). */
  var signatureChecks = 0
    private set

  /** The release key pointers are verified against: the stored one, or the pinned one when nothing usable is stored. */
  fun currentReleaseKey(): String {
    val k = state.storedReleaseKey
    return if (k != null && state.storedPinnedKey == pinnedReleaseKey && keyOk(k)) k else pinnedReleaseKey
  }

  fun effectiveSequence(): Long = maxOf(state.storedSequence, minSequence)

  /** Applies due pending statements. Run on launch and before every pointer check. */
  fun applyDue() { handle(null) }

  /**
   * Handles a delivered `rotations` array (null for none). Returns one result per envelope; empty when the array
   * is refused whole. Verdicts are against the state before this delivery.
   */
  fun handle(rotations: JSONArray?): List<Result> {
    if (rotations != null && rotations.length() > MAX) return emptyList()
    val effective = effectiveSequence()
    val known = HashMap<Long, Stmt>()
    for (s in loadPending()) if (s.sequence > effective) known.putIfAbsent(s.sequence, s)
    val results = ArrayList<Result>()
    if (rotations != null) for (i in 0 until rotations.length()) {
      val env = rotations.optJSONObject(i)
      val body = env?.opt("body") as? String
      val sig = env?.opt("signature") as? String
      if (body == null || sig == null || body.toByteArray(Charsets.UTF_8).size > MAX_BODY) { results.add(Result(false, "malformed")); continue }
      val r = check(body, sig, effective)
      if (r is Stmt) {
        // Same sequence twice: the first accepted stays.
        if (known.containsKey(r.sequence)) results.add(Result(false, "replay")) else { known[r.sequence] = r; results.add(Result(true)) }
      } else results.add(r as Result)
    }
    commitState(known.values.sortedBy { it.sequence }, effective)
    return results
  }

  /** Section 3 rules 1 to 5 in order. Returns a [Stmt] when valid, else a [Result]. */
  private fun check(body: String, sig: String, effective: Long, reload: Boolean = false): Any {
    signatureChecks++
    if (!verify(body.toByteArray(Charsets.UTF_8), sig, rootKey)) return Result(false, "bad_signature")
    val j = try { JSONObject(body) } catch (_: Exception) { return Result(false, "malformed") }
    if (j.opt("type") != "key-rotation") return Result(false, "bad_type")
    if (j.opt("appId") != appId) return Result(false, "wrong_app")
    val seq = j.opt("sequence").let { if (it is Int) it.toLong() else it as? Long } ?: return Result(false, "malformed")
    if (seq < 1) return Result(false, "malformed")
    if (seq <= effective) return Result(false, "replay")
    val validFrom = (j.opt("validFrom") as? String)?.let { parseTime(it) } ?: return Result(false, "malformed")
    if (!reload && validFrom > clock.now() + NINETY_DAYS_MS) return Result(false, "too_far")
    val newKey = j.opt("newKey") as? String
    if (newKey == null || !keyOk(newKey)) return Result(false, "bad_key")
    return Stmt(body, sig, seq, newKey, validFrom)
  }

  /** Section 7: apply the due statement with the highest sequence, keep the later ones, at most 8. */
  private fun commitState(all: List<Stmt>, effective: Long) {
    val now = clock.now()
    val due = all.filter { it.validFrom <= now }.maxByOrNull { it.sequence }
    val keep = (if (due == null) all else all.filter { it.sequence > due.sequence }).take(MAX)
    val pending = if (keep.isEmpty()) null else JSONArray(keep.map { JSONObject().put("body", it.body).put("signature", it.signature) }).toString()
    val changed = due != null || pending != state.storedPending || state.storedPinnedKey != pinnedReleaseKey
    if (!changed) return
    // A different pin than the one that wrote the state: drop the stored key, keep the sequence (design section 4).
    val key = due?.newKey ?: if (state.storedPinnedKey == pinnedReleaseKey) state.storedReleaseKey else null
    state.commit(key, maxOf(due?.sequence ?: 0L, state.storedSequence), pinnedReleaseKey, pending)
  }

  /** A corrupt or unverifiable pending list is cleared by the next commit; key and sequence stay. */
  private fun loadPending(): List<Stmt> {
    val raw = state.storedPending ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      if (arr.length() > MAX) return emptyList()
      val out = ArrayList<Stmt>()
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val r = check(o.getString("body"), o.getString("signature"), 0, reload = true)
        if (r is Stmt) out.add(r)
      }
      out
    } catch (_: Exception) { emptyList() }
  }

  private fun keyOk(k: String): Boolean = try { decode(k).size == 32 } catch (_: Exception) { false }

  private fun parseTime(s: String): Long? = try {
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }.parse(s)?.time
  } catch (_: Exception) { null }

  companion object {
    const val MAX = 8
    const val MAX_BODY = 1024
    const val NINETY_DAYS_MS = 90L * 24 * 60 * 60 * 1000
  }
}
