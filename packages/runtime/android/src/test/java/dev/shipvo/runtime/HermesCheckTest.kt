package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HermesCheckTest {
  @Test fun mismatchIsRefused() = assertTrue(HermesCheck.mismatch(listOf(96), 98))
  @Test fun matchIsApplied() = assertFalse(HermesCheck.mismatch(listOf(96, 98), 98))
  @Test fun missingReleaseFieldIsApplied() = assertFalse(HermesCheck.mismatch(listOf(96), null))
  @Test fun shellThatDeclaresNothingAppliesAnything() = assertFalse(HermesCheck.mismatch(emptyList(), 98))
  @Test fun releaseVersionAbsentOrNullIsNull() { assertEquals(null, HermesCheck.releaseVersion(false, null)); assertEquals(null, HermesCheck.releaseVersion(true, null)) }
  @Test fun releaseVersionReadsAWholeNumber() { assertEquals(98, HermesCheck.releaseVersion(true, 98)); assertEquals(98, HermesCheck.releaseVersion(true, 98.0)) }
  @Test fun releaseVersionRefusesNonIntegers() {
    for (bad in listOf<Any>("98", 0, -1, 98.5, true)) {
      try { HermesCheck.releaseVersion(true, bad); org.junit.Assert.fail("$bad should be refused") } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("hermes_bytecode_version")) }
    }
  }
  @Test fun parsesTheManifestValue() {
    assertEquals(listOf(96, 98), HermesCheck.parse("96, 98"))
    assertEquals(emptyList<Int>(), HermesCheck.parse(null))
    assertEquals(listOf(96), HermesCheck.parse("96,x,-1,0"))
  }
  @Test fun refuseOnMismatchRecordsEventBlocksAndReturnsResult() {
    val events = mutableListOf<String>(); val blocked = mutableListOf<Int>()
    val r = HermesCheck.refuse(listOf(96), 98, 7, { events.add(it) }, { blocked.add(it) })!!
    assertEquals(listOf("hermes_bytecode_mismatch:7"), events)
    assertEquals(listOf(7), blocked)
    assertEquals("none", r["status"]); assertEquals("hermes_bytecode_mismatch", r["reason"])
    assertEquals(7, r["release"]); assertEquals(98, r["releaseHermesBytecodeVersion"]); assertEquals(listOf(96), r["shellHermesBytecodeVersions"])
  }
  @Test fun refuseOnMatchOrMissingFieldDoesNothing() {
    val events = mutableListOf<String>(); val blocked = mutableListOf<Int>()
    assertEquals(null, HermesCheck.refuse(listOf(96, 98), 98, 7, { events.add(it) }, { blocked.add(it) }))
    assertEquals(null, HermesCheck.refuse(listOf(96), null, 7, { events.add(it) }, { blocked.add(it) }))
    assertEquals(null, HermesCheck.refuse(emptyList(), 98, 7, { events.add(it) }, { blocked.add(it) }))
    assertTrue(events.isEmpty() && blocked.isEmpty())
  }
}
