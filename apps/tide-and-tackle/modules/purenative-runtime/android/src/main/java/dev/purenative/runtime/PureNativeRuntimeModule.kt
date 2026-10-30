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
          s.currentRelease = s.pendingRelease; s.currentPath = s.pendingPath
          s.pendingRelease = 0; s.pendingPath = null; s.trialBoots = 0
          s.addEvent("applied:${s.currentRelease}")
          promoted = true
        }
        s.unhealthyBoots = 0; s.firstUnhealthyAt = 0
      }
      mapOf("release" to Store.runningRelease, "coldStartMs" to coldStart, "sinceLoadMs" to sinceLoad, "promoted" to promoted)
    }

    Function("consumeEvents") { Store(ctx).consumeEvents() }

    Function("rollback") {
      val s = Store(ctx)
      synchronized(PureNativeHostHandler.LOCK) {
        s.pendingPath?.let { File(it).delete() }
        s.pendingPath = null; s.pendingRelease = 0; s.trialBoots = 0
        s.addEvent("rolled_back:${s.currentRelease}")
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

  private fun check(): Map<String, Any?> {
    val s = Store(ctx)
    require(s.baseUrl.isNotEmpty() && s.publicKey.isNotEmpty() && s.appId.isNotEmpty()) { "runtime not configured" }
    val known = maxOf(s.currentRelease, s.pendingRelease)
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
    val url = core.getString("url").let { if (it.startsWith("http")) it else "${s.baseUrl}/${it.trimStart('/')}" }
    val tmp = File(s.dir, "dl-$release.tmp")
    val d0 = SystemClock.elapsedRealtime()
    val dl = http(url, null)
    require(dl.responseCode == 200) { "bundle HTTP ${dl.responseCode}" }
    dl.inputStream.use { ins -> tmp.outputStream().use { ins.copyTo(it, 64 * 1024) } }
    dl.disconnect()
    val downloadMs = SystemClock.elapsedRealtime() - d0

    val v0 = SystemClock.elapsedRealtime()
    val ok = tmp.length() == core.getLong("size") && Verify.sha256Hex(tmp) == core.getString("sha256")
    if (!ok) { tmp.delete(); s.addEvent("verify_failed:$release"); throw IllegalStateException("bundle hash/size mismatch") }
    val verifyMs = SystemClock.elapsedRealtime() - v0 + verifyPointerMs

    val dest = File(s.dir, "r$release.hbc")
    require(tmp.renameTo(dest)) { "could not stage bundle" }
    synchronized(PureNativeHostHandler.LOCK) {
      s.pendingPath?.let { if (it != dest.path) File(it).delete() }
      s.pendingPath = dest.path; s.pendingRelease = release; s.trialBoots = 0
      s.pendingIssuedAt = body.optString("issued_at")
    }
    return mapOf("status" to "staged", "release" to release, "bytes" to dest.length(),
      "downloadMs" to downloadMs, "verifyMs" to verifyMs, "issuedAt" to body.optString("issued_at"))
  }
}
