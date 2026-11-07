package dev.shipvo.runtime

import android.app.Activity
import android.content.Context
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** A trivial activity, declared in src/androidTest/AndroidManifest.xml. */
class TestActivity : Activity()

/**
 * A bundle selection made with no screen must not use up a staged release's trial boots. The first started activity
 * counts it. If the instrumentation process reports a foreground importance, a plain call already counts as visible;
 * the test then drives the no-screen selection through the `Store.gate` seam instead.
 */
@RunWith(AndroidJUnit4::class)
class HeadlessLoadTest {
  private lateinit var ctx: Context
  private lateinit var bundle: File

  @Before
  fun stage() {
    ctx = InstrumentationRegistry.getInstrumentation().targetContext
    ctx.getSharedPreferences("shipvo.runtime", Context.MODE_PRIVATE).edit().clear().commit()
    Store.gate.uiStarted = false
    Store.gate.deferredRelease = 0
    val s = Store(ctx)
    bundle = File(s.dir, "pending.bundle").apply { writeText("// pending") }
    s.binaryVersion = s.installedBinaryVersion
    s.pendingPath = bundle.path
    s.pendingRelease = 1
    s.trialBoots = 0
  }

  @Test
  fun loadWithNoScreenKeepsTrialBootsAtZeroUntilAnActivityStarts() {
    val s = Store(ctx)
    val handler = ShipvoHostHandler(ctx)
    val processCanShowUi = ShipvoHostHandler.canShowUi(ctx)
    println("HeadlessLoadTest: canShowUi with no activity = $processCanShowUi")

    repeat(3) {
      if (!processCanShowUi) {
        assertEquals(bundle.path, handler.getJSBundleFile(false))
      } else {
        // The instrumentation process counts as visible: choose the trial as a no-screen load through the gate.
        Store.gate.selectTrial(s, visible = false)
      }
      assertEquals(0, s.trialBoots)
    }
    assertEquals(1, Store.gate.deferredRelease)

    ActivityScenario.launch(TestActivity::class.java).use { scenario ->
      scenario.onActivity { }
      // The lifecycle callback is only registered by the handler; settle directly when the gate drove step 2.
      if (processCanShowUi) {
        synchronized(ShipvoHostHandler.LOCK) { ShipvoHostHandler.settleDeferred(s, visible = true, crashed = false) }
      }
      assertEquals(1, s.trialBoots)
    }
    assertNotNull(s.pendingPath)
  }
}
