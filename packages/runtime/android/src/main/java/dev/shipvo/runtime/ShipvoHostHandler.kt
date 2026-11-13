package dev.shipvo.runtime

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.io.File

/**
 * Chooses the JS bundle at boot. Order: a staged (pending) release on trial, else the last good release,
 * else the bundle embedded in the APK. A pending release that fails to reach markHealthy within 3 boots is
 * discarded; a current release that boots unhealthy 3 times inside 60 s falls back to the previous one.
 */
class ShipvoHostHandler(private val ctx: Context) : ReactNativeHostHandler {
  override fun getJSBundleFile(useDeveloperSupport: Boolean): String? {
    if (useDeveloperSupport) return null
    synchronized(LOCK) {
      watchActivities()
      val s = Store(ctx)
      val visible = canShowUi(ctx)
      Store.bundleSelectedAt = s.now()
      Store.loadsInProcess = Store.loadsInProcess + 1

      val installed = s.installedBinaryVersion
      if (s.binaryVersion != installed) {
        val hadBundles = s.currentPath != null || s.pendingPath != null
        s.resetForNewShell()
        if (hadBundles) s.addEvent("shell_changed:0")
      }

      val pending = s.pendingPath
      if (pending != null) {
        if (s.trialBoots >= MAX_BOOTS || !File(pending).exists()) {
          s.addEvent("crash_loop_revert:${s.pendingRelease}:${if (Store.loadsInProcess <= 1) "cold" else "reload"}")
          s.block(s.pendingRelease)
          File(pending).delete()
          s.pendingPath = null; s.pendingRelease = 0; s.trialBoots = 0; StateVersion.dropPending(s)
        } else {
          Store.gate.selectTrial(s, visible)
          Store.runningRelease = s.pendingRelease
          return pending
        }
      }

      val current = s.currentPath
      if (current != null && File(current).exists()) {
        if (Store.gate.selectCurrent(s, visible, s.now(), MAX_BOOTS, WINDOW_MS)) {
          s.addEvent("crash_loop_revert:${s.currentRelease}:${if (Store.loadsInProcess <= 1) "cold" else "reload"}")
          s.block(s.currentRelease)
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

  private var watching = false

  /** Counts a deferred load as soon as the first activity starts (the settle trigger for true headless loads). */
  private fun watchActivities() {
    if (watching) return
    val app = ctx.applicationContext as? Application ?: return
    watching = true
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        synchronized(LOCK) { Store.gate.uiStarted = true; settleDeferred(Store(ctx), visible = true, crashed = false) }
      }
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { Store.gate.uiStarted = true }
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }

  private fun selectCurrentOrEmbedded(s: Store): String? {
    val c = s.currentPath
    return if (c != null && File(c).exists()) { Store.runningRelease = s.currentRelease; c } else { Store.runningRelease = 0; null }
  }

  companion object {
    const val MAX_BOOTS = 3
    const val WINDOW_MS = 60_000L
    /** A release is stable once its process stayed in the foreground this long after markHealthy. iOS uses the same value. */
    const val STABILITY_MS = 30_000L
    val LOCK = Any()

    /** Test seam: when set, replaces the process-state check in [canShowUi] (an instrumentation process reports foreground). */
    @Volatile internal var processVisibleOverride: Boolean? = null

    /** True when an activity exists or the process is in the foreground or visible now. The process state is already right
     *  while the first activity is in `onCreate`, before `onActivityStarted`. Importance values: 100 foreground, 125
     *  foreground service (no screen, excluded), 130 top sleeping, 200 visible, 300 service, 400 cached. */
    internal fun canShowUi(ctx: Context): Boolean {
      if (Store.gate.uiStarted) return true
      processVisibleOverride?.let { return it }
      val info = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(info)
      return BootRules.visibleImportance(info.importance)
    }

    /** Counts the load that was chosen without UI, if one is waiting. Call inside [LOCK]. The release keeps running
     *  the same bundle; a trial release that now reaches its limit is reverted at the next selection. */
    internal fun settleDeferred(s: Store, visible: Boolean, crashed: Boolean) =
      Store.gate.settle(s, visible, crashed, s.now(), MAX_BOOTS, WINDOW_MS)

    internal fun revertToPrevious(s: Store) {
      s.currentPath?.let { if (it != s.previousPath) File(it).delete() }
      StateVersion.revert(s)
      s.currentPath = s.previousPath; s.currentRelease = s.previousRelease; s.currentSha = null
      s.previousPath = null; s.previousRelease = 0
      BootRules.clear(s)
    }
  }
}
