package dev.shipvo.capacitor;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Bundle files in a private directory. No Android classes, so it runs in a plain JVM test.
 * It never decides anything: the TypeScript core verifies the signature and hash; this class
 * only stores bytes and re-checks the hash it is given before it unpacks.
 */
public final class BundleStore {
    private final File dir;
    private final File served;

    public BundleStore(File root) {
        this.dir = new File(root, "bundles");
        this.served = new File(root, "served");
        dir.mkdirs();
    }

    private File file(String name) throws IOException {
        if (name == null || !name.matches("[A-Za-z0-9._-]{1,128}") || name.contains("..")) {
            throw new IOException("bad file name");
        }
        return new File(dir, name);
    }

    public void write(String name, byte[] bytes) throws IOException {
        File f = file(name);
        File tmp = new File(dir, name + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(bytes); o.getFD().sync(); }
        try { java.nio.file.Files.move(tmp.toPath(), f.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING); }
        catch (IOException e) { tmp.delete(); throw new IOException("could not write " + name); }
    }

    public byte[] read(String name) throws IOException { 
        try (InputStream in = new FileInputStream(file(name))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            copy(in, out);
            return out.toByteArray();
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    }

    /**
     * Builds `name` from the stored `baseName` and a patch. Writes the file only when the patch, the
     * rebuilt size and the rebuilt hash all check out; otherwise the caller downloads the full bundle.
     */
    public PatchStep.Outcome patch(String baseName, byte[] patch, String patchSha256, String name, long newSize, String newSha256, long maxMemory) {
        byte[] base = null;
        try { if (file(baseName).length() <= maxMemory) base = read(baseName); } catch (IOException | OutOfMemoryError e) { base = null; }
        PatchStep.Outcome o = PatchStep.run(base, patch, patchSha256, newSize, newSha256, maxMemory);
        if (o.bytes == null) return o;
        try { write(name, o.bytes); return o; } catch (IOException e) { return new PatchStep.Outcome("full", null, e.getMessage()); }
    }

    public void remove(String name) throws IOException { file(name).delete(); }

    public List<String> list() {
        String[] names = dir.list();
        List<String> out = new ArrayList<>();
        if (names != null) { Arrays.sort(names); for (String n : names) if (!n.endsWith(".tmp")) out.add(n); }
        return out;
    }

    public void clear() {
        String[] names = dir.list();
        if (names != null) for (String n : names) new File(dir, n).delete();
        deleteTree(served);
    }

    public static String sha256Hex(byte[] bytes) throws IOException {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IOException(e); }
    }

    /**
     * Unpacks a stored zip into a fresh directory, but only if its sha-256 equals the hash the
     * core verified against the signed pointer. Entries that escape the directory are refused.
     */
    public File unpack(String name, String expectedSha256) throws IOException {
        byte[] bytes = read(name);
        if (expectedSha256 == null || !sha256Hex(bytes).equalsIgnoreCase(expectedSha256)) {
            throw new IOException("bundle hash does not match");
        }
        deleteTree(served);
        File target = new File(served, name);
        target.mkdirs();
        String root = target.getCanonicalPath() + File.separator;
        try (ZipInputStream z = new ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) {
                File out = new File(target, e.getName());
                if (!out.getCanonicalPath().startsWith(root)) { deleteTree(served); throw new IOException("bad entry in bundle"); }
                if (e.isDirectory()) { out.mkdirs(); continue; }
                out.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(out)) { copy(z, o); }
            }
        }
        if (!new File(target, "index.html").isFile()) { deleteTree(served); throw new IOException("bundle has no index.html"); }
        return target;
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }
}
