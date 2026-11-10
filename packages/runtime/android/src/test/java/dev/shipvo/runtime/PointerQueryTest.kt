package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PointerQueryTest {
  private fun url(hbc: String?, nm: String?) = PointerQuery.url("https://x.dev", "app", 1, "b2", hbc, nm)

  @Test fun noQueryWhenNothingDeclared() {
    assertEquals("https://x.dev/p/app/1/b2.json", url(null, null))
    assertEquals("https://x.dev/p/app/1/b2.json", url("", " "))
  }

  @Test fun queryWhenDeclared() {
    assertEquals("https://x.dev/p/app/1/b2.json?hbc=96,98", url("96,98", null))
    assertEquals("https://x.dev/p/app/1/b2.json?hbc=96&nm=a%401.0.0", url("96", "a@1.0.0"))
    assertEquals("https://x.dev/p/app/1/b2.json?hbc=96&hbe=250829098.0.10&nm=a%401.0.0", PointerQuery.url("https://x.dev", "app", 1, "b2", "96", "a@1.0.0", "250829098.0.10"))
    assertEquals("https://x.dev/p/app/1/b2.json?hbe=1.2.3", PointerQuery.url("https://x.dev", "app", 1, "b2", null, null, " 1.2.3 "))
    assertEquals("https://x.dev/p/app/1/b2.json", PointerQuery.url("https://x.dev", "app", 1, "b2", null, null, " "))
  }

  @Test fun scopedNamesAreEncoded() {
    assertEquals("https://x.dev/p/app/1/b2.json?nm=%40s%2Fp%401.2.3,b%402.0.0", url(null, "@s/p@1.2.3,b@2.0.0"))
  }

  @Test fun refusesPointerForAnotherPlatform() {
    assertTrue(PointerQuery.isForAndroid("android"))
    assertFalse(PointerQuery.isForAndroid("ios"))
    assertFalse(PointerQuery.isForAndroid(null))
  }

  @Test fun readsTypedReason() {
    assertEquals("native_module_missing", PointerQuery.mismatchReason("{\"error\":\"native_module_missing\"}"))
    assertEquals("hermes_bytecode_mismatch", PointerQuery.mismatchReason("{ \"error\": \"hermes_bytecode_mismatch\" }"))
    assertNull(PointerQuery.mismatchReason("{\"error\":\"not_found\"}"))
    assertNull(PointerQuery.mismatchReason(null))
  }

  @Test fun scopedNameWithoutVersionIsEncodedAsIs() {
    // The control plane splits on the last "@", so "@s/p" has no version there.
    assertEquals("https://x.dev/p/app/1/b2.json?nm=%40s%2Fp", url(null, "@s/p"))
  }

  @Test fun queuesRejectionOncePerReason() {
    assertEquals("pointer_rejected:native_module_missing", PointerQuery.rejectionEvent(emptyList(), "native_module_missing"))
    val queued = listOf("crash_loop_revert", "pointer_rejected:native_module_missing")
    assertNull(PointerQuery.rejectionEvent(queued, "native_module_missing"))
    assertEquals("pointer_rejected:hermes_bytecode_mismatch", PointerQuery.rejectionEvent(queued, "hermes_bytecode_mismatch"))
  }
}
