package dev.purenative.runtime

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

class PureNativeRuntimeModule : Module() {
  private val ctx: Context get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PureNativeRuntime")

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
      synchronized(PureNativeHostHandler.LOCK) {
        if (s.pendingRelease != 0 && Store.runningRelease == s.pendingRelease) {
          s.previousPath?.let { old -> if (old != s.currentPath) File(old).delete() }
          s.previousRelease = s.currentRelease; s.previousPath = s.currentPath
          s.currentRelease = s.pendingRelease; s.currentPath = s.pendingPath; s.currentSha = s.pendingSha
          s.pendingRelease = 0; s.pendingPath = null; s.trialBoots = 0
          s.addEvent("applied:${s.currentRelease}")
          promoted = true
        }
        s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
      }
      val kind = if (Store.loadsInProcess <= 1) "cold" else "reload"
      mapOf("release" to Store.runningRelease, "coldStartMs" to coldStart, "sinceLoadMs" to sinceLoad, "promoted" to promoted, "kind" to kind)
    }

    Function("consumeEvents") { Store(ctx).consumeEvents() }

    Function("rollback") {
      val s = Store(ctx)
      synchronized(PureNativeHostHandler.LOCK) {
        s.pendingPath?.let { File(it).delete() }
        s.pendingPath = null; s.pendingRelease = 0; s.trialBoots = 0
        s.addEvent("rolled_back:${s.currentRelease}")
        s.block(s.currentRelease)
        PureNativeHostHandler.revertToPrevious(s)
      }
      reloadHost()
    }

    Function("reload") { reloadHost() }
  }

  private fun reloadHost() {
    Handler(Looper.getMainLooper()).post {
      (ctx as? ReactApplication)?.reactHost?.reload("purenative-update")
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
    val known = maxOf(s.currentRelease, s.pendingRelease, s.blockedRelease)
    val conn = http("${s.baseUrl}/p/${s.appId}/${s.shellMajor}/${s.band}.json", if (known > 0) "\"$known\"" else null)
    val code = conn.responseCode
    if (code == 304 || code == 404) { conn.disconnect(); return mapOf("status" to "none") }
    require(code == 200) { "pointer HTTP $code" }
    val envelope = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
    conn.disconnect()

    val t0 = SystemClock.elapsedRealtime()
    val bodyStr = envelope.getString("body")
    require(Verify.ed25519(bodyStr.toByteArray(Charsets.UTF_8), envelope.getString("signature"), s.publicKey)) { "pointer signature invalid" }
    val body = JSONObject(bodyStr)
    require(body.getString("app_id") == s.appId && body.getInt("shell_major") == s.shellMajor) { "pointer for another app/shell" }
    val release = body.getInt("release")
    if (release <= known) return mapOf("status" to "none")
    val shellVersion = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0.0.0"
    require(!Verify.semverLess(shellVersion, body.getString("min_shell_version"))) { "shell too old for release $release" }
    val verifyPointerMs = SystemClock.elapsedRealtime() - t0

    val core = body.getJSONObject("core")
    val wantSha = core.getString("sha256"); val wantSize = core.getLong("size")
    val tmp = File(s.dir, "dl-$release.tmp")
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
        if (match != null) {
          val patchBytes = http(resolve(s, match.getString("url")), null).let { c ->
            require(c.responseCode == 200) { "patch HTTP ${c.responseCode}" }
            c.inputStream.use { it.readBytes() }.also { c.disconnect() }
          }
          require(patchBytes.size.toLong() == match.getLong("size") && Verify.sha256Hex(patchBytes) == match.getString("sha256")) { "patch hash mismatch" }
          val base = baseFile?.readBytes() ?: s.embeddedBundle() ?: error("no base bundle")
          val out = Patch.apply(base, patchBytes)
          require(out.size.toLong() == wantSize && Verify.sha256Hex(out) == wantSha) { "patched bundle hash mismatch" }
          tmp.writeBytes(out)
          via = "patch"; bytesDownloaded = patchBytes.size.toLong()
        }
      } catch (e: Exception) { patchError = e.message; tmp.delete() }
    }

    // 2. Fall back to the full bundle.
    if (via == "full") {
      val dl = http(resolve(s, core.getString("url")), null)
      require(dl.responseCode == 200) { "bundle HTTP ${dl.responseCode}" }
      dl.inputStream.use { ins -> tmp.outputStream().use { ins.copyTo(it, 64 * 1024) } }
      dl.disconnect()
      bytesDownloaded = tmp.length()
    }
    val downloadMs = SystemClock.elapsedRealtime() - d0

    val v0 = SystemClock.elapsedRealtime()
    val ok = tmp.length() == wantSize && Verify.sha256Hex(tmp) == wantSha
    if (!ok) { tmp.delete(); s.addEvent("verify_failed:$release"); throw IllegalStateException("bundle hash/size mismatch") }
    val verifyMs = SystemClock.elapsedRealtime() - v0 + verifyPointerMs

    val dest = File(s.dir, "r$release.hbc")
    require(tmp.renameTo(dest)) { "could not stage bundle" }
    synchronized(PureNativeHostHandler.LOCK) {
      s.pendingPath?.let { if (it != dest.path) File(it).delete() }
      s.pendingPath = dest.path; s.pendingRelease = release; s.trialBoots = 0; s.pendingSha = wantSha
      if (s.binaryVersion == null) s.binaryVersion = s.installedBinaryVersion
      s.pendingIssuedAt = body.optString("issued_at")
    }
    return mapOf("status" to "staged", "release" to release, "bytes" to bytesDownloaded, "via" to via, "bundleBytes" to dest.length(),
      "patchError" to patchError,
      "downloadMs" to downloadMs, "verifyMs" to verifyMs, "issuedAt" to body.optString("issued_at"))
  }
}
