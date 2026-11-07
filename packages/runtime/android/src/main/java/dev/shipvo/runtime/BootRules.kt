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

  /** Whether a downloaded release may still be staged. Two overlapping checks can both pass the early "newer than known"
   *  test. The second one must not stage the same release again: that would reset `trialBoots` and give a crashing release
   *  more than MAX_BOOTS runs. Call this inside the handler lock, right before staging. */
  fun mayStage(release: Int, current: Int, pending: Int, blocked: Int): Boolean = release > maxOf(current, pending, blocked)

  /** Whether a load counts as a boot the moment its bundle is chosen. Only a load that can show a screen does. A silent push
   *  or background task can start the process with no UI; counting those would use up a release's trial boots. */
  fun countsAtSelection(visible: Boolean): Boolean = visible

  /** Whether a load that was not counted at selection counts now: once the process can show UI, or after an uncaught JS
   *  error in that load (a crashing headless load must still count against the release). Counts at most once. */
  fun countsLater(deferred: Boolean, visible: Boolean, crashed: Boolean): Boolean = deferred && (visible || crashed)

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
