package dev.purenative.runtime

import android.content.Context
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.io.File

/**
 * Chooses the JS bundle at boot. Order: a staged (pending) release on trial, else the last good release,
 * else the bundle embedded in the APK. A pending release that fails to reach markHealthy within 3 boots is
 * discarded; a current release that boots unhealthy 3 times inside 60 s falls back to the previous one.
 */
class PureNativeHostHandler(private val ctx: Context) : ReactNativeHostHandler {
  override fun getJSBundleFile(useDeveloperSupport: Boolean): String? {
    if (useDeveloperSupport) return null
    synchronized(LOCK) {
      val s = Store(ctx)
      Store.bundleSelectedAt = s.now()

      val pending = s.pendingPath
      if (pending != null) {
        if (s.trialBoots >= MAX_BOOTS || !File(pending).exists()) {
          s.addEvent("crash_loop_revert:${s.pendingRelease}")
          File(pending).delete()
          s.pendingPath = null; s.pendingRelease = 0; s.trialBoots = 0
        } else {
          s.trialBoots = s.trialBoots + 1
          Store.runningRelease = s.pendingRelease
          return pending
        }
      }

      val current = s.currentPath
      if (current != null && File(current).exists()) {
        val now = s.now()
        if (now - s.firstUnhealthyAt > WINDOW_MS) { s.firstUnhealthyAt = now; s.unhealthyBoots = 0 }
        s.unhealthyBoots = s.unhealthyBoots + 1
        if (s.unhealthyBoots > MAX_BOOTS) {
          s.addEvent("crash_loop_revert:${s.currentRelease}")
          revertToPrevious(s)
          return selectCurrentOrEmbedded(s)
        }
        Store.runningRelease = s.currentRelease
        return current
      }
      Store.runningRelease = 0
      return null // embedded bundle in the APK
    }
  }

  private fun selectCurrentOrEmbedded(s: Store): String? {
    val c = s.currentPath
    return if (c != null && File(c).exists()) { Store.runningRelease = s.currentRelease; c } else { Store.runningRelease = 0; null }
  }

  companion object {
    const val MAX_BOOTS = 3
    const val WINDOW_MS = 60_000L
    val LOCK = Any()

    fun revertToPrevious(s: Store) {
      s.currentPath?.let { if (it != s.previousPath) File(it).delete() }
      s.currentPath = s.previousPath; s.currentRelease = s.previousRelease
      s.previousPath = null; s.previousRelease = 0
      s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
    }
  }
}
