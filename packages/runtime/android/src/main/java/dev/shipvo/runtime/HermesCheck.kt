package dev.shipvo.runtime

/** Refuses a release built for a different Hermes bytecode version. Runs beside the signature and hash checks, never instead of them. */
internal object HermesCheck {
  const val REASON = "hermes_bytecode_mismatch"

  /** "96,98" (the shell's manifest value) to [96, 98]. Anything that is not a positive integer is dropped. */
  fun parse(raw: String?): List<Int> = raw?.split(',')?.mapNotNull { it.trim().toIntOrNull() }?.filter { it > 0 } ?: emptyList()

  /** The release field: absent or null gives null (apply as before). Present but not a positive whole number throws, so a bad signed value is refused, never ignored. */
  fun releaseVersion(present: Boolean, raw: Any?): Int? {
    if (!present || raw == null) return null
    val v = (raw as? Number)?.takeIf { it.toDouble() == it.toLong().toDouble() }?.toLong()
    require(v != null && v in 1..Int.MAX_VALUE) { "pointer has an invalid hermes_bytecode_version" }
    return v.toInt()
  }

  /** True only when both sides say a version and they differ. A missing field on either side means apply, as before. */
  fun mismatch(shell: List<Int>, release: Int?): Boolean = release != null && shell.isNotEmpty() && release !in shell

  /** On a mismatch: records the event, blocks the release and returns the result map. Otherwise returns null and touches nothing. */
  fun refuse(shell: List<Int>, releaseHbc: Int?, release: Int, addEvent: (String) -> Unit, block: (Int) -> Unit): Map<String, Any?>? {
    if (!mismatch(shell, releaseHbc)) return null
    addEvent("$REASON:$release")
    block(release) // this release can never run on this shell; a newer release or a new shell is tried
    return mapOf("status" to "none", "release" to release, "reason" to REASON,
      "releaseHermesBytecodeVersion" to releaseHbc, "shellHermesBytecodeVersions" to shell)
  }
}
