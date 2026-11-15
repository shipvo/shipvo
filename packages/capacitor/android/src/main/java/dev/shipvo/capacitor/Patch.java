package dev.shipvo.capacitor;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

/** bspatch for the BSDIFF40 format (bsdiff 4.x): header, then bzip2 control, diff and extra blocks. Copied in small form from packages/runtime. */
final class Patch {
    private Patch() {}

    private static long offtin(byte[] b, int o) {
        long y = b[o + 7] & 0x7F;
        for (int i = 6; i >= 0; i--) y = (y << 8) | (b[o + i] & 0xFF);
        return (b[o + 7] & 0x80) != 0 ? -y : y;
    }

    private static void readFully(InputStream in, byte[] buf, int off, int len) throws IOException {
        int n = 0;
        while (n < len) {
            int r = in.read(buf, off + n, len - n);
            if (r <= 0) throw new IOException("patch truncated");
            n += r;
        }
    }

    static byte[] apply(byte[] old, byte[] patch) throws IOException {
        if (patch.length < 32 || !"BSDIFF40".equals(new String(patch, 0, 8, StandardCharsets.US_ASCII))) throw new IOException("not a BSDIFF40 patch");
        long ctrlLen = offtin(patch, 8), diffLen = offtin(patch, 16), newSize = offtin(patch, 24);
        if (ctrlLen < 0 || diffLen < 0 || newSize < 0 || newSize > (64L << 20) || 32 + ctrlLen + diffLen > patch.length) throw new IOException("bad patch header");
        int extraStart = (int) (32 + ctrlLen + diffLen);
        byte[] out = new byte[(int) newSize];
        try (InputStream ctrl = new BZip2CompressorInputStream(new ByteArrayInputStream(patch, 32, (int) ctrlLen));
             InputStream diff = new BZip2CompressorInputStream(new ByteArrayInputStream(patch, 32 + (int) ctrlLen, (int) diffLen));
             InputStream extra = new BZip2CompressorInputStream(new ByteArrayInputStream(patch, extraStart, patch.length - extraStart))) {
            long oldPos = 0, newPos = 0;
            byte[] c = new byte[24];
            while (newPos < newSize) {
                readFully(ctrl, c, 0, 24);
                long x = offtin(c, 0), y = offtin(c, 8), z = offtin(c, 16);
                if (x < 0 || y < 0 || newPos + x + y > newSize) throw new IOException("corrupt patch control");
                readFully(diff, out, (int) newPos, (int) x);
                for (int i = 0; i < x; i++) {
                    long op = oldPos + i;
                    if (op >= 0 && op < old.length) out[(int) newPos + i] += old[(int) op];
                }
                newPos += x; oldPos += x;
                readFully(extra, out, (int) newPos, (int) y);
                newPos += y; oldPos += z;
            }
        }
        return out;
    }
}
