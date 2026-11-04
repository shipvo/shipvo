#!/usr/bin/env node
// Writes a static fake control plane for the iOS runtime tests: signed iOS pointers plus bundles, and deliberately bad
// ones (wrong signature, wrong hash, Android pointer, shell too old). Usage: node scripts/ios-fixture.mjs <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { signBytes, sha256Hex, keyFromSeed, b64 } from "../packages/cli/dist/index.js";

const out = process.argv[2] || "fixture";
const seed = b64(randomBytes(32)), otherSeed = b64(randomBytes(32));
const publicKey = b64(keyFromSeed(seed).publicKey);
const bundle = Buffer.concat([Buffer.from("SHIPVO-TEST-BUNDLE\n"), randomBytes(200_000)]);

function put(path, data) { mkdirSync(join(out, path, ".."), { recursive: true }); writeFileSync(join(out, path), data); }
function pointer(app, { release = 5, sig = seed, platform = "ios", sha = sha256Hex(bundle), size = bundle.length, min = "1.0.0", file = `ios-r${release}.hbc` } = {}) {
  for (const band of ["b0", "b1", "b2"]) {
    const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, ...(platform ? { platform } : {}), release,
      issued_at: new Date().toISOString(), core: { version: `1.0.${release}`, sha256: sha, size, url: `b/${app}/${file}` }, addons: [], screens: [], min_shell_version: min });
    put(`p/${app}/1/${platform === "ios" ? "ios/" : ""}${band}.json`, JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), sig) }));
  }
  put(`b/${app}/${file}`, bundle);
}
// A BSDIFF40 patch built by hand (bzip2 CLI): the new bundle is the old one with 100 bytes changed and 50 appended.
const bz = (b) => execFileSync("bzip2", ["-c"], { input: b, maxBuffer: 1 << 26 });
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const bundle2 = Buffer.concat([Buffer.from(bundle), Buffer.alloc(50, 7)]); for (let i = 5000; i < 5100; i++) bundle2[i] ^= 0x55;
function bsdiff(oldB, newB) {
  const diff = Buffer.alloc(oldB.length); for (let i = 0; i < oldB.length; i++) diff[i] = (newB[i] - oldB[i]) & 0xff;
  const ctrl = bz(Buffer.concat([i64(oldB.length), i64(newB.length - oldB.length), i64(0)])), d = bz(diff), extra = bz(newB.subarray(oldB.length));
  return Buffer.concat([Buffer.from("BSDIFF40"), i64(ctrl.length), i64(d.length), i64(newB.length), ctrl, d, extra]);
}
function patchPointer(app, patchBytes) {
  const url = `b/${app}/d-r6.bsdiff`, sha = sha256Hex(bundle2);
  for (const band of ["b0", "b1", "b2"]) {
    const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, platform: "ios", release: 6, issued_at: new Date().toISOString(),
      core: { version: "1.0.6", sha256: sha, size: bundle2.length, url: `b/${app}/ios-r6.hbc`, patches: [{ from_sha256: sha256Hex(bundle), url, size: patchBytes.length, sha256: sha256Hex(patchBytes) }] }, addons: [], screens: [], min_shell_version: "1.0.0" });
    put(`p/${app}/1/ios/${band}.json`, JSON.stringify({ body, signature: signBytes(new TextEncoder().encode(body), seed) }));
  }
  put(url, patchBytes); put(`b/${app}/ios-r6.hbc`, bundle2);
}
const goodPatch = bsdiff(bundle, bundle2);
patchPointer("patch", goodPatch);                              // release 6, patch from the release 5 bundle
patchPointer("bad-patch", Buffer.concat([goodPatch.subarray(0, 40), Buffer.alloc(30, 1)])); // valid hash, broken contents: must fall back to the full bundle
put("b/good/ios-r5.hbc", bundle);
pointer("good");                                   // release 5, valid
pointer("no-range");                               // same as good, but its server ignores Range
pointer("good-next", { release: 6 });              // a newer one for the same app id family
pointer("bad-sig", { sig: otherSeed });            // signed by someone else
pointer("bad-hash", { sha: "0".repeat(64) });      // body says another hash than the bytes
pointer("bad-size", { size: bundle.length + 1 });  // size mismatch
pointer("old-shell", { min: "9.0.0" });            // needs a newer app binary
pointer("android-ptr", { platform: null });        // lives at the Android key: iOS must never read it
// An Android-signed pointer copied to the iOS key must still be refused (platform field missing).
const body = JSON.stringify({ schema_version: "1.0", app_id: "replay", shell_major: 1, band: "b0", release: 5, issued_at: new Date().toISOString(), core: { version: "1.0.5", sha256: sha256Hex(bundle), size: bundle.length, url: "b/replay/ios-r5.hbc" }, addons: [], screens: [], min_shell_version: "1.0.0" });
for (const band of ["b0", "b1", "b2"]) put(`p/replay/1/ios/${band}.json`, JSON.stringify({ body: body.replace('"band":"b0"', `"band":"${band}"`), signature: signBytes(new TextEncoder().encode(body.replace('"band":"b0"', `"band":"${band}"`)), seed) }));
put("b/replay/ios-r5.hbc", bundle);
writeFileSync(join(out, "meta.json"), JSON.stringify({ publicKey, bundleSha: sha256Hex(bundle), bundleSize: bundle.length, bundle2Sha: sha256Hex(bundle2), patchSize: goodPatch.length }));
console.log(JSON.stringify({ out, publicKey }));
