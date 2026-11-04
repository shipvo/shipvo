package dev.shipvo.runtime

/** Refuses a release built for a different Hermes bytecode version. Runs beside the signature and hash checks, never instead of them. */
internal object HermesCheck {
  const val REASON = "hermes_bytecode_mismatch"

  /** "96,98" (the shell's manifest value) to [96, 98]. Anything that is not a positive integer is dropped. */
  fun parse(raw: String?): List<Int> = raw?.split(',')?.mapNotNull { it.trim().toIntOrNull() }?.filter { it > 0 } ?: emptyList()

  /** True only when both sides say a version and they differ. A missing field on either side means apply, as before. */
  fun mismatch(shell: List<Int>, release: Int?): Boolean = release != null && shell.isNotEmpty() && release !in shell
}
