package dev.shipvo.capacitor;

import static org.junit.Assert.*;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Before;
import org.junit.Test;

public class PatchStepTest {
    private static final long MB = 1L << 20;
    private String json;
    private BundleStore store;
    private byte[] base, patch, expected;
    private String patchSha, newSha;

    private String field(String k) {
        Matcher m = Pattern.compile("\"" + k + "\": \"([^\"]*)\"").matcher(json);
        assertTrue(m.find());
        return m.group(1);
    }

    @Before
    public void setUp() throws IOException {
        // Shared with the TypeScript tests; the runtime's patcher must give the same bytes.
        json = new String(Files.readAllBytes(new File("../test-vectors/patch.json").toPath()), StandardCharsets.UTF_8);
        base = Base64.getDecoder().decode(field("base"));
        patch = Base64.getDecoder().decode(field("patch"));
        expected = Base64.getDecoder().decode(field("new"));
        patchSha = field("patchSha256"); newSha = field("newSha256");
        store = new BundleStore(Files.createTempDirectory("shipvo").toFile());
        store.write("release-1.bundle", base);
    }

    private PatchStep.Outcome run(byte[] p, String pSha, String nSha, long max) throws IOException {
        return store.patch("release-1.bundle", p, pSha, "release-2.bundle", expected.length, nSha, max);
    }

    @Test
    public void validPatchGivesTheExactBundle() throws IOException {
        PatchStep.Outcome o = run(patch, patchSha, newSha, 512 * MB);
        assertEquals("patch", o.via); assertNull(o.patchError);
        assertArrayEquals(expected, store.read("release-2.bundle"));
    }

    @Test
    public void corruptPatchFallsBack() throws IOException {
        byte[] bad = java.util.Arrays.copyOf(patch, 60); // cut inside the compressed blocks
        PatchStep.Outcome o = run(bad, BundleStore.sha256Hex(bad), newSha, 512 * MB);
        assertEquals("full", o.via); assertNotNull(o.patchError);
        assertFalse(store.list().contains("release-2.bundle"));
    }

    @Test
    public void wrongPatchHashFallsBack() throws IOException {
        PatchStep.Outcome o = run(patch, newSha, newSha, 512 * MB);
        assertEquals("full", o.via); assertEquals("patch hash mismatch", o.patchError);
    }

    @Test
    public void wrongOutputHashFallsBack() throws IOException {
        PatchStep.Outcome o = run(patch, patchSha, patchSha, 512 * MB);
        assertEquals("full", o.via); assertEquals("patched bundle hash mismatch", o.patchError);
        assertFalse(store.list().contains("release-2.bundle"));
    }

    @Test
    public void overBudgetFallsBack() throws IOException {
        PatchStep.Outcome o = run(patch, patchSha, newSha, 100);
        assertEquals("full", o.via); assertEquals(PatchStep.OVER_BUDGET, o.patchError);
        assertFalse(store.list().contains("release-2.bundle"));
    }

    @Test
    public void missingBaseFallsBack() throws IOException {
        PatchStep.Outcome o = store.patch("release-9.bundle", patch, patchSha, "release-2.bundle", expected.length, newSha, 512 * MB);
        assertEquals("full", o.via);
    }
}
