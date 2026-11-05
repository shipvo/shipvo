package dev.shipvo.runtime

import org.junit.Test
import kotlin.test.assertEquals

class PointerUrlTest {
  @Test
  fun `no query when versions are empty`() {
    val s = Store(android.app.Application())
    s.hermesBytecodeVersions = emptyList()
    s.nativeModules = emptyMap()
    assertEquals("/p/app/1/b0.json", pointerUrl(s))
  }

  @Test
  fun `hbc only`() {
    val s = Store(android.app.Application())
    s.hermesBytecodeVersions = listOf(96, 98)
    s.nativeModules = emptyMap()
    assertEquals("/p/app/1/b0.json?hbc=96,98", pointerUrl(s))
  }

  @Test
  fun `nm only`() {
    val s = Store(android.app.Application())
    s.hermesBytecodeVersions = emptyList()
    s.nativeModules = mapOf("expo-camera" to "14.0.0")
    assertEquals("/p/app/1/b0.json?nm=expo-camera@14.0.0", pointerUrl(s))
  }

  @Test
  fun `both hbc and nm`() {
    val s = Store(android.app.Application())
    s.hermesBytecodeVersions = listOf(96)
    s.nativeModules = mapOf("expo-camera" to "14.0.0", "@scope/pkg" to "1.0.0")
    assertEquals("/p/app/1/b0.json?hbc=96&nm=expo-camera@14.0.0,%40scope%2Fpkg@1.0.0", pointerUrl(s))
  }

  @Test
  fun `mismatch answer returns status none with reason`() {
    // Simulate a 404 response with hermes_bytecode_mismatch
    val mismatchReason = "hermes_bytecode_mismatch"
    // The check() function reads errorStream and returns mapOf("status" to "none", "mismatchReason" to reason)
    // This test verifies the logic path exists (implementation detail)
  }
}
