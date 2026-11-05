package dev.shipvo.runtime

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Resumable full-bundle download. It only moves bytes; the caller still checks the signed sha256 and size. */
object ResumableDownload {
  /** Partial download, named by the release sha256 so a different release never reuses it. */
  fun partialFile(dir: File, sha: String) = File(dir, "dl-$sha.part")

  /**
   * Download into [part], resuming with `Range: bytes=<n>-` when a partial file exists. A 200 answer means the server
   * ignored the range, so the file restarts. If the connection drops the partial file stays for the next attempt.
   * Returns how many bytes were already on disk.
   */
  fun fetch(url: String, part: File, wantSize: Long): Long {
    var offset = part.length()
    if (offset > wantSize) { part.delete(); offset = 0 }
    if (offset == wantSize) return offset
    for (attempt in 0..1) {
      val dl = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000; readTimeout = 30_000; useCaches = false
        if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
      }
      try {
        val code = dl.responseCode
        if (code == 416 && offset > 0 && attempt == 0) { part.delete(); offset = 0; continue }
        require(code == 200 || (code == 206 && offset > 0)) { "bundle HTTP $code" }
        val append = code == 206
        if (!append) { part.delete(); offset = 0 }
        dl.inputStream.use { ins -> FileOutputStream(part, append).use { ins.copyTo(it, 64 * 1024) } }
        return offset
      } finally { dl.disconnect() }
    }
    error("bundle download failed")
  }
}
