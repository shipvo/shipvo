// Hermes bytecode header helpers for the iOS e2e. Copied from scripts/android-e2e/lib.mjs (same rule as `HermesGuard.versionOf`).
const HBC_MAGIC = [0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f];

/** Hermes bytecode version in a bundle header (8-byte magic, then a 32-bit little-endian version), or null for plain JS. */
export function hermesVersionOf(bytes) {
  if (bytes.length < 12 || HBC_MAGIC.some((m, i) => bytes[i] !== m)) return null;
  const v = bytes[8] + bytes[9] * 2 ** 8 + bytes[10] * 2 ** 16 + bytes[11] * 2 ** 24;
  return v >= 1 && v <= 0x7fffffff ? v : null;
}

/** A copy of a Hermes bundle with its header version set to `version`. Plain JS is refused. */
export function withHermesVersion(bytes, version) {
  if (hermesVersionOf(bytes) == null) throw new Error("not a Hermes bytecode bundle");
  const out = Uint8Array.from(bytes); new DataView(out.buffer).setUint32(8, version, true);
  return out;
}

/** A version different from the shell's. */
export const otherHermesVersion = (shell) => (shell === 1 ? 2 : shell - 1);
