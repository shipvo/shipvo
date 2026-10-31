#!/usr/bin/env node
// Signs an iOS release pointer for the e2e server, the same wire format `shipvo publish --platform ios` writes.
//   node make-release.mjs <root> <appId> <seed> <release> <bundle.hbc> [minShell]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signBytes, sha256Hex } from "../../packages/cli/dist/index.js";

const [root, app, seed, releaseS, file, min = "1.0.0"] = process.argv.slice(2);
const release = Number(releaseS), bytes = new Uint8Array(readFileSync(file));
mkdirSync(join(root, "b", app), { recursive: true });
writeFileSync(join(root, "b", app, `ios-r${release}.hbc`), bytes);
for (const band of ["b0", "b1", "b2"]) {
  const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, platform: "ios", release, issued_at: new Date().toISOString(),
    core: { version: `1.0.${release}`, sha256: sha256Hex(bytes), size: bytes.length, url: `b/${app}/ios-r${release}.hbc`, patches: [] }, addons: [], screens: [], min_shell_version: min });
  mkdirSync(join(root, "p", app, "1", "ios"), { recursive: true });
  writeFileSync(join(root, "p", app, "1", "ios", `${band}.json`), JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), seed) }));
}
console.log(`signed iOS release ${release} (${bytes.length} bytes) for ${app}`);
