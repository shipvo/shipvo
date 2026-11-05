package dev.shipvo.runtime

import java.net.URLEncoder

/** Builds the pointer URL and reads typed "this shell cannot run it" answers. No Android types, so JVM tests cover it. */
internal object PointerQuery {
  val MISMATCH_REASONS = setOf("hermes_bytecode_mismatch", "native_module_missing", "native_module_version")

  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  /** `hbc` is "96,98"; `nm` is "name@1.2.3,@scope/pkg@2.0.0". Blank values add no query. */
  fun url(base: String, hbc: String?, nm: String?): String {
    val q = ArrayList<String>()
    // The server answers 400 for bad items, so keep only positive integers for hbc and name@version for nm.
    val h = hbc?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() && it.all { c -> c in '0'..'9' } && (it.toLongOrNull() ?: 0L) > 0 }
    if (!h.isNullOrEmpty()) q += "hbc=" + h.joinToString(",") { enc(it) }
    val n = nm?.split(',')?.map { it.trim() }?.filter { it.lastIndexOf('@').let { i -> i > 0 && i < it.length - 1 } }
    // Encode each item and keep the commas, so the server splits the list as before. '@' is encoded too.
    if (!n.isNullOrEmpty()) q += "nm=" + n.joinToString(",") { enc(it) }
    return if (q.isEmpty()) base else base + "?" + q.joinToString("&")
  }

  /** The typed reason from a 404 body such as {"error":"hermes_bytecode_mismatch"}, or null. */
  fun mismatchReason(body: String?): String? {
    val m = Regex("\"error\"\\s*:\\s*\"([a-z_]+)\"").find(body ?: return null) ?: return null
    return m.groupValues[1].takeIf { it in MISMATCH_REASONS }
  }

  /** Queue a mismatch reason only if it is not already the last queued event, so repeated checks do not flood the queue. */
  fun shouldQueue(lastEvent: String?, reason: String) = lastEvent != reason
}
