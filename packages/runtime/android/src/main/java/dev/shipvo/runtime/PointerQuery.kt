package dev.shipvo.runtime

import java.net.URLEncoder

/** Builds the pointer URL and reads the control plane's typed "not for this shell" answers. */
internal object PointerQuery {
  val MISMATCH_REASONS = setOf("hermes_bytecode_mismatch", "native_module_missing", "native_module_version")

  private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

  /** `hbc` is "96,98"; `nm` is "name@1.2.3,@scope/pkg@2.0.0". A blank value is treated as not declared. */
  fun url(base: String, app: String, shellMajor: Int, band: String, hbc: String?, nm: String?): String {
    val q = ArrayList<String>()
    hbc?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }
      ?.let { q += "hbc=" + it.joinToString(",") { v -> enc(v) } }
    nm?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }
      ?.let { q += "nm=" + it.joinToString(",") { v -> enc(v) } }
    val path = "$base/p/$app/$shellMajor/$band.json"
    return if (q.isEmpty()) path else path + "?" + q.joinToString("&")
  }

  /** The typed reason in a 404 body, or null for any other answer. */
  fun mismatchReason(body: String?): String? {
    val m = Regex("\"error\"\\s*:\\s*\"([a-z_]+)\"").find(body ?: return null) ?: return null
    return m.groupValues[1].takeIf { it in MISMATCH_REASONS }
  }
}
