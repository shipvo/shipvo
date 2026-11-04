// Read the Hermes bytecode version from a bundle header, and check it against what the app's shells declare.
// A Hermes bytecode file starts with an 8-byte magic number (little-endian 0x1F1903C103BC1FC6),
// (source: Hermes `BytecodeVersion.h` and the file header layout in the Hermes repo),
// followed by the bytecode format version as a 32-bit little-endian integer.
const MAGIC = [0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f];

/** True if the bytes start with the Hermes bytecode magic number. */
export const isHermesBytecode = (b: Uint8Array): boolean => b.length >= 12 && MAGIC.every((m, i) => b[i] === m);

/** The bytecode version in the header, or null if this is not Hermes bytecode. */
export function hermesBytecodeVersion(b: Uint8Array): number | null {
  if (!isHermesBytecode(b)) return null;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(8, true);
}

/** Parse a declared version list such as "96" or "96,98" (CLI flag) or a number / number[] (shipvo.json). */
export function parseDeclared(v: unknown): number[] | undefined {
  if (v === true || v === "true") throw new Error("--hermes-bytecode-version needs a value, for example --hermes-bytecode-version 96");
  if (v === undefined || v === null || v === "") return undefined;
  const list = Array.isArray(v) ? v : String(v).split(",");
  const nums = list.map((x) => Number(String(x).trim()));
  if (!nums.length || nums.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error(`hermes bytecode version must be positive integers (got ${JSON.stringify(v)})`);
  return nums;
}

/**
 * Decide what to record in the release. Returns the version (or undefined when nothing is known).
 * Throws when the bundle is not bytecode but the app declares a bytecode version, or when the versions differ.
 */
export function checkBundle(file: string, bytes: Uint8Array, declared?: number[]): number | undefined {
  const version = hermesBytecodeVersion(bytes);
  if (version === null) {
    if (file.endsWith(".hbc")) throw new Error(`${file} has a .hbc name but no Hermes bytecode header. Was it compiled with hermesc?`);
    if (declared) throw new Error(`${file} is plain JavaScript, but the app declares Hermes bytecode version ${declared.join(", ")}. Enable Hermes bytecode in the export, or remove hermesBytecodeVersion.`);
    return undefined;
  }
  if (declared && !declared.includes(version)) throw new Error(`${file} is Hermes bytecode version ${version}, but the app's shells run ${declared.join(", ")}. Build with the same Hermes as the shell, or update hermesBytecodeVersion if the shell changed.`);
  return version;
}
