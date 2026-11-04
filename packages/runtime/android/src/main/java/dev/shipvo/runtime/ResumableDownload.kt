package dev.shipvo.runtime

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Download to a partial file and continue it with a Range request after a dropped connection.
 * It only moves bytes. The caller checks size, SHA-256 and signature of the finished file, as for any download.
 */
object ResumableDownload {
  /** Partial file for one bundle, named by its signed sha256. */
  fun partFile(dir: File, sha256: String) = File(dir, "dl-$sha256.part")

  /** Remove partial files that belong to another release. */
  fun prune(dir: File, keepSha256: String) {
    dir.listFiles { f -> f.name.startsWith("dl-") && f.name.endsWith(".part") && f.name != partFile(dir, keepSha256).name }?.forEach { it.delete() }
  }

  /**
   * Fetch `url` into `part`, appending when `part` already holds bytes. Returns the number of bytes fetched in this call.
   * On a network error the partial file stays so the next attempt can resume. `open` builds the connection (tests pass their own).
   */
  fun fetch(url: String, part: File, wantSize: Long, open: (String) -> HttpURLConnection = ::defaultOpen): Long {
    var offset = if (part.exists()) part.length() else 0L
    if (offset > wantSize) { part.delete(); offset = 0 }
    if (offset == wantSize && offset > 0) return 0
    val conn = open(url)
    try {
      if (offset > 0) conn.setRequestProperty("Range", "bytes=$offset-")
      val code = conn.responseCode
      when {
        code == 206 && offset > 0 && contentRangeStart(conn.getHeaderField("Content-Range")) == offset -> {}
        code == 200 -> { offset = 0 } // server ignored the Range: start over
        code == 416 -> { part.delete(); throw IllegalStateException("bundle HTTP 416, partial file discarded") }
        else -> throw IllegalStateException("bundle HTTP $code")
      }
      var n = 0L
      conn.inputStream.use { ins -> FileOutputStream(part, offset > 0).use { out ->
        val buf = ByteArray(64 * 1024)
        while (true) { val r = ins.read(buf); if (r < 0) break; out.write(buf, 0, r); n += r }
      } }
      return n
    } finally { conn.disconnect() }
  }

  /** Start byte of a "bytes <start>-<end>/<total>" header, or -1. */
  internal fun contentRangeStart(h: String?): Long =
    h?.let { Regex("^bytes (\\d+)-").find(it)?.groupValues?.get(1)?.toLongOrNull() } ?: -1

  private fun defaultOpen(url: String): HttpURLConnection =
    (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 10_000; readTimeout = 30_000; useCaches = false }
}
