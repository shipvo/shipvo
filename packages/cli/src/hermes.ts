import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
// Read the Hermes bytecode version from a bundle header, and check it against what the app's shells declare.
// A Hermes bytecode file starts with an 8-byte magic number (little-endian 0x1F1903C103BC1FC6),
// followed by the bytecode format version as a 32-bit little-endian integer.
// Layout source: the BytecodeFileHeader struct in facebook/hermes, include/hermes/BCGen/HBC/BytecodeFileFormat.h
// (fields MAGIC, then VERSION).
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

const ENGINE_ID = /^\d+\.\d+\.\d+$/;

/** Validate a Hermes engine build id such as "250829098.0.10". Undefined, null and "" mean "not declared". */
export function parseEngine(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !ENGINE_ID.test(v.trim())) throw new Error(`hermesEngine must look like 250829098.0.10 (got ${JSON.stringify(v)})`);
  return v.trim();
}

/**
 * The engine build of the Hermes compiler this project uses: the version of the `hermes-compiler` package
 * (React Native 0.83+ depends on it), looked up from the project, then from react-native's own install.
 * Returns undefined when it cannot be found or the version is not an engine id.
 */
export function installedHermesEngine(cwd: string): string | undefined {
  const from = (base: string) => { try { return createRequire(join(base, "package.json")).resolve("hermes-compiler/package.json"); } catch { return undefined; } };
  let path = from(cwd);
  if (!path) {
    try { path = from(dirname(createRequire(join(cwd, "package.json")).resolve("react-native/package.json"))); } catch {}
  }
  if (!path) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, "utf8")).version;
    return typeof v === "string" && ENGINE_ID.test(v) ? v : undefined;
  } catch { return undefined; }
}

/** Refuse a publish when the app declares an engine build and the compiler in use is another one (or cannot be identified). Returns the id to record. */
export function checkEngine(installed: string | undefined, declared: string | undefined): string | undefined {
  if (declared && installed !== declared) {
    throw new Error(installed
      ? `The app declares Hermes engine ${declared} (hermesEngine in shipvo.json), but hermes-compiler here is ${installed}. Build with the same Hermes as the shell, or update hermesEngine if the shell changed.`
      : `The app declares Hermes engine ${declared} (hermesEngine in shipvo.json), but the hermes-compiler version could not be read from this project. Install hermes-compiler, or remove hermesEngine.`);
  }
  return installed;
}
