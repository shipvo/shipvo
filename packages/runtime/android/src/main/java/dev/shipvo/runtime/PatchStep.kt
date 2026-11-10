package dev.shipvo.runtime

/** Memory guard for the patch step: skip a patch that would not fit, and turn running out of memory into a fall back to the full download. */
internal object PatchStep {
  /** Share of the app's heap limit (`Runtime.maxMemory()`) that base + patch + output may use together. */
  const val BUDGET_FRACTION = 0.4

  const val OUT_OF_MEMORY = "out_of_memory"
  const val OVER_BUDGET = "over_memory_budget"

  /** The 0.4 share also covers the buffers `Patch.apply` allocates while it decompresses. */
  fun fits(baseSize: Long, patchSize: Long, newSize: Long, maxMemory: Long): Boolean =
    baseSize + patchSize + newSize <= (maxMemory * BUDGET_FRACTION).toLong()

  /** Result of a patch attempt: `bytes` on success, else `error` says why the caller must download the full bundle. */
  class Outcome(val bytes: ByteArray?, val error: String?)

  /** What the update does after the patch attempt: `via` is "patch" or "full"; `bytesDownloaded` is the patch size only when the patch was used. */
  class Decision(val via: String, val patchError: String?, val bytesDownloaded: Long)

  fun decide(outcome: Outcome?, patchSize: Long): Decision = when {
    outcome == null -> Decision("full", null, 0L)
    outcome.bytes != null -> Decision("patch", null, patchSize)
    else -> Decision("full", outcome.error, 0L)
  }

  /** Runs [apply] only when the sizes fit; a null [baseSize] (unreadable base) counts as over budget. [apply] reads the inputs and builds the output, so nothing is allocated when over budget. */
  fun run(baseSize: Long?, patchSize: Long, newSize: Long, maxMemory: Long = Runtime.getRuntime().maxMemory(), apply: () -> ByteArray): Outcome {
    if (baseSize == null || !fits(baseSize, patchSize, newSize, maxMemory)) return Outcome(null, OVER_BUDGET)
    return try { Outcome(apply(), null) }
    catch (e: OutOfMemoryError) { Outcome(null, OUT_OF_MEMORY) }
    catch (e: Exception) { Outcome(null, e.message) }
  }
}
