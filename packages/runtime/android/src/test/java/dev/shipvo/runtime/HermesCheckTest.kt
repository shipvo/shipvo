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
  @Test fun parsesTheManifestValue() {
    assertEquals(listOf(96, 98), HermesCheck.parse("96, 98"))
    assertEquals(emptyList<Int>(), HermesCheck.parse(null))
    assertEquals(listOf(96), HermesCheck.parse("96,x,-1,0"))
  }
}
