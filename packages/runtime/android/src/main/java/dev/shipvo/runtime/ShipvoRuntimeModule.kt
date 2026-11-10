package dev.shipvo.runtime

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import com.facebook.react.ReactApplication
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class ShipvoRuntimeModule : Module() {
  private val ctx: Context get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ShipvoRuntime")

    Function("getState") {
      val s = Store(ctx)
      mapOf(
        "cohort" to s.cohort, "band" to s.band,
        "runningRelease" to Store.runningRelease, "currentRelease" to s.currentRelease,
        "pendingRelease" to s.pendingRelease, "previousRelease" to s.previousRelease,
        "blockedRelease" to s.blockedRelease, "shellVersion" to s.installedBinaryVersion,
        "baseUrl" to s.baseUrl, "appId" to s.appId, "shellMajor" to s.shellMajor
      )
    }

    AsyncFunction("getAppliedStateVersion") { StateVersion.applied(Store(ctx), Store.runningRelease) }

    AsyncFunction("checkForUpdate") { apply: Boolean ->
      val r = try { check() } catch (e: Exception) { mapOf("status" to "error", "error" to (e.message ?: e.javaClass.simpleName)) }
      if (apply && r["status"] == "staged") reloadHost()
      r
    }

    Function("markHealthy") {
      val s = Store(ctx)
      val now = SystemClock.elapsedRealtime()
      val coldStart = now - Process.getStartElapsedRealtime()
      val sinceLoad = if (Store.bundleSelectedAt > 0) now - Store.bundleSelectedAt else -1
      var promoted = false
      // markHealthy can be called from a headless task or at module init. Only a load that can show a screen is healthy.
      val visible = ShipvoHostHandler.canShowUi(ctx)
      synchronized(ShipvoHostHandler.LOCK) {
        if (!visible) return@Function mapOf("release" to Store.runningRelease, "coldStartMs" to coldStart, "sinceLoadMs" to sinceLoad,
          "promoted" to false, "kind" to if (Store.loadsInProcess <= 1) "cold" else "reload")
        ShipvoHostHandler.settleDeferred(s, visible = true, crashed = false) // count the load first
        if (s.pendingRelease != 0 && Store.runningRelease == s.pendingRelease) {
          s.previousPath?.let { old -> if (old != s.currentPath) File(old).delete() }
          StateVersion.promote(s)
          s.previousRelease = s.currentRelease; s.previousPath = s.currentPath
          s.currentRelease = s.pendingRelease; s.currentPath = s.pendingPath; s.currentSha = s.pendingSha
          s.pendingRelease = 0; s.pendingPath = null; s.trialBoots = 0
          s.addEvent("applied:${s.currentRelease}")
          promoted = true
        }
        // The promoting boot was a trial boot and was not counted, so onHealthy counts it until the stability window ends.
        // The counter is not cleared here: markStableIfHealthy does that after the window.
        BootRules.onHealthy(s, Store.loadsInProcess, s.now(), promoted)
      }
      scheduleStable()
      val kind = if (Store.loadsInProcess <= 1) "cold" else "reload"
      mapOf("release" to Store.runningRelease, "coldStartMs" to coldStart, "sinceLoadMs" to sinceLoad, "promoted" to promoted, "kind" to kind)
    }

    // Called by the JS error handler before React destroys the host, so the pause that follows is not read as "stable".
    Function("noteCrash") {
      synchronized(ShipvoHostHandler.LOCK) {
        BootRules.noteCrash(Store.loadsInProcess)
        ShipvoHostHandler.settleDeferred(Store(ctx), visible = false, crashed = true) // a headless load that throws still counts
      }
    }

    OnActivityEntersBackground { stableNow() }

    Function("consumeEvents") { Store(ctx).consumeEvents() }

    Function("rollback") {
      val s = Store(ctx)
      synchronized(ShipvoHostHandler.LOCK) {
        s.pendingPath?.let { File(it).delete() }
        s.pendingPath = null; s.pendingRelease = 0; s.trialBoots = 0; StateVersion.dropPending(s)
        s.addEvent("rolled_back:${s.currentRelease}")
        s.block(s.currentRelease)
        ShipvoHostHandler.revertToPrevious(s)
      }
      reloadHost()
    }

    Function("reload") { reloadHost() }
  }

  /** Clears the unhealthy-boot count once the app stayed up for the stability window.
   *  The task is dropped after it runs and on reload, and `markStableIfHealthy` checks the load number. */
  private fun scheduleStable() {
    val app = ctx
    synchronized(ShipvoHostHandler.LOCK) {
      stableTask?.let { handler.removeCallbacks(it) }
      val load = Store.loadsInProcess
      val task = Runnable {
        synchronized(ShipvoHostHandler.LOCK) { BootRules.markStableIfHealthy(Store(app), load); stableTask = null }
      }
      stableTask = task
      handler.postDelayed(task, ShipvoHostHandler.STABILITY_MS)
    }
  }

  /** Going to background cleanly counts as stable, but only if this load reported healthy (see BootRules). */
  private fun stableNow() {
    synchronized(ShipvoHostHandler.LOCK) {
      if (BootRules.markStableIfHealthy(Store(ctx), Store.loadsInProcess)) {
        stableTask?.let { handler.removeCallbacks(it) }; stableTask = null
      }
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var stableTask: Runnable? = null

  private fun reloadHost() {
    synchronized(ShipvoHostHandler.LOCK) { stableTask?.let { handler.removeCallbacks(it) }; stableTask = null }
    Handler(Looper.getMainLooper()).post {
      (ctx as? ReactApplication)?.reactHost?.reload("shipvo-update")
    }
  }

  private fun http(url: String, etag: String?): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 10_000; readTimeout = 30_000; useCaches = false
      etag?.let { setRequestProperty("If-None-Match", it) }
    }

  private fun resolve(s: Store, url: String) = if (url.startsWith("http")) url else "${s.baseUrl}/${url.trimStart('/')}"

  private fun check(): Map<String, Any?> {
    val s = Store(ctx)
    require(s.baseUrl.isNotEmpty() && s.publicKey.isNotEmpty() && s.appId.isNotEmpty()) { "runtime not configured" }
    val rotation = s.rotation()
    rotation.applyDue() // due root-signed key rotations apply before any pointer is checked
    val known = maxOf(s.currentRelease, s.pendingRelease, s.blockedRelease)
    val conn = http(PointerQuery.url(s.baseUrl, s.appId, s.shellMajor, s.band, s.hermesBytecodeVersions, s.nativeModules, s.hermesEngine), if (known > 0) "\"$known\"" else null)
    val code = conn.responseCode
    if (code == 404) {
      // The shell cannot run the newest release. Keep the current one and say why.
      val reason = PointerQuery.mismatchReason(try { conn.errorStream?.bufferedReader()?.use { it.readText() } } catch (_: Exception) { null })
      conn.disconnect()
      if (reason == null) return mapOf("status" to "none")
      PointerQuery.rejectionEvent(s.pendingEvents(), reason)?.let { s.addEvent(it) }
      return mapOf("status" to "none", "reason" to reason)
    }
    if (code == 304) { conn.disconnect(); return mapOf("status" to "none") }
    require(code == 200) { "pointer HTTP $code" }
    val envelope = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
    conn.disconnect()

    // Root-signed rotation statements ride along with the pointer; handle them before the pointer is verified.
    envelope.optJSONArray("rotations")?.let { rotation.handle(it) }
    val t0 = SystemClock.elapsedRealtime()
    val bodyStr = envelope.getString("body")
    require(Verify.ed25519(bodyStr.toByteArray(Charsets.UTF_8), envelope.getString("signature"), rotation.currentReleaseKey())) { "pointer signature invalid" }
    val body = JSONObject(bodyStr)
    require(PointerQuery.isForAndroid(if (body.has("platform") && !body.isNull("platform")) body.getString("platform") else null)) { "pointer is not for Android" }
    require(body.getString("app_id") == s.appId && body.getInt("shell_major") == s.shellMajor) { "pointer for another app/shell" }
    val release = body.getInt("release")
    if (release <= known) return mapOf("status" to "none")
    val shellVersion = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0.0.0"
    require(!Verify.semverLess(shellVersion, body.getString("min_shell_version"))) { "shell too old for release $release" }
    val verifyPointerMs = SystemClock.elapsedRealtime() - t0
    // Beside the signature checks, not inside them: refuse a bundle built for another Hermes bytecode version.
    HermesGuard.decide(release, body.opt("hermes_bytecode_version")) { try { ctx.assets.open("index.android.bundle") } catch (_: java.io.IOException) { null } }?.let { ev ->
      s.addEvent(ev); s.block(release)
      return mapOf("status" to "none", "reason" to HermesGuard.REASON)
    }

    val core = body.getJSONObject("core")
    val wantSha = core.getString("sha256"); val wantSize = core.getLong("size")
    val tmp = File(s.dir, "dl-$release.tmp")
    val part = ResumableDownload.partialFile(s.dir, wantSha)
    // The release changed: partial files for other hashes can never complete.
    s.dir.listFiles()?.forEach { if (it.extension == "part" && it.name != part.name) it.delete() }
    val d0 = SystemClock.elapsedRealtime()
    var via = "full"; var bytesDownloaded = 0L; var patchError: String? = null

    // 1. Try a patch against the bundle this device already has (last good release, else the APK's own bundle).
    val patches = core.optJSONArray("patches")
    if (patches != null && patches.length() > 0) {
      try {
        val baseFile = s.currentPath?.let { File(it) }?.takeIf { it.exists() }
        val baseSha = if (baseFile != null) (s.currentSha ?: Verify.sha256Hex(baseFile).also { s.currentSha = it }) else s.embeddedSha()
        var match: JSONObject? = null
        for (i in 0 until patches.length()) { val p = patches.getJSONObject(i); if (p.getString("from_sha256") == baseSha) { match = p; break } }
        val chosen = match
        if (chosen != null) {
          val baseSize = baseFile?.length() ?: s.embeddedSize()
          // Over the memory budget: skip the patch and take the resumable, streamed full download.
          val outcome = PatchStep.run(baseSize, chosen.getLong("size"), wantSize) {
            val patchBytes = http(resolve(s, chosen.getString("url")), null).let { c ->
              require(c.responseCode == 200) { "patch HTTP ${c.responseCode}" }
              c.inputStream.use { it.readBytes() }.also { c.disconnect() }
            }
            require(patchBytes.size.toLong() == chosen.getLong("size") && Verify.sha256Hex(patchBytes) == chosen.getString("sha256")) { "patch hash mismatch" }
            val base = baseFile?.readBytes() ?: s.embeddedBundle() ?: error("no base bundle")
            val out = Patch.apply(base, patchBytes)
            require(out.size.toLong() == wantSize && Verify.sha256Hex(out) == wantSha) { "patched bundle hash mismatch" }
            out
          }
          val decision = PatchStep.decide(outcome, chosen.getLong("size"))
          via = decision.via; patchError = decision.patchError; bytesDownloaded = decision.bytesDownloaded
          if (outcome.bytes != null) tmp.writeBytes(outcome.bytes) else tmp.delete()
        }
      } catch (e: Exception) { patchError = e.message; tmp.delete() }
    }

    // 2. Fall back to the full bundle.
    if (via == "full") {
      val resumedFrom = ResumableDownload.fetch(resolve(s, core.getString("url")), part, wantSize)
      tmp.delete()
      require(part.renameTo(tmp)) { "could not move downloaded bundle" }
      bytesDownloaded = tmp.length() - resumedFrom
    }
    val downloadMs = SystemClock.elapsedRealtime() - d0

    val v0 = SystemClock.elapsedRealtime()
    val ok = tmp.length() == wantSize && Verify.sha256Hex(tmp) == wantSha
    if (!ok) { tmp.delete(); part.delete(); s.addEvent("verify_failed:$release"); throw IllegalStateException("bundle hash/size mismatch") }
    val verifyMs = SystemClock.elapsedRealtime() - v0 + verifyPointerMs

    val dest = File(s.dir, "r$release.hbc")
    require(tmp.renameTo(dest)) { "could not stage bundle" }
    synchronized(ShipvoHostHandler.LOCK) {
      if (!BootRules.mayStage(release, s.currentRelease, s.pendingRelease, s.blockedRelease)) return mapOf("status" to "none")
      s.pendingPath?.let { if (it != dest.path) File(it).delete() }
      s.pendingPath = dest.path; s.pendingRelease = release; s.trialBoots = 0; s.pendingSha = wantSha
      StateVersion.stage(s, body.opt("state_version"))
      if (s.binaryVersion == null) s.binaryVersion = s.installedBinaryVersion
      s.pendingIssuedAt = body.optString("issued_at")
    }
    return mapOf("status" to "staged", "release" to release, "bytes" to bytesDownloaded, "via" to via, "bundleBytes" to dest.length(),
      "patchError" to patchError,
      "downloadMs" to downloadMs, "verifyMs" to verifyMs, "issuedAt" to body.optString("issued_at"))
  }
}
