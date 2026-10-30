package dev.purenative.runtime

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.SystemClock
import java.io.File
import kotlin.random.Random

/** Persistent runtime state. All bundle decisions go through here so the host handler and module agree. */
internal class Store(private val ctx: Context) {
  private val p: SharedPreferences = ctx.getSharedPreferences("purenative.runtime", Context.MODE_PRIVATE)
  val dir: File get() = File(ctx.filesDir, "purenative").apply { mkdirs() }

  val cohort: Int
    get() {
      if (!p.contains("cohort")) p.edit().putInt("cohort", Random.nextInt(0, 1000)).commit()
      return p.getInt("cohort", 0)
    }
  val band: String get() = cohort.let { if (it < 10) "b0" else if (it < 100) "b1" else "b2" }

  var currentRelease: Int get() = p.getInt("current_release", 0); set(v) { p.edit().putInt("current_release", v).commit() }
  var currentPath: String? get() = p.getString("current_path", null); set(v) { p.edit().putString("current_path", v).commit() }
  var previousRelease: Int get() = p.getInt("previous_release", 0); set(v) { p.edit().putInt("previous_release", v).commit() }
  var previousPath: String? get() = p.getString("previous_path", null); set(v) { p.edit().putString("previous_path", v).commit() }
  var pendingRelease: Int get() = p.getInt("pending_release", 0); set(v) { p.edit().putInt("pending_release", v).commit() }
  var pendingPath: String? get() = p.getString("pending_path", null); set(v) { p.edit().putString("pending_path", v).commit() }
  var pendingIssuedAt: String? get() = p.getString("pending_issued_at", null); set(v) { p.edit().putString("pending_issued_at", v).commit() }
  var trialBoots: Int get() = p.getInt("trial_boots", 0); set(v) { p.edit().putInt("trial_boots", v).commit() }
  var unhealthyBoots: Int get() = p.getInt("unhealthy_boots", 0); set(v) { p.edit().putInt("unhealthy_boots", v).commit() }
  var firstUnhealthyAt: Long get() = p.getLong("first_unhealthy_at", 0); set(v) { p.edit().putLong("first_unhealthy_at", v).commit() }

  fun addEvent(e: String) {
    val list = p.getString("events", "")!!.split('\n').filter { it.isNotBlank() }.takeLast(49) + e
    p.edit().putString("events", list.joinToString("\n")).commit()
  }
  fun consumeEvents(): List<String> {
    val list = p.getString("events", "")!!.split('\n').filter { it.isNotBlank() }
    p.edit().remove("events").commit(); return list
  }

  private fun meta(key: String): String? = try {
    val ai = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
    ai.metaData?.getString(key)
  } catch (_: Exception) { null }
  val baseUrl: String get() = (meta("dev.purenative.BASE_URL") ?: "").trimEnd('/')
  val publicKey: String get() = meta("dev.purenative.PUBLIC_KEY") ?: ""
  val appId: String get() = meta("dev.purenative.APP_ID") ?: ""
  val shellMajor: Int get() = (meta("dev.purenative.SHELL_MAJOR") ?: "1").toIntOrNull() ?: 1

  companion object {
    /** Which release the JS that is running right now came from (set at bundle-selection time). */
    @Volatile var runningRelease: Int = 0
    @Volatile var bundleSelectedAt: Long = 0
  }

  fun now() = SystemClock.elapsedRealtime()
}
