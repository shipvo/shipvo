package dev.shipvo.runtime

/** Source of wall-clock time for rotation checks. Rotation code never reads the system time directly. */
internal fun interface Clock {
  /** Milliseconds since the Unix epoch. */
  fun now(): Long

  object Wall : Clock { override fun now() = System.currentTimeMillis() }
}
