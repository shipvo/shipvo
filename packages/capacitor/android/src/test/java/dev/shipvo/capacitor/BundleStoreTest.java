package dev.shipvo.capacitor;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Before;
import org.junit.Test;

public class BundleStoreTest {
    private BundleStore store;

    @Before
    public void setUp() throws IOException {
        store = new BundleStore(Files.createTempDirectory("shipvo").toFile());
    }

    private static byte[] zip(String... nameAndContent) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(b)) {
            for (int i = 0; i < nameAndContent.length; i += 2) {
                z.putNextEntry(new ZipEntry(nameAndContent[i]));
                z.write(nameAndContent[i + 1].getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
        }
        return b.toByteArray();
    }

    @Test
    public void writeReadListRemoveClear() throws IOException {
        store.write("release-2.bundle", new byte[] {1, 2, 3});
        store.write("release-1.bundle", new byte[] {4});
        assertArrayEquals(new byte[] {1, 2, 3}, store.read("release-2.bundle"));
        assertEquals(Arrays.asList("release-1.bundle", "release-2.bundle"), store.list());
        store.remove("release-1.bundle");
        assertEquals(Arrays.asList("release-2.bundle"), store.list());
        store.clear();
        assertTrue(store.list().isEmpty());
    }

    @Test
    public void refusesNamesThatEscape() throws IOException {
        for (String n : new String[] {"../x", "a/b", "", null, ".."}) {
            try { store.write(n, new byte[0]); fail("accepted " + n); } catch (IOException expected) { }
        }
    }

    @Test
    public void unpacksOnlyWithTheVerifiedHash() throws IOException {
        byte[] z = zip("index.html", "<p>release 2</p>", "assets/app.js", "1");
        store.write("release-2.bundle", z);
        try { store.unpack("release-2.bundle", "00"); fail("served a bundle with the wrong hash"); } catch (IOException expected) { }
        try { store.unpack("release-2.bundle", null); fail("served without a hash"); } catch (IOException expected) { }
        File dir = store.unpack("release-2.bundle", BundleStore.sha256Hex(z));
        assertEquals("<p>release 2</p>", new String(Files.readAllBytes(new File(dir, "index.html").toPath()), StandardCharsets.UTF_8));
        assertTrue(new File(dir, "assets/app.js").isFile());
    }

    @Test
    public void refusesBundlesThatEscapeOrHaveNoIndex() throws IOException {
        byte[] evil = zip("index.html", "x", "../evil.txt", "x");
        store.write("evil.bundle", evil);
        try { store.unpack("evil.bundle", BundleStore.sha256Hex(evil)); fail("unpacked outside the directory"); } catch (IOException expected) { }
        byte[] none = zip("a.txt", "x");
        store.write("none.bundle", none);
        try { store.unpack("none.bundle", BundleStore.sha256Hex(none)); fail("served a bundle without index.html"); } catch (IOException expected) { }
    }
}
