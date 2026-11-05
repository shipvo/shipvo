package dev.shipvo.runtime

/** Refuses a release built for a different Hermes bytecode version than the shell runs. Runs in addition to the
 *  signature and hash checks, never instead of them. Free of Android types so a plain JVM test can run it. */
internal object HermesGuard {
  const val REASON = "hermes_bytecode_mismatch"
  private val MAGIC = byteArrayOf(0xc6.toByte(), 0x1f, 0xbc.toByte(), 0x03, 0xc1.toByte(), 0x03, 0x19, 0x1f)

  /** The bytecode version in a bundle header (8-byte magic, then a 32-bit little-endian version), or null for plain JS. */
  fun versionOf(head: ByteArray): Int? {
    if (head.size < 12 || (0 until 8).any { head[it] != MAGIC[it] }) return null
    val v = (0 until 4).fold(0L) { acc, i -> acc or ((head[8 + i].toLong() and 0xff) shl (8 * i)) }
    return if (v in 1..Int.MAX_VALUE) v.toInt() else null
  }

  /** The event to log when the release must be refused, or null when it may be staged.
   *  A missing field on either side means "unknown", so the release is applied as before. */
  fun mismatchEvent(release: Int, releaseVersion: Int?, shellVersion: Int?): String? =
    if (releaseVersion == null || shellVersion == null || releaseVersion == shellVersion) null
    else "$REASON:$release:release=$releaseVersion:shell=$shellVersion"
}
