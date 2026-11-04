package dev.shipvo.runtime

/** The unhealthy-boot counters. `Store` implements it; tests use an in-memory copy. */
internal interface BootCounts {
  var unhealthyBoots: Int
  var firstUnhealthyAt: Long
}

/** The crash-loop counting rules, free of Android types so a plain JVM test can run them. */
internal object BootRules {
  /** Counts one boot of the current release. Returns true when the release must be reverted. */
  fun countBoot(c: BootCounts, now: Long, maxBoots: Int, windowMs: Long): Boolean {
    if (now - c.firstUnhealthyAt > windowMs) { c.firstUnhealthyAt = now; c.unhealthyBoots = 0 }
    c.unhealthyBoots = c.unhealthyBoots + 1
    return c.unhealthyBoots > maxBoots
  }

  /** The promoting boot was a trial boot and was not counted. Count it now, until the app proves stable. */
  fun countPromotedBoot(c: BootCounts, now: Long) { c.unhealthyBoots = 1; c.firstUnhealthyAt = now }

  fun clear(c: BootCounts) { c.unhealthyBoots = 0; c.firstUnhealthyAt = 0 }

  /** The load that last reported healthy (0 = none). */
  @Volatile var healthyLoad = 0

  fun noteHealthy(load: Int) { healthyLoad = load }

  /** Clears the counts only if `load` is the one that reported healthy. A reloaded load that has not called
   *  markHealthy yet keeps its count, so a crash before markHealthy still adds up. Returns whether it cleared. */
  fun markStableIfHealthy(c: BootCounts, load: Int): Boolean {
    if (healthyLoad == 0 || healthyLoad != load) return false
    clear(c); return true
  }
}
