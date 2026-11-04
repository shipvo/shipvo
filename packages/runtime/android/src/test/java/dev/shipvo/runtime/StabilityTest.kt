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

  @Before fun reset() { BootRules.healthyLoad = 0 }

  /** One launch of a promoted release: count it, then report healthy. Returns true if the launch reverts. */
  private fun launch(c: Counts, now: Long, load: Int): Boolean {
    if (BootRules.countBoot(c, now, max, win)) return true
    BootRules.noteHealthy(load); return false
  }

  @Test fun releaseThatDiesAfterMarkHealthyIsReverted() {
    val c = Counts()
    BootRules.countPromotedBoot(c, 0)          // boot 1: promoted, counted as 1
    assertFalse(launch(c, 5_000, 2))           // boot 2
    assertFalse(launch(c, 10_000, 3))          // boot 3
    assertTrue("fourth launch reverts", launch(c, 15_000, 4))
  }

  @Test fun releaseThatReachesStabilityIsKept() {
    val c = Counts()
    BootRules.countPromotedBoot(c, 0)
    for (i in 2..20) {
      assertFalse(launch(c, i * 5_000L, i))
      assertTrue(BootRules.markStableIfHealthy(c, i))
    }
  }

  @Test fun backgroundBeforeMarkHealthyDoesNotClearTheCount() {
    val c = Counts()
    BootRules.countPromotedBoot(c, 0)
    BootRules.noteHealthy(1)                   // load 1 reported healthy, then the app reloaded
    BootRules.countBoot(c, 1_000, max, win)    // load 2 starts
    assertFalse(BootRules.markStableIfHealthy(c, 2))
    assertEquals(2, c.unhealthyBoots)
  }

  @Test fun countsExpireOutsideTheWindow() {
    val c = Counts()
    BootRules.countPromotedBoot(c, 0)
    assertFalse(BootRules.countBoot(c, win + 1, max, win))
    assertEquals(1, c.unhealthyBoots)
  }
}
