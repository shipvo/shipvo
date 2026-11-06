package dev.shipvo.runtime

import net.i2p.crypto.eddsa.EdDSAEngine
import net.i2p.crypto.eddsa.EdDSAPrivateKey
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPrivateKeySpec
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Locale
import java.util.TimeZone

/** Runs the shared vectors (packages/runtime/test-vectors/rotation.json) against Rotation with an in-memory store. */
class RotationTest {
  private class Mem : RotationState {
    override var storedReleaseKey: String? = null
    override var storedSequence = 0L
    override var storedPinnedKey: String? = null
    override var storedPending: String? = null
    var commits = 0
    override fun commit(releaseKey: String?, sequence: Long, pinnedKey: String?, pending: String?) {
      storedReleaseKey = releaseKey; storedSequence = sequence; storedPinnedKey = pinnedKey; storedPending = pending; commits++
    }
  }

  private val spec = EdDSANamedCurveTable.getByName(EdDSANamedCurveTable.ED_25519)
  private fun dec(s: String) = Base64.getDecoder().decode(s)
  private fun verify(m: ByteArray, sig: String, key: String): Boolean = try {
    val e = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
    e.initVerify(EdDSAPublicKey(EdDSAPublicKeySpec(dec(key), spec)))
    e.update(m); e.verify(dec(sig))
  } catch (_: Exception) { false }
  private fun sign(m: ByteArray, seed: String): String {
    val e = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
    e.initSign(EdDSAPrivateKey(EdDSAPrivateKeySpec(dec(seed), spec)))
    e.update(m); return Base64.getEncoder().encodeToString(e.sign())
  }
  private fun time(s: String) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(s)!!.time

  private val vectors = JSONObject(javaClass.classLoader!!.getResourceAsStream("rotation.json")!!.bufferedReader().readText())
  private val keys = vectors.getJSONObject("keys")
  private fun pub(name: String) = keys.getJSONObject(name).getString("publicKey")


  private fun make(state: Mem, clock: Array<Long>, count: IntArray) = Rotation(
    state, vectors.getString("appId"), pub("K1"), vectors.getJSONObject("root").getString("publicKey"),
    vectors.getLong("minSequence"), { clock[0] }, { m, s, k -> count[0]++; verify(m, s, k) }, { dec(it) })

  @Test fun sharedVectors() {
    val cases = vectors.getJSONArray("cases")
    assertEquals(14, cases.length())
    for (c in 0 until cases.length()) {
      val case = cases.getJSONObject(c)
      val name = "case ${case.getInt("id")}: ${case.getString("name")}"
      val state = Mem(); val clock = arrayOf(time(vectors.getString("startTime"))); val count = intArrayOf(0)
      var rot = make(state, clock, count)
      val steps = case.getJSONArray("steps")
      for (i in 0 until steps.length()) {
        val step = steps.getJSONObject(i)
        clock[0] = time(step.getString("now"))
        if (step.optBoolean("relaunch")) rot = make(state, clock, count) // new process, same stored state
        count[0] = 0
        val results = rot.handle(step.getJSONArray("deliver"))
        if (step.optBoolean("rejectedWhole")) {
          assertTrue("$name step $i whole", results.isEmpty())
          assertEquals("$name step $i signature checks", step.getInt("signatureChecks"), count[0])
        } else {
          val want = step.getJSONArray("verify")
          assertEquals("$name step $i result count", want.length(), results.size)
          for (k in 0 until want.length()) {
            val w = want.getJSONObject(k)
            assertEquals("$name step $i env $k", w.getBoolean("ok"), results[k].ok)
            if (!w.getBoolean("ok")) assertEquals("$name step $i env $k reason", w.getString("reason"), results[k].reason)
          }
        }
        val expect = step.getJSONObject("expect")
        assertEquals("$name step $i key", pub(expect.getString("currentKey")), rot.currentReleaseKey())
        assertEquals("$name step $i sequence", expect.getLong("sequence"), rot.effectiveSequence())
        val pending = state.storedPending?.let { JSONArray(it) } ?: JSONArray()
        val seqs = (0 until pending.length()).map { JSONObject(pending.getJSONObject(it).getString("body")).getLong("sequence") }
        val wantSeqs = expect.getJSONArray("pending").let { a -> (0 until a.length()).map { a.getLong(it) } }
        assertEquals("$name step $i pending", wantSeqs, seqs)
      }
    }
  }

  private fun firstDelivery(caseId: Int): JSONArray {
    val cases = vectors.getJSONArray("cases")
    for (i in 0 until cases.length()) if (cases.getJSONObject(i).getInt("id") == caseId)
      return cases.getJSONObject(i).getJSONArray("steps").getJSONObject(0).getJSONArray("deliver")
    error("no case $caseId")
  }

  @Test fun pointersFollowTheRotatedKey() {
    val state = Mem(); val clock = arrayOf(time(vectors.getString("startTime"))); val count = intArrayOf(0)
    val rot = make(state, clock, count)
    val pointer = "{\"release\":2}".toByteArray()
    val bySeed = { n: String -> sign(pointer, keys.getJSONObject(n).getString("seed")) }
    assertTrue(verify(pointer, bySeed("K1"), rot.currentReleaseKey()))
    assertTrue(rot.handle(firstDelivery(1))[0].ok)
    assertTrue(verify(pointer, bySeed("K2"), rot.currentReleaseKey()))
    assertFalse(verify(pointer, bySeed("K1"), rot.currentReleaseKey()))
  }

  @Test fun corruptPendingIsClearedAndKeyAndSequenceKept() {
    val state = Mem(); val clock = arrayOf(time(vectors.getString("startTime"))); val count = intArrayOf(0)
    val rot = make(state, clock, count)
    assertTrue(rot.handle(firstDelivery(1))[0].ok)
    state.storedPending = "not json {"
    rot.applyDue()
    assertEquals(null, state.storedPending)
    assertEquals(1L, state.storedSequence)
    assertEquals(pub("K2"), rot.currentReleaseKey())
  }

  @Test fun newPinDiscardsStoredKeyButKeepsSequence() {
    val state = Mem(); val clock = arrayOf(time(vectors.getString("startTime"))); val count = intArrayOf(0)
    assertTrue(make(state, clock, count).handle(firstDelivery(1))[0].ok)
    // A new shell build pins K3 and MIN_SEQUENCE 1: the stored K2 is dropped, and statement 1 cannot come back.
    val rot = Rotation(state, "tide", pub("K3"), vectors.getJSONObject("root").getString("publicKey"), 1, { clock[0] }, ::verify, { dec(it) })
    assertEquals(pub("K3"), rot.currentReleaseKey())
    assertFalse(rot.handle(firstDelivery(1))[0].ok)
    assertEquals(pub("K3"), rot.currentReleaseKey())
    assertEquals(1L, state.storedSequence)
  }

  @Test fun noRootKeyMeansNothingApplies() {
    val state = Mem(); val clock = arrayOf(time(vectors.getString("startTime")))
    val rot = Rotation(state, "tide", pub("K1"), "", 0, { clock[0] }, ::verify, { dec(it) })
    assertFalse(rot.handle(firstDelivery(1))[0].ok)
    assertEquals(pub("K1"), rot.currentReleaseKey())
  }
}
