package dev.shipvo.runtime

import android.util.Base64
import net.i2p.crypto.eddsa.EdDSAEngine
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

internal object Verify {
  fun ed25519(message: ByteArray, signatureB64: String, publicKeyB64: String): Boolean = try {
    val spec = EdDSANamedCurveTable.getByName(EdDSANamedCurveTable.ED_25519)
    val key = EdDSAPublicKey(EdDSAPublicKeySpec(Base64.decode(publicKeyB64, Base64.DEFAULT), spec))
    val engine = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
    engine.initVerify(key)
    engine.update(message)
    engine.verify(Base64.decode(signatureB64, Base64.DEFAULT))
  } catch (_: Exception) { false }

  fun sha256Hex(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    FileInputStream(f).use { ins -> val buf = ByteArray(64 * 1024); while (true) { val n = ins.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
    return md.digest().joinToString("") { "%02x".format(it) }
  }

  fun sha256Hex(b: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

  /** a < b for x.y.z */
  fun semverLess(a: String, b: String): Boolean {
    val pa = a.split('-')[0].split('.').map { it.toIntOrNull() ?: 0 }
    val pb = b.split('-')[0].split('.').map { it.toIntOrNull() ?: 0 }
    for (i in 0 until 3) { val x = pa.getOrElse(i) { 0 }; val y = pb.getOrElse(i) { 0 }; if (x != y) return x < y }
    return false
  }
}
