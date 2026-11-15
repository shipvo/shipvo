package dev.shipvo.capacitor;

/**
 * Rule 9 on Android: apply a patch to the stored base bundle, check it, and say whether the
 * caller may use the result. Anything else means "download the full bundle".
 */
public final class PatchStep {
    private PatchStep() {}

    /** Share of the app's heap limit that base + patch + output may use together. */
    public static final double BUDGET_FRACTION = 0.4;
    public static final String OUT_OF_MEMORY = "out_of_memory";
    public static final String OVER_BUDGET = "over_memory_budget";

    /** `bytes` is the rebuilt bundle when `via` is "patch"; otherwise `patchError` says why the full bundle is needed. */
    public static final class Outcome {
        public final String via; public final byte[] bytes; public final String patchError;
        Outcome(String via, byte[] bytes, String patchError) { this.via = via; this.bytes = bytes; this.patchError = patchError; }
    }

    public static boolean fits(long base, long patch, long out, long maxMemory) {
        return base + patch + out <= (long) (maxMemory * BUDGET_FRACTION);
    }

    public static Outcome run(byte[] base, byte[] patch, String patchSha256, long newSize, String newSha256, long maxMemory) {
        if (base == null || !fits(base.length, patch.length, newSize, maxMemory)) return new Outcome("full", null, OVER_BUDGET);
        try {
            if (!BundleStore.sha256Hex(patch).equalsIgnoreCase(patchSha256)) throw new IllegalStateException("patch hash mismatch");
            byte[] out = Patch.apply(base, patch);
            if (out.length != newSize || !BundleStore.sha256Hex(out).equalsIgnoreCase(newSha256)) throw new IllegalStateException("patched bundle hash mismatch");
            return new Outcome("patch", out, null);
        } catch (OutOfMemoryError e) { return new Outcome("full", null, OUT_OF_MEMORY); }
        catch (Exception e) { return new Outcome("full", null, String.valueOf(e.getMessage())); }
    }
}
