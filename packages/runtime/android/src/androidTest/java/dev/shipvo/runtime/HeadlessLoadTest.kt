package dev.shipvo.runtime

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** A trivial activity, declared in src/androidTest/AndroidManifest.xml. */
class TestActivity : Activity()

/**
 * A bundle selection made with no screen must not use up a staged release's trial boots. The first started activity
 * counts it. The test forces the process to report non-visible through `ShipvoHostHandler.processVisibleOverride`
 * (an instrumentation process reports foreground), so `getJSBundleFile` itself is the code under test.
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
    ShipvoHostHandler.processVisibleOverride = false
    val s = Store(ctx)
    bundle = File(s.dir, "pending.bundle").apply { writeText("// pending") }
    s.binaryVersion = s.installedBinaryVersion
    s.pendingPath = bundle.path
    s.pendingRelease = 1
    s.trialBoots = 0
  }

  @After
  fun reset() {
    ShipvoHostHandler.processVisibleOverride = null
    Store.gate.uiStarted = false
  }

  @Test
  fun loadWithNoScreenKeepsTrialBootsAtZeroUntilAnActivityStarts() {
    val s = Store(ctx)
    val handler = ShipvoHostHandler(ctx)

    repeat(3) {
      assertEquals(bundle.path, handler.getJSBundleFile(false))
      assertEquals(0, s.trialBoots)
    }
    assertEquals(1, Store.gate.deferredRelease)

    // Start the activity under the test package; the handler's lifecycle callback counts the boot.
    val inst = InstrumentationRegistry.getInstrumentation()
    val intent = Intent(Intent.ACTION_MAIN)
      .setClassName(inst.context, TestActivity::class.java.name)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val activity = inst.startActivitySync(intent)
    try {
      inst.waitForIdleSync()
      assertEquals(1, s.trialBoots)
    } finally {
      inst.runOnMainSync { activity.finish() }
    }
    assertEquals(1, s.pendingRelease)
  }

  @Test
  fun loadWithAScreenCountsTheBootAtOnce() {
    ShipvoHostHandler.processVisibleOverride = true
    val s = Store(ctx)
    assertEquals(bundle.path, ShipvoHostHandler(ctx).getJSBundleFile(false))
    assertEquals(1, s.trialBoots)
    assertEquals(0, Store.gate.deferredRelease)
  }
}
