package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class StabilityTest {
  private class Counts : BootCounts { override var unhealthyBoots = 0; override var firstUnhealthyAt = 0L }
  private val max = ShipvoHostHandler.MAX_BOOTS
  private val win = ShipvoHostHandler.WINDOW_MS

  @Before fun reset() { BootRules.healthyLoad = 0; BootRules.crashedLoad = 0 }

  /** One launch of a promoted release: count it, then report healthy. Returns true if the launch reverts. */
  private fun launch(c: Counts, now: Long, load: Int): Boolean {
    if (BootRules.countBoot(c, now, max, win)) return true
    BootRules.onHealthy(c, load, now, promoted = false); return false
  }

  @Test fun releaseThatDiesAfterMarkHealthyIsReverted() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)  // boot 1: promoted, counted as 1
    assertFalse(launch(c, 5_000, 2))           // boot 2
    assertFalse(launch(c, 10_000, 3))          // boot 3
    assertTrue("fourth launch reverts", launch(c, 15_000, 4))
  }

  @Test fun releaseThatReachesStabilityIsKept() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)
    for (i in 2..20) {
      assertFalse(launch(c, i * 5_000L, i))
      assertTrue(BootRules.markStableIfHealthy(c, i))
    }
  }

  @Test fun backgroundBeforeMarkHealthyDoesNotClearTheCount() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)  // load 1 reported healthy, then the app reloaded
    BootRules.countBoot(c, 1_000, max, win)    // load 2 starts
    assertFalse(BootRules.markStableIfHealthy(c, 2))
    assertEquals(2, c.unhealthyBoots)
  }

  @Test fun crashAfterMarkHealthyIsNotStableWhenHostIsDestroyed() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)
    BootRules.noteCrash(1)                      // JS error, then the host pause calls markStableIfHealthy
    assertFalse(BootRules.markStableIfHealthy(c, 1))
    assertEquals(1, c.unhealthyBoots)
  }

  @Test fun crashInOneLoadDoesNotBlockTheNextLoad() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)
    BootRules.noteCrash(1)
    BootRules.onHealthy(c, 2, 1_000, promoted = false)
    assertTrue(BootRules.markStableIfHealthy(c, 2))
  }

  @Test fun countsExpireOutsideTheWindow() {
    val c = Counts()
    BootRules.onHealthy(c, 1, 0, promoted = true)
    assertFalse(BootRules.countBoot(c, win + 1, max, win))
    assertEquals(1, c.unhealthyBoots)
  }
}
