// Publishes one signed release into the local server tree, like `shipvo publish` does for the real control plane:
// bundle at b/<app>/r<N>.hbc, bsdiff patches against given bases, and one signed pointer per band.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPointer, sha256 } from "./lib.mjs";

function bsdiff(oldBytes, newBytes) {
  const w = mkdtempSync(join(tmpdir(), "bsd-"));
  try {
    writeFileSync(join(w, "o"), oldBytes); writeFileSync(join(w, "n"), newBytes);
    execFileSync("python3", ["-c", "import sys,bsdiff4; bsdiff4.file_diff(*sys.argv[1:4])", join(w, "o"), join(w, "n"), join(w, "p")]);
    return new Uint8Array(readFileSync(join(w, "p")));
  } finally { rmSync(w, { recursive: true, force: true }); }
}
const put = (file, data) => { mkdirSync(dirname(file), { recursive: true }); const t = file + ".tmp"; writeFileSync(t, data); renameSync(t, file); };

/**
 * bases: byte arrays of bundles the device may already have; a patch is written for each (full bundle if the patch is
 * not under 60% of it, same rule as `shipvo publish`). Returns { at, patches } where `at` is the ms time the last
 * pointer became visible.
 */
export function publishRelease({ root, app, seed, release, bytes, bands = ["b0", "b1", "b2"], bases = [], tamper, minShell = "1.0.0", hermesBytecodeVersion }) {
  const url = `b/${app}/r${release}.hbc`;
  put(join(root, url), bytes);
  const patches = [];
  for (const base of bases) {
    if (sha256(base) === sha256(bytes)) continue;
    const p = bsdiff(base, bytes);
    if (p.length >= bytes.length * 0.6) continue;
    const purl = `b/${app}/d-${sha256(base).slice(0, 16)}-r${release}.bsdiff`;
    put(join(root, purl), p);
    patches.push({ from_sha256: sha256(base), url: purl, size: p.length, sha256: sha256(p) });
  }
  const issuedAt = new Date().toISOString();
  for (const band of bands) put(join(root, "p", app, "1", `${band}.json`), JSON.stringify(buildPointer({ app, seed, release, band, bytes, url, patches, minShell, tamper, hermesBytecodeVersion, issuedAt })));
  return { at: Date.now(), patches };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  // node release.mjs <root> <app> <seed> <release> <bundle.hbc> [--base file]... [--tamper signature|hash|size] [--bands b0,b1]
  const [root, app, seed, rel, file, ...rest] = process.argv.slice(2);
  const opt = (k) => rest.flatMap((x, i) => (x === k ? [rest[i + 1]] : []));
  const r = publishRelease({ root, app, seed, release: Number(rel), bytes: new Uint8Array(readFileSync(file)), bases: opt("--base").map((f) => new Uint8Array(readFileSync(f))), tamper: opt("--tamper")[0], bands: opt("--bands")[0]?.split(",") });
  console.log(`published release ${rel}: ${r.patches.length} patches`);
}
