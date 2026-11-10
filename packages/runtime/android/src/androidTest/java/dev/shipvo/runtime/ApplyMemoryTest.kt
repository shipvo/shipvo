package dev.shipvo.runtime

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File

/** Measures the peak memory of the patch step (read patch, read base, apply) with synthetic bundles. Numbers go to logcat as SHIPVO_APPLY_MEMORY lines, which CI copies into the job summary. */
@RunWith(AndroidJUnit4::class)
class ApplyMemoryTest {
  private fun le(v: Long): ByteArray = ByteArray(8) { i -> ((v shr (8 * i)) and 0xFF).toByte() }

  private fun bz(b: ByteArray): ByteArray {
    val o = ByteArrayOutputStream()
    BZip2CompressorOutputStream(o).use { it.write(b) }
    return o.toByteArray()
  }

  /** A BSDIFF40 patch that turns [size] bytes of base into the same bytes plus a 1 KB tail. */
  private fun patch(size: Int): ByteArray {
    val tail = ByteArray(1024) { (it * 7).toByte() }
    val ctrl = bz(le(size.toLong()) + le(tail.size.toLong()) + le(0))
    val diff = bz(ByteArray(size))
    val extra = bz(tail)
    return "BSDIFF40".toByteArray() + le(ctrl.size.toLong()) + le(diff.size.toLong()) + le(size.toLong() + tail.size) + ctrl + diff + extra
  }

  private fun measure(mb: Int) {
    val dir = File(System.getProperty("java.io.tmpdir"), "apply-mem-$mb").apply { mkdirs() }
    val baseFile = File(dir, "base.bin"); val patchFile = File(dir, "patch.bin")
    val size = mb shl 20
    val base = ByteArray(size).also { java.util.Random(mb.toLong()).nextBytes(it) }
    baseFile.writeBytes(base); patchFile.writeBytes(patch(size))
    val expected = base + ByteArray(1024) { (it * 7).toByte() }
    System.gc()
    val rt = Runtime.getRuntime()
    val before = rt.totalMemory() - rt.freeMemory()
    @Volatile var peak = before
    @Volatile var done = false
    val sampler = Thread { while (!done) { peak = maxOf(peak, rt.totalMemory() - rt.freeMemory()); Thread.sleep(2) } }
    sampler.start()
    val t0 = System.nanoTime()
    // Same reads as the update path: the patch, then the base, then the output.
    val out = Patch.apply(baseFile.readBytes(), patchFile.readBytes())
    val ms = (System.nanoTime() - t0) / 1_000_000
    done = true; sampler.join()
    peak = maxOf(peak, rt.totalMemory() - rt.freeMemory())
    assertArrayEquals(expected, out)
    Log.i("Shipvo", "SHIPVO_APPLY_MEMORY android bundle=${mb}MB peak_heap_delta=${(peak - before) shr 20}MB apply_ms=$ms")
    dir.deleteRecursively()
  }

  @Test fun peakMemory20Mb() = measure(20)
  @Test fun peakMemory60Mb() = measure(60)
}
