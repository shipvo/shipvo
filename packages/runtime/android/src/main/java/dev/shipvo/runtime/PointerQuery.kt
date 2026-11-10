package dev.shipvo.runtime

import java.net.URLEncoder

/** Builds the pointer URL and reads the control plane's typed "not for this shell" answers. */
internal object PointerQuery {
  val MISMATCH_REASONS = setOf("hermes_bytecode_mismatch", "native_module_missing", "native_module_version")

  private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

  /** `hbc` is "96,98"; `hbe` is the engine build id "250829098.0.10"; `nm` is "name@1.2.3,@scope/pkg@2.0.0". A blank value is treated as not declared. */
  fun url(base: String, app: String, shellMajor: Int, band: String, hbc: String?, nm: String?, hbe: String? = null): String {
    val q = ArrayList<String>()
    hbc?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }
      ?.let { q += "hbc=" + it.joinToString(",") { v -> enc(v) } }
    hbe?.trim()?.takeIf { it.isNotEmpty() }?.let { q += "hbe=" + enc(it) }
    nm?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }
      ?.let { q += "nm=" + it.joinToString(",") { v -> enc(v) } }
    val path = "$base/p/$app/$shellMajor/$band.json"
    return if (q.isEmpty()) path else path + "?" + q.joinToString("&")
  }

  /** A pointer is for this device only when its `platform` is `android` (iOS checks the same). */
  fun isForAndroid(platform: String?): Boolean = platform == "android"

  /** The typed reason in a 404 body, or null for any other answer. */
  fun mismatchReason(body: String?): String? {
    val m = Regex("\"error\"\\s*:\\s*\"([a-z_]+)\"").find(body ?: return null) ?: return null
    return m.groupValues[1].takeIf { it in MISMATCH_REASONS }
  }

  /**
   * The event to queue for a rejected pointer, or null when the same reason is already queued.
   * A shell that stays mismatched would otherwise add one event per check and push out
   * `crash_loop_revert`, `rolled_back` and `verify_failed` (the queue keeps 50).
   */
  fun rejectionEvent(queued: List<String>, reason: String): String? =
    "pointer_rejected:$reason".takeIf { it !in queued }
}
