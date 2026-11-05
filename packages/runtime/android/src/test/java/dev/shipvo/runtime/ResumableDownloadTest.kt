package dev.shipvo.runtime

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

class ResumableDownloadTest {
  private val data = ByteArray(300_000) { (it * 31 % 251).toByte() }
  private val ranges = mutableListOf<String?>()
  private var honourRange = true
  private lateinit var server: ServerSocket
  private lateinit var dir: File
  private val url get() = "http://127.0.0.1:${server.localPort}/b"

  // A tiny HTTP/1.1 server on a plain socket. The Android unit-test classpath hides com.sun.net.httpserver.
  private fun serve(socket: java.net.Socket): Unit = socket.use { s ->
    val input = s.getInputStream().bufferedReader(Charsets.ISO_8859_1)
    input.readLine() ?: return@use
    var r: String? = null
    while (true) {
      val line = input.readLine() ?: break
      if (line.isEmpty()) break
      if (line.startsWith("Range:", ignoreCase = true)) r = line.substringAfter(":").trim()
    }
    synchronized(ranges) { ranges.add(r) }
    val start = if (honourRange && r != null) r.removePrefix("bytes=").removeSuffix("-").toInt() else 0
    val body = data.copyOfRange(start, data.size)
    val status = if (start > 0) "206 Partial Content" else "200 OK"
    val out = s.getOutputStream()
    out.write("HTTP/1.1 $status\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
    out.write(body)
    out.flush()
  }

  @Before fun start() {
    dir = File.createTempFile("shipvo", "dl").apply { delete(); mkdirs() }
    server = ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"))
    thread(isDaemon = true) {
      try { while (true) serve(server.accept()) } catch (_: java.io.IOException) {}
    }
  }
  @After fun stop() { server.close(); dir.deleteRecursively() }

  @Test fun secondRequestStartsAtThePartialSize() {
    val part = ResumableDownload.partialFile(dir, "abc")
    part.writeBytes(data.copyOfRange(0, 100_000))
    val from = ResumableDownload.fetch(url, part, data.size.toLong())
    assertEquals(100_000L, from)
    assertEquals(listOf<String?>("bytes=100000-"), ranges)
    assertArrayEquals(data, part.readBytes())
  }

  @Test fun a200AnswerToARangeRequestRestartsCleanly() {
    honourRange = false
    val part = ResumableDownload.partialFile(dir, "abc")
    part.writeBytes(data.copyOfRange(0, 100_000))
    ResumableDownload.fetch(url, part, data.size.toLong())
    assertEquals(listOf<String?>("bytes=100000-"), ranges)
    assertArrayEquals(data, part.readBytes())
  }

  @Test fun freshDownloadSendsNoRange() {
    val part = ResumableDownload.partialFile(dir, "abc")
    assertEquals(0L, ResumableDownload.fetch(url, part, data.size.toLong()))
    assertEquals(listOf<String?>(null), ranges)
    assertArrayEquals(data, part.readBytes())
  }

  @Test fun anOversizedPartialIsDiscarded() {
    val part = ResumableDownload.partialFile(dir, "abc")
    part.writeBytes(ByteArray(data.size + 5))
    assertEquals(0L, ResumableDownload.fetch(url, part, data.size.toLong()))
    assertArrayEquals(data, part.readBytes())
  }

  @Test fun partialFilesAreNamedByReleaseHash() {
    assertFalse(ResumableDownload.partialFile(dir, "a") == ResumableDownload.partialFile(dir, "b"))
  }
}
