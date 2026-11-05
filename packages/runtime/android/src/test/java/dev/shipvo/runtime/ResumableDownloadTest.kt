package dev.shipvo.runtime

import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
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
  private lateinit var server: HttpServer
  private lateinit var dir: File
  private val url get() = "http://127.0.0.1:${server.address.port}/b"

  @Before fun start() {
    dir = File.createTempFile("shipvo", "dl").apply { delete(); mkdirs() }
    server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/b") { ex ->
      val r = ex.requestHeaders.getFirst("Range"); ranges.add(r)
      val start = if (honourRange && r != null) r.removePrefix("bytes=").removeSuffix("-").toInt() else 0
      val body = data.copyOfRange(start, data.size)
      ex.sendResponseHeaders(if (start > 0) 206 else 200, body.size.toLong())
      ex.responseBody.use { it.write(body) }
    }
    server.start()
  }
  @After fun stop() { server.stop(0); dir.deleteRecursively() }

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
