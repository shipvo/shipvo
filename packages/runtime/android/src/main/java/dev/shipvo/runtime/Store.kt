package dev.shipvo.runtime

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.SystemClock
import java.io.File
import kotlin.random.Random

/** Persistent runtime state. All bundle decisions go through here so the host handler and module agree. */
internal class Store(private val ctx: Context) : TrialCounts, RotationState {
  private val p: SharedPreferences = ctx.getSharedPreferences("shipvo.runtime", Context.MODE_PRIVATE)
  val dir: File get() = File(ctx.filesDir, "shipvo").apply { mkdirs() }

  val cohort: Int
    get() {
      if (!p.contains("cohort")) p.edit().putInt("cohort", Random.nextInt(0, 1000)).commit()
      return p.getInt("cohort", 0)
    }
  val band: String get() = cohort.let { if (it < 10) "b0" else if (it < 100) "b1" else "b2" }

  override var currentRelease: Int get() = p.getInt("current_release", 0); set(v) { p.edit().putInt("current_release", v).commit() }
  var currentPath: String? get() = p.getString("current_path", null); set(v) { p.edit().putString("current_path", v).commit() }
  var previousRelease: Int get() = p.getInt("previous_release", 0); set(v) { p.edit().putInt("previous_release", v).commit() }
  var previousPath: String? get() = p.getString("previous_path", null); set(v) { p.edit().putString("previous_path", v).commit() }
  override var pendingRelease: Int get() = p.getInt("pending_release", 0); set(v) { p.edit().putInt("pending_release", v).commit() }
  var pendingPath: String? get() = p.getString("pending_path", null); set(v) { p.edit().putString("pending_path", v).commit() }
  var pendingIssuedAt: String? get() = p.getString("pending_issued_at", null); set(v) { p.edit().putString("pending_issued_at", v).commit() }
  /** Highest release this device refused (crash-looped or rolled back). Only newer releases are fetched. */
  var blockedRelease: Int get() = p.getInt("blocked_release", 0); set(v) { p.edit().putInt("blocked_release", v).commit() }
  /** Shell binary the stored OTA bundles were downloaded under. */
  var binaryVersion: String? get() = p.getString("binary_version", null); set(v) { p.edit().putString("binary_version", v).commit() }
  fun block(release: Int) { if (release > blockedRelease) blockedRelease = release }

  val installedBinaryVersion: String
    get() = try {
      val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
      @Suppress("DEPRECATION") val code = if (android.os.Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()
      "${pi.versionName}/$code"
    } catch (_: Exception) { "unknown" }

  /** After a shell (APK) update, bundles built for the old native code must not run. */
  fun resetForNewShell() {
    dir.listFiles()?.forEach { it.delete() }
    p.edit().remove("current_release").remove("current_path").remove("previous_release").remove("previous_path")
      .remove("pending_release").remove("pending_path").remove("pending_issued_at").remove("trial_boots")
      .remove("unhealthy_boots").remove("first_unhealthy_at").remove("blocked_release")
      .remove("current_sha").remove("pending_sha")
      .putString("binary_version", installedBinaryVersion).commit()
  }

  /** sha256 of the current (last good) bundle file, cached so we don't hash 1.5 MB on every check. */
  var currentSha: String? get() = p.getString("current_sha", null); set(v) { p.edit().putString("current_sha", v).commit() }
  var pendingSha: String? get() = p.getString("pending_sha", null); set(v) { p.edit().putString("pending_sha", v).commit() }

  /** The bundle embedded in the APK, used as the first patch baseline. */
  fun embeddedBundle(): ByteArray? = try { ctx.assets.open("index.android.bundle").use { it.readBytes() } } catch (_: Exception) { null }
  fun embeddedSha(): String? {
    val key = "embedded_sha:" + installedBinaryVersion
    p.getString(key, null)?.let { return it }
    val sha = embeddedBundle()?.let { Verify.sha256Hex(it) } ?: return null
    p.edit().putString(key, sha).commit(); return sha
  }

  override var trialBoots: Int get() = p.getInt("trial_boots", 0); set(v) { p.edit().putInt("trial_boots", v).commit() }
  override var unhealthyBoots: Int get() = p.getInt("unhealthy_boots", 0); set(v) { p.edit().putInt("unhealthy_boots", v).commit() }
  override var firstUnhealthyAt: Long get() = p.getLong("first_unhealthy_at", 0); set(v) { p.edit().putLong("first_unhealthy_at", v).commit() }

  override val storedReleaseKey: String? get() = p.getString("rotation.releaseKey", null)
  override val storedSequence: Long get() = try { p.getLong("rotation.sequence", 0) } catch (_: ClassCastException) { 0 }
  override val storedPinnedKey: String? get() = p.getString("rotation.pinnedKey", null)
  override val storedPending: String? get() = p.getString("rotation.pending", null)
  /** One commit() writes key, sequence, pinned key and pending list together. */
  override fun commit(releaseKey: String?, sequence: Long, pinnedKey: String?, pending: String?) {
    p.edit().apply {
      if (releaseKey != null) putString("rotation.releaseKey", releaseKey) else remove("rotation.releaseKey")
      putLong("rotation.sequence", sequence)
      if (pinnedKey != null) putString("rotation.pinnedKey", pinnedKey) else remove("rotation.pinnedKey")
      if (pending != null) putString("rotation.pending", pending) else remove("rotation.pending")
    }.commit()
  }
  /** Key rotation for this shell: root-signed statements can replace the release key (docs/design/key-rotation.md). */
  fun rotation(clock: Clock = Clock.Wall) = Rotation(this, appId, publicKey, rootKey, minSequence, clock)

  fun addEvent(e: String) {
    val list = p.getString("events", "")!!.split('\n').filter { it.isNotBlank() }.takeLast(49) + e
    p.edit().putString("events", list.joinToString("\n")).commit()
  }
  /** Events queued and not yet consumed, oldest first. */
  fun pendingEvents(): List<String> = p.getString("events", "")!!.split('\n').filter { it.isNotBlank() }
  fun consumeEvents(): List<String> {
    val list = p.getString("events", "")!!.split('\n').filter { it.isNotBlank() }
    p.edit().remove("events").commit(); return list
  }

  private fun meta(key: String): String? = try {
    val ai = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
    ai.metaData?.getString(key)
  } catch (_: Exception) { null }
  /** Like [meta], but also accepts numbers: a manifest can store a single version such as 96 as an integer. */
  private fun metaAny(key: String): String? = try {
    val ai = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
    ai.metaData?.get(key)?.toString()
  } catch (_: Exception) { null }
  val baseUrl: String get() = (meta("dev.shipvo.BASE_URL") ?: "").trimEnd('/')
  val publicKey: String get() = meta("dev.shipvo.PUBLIC_KEY") ?: ""
  /** Root public key that signs rotation statements. Empty when the shell does not declare one: rotation is then off. */
  val rootKey: String get() = meta("dev.shipvo.ROOT_KEY") ?: ""
  /** Highest rotation sequence that existed when this shell was built. */
  val minSequence: Long get() = metaAny("dev.shipvo.MIN_SEQUENCE")?.toLongOrNull() ?: 0
  val appId: String get() = meta("dev.shipvo.APP_ID") ?: ""
  /** Hermes bytecode versions this shell runs, e.g. "96,98". Null when the shell does not declare them. */
  val hermesBytecodeVersions: String? get() = metaAny("dev.shipvo.HERMES_BYTECODE_VERSIONS")?.takeIf { it.isNotBlank() }
  /** Hermes engine build id this shell runs, e.g. "250829098.0.10". Null when the shell does not declare it. */
  val hermesEngine: String? get() = metaAny("dev.shipvo.HERMES_ENGINE")?.takeIf { it.isNotBlank() }
  /** Native modules in this shell, e.g. "react-native-mmkv@3.1.0,@scope/pkg@1.0.0". Null when not declared. */
  val nativeModules: String? get() = metaAny("dev.shipvo.NATIVE_MODULES")?.takeIf { it.isNotBlank() }
  val shellMajor: Int get() = (meta("dev.shipvo.SHELL_MAJOR") ?: "1").toIntOrNull() ?: 1

  companion object {
    /** Which release the JS that is running right now came from (set at bundle-selection time). */
    @Volatile var runningRelease: Int = 0
    @Volatile var bundleSelectedAt: Long = 0
    /** How many times a bundle was selected in this process: 1 = cold start, more = in-process reload. */
    @Volatile var loadsInProcess: Int = 0
    /** Counts loads chosen without UI. */
    internal val gate = LoadGate()
  }

  fun now() = SystemClock.elapsedRealtime()
}
