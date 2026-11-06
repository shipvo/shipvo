import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { b64 } from "../../packages/cli/dist/index.js";
import { publishRelease } from "./release.mjs";
import { sha256 } from "./lib.mjs";

const seed = b64(randomBytes(32));
const old = new Uint8Array(randomBytes(20000));
const next = old.slice(); next[100] ^= 1; next[9000] ^= 1; // a small edit, so a patch is much smaller than the bundle

test("writes the bundle and one pointer per band", () => {
  const root = mkdtempSync(join(tmpdir(), "rel-"));
  publishRelease({ root, app: "tide", seed, release: 2, bytes: next });
  assert.equal(sha256(readFileSync(join(root, "b/tide/r2.hbc"))), sha256(next));
  for (const b of ["b0", "b1", "b2"]) assert.equal(JSON.parse(JSON.parse(readFileSync(join(root, `p/tide/1/${b}.json`), "utf8")).body).release, 2);
});
test("only the listed bands get a pointer", () => {
  const root = mkdtempSync(join(tmpdir(), "rel-"));
  publishRelease({ root, app: "tide", seed, release: 3, bytes: next, bands: ["b1"] });
  assert.ok(existsSync(join(root, "p/tide/1/b1.json"))); assert.ok(!existsSync(join(root, "p/tide/1/b0.json")));
});
test("a patch is offered for a similar base and names the base hash", () => {
  const root = mkdtempSync(join(tmpdir(), "rel-"));
  const { patches } = publishRelease({ root, app: "tide", seed, release: 4, bytes: next, bases: [old] });
  assert.equal(patches.length, 1); assert.equal(patches[0].from_sha256, sha256(old)); assert.ok(patches[0].size < next.length * 0.6);
  assert.equal(sha256(readFileSync(join(root, patches[0].url))), patches[0].sha256);
});
test("no patch for an identical base", () => {
  const root = mkdtempSync(join(tmpdir(), "rel-"));
  assert.equal(publishRelease({ root, app: "tide", seed, release: 5, bytes: next, bases: [next] }).patches.length, 0);
});
