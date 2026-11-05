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

  /** The load that handled an uncaught JS error (0 = none). React destroys the host after such an error, which pauses the
   *  activity. That pause must not count as a clean trip to the background. */
  @Volatile var crashedLoad = 0

  fun noteCrash(load: Int) { crashedLoad = load }

  /** What `markHealthy` does to the counts: the promoting boot (if any) is counted, and `load` is recorded as healthy.
   *  The module and the tests both call this, so they cannot drift apart. */
  fun onHealthy(c: BootCounts, load: Int, now: Long, promoted: Boolean) {
    if (promoted) countPromotedBoot(c, now)
    noteHealthy(load)
  }

  /** Clears the counts only if `load` is the one that reported healthy and has not hit an uncaught JS error. A reloaded
   *  load that has not called markHealthy yet keeps its count, so a crash before markHealthy still adds up.
   *  Returns whether it cleared. */
  fun markStableIfHealthy(c: BootCounts, load: Int): Boolean {
    if (healthyLoad == 0 || healthyLoad != load || crashedLoad == load) return false
    clear(c); return true
  }
}
