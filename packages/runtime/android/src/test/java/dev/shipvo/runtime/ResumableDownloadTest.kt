package dev.shipvo.runtime

import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files

class ResumableDownloadTest {
  private val body = ByteArray(100_000) { (it * 31).toByte() }
  private lateinit var server: HttpServer
  private lateinit var dir: File
  private val ranges = mutableListOf<String?>()
  private var honourRange = true
  private var cutAt = -1 // when >= 0, the next response sends this many bytes then drops the connection

  private fun url() = "http://127.0.0.1:${server.address.port}/b"

  @Before fun start() {
    dir = Files.createTempDirectory("shipvo-dl").toFile()
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/b") { ex ->
      val range = ex.requestHeaders.getFirst("Range"); ranges.add(range)
      val start = if (honourRange && range != null) range.removePrefix("bytes=").removeSuffix("-").toInt() else 0
      if (start > 0) ex.responseHeaders.add("Content-Range", "bytes $start-${body.size - 1}/${body.size}")
      val out = body.copyOfRange(start, body.size)
      ex.sendResponseHeaders(if (start > 0) 206 else 200, out.size.toLong())
      val cut = cutAt; cutAt = -1
      if (cut >= 0) { ex.responseBody.write(out, 0, cut); ex.responseBody.flush(); ex.close() }
      else { ex.responseBody.write(out); ex.close() }
    }
    server.start()
  }
  @After fun stop() { server.stop(0); dir.deleteRecursively() }

  private fun fetch(part: File) = ResumableDownload.fetch(url(), part, body.size.toLong())

  @Test fun retryAsksForTheBytesAfterThePartialFile() {
    val part = File(dir, "a.part")
    cutAt = 40_000
    try { fetch(part); throw AssertionError("expected a dropped connection") } catch (e: java.io.IOException) {}
    val have = part.length()
    assertTrue("partial file kept", have in 1 until body.size.toLong())
    val got = fetch(part)
    assertEquals(null, ranges[0])
    assertEquals("bytes=$have-", ranges[1])
    assertEquals(body.size - have, got)
    assertArrayEquals(body, part.readBytes())
  }

  @Test fun serverAnswering200RestartsCleanly() {
    val part = File(dir, "b.part"); part.writeBytes(ByteArray(5_000) { 9 })
    honourRange = false
    fetch(part)
    assertEquals("bytes=5000-", ranges[0])
    assertArrayEquals(body, part.readBytes())
  }

  @Test fun corruptPartialIsNotTrustedAndPruneRemovesOtherReleases() {
    val sha = "a".repeat(64)
    val part = ResumableDownload.partFile(dir, sha)
    part.writeBytes(ByteArray(5_000) { 9 })
    fetch(part) // appends fine; the caller's hash check is what catches the corruption
    assertFalse(body.contentEquals(part.readBytes()))
    part.delete()
    fetch(part)
    assertArrayEquals(body, part.readBytes())

    val other = ResumableDownload.partFile(dir, "b".repeat(64)); other.writeBytes(byteArrayOf(1))
    ResumableDownload.prune(dir, sha)
    assertFalse(other.exists()); assertTrue(part.exists())
  }

  @Test fun parsesContentRange() {
    assertEquals(6L, ResumableDownload.contentRangeStart("bytes 6-9/10"))
    assertEquals(-1L, ResumableDownload.contentRangeStart(null))
  }
}
