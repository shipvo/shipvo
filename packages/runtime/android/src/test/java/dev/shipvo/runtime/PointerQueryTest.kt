package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PointerQueryTest {
  private val base = "https://x.dev/p/app/1/b0.json"

  @Test fun noQueryWhenNothingDeclared() {
    assertEquals(base, PointerQuery.url(base, null, null))
    assertEquals(base, PointerQuery.url(base, "", " , "))
  }
  @Test fun hbcOnly() = assertEquals("$base?hbc=96,98", PointerQuery.url(base, "96, 98", null))
  @Test fun scopedNamesAreEncoded() {
    assertEquals("$base?hbc=96&nm=%40scope%2Fpkg%401.2.3,other%402.0.0",
      PointerQuery.url(base, "96", "@scope/pkg@1.2.3,other@2.0.0"))
  }
  @Test fun typedReasons() {
    assertEquals("hermes_bytecode_mismatch", PointerQuery.mismatchReason("{\"error\":\"hermes_bytecode_mismatch\"}"))
    assertEquals("native_module_version", PointerQuery.mismatchReason("{\"error\": \"native_module_version\",\"module\":\"a\"}"))
    assertNull(PointerQuery.mismatchReason("{\"error\":\"not_found\"}"))
    assertNull(PointerQuery.mismatchReason(null))
  }
  @Test fun dropsInvalidItems() {
    assertEquals("$base?hbc=96&nm=a%401", PointerQuery.url(base, "96,x,0,-1,9z", "a@1,noversion,@,@scope,a@,@scope/pkg@,a@b@"))
    assertEquals("$base?hbc=96", PointerQuery.url(base, "96,99999999999999999999", null))
    assertEquals(base, PointerQuery.url(base, "abc", "nover"))
  }
  @Test fun sameReasonIsNotQueuedTwice() {
    assertEquals(true, PointerQuery.shouldQueue(null, "native_module_missing"))
    assertEquals(true, PointerQuery.shouldQueue("verify_failed:3", "native_module_missing"))
    assertEquals(false, PointerQuery.shouldQueue("native_module_missing", "native_module_missing"))
  }
}
