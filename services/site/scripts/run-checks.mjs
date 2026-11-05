#!/usr/bin/env node
// Runs every site check: scripts/check-*.mjs and test/*.mjs (files ending in .test.mjs or named in test/).
// New checks only need a new file here; never list them in package.json (that line was a merge-conflict hotspot).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ...readdirSync(join(site, "scripts")).filter((f) => /^check-.*\.mjs$/.test(f)).sort().map((f) => join("scripts", f)),
  ...readdirSync(join(site, "test")).filter((f) => /\.mjs$/.test(f) && !f.startsWith("_")).sort().map((f) => join("test", f)),
];
let failed = [];
for (const f of files) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", f], { cwd: site, stdio: "inherit", env: process.env });
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length}/${files.length} site checks passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
