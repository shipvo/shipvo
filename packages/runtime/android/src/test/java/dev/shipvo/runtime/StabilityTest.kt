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

  @Test fun aReleaseAlreadyPendingCurrentOrBlockedIsNotStagedAgain() {
    assertTrue(BootRules.mayStage(5, 3, 4, 2))
    assertFalse(BootRules.mayStage(5, 3, 5, 0))  // pending: staging again would reset trialBoots
    assertFalse(BootRules.mayStage(5, 5, 0, 0))
    assertFalse(BootRules.mayStage(5, 3, 0, 5))
  }

  private class Trial(override var trialBoots: Int = 0, override val pendingRelease: Int = 5, override val currentRelease: Int = 5) :
    TrialCounts { override var unhealthyBoots = 0; override var firstUnhealthyAt = 0L }
  private fun settle(g: LoadGate, c: Trial, visible: Boolean = true, crashed: Boolean = false, now: Long = 0) =
    g.settle(c, visible, crashed, now, max, win)

  @Test fun headlessLoadsDoNotUseUpTrialBoots() {
    val c = Trial()
    repeat(3) { LoadGate().selectTrial(c, visible = false) }  // three processes, none shows a screen
    assertEquals(0, c.trialBoots)
  }

  @Test fun settleCountsOnceWhenUiAppears() {
    val c = Trial(); val g = LoadGate()
    g.selectTrial(c, visible = false)
    settle(g, c, visible = false)
    assertEquals(0, c.trialBoots)
    settle(g, c); settle(g, c)
    assertEquals(1, c.trialBoots)
  }

  @Test fun headlessLoadThatCrashesCountsOnce() {
    val c = Trial(); val g = LoadGate()
    g.selectTrial(c, visible = false)
    settle(g, c, visible = false, crashed = true); settle(g, c, visible = false, crashed = true)
    assertEquals(1, c.trialBoots)
  }

  @Test fun visibleLoadCountsAtSelection() {
    val c = Trial(); val g = LoadGate()
    g.selectTrial(c, visible = true)
    assertEquals(1, c.trialBoots)
    settle(g, c)
    assertEquals(1, c.trialBoots)
  }

  @Test fun threeVisibleLoadsStillExhaustTheTrial() {
    val c = Trial()
    repeat(3) { LoadGate().selectTrial(c, visible = true) }
    assertEquals(max, c.trialBoots)  // the next selection sees trialBoots >= MAX_BOOTS and reverts
  }

  @Test fun deferredNonTrialReleaseCountsThroughTheUnhealthyBootWindow() {
    val c = Trial(); val g = LoadGate()
    assertFalse(g.selectCurrent(c, visible = false, now = 0, maxBoots = max, windowMs = win))
    assertEquals(0, c.unhealthyBoots)
    settle(g, c, now = 1_000)
    assertEquals(1, c.unhealthyBoots)
    repeat(max) { LoadGate().selectCurrent(c, visible = true, now = 2_000L, maxBoots = max, windowMs = win) }
    assertTrue(LoadGate().selectCurrent(c, visible = true, now = 3_000, maxBoots = max, windowMs = win))
  }

  @Test fun processImportanceDecidesVisibility() {
    assertTrue(BootRules.visibleImportance(100))   // foreground
    assertTrue(BootRules.visibleImportance(200))   // visible
    assertFalse(BootRules.visibleImportance(125))  // foreground service only
    assertFalse(BootRules.visibleImportance(300))  // service / cached
  }

  @Test fun aLoadWithoutUiIsCountedOnlyOnce() {
    assertFalse(BootRules.countsLater(false, visible = true, crashed = true))
    assertFalse(BootRules.countsLater(true, visible = false, crashed = false))
  }
}
