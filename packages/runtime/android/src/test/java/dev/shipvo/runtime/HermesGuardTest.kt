package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

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
}
