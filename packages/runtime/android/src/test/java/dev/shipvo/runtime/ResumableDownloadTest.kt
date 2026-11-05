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
  // A minimal HTTP/1.1 server on a plain socket: com.sun.net.httpserver is not on the Android unit-test classpath.
  private lateinit var server: ServerSocket
  private lateinit var dir: File
  private val url get() = "http://127.0.0.1:${server.localPort}/b"

  @Before fun start() {
    dir = File.createTempFile("shipvo", "dl").apply { delete(); mkdirs() }
    server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    thread(isDaemon = true) {
      while (!server.isClosed) {
        val s = try { server.accept() } catch (e: Exception) { break }
        s.use { sock ->
          val reader = sock.getInputStream().bufferedReader(Charsets.ISO_8859_1)
          reader.readLine() ?: return@use
          var range: String? = null
          while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
            val i = line.indexOf(':')
            if (i > 0 && line.substring(0, i).trim().equals("Range", ignoreCase = true)) range = line.substring(i + 1).trim()
          }
          synchronized(ranges) { ranges.add(range) }
          val start = if (honourRange && range != null) range.removePrefix("bytes=").removeSuffix("-").toInt() else 0
          val body = data.copyOfRange(start, data.size)
          val head = buildString {
            append(if (start > 0) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
            if (start > 0) append("Content-Range: bytes $start-${data.size - 1}/${data.size}\r\n")
            append("Content-Length: ${body.size}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n")
          }
          val out = sock.getOutputStream()
          out.write(head.toByteArray(Charsets.ISO_8859_1)); out.write(body); out.flush()
        }
      }
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
