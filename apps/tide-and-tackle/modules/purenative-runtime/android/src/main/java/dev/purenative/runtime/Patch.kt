package dev.purenative.runtime

import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.ByteArrayInputStream
import java.io.InputStream

/** bspatch for the standard BSDIFF40 format (Colin Percival's bsdiff 4.x): header, then bzip2 ctrl/diff/extra blocks. */
internal object Patch {
  private fun offtin(b: ByteArray, o: Int): Long {
    var y = (b[o + 7].toLong() and 0x7F)
    for (i in 6 downTo 0) y = (y shl 8) or (b[o + i].toLong() and 0xFF)
    return if ((b[o + 7].toInt() and 0x80) != 0) -y else y
  }

  private fun readFully(ins: InputStream, buf: ByteArray, off: Int, len: Int) {
    var n = 0
    while (n < len) { val r = ins.read(buf, off + n, len - n); require(r > 0) { "patch truncated" }; n += r }
  }

  fun apply(old: ByteArray, patch: ByteArray): ByteArray {
    require(patch.size >= 32 && String(patch, 0, 8, Charsets.US_ASCII) == "BSDIFF40") { "not a BSDIFF40 patch" }
    val ctrlLen = offtin(patch, 8); val diffLen = offtin(patch, 16); val newSize = offtin(patch, 24)
    require(ctrlLen >= 0 && diffLen >= 0 && newSize in 0..(64L shl 20)) { "bad patch header" }
    val ctrl = BZip2CompressorInputStream(ByteArrayInputStream(patch, 32, ctrlLen.toInt()))
    val diff = BZip2CompressorInputStream(ByteArrayInputStream(patch, (32 + ctrlLen).toInt(), diffLen.toInt()))
    val extraStart = (32 + ctrlLen + diffLen).toInt()
    val extra = BZip2CompressorInputStream(ByteArrayInputStream(patch, extraStart, patch.size - extraStart))

    val out = ByteArray(newSize.toInt())
    var oldPos = 0L; var newPos = 0L
    val c = ByteArray(24)
    while (newPos < newSize) {
      readFully(ctrl, c, 0, 24)
      val x = offtin(c, 0); val y = offtin(c, 8); val z = offtin(c, 16)
      require(x >= 0 && y >= 0 && newPos + x + y <= newSize) { "corrupt patch control" }
      readFully(diff, out, newPos.toInt(), x.toInt())
      for (i in 0 until x.toInt()) {
        val op = oldPos + i
        if (op in 0 until old.size) out[(newPos + i).toInt()] = (out[(newPos + i).toInt()] + old[op.toInt()]).toByte()
      }
      newPos += x; oldPos += x
      readFully(extra, out, newPos.toInt(), y.toInt())
      newPos += y; oldPos += z
    }
    ctrl.close(); diff.close(); extra.close()
    return out
  }
}
