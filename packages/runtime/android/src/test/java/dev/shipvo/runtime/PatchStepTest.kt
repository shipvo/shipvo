package dev.shipvo.runtime

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PatchStepTest {
  private val mb = 1L shl 20

  @Test fun outOfMemoryBecomesAFallbackWithARecordedError() {
    val o = PatchStep.run(1 * mb, 1 * mb, 1 * mb, 512 * mb) { throw OutOfMemoryError("heap") }
    assertNull(o.bytes)
    assertEquals("out_of_memory", o.error)
  }

  @Test fun otherFailuresKeepTheirMessage() {
    val o = PatchStep.run(1, 1, 1, 512 * mb) { error("patch hash mismatch") }
    assertNull(o.bytes); assertEquals("patch hash mismatch", o.error)
  }

  @Test fun overBudgetIsSkippedWithoutRunningTheApply() {
    var called = false
    val o = PatchStep.run(60 * mb, 5 * mb, 60 * mb, 256 * mb) { called = true; ByteArray(1) }
    assertFalse(called)
    assertNull(o.bytes); assertEquals("over_memory_budget", o.error)
  }

  @Test fun withinBudgetApplies() {
    val o = PatchStep.run(20 * mb, 1 * mb, 20 * mb, 512 * mb) { byteArrayOf(1, 2) }
    assertArrayEquals(byteArrayOf(1, 2), o.bytes); assertNull(o.error)
    assertTrue(PatchStep.fits(1, 1, 1, 100))
  }

  @Test fun unknownBaseSizeIsSkippedAsOverBudget() {
    var called = false
    val o = PatchStep.run(null, 1, 1, 512 * mb) { called = true; ByteArray(1) }
    assertFalse(called); assertEquals("over_memory_budget", o.error)
  }

  @Test fun outOfMemoryStillShipsTheFullBundleAndRecordsTheError() {
    val d = PatchStep.decide(PatchStep.run(1 * mb, 1 * mb, 1 * mb, 512 * mb) { throw OutOfMemoryError("heap") }, 1 * mb)
    assertEquals("full", d.via); assertEquals("out_of_memory", d.patchError); assertEquals(0L, d.bytesDownloaded)
  }

  @Test fun successfulPatchIsRecordedWithItsSize() {
    val d = PatchStep.decide(PatchStep.run(1, 1, 1, 512 * mb) { byteArrayOf(1) }, 1234L)
    assertEquals("patch", d.via); assertNull(d.patchError); assertEquals(1234L, d.bytesDownloaded)
  }

  @Test fun noMatchingPatchMeansFullWithoutAnError() {
    val d = PatchStep.decide(null, 0)
    assertEquals("full", d.via); assertNull(d.patchError)
  }
}
