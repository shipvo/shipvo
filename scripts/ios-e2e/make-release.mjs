#!/usr/bin/env node
// Signs an iOS release pointer for the e2e server, the same wire format `shipvo publish --platform ios` writes.
//   node make-release.mjs <root> <appId> <seed> <release> <bundle.hbc> [minShell]
// With PATCH_FROM=<file>[,<file>...] (for example the app's embedded main.jsbundle, and release 1's bundle when
// building release 2) it also lists a bsdiff patch from each file, built with the Python bsdiff4 module, like
// `shipvo publish` does.
// With MISMATCH_HERMES=1 the bundle's Hermes bytecode version is changed to a different one before signing, so the
// release is one the app must refuse (the file given is not modified).
// Like `shipvo publish`, the pointer carries `hermes_bytecode_version` (read from the bundle header) when the bundle is
// Hermes bytecode. The iOS runtime refuses a mismatch from this field, so without it a mismatched release is applied.
// With CRASH_ON_START=1 the file given is written first: Hermes bytecode of a script that throws when it starts,
// compiled by the Hermes compiler at HERMESC (the one that matches the app's React Native). It is the bad release
// for the crash-loop scenario.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hermesVersionOf, otherHermesVersion, withHermesVersion } from "./hermes.mjs";
import { signBytes, sha256Hex } from "../../packages/cli/dist/index.js";

const [root, app, seed, releaseS, file, min = "1.0.0"] = process.argv.slice(2);
const release = Number(releaseS);
if (process.env.CRASH_ON_START === "1") {
  if (!process.env.HERMESC) throw new Error("CRASH_ON_START=1 needs HERMESC, the path of the hermesc binary");
  const src = `${file}.crash.js`;
  writeFileSync(src, 'throw new Error("ios-e2e: crash on start");\n');
  execFileSync(process.env.HERMESC, ["-emit-binary", "-out", file, src]);
}
let bytes = new Uint8Array(readFileSync(file));
if (process.env.MISMATCH_HERMES === "1") {
  const shell = hermesVersionOf(bytes);
  if (shell == null) throw new Error("MISMATCH_HERMES=1 needs a Hermes bytecode bundle");
  bytes = withHermesVersion(bytes, otherHermesVersion(shell));
  console.log(`bytecode version ${shell} -> ${hermesVersionOf(bytes)}`);
}
mkdirSync(join(root, "b", app), { recursive: true });
writeFileSync(join(root, "b", app, `ios-r${release}.hbc`), bytes);
const hermesVersion = hermesVersionOf(bytes);
const patches = [], seen = new Set();
for (const from of (process.env.PATCH_FROM || "").split(",").filter(Boolean)) {
  const fromSha = sha256Hex(new Uint8Array(readFileSync(from)));
  if (seen.has(fromSha)) continue;
  seen.add(fromSha);
  const url = `b/${app}/ios-d-${fromSha.slice(0, 16)}-r${release}.bsdiff`;
  execFileSync("python3", ["-c", "import sys, bsdiff4; bsdiff4.file_diff(sys.argv[1], sys.argv[2], sys.argv[3])", from, file, join(root, url)]);
  const patch = new Uint8Array(readFileSync(join(root, url)));
  patches.push({ from_sha256: fromSha, url, size: patch.length, sha256: sha256Hex(patch) });
  console.log(`patch from ${fromSha.slice(0, 12)}: ${patch.length} bytes`);
}
for (const band of ["b0", "b1", "b2"]) {
  const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, platform: "ios", release, issued_at: new Date().toISOString(),
    core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${app}/ios-r${release}.hbc`, patches }, addons: [], screens: [], min_shell_version: min, ...(hermesVersion ? { hermes_bytecode_version: hermesVersion } : {}) });
  mkdirSync(join(root, "p", app, "1", "ios"), { recursive: true });
  writeFileSync(join(root, "p", app, "1", "ios", `${band}.json`), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), seed) }));
}
console.log(`signed iOS release ${release} (${bytes.length} bytes) for ${app}`);
