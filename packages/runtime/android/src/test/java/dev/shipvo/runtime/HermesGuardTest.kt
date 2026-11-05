package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

class HermesGuardTest {
  private fun hbc(v: Int) = byteArrayOf(0xc6.toByte(), 0x1f, 0xbc.toByte(), 0x03, 0xc1.toByte(), 0x03, 0x19, 0x1f,
    v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte())

  @Test fun readsVersionFromHeader() {
    assertEquals(96, HermesGuard.versionOf(hbc(96)))
    assertEquals(300, HermesGuard.versionOf(hbc(300)))
    assertNull(HermesGuard.versionOf("var a = 1; // js".toByteArray()))
    assertNull(HermesGuard.versionOf(ByteArray(4)))
  }

  @Test fun mismatchIsRefusedWithTypedReason() {
    assertEquals("hermes_bytecode_mismatch:7:release=98:shell=96", HermesGuard.mismatchEvent(7, 98, 96))
  }

  @Test fun matchIsAccepted() { assertNull(HermesGuard.mismatchEvent(7, 96, 96)) }

  @Test fun missingFieldIsAccepted() {
    assertNull(HermesGuard.mismatchEvent(7, null, 96))
    assertNull(HermesGuard.mismatchEvent(7, 96, null))
  }

  /** Hands out at most `chunk` bytes per read, like a slow stream. */
  private fun trickle(b: ByteArray, chunk: Int) = object : InputStream() {
    var i = 0
    override fun read(): Int = if (i < b.size) b[i++].toInt() and 0xff else -1
    override fun read(buf: ByteArray, off: Int, len: Int): Int {
      if (i >= b.size) return -1
      val n = minOf(len, chunk, b.size - i); System.arraycopy(b, i, buf, off, n); i += n; return n
    }
  }

  @Test fun headerIsReadAcrossShortReads() {
    assertEquals(96, HermesGuard.readHeader { trickle(hbc(96) + ByteArray(50), 1) }?.let { HermesGuard.versionOf(it) })
  }

  @Test fun shortStreamAndMissingAssetAreUnknown() {
    assertNull(HermesGuard.readHeader { trickle(hbc(96).copyOf(5), 3) }?.let { HermesGuard.versionOf(it) })
    assertNull(HermesGuard.readHeader { ByteArrayInputStream(hbc(96).copyOf(9)) }?.let { HermesGuard.versionOf(it) })
    assertNull(HermesGuard.readHeader { null })
    assertNull(HermesGuard.readHeader { throw IOException("gone") })
    assertNull(HermesGuard.decide(7, 98) { null })
    assertNull(HermesGuard.decide(7, 98) { ByteArrayInputStream(hbc(96).copyOf(9)) })
  }

  @Test fun versionFieldMustBeAWholePositiveNumber() {
    assertEquals(96, HermesGuard.releaseVersionOf(96))
    assertEquals(96, HermesGuard.releaseVersionOf(96L))
    assertNull(HermesGuard.releaseVersionOf(96.5))
    assertNull(HermesGuard.releaseVersionOf("96"))
    assertNull(HermesGuard.releaseVersionOf(0))
    assertNull(HermesGuard.releaseVersionOf(-3))
    assertNull(HermesGuard.releaseVersionOf(null))
  }

  @Test fun decideCoversMismatchMatchAndMissingField() {
    val shell = { ByteArrayInputStream(hbc(96) + ByteArray(20)) }
    assertEquals("hermes_bytecode_mismatch:7:release=98:shell=96", HermesGuard.decide(7, 98, shell))
    assertNull(HermesGuard.decide(7, 96, shell))
    assertNull(HermesGuard.decide(7, null, shell))
    assertNull(HermesGuard.decide(7, 96.5, shell))
    assertNull(HermesGuard.decide(7, 98) { ByteArrayInputStream("var a;".toByteArray()) })
  }
}
