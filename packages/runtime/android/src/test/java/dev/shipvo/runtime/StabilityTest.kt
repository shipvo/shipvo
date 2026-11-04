package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class StabilityTest {
  @Test fun windowsAreTheDocumentedValues() {
    assertEquals(30_000L, ShipvoHostHandler.STABILITY_MS)
    assertEquals(60_000L, ShipvoHostHandler.WINDOW_MS)
    assertEquals(3, ShipvoHostHandler.MAX_BOOTS)
  }
}
