package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PointerQueryTest {
  private fun url(hbc: String?, nm: String?) = PointerQuery.url("https://x.dev", "app", 1, "b2", hbc, nm)

  @Test fun noQueryWhenNothingDeclared() {
    assertEquals("https://x.dev/p/app/1/b2.json", url(null, null))
    assertEquals("https://x.dev/p/app/1/b2.json", url("", " "))
  }

  @Test fun queryWhenDeclared() {
    assertEquals("https://x.dev/p/app/1/b2.json?hbc=96,98", url("96,98", null))
    assertEquals("https://x.dev/p/app/1/b2.json?hbc=96&nm=a@1.0.0", url("96", "a@1.0.0"))
  }

  @Test fun scopedNamesAreEncoded() {
    assertEquals("https://x.dev/p/app/1/b2.json?nm=%40s%2Fp%401.2.3,b%402.0.0", url(null, "@s/p@1.2.3,b@2.0.0"))
  }

  @Test fun readsTypedReason() {
    assertEquals("native_module_missing", PointerQuery.mismatchReason("{\"error\":\"native_module_missing\"}"))
    assertEquals("hermes_bytecode_mismatch", PointerQuery.mismatchReason("{ \"error\": \"hermes_bytecode_mismatch\" }"))
    assertNull(PointerQuery.mismatchReason("{\"error\":\"not_found\"}"))
    assertNull(PointerQuery.mismatchReason(null))
  }
}
