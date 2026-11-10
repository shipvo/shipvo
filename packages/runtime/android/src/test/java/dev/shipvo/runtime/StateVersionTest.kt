package dev.shipvo.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StateVersionTest {
  private class Mem : StateVersions {
    override var pendingRelease = 0; override var currentRelease = 0
    override var pendingStateVersion = 0; override var currentStateVersion = 0; override var previousStateVersion = 0
    var previousRelease = 0
    fun stage(release: Int, sv: Any?) { pendingRelease = release; StateVersion.stage(this, sv) }
    /** What markHealthy does for the running pending release. */
    fun apply() {
      StateVersion.promote(this); previousRelease = currentRelease; currentRelease = pendingRelease; pendingRelease = 0
    }
    /** What revertToPrevious does. */
    fun revert() { StateVersion.revert(this); currentRelease = previousRelease; previousRelease = 0 }
  }

  @Test fun stagedThenAppliedReleaseKeepsItsVersion() {
    val c = Mem(); c.stage(5, 3); c.apply()
    assertEquals(3, StateVersion.applied(c, 5))
  }
  @Test fun trialRunReportsThePendingVersion() {
    val c = Mem(); c.stage(5, 3)
    assertEquals(3, StateVersion.applied(c, 5))
  }
  @Test fun releaseWithoutAVersionReturnsNull() {
    val c = Mem(); c.stage(5, null); c.apply()
    assertNull(StateVersion.applied(c, 5))
  }
  @Test fun aNewReleaseWithoutAVersionDoesNotInheritTheOldOne() {
    val c = Mem(); c.stage(5, 3); c.apply(); c.stage(6, null); c.apply()
    assertNull(StateVersion.applied(c, 6))
  }
  @Test fun embeddedBundleReturnsNull() {
    val c = Mem(); c.stage(5, 3); c.apply()
    assertNull(StateVersion.applied(c, 0))
  }
  @Test fun revertToEmbeddedReturnsNull() {
    val c = Mem(); c.stage(5, 3); c.apply(); c.revert()
    assertNull(StateVersion.applied(c, 0))
    assertEquals(0, c.currentStateVersion)
  }
  @Test fun revertToPreviousReleaseReturnsItsVersion() {
    val c = Mem(); c.stage(5, 2); c.apply(); c.stage(6, 3); c.apply()
    assertEquals(3, StateVersion.applied(c, 6))
    c.revert()
    assertEquals(2, StateVersion.applied(c, 5))
  }
  @Test fun invalidVersionsStayAbsent() {
    val c = Mem()
    for (bad in listOf<Any?>("3", 0, -1, 2.5)) { c.stage(5, bad); assertNull(StateVersion.applied(c, 5)) }
  }
}
