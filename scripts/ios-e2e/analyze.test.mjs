import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, analyzePatch, median, parseLog } from "./analyze.mjs";

const L = (t, path, bytes) => JSON.stringify({ t, path, bytes });
// Run windows: [1000,2000], [3000,4000], [5000,6500], [7000,8000]
const log = parseLog([
  L(500, "/b/old.hbc", 9999), // outside any window
  L(1100, "/p/e2e/1/ios/b0.json", 300), L(1300, "/b/e2e/ios-r1.hbc", 1000), L(1500, "/t", 20),
  L(3100, "/p/e2e/1/ios/b0.json", 300), L(3500, "/b/e2e/ios-r1.hbc", 2000),
  L(5200, "/p/e2e/1/ios/b0.json", 300), L(5900, "/b/e2e/ios-r1.hbc", 3000),
  L(7050, "/p/e2e/1/ios/b0.json", 300), L(7250, "/b/e2e/ios-r1.hbc", 4000),
].join("\n"));
const m = (p, a, h) => ({ pointer_published: p, app_launched: a, healthy: h });
const marks = [m(900, 1000, 2000), m(2900, 3000, 4000), m(4900, 5000, 6500), m(6900, 7000, 8000)];

test("median handles odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.throws(() => median([]));
});

test("odd run count", () => {
  assert.equal(analyze(log, marks.slice(0, 3)),
`| Runs | Median download bytes | Median download time (ms) | Median apply time (ms) | Median publish-to-healthy (ms) |
| --- | --- | --- | --- | --- |
| 3 | 2000 | 400 | 600 | 1100 |
`);
});

test("even run count", () => {
  assert.equal(analyze(log, marks),
`| Runs | Median download bytes | Median download time (ms) | Median apply time (ms) | Median publish-to-healthy (ms) |
| --- | --- | --- | --- | --- |
| 4 | 2500 | 300 | 650 | 1100 |
`);
});

test("errors on missing marks or downloads", () => {
  assert.throws(() => analyze(log, [{ pointer_published: 1, app_launched: 2 }]), /missing mark healthy/);
  assert.throws(() => analyze(log, [m(0, 10, 20)]), /no bundle download/);
  assert.throws(() => parseLog('{"t":1}'), /bad log line 1/);
});

test("server writes valid JSON lines with t, path, bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"));
  writeFileSync(join(dir, "a.bin"), "hello");
  const logFile = join(dir, "s.log"), port = 18100 + (process.pid % 500);
  const srv = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname, dir, String(port), logFile], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((r) => srv.stdout.once("data", r));
    await (await fetch(`http://127.0.0.1:${port}/a.bin`)).arrayBuffer();
    await (await fetch(`http://127.0.0.1:${port}/nope`)).arrayBuffer();
    await new Promise((r) => setTimeout(r, 100));
  } finally { srv.kill(); }
  const lines = parseLog(readFileSync(logFile + ".jsonl", "utf8"));
  assert.deepEqual(lines.map((e) => [e.path, e.bytes]), [["/a.bin", 5], ["/nope", '{"error":"not_found"}'.length]]);
  assert.ok(lines.every((e) => Math.abs(e.t - Date.now()) < 60000));
  assert.match(readFileSync(logFile, "utf8"), /^GET \/a\.bin 200/);
});

test("patch rows: median patch size, full size and last-byte-to-healthy", () => {
  const pl = parseLog([
    L(1100, "/p/e2e/1/ios/b0.json", 300), L(1300, "/b/e2e/ios-d-aa-r2.bsdiff", 60000),
    L(3100, "/p/e2e/1/ios/b0.json", 300), L(3400, "/b/e2e/ios-d-aa-r2.bsdiff", 64000),
    L(5100, "/b/e2e/ios-d-aa-r2.bsdiff", 70000),
  ].join("\n"));
  const pm = (a, h) => ({ app_launched: a, healthy: h, full_bytes: 1570000 });
  assert.equal(analyzePatch(pl, [pm(1000, 1800), pm(3000, 3900), pm(5000, 5200)]),
`| Patch runs | Median patch bytes | Median full-bundle bytes | Median patch apply time (ms) |
| --- | --- | --- | --- |
| 3 | 64000 | 1570000 | 500 |
`);
});

test("patch rows reject a run that did not use a patch", () => {
  const pl = parseLog([L(1300, "/b/e2e/ios-r2.hbc", 1000), L(3300, "/b/e2e/ios-d-aa-r2.bsdiff", 10), L(3350, "/b/e2e/ios-r2.hbc", 1000)].join("\n"));
  const pm = (a, h) => ({ app_launched: a, healthy: h, full_bytes: 1000 });
  assert.throws(() => analyzePatch(pl, [pm(1000, 2000)]), /no patch download/);
  assert.throws(() => analyzePatch(pl, [pm(3000, 4000)]), /full bundle/);
  assert.throws(() => analyzePatch(pl, [{ app_launched: 1, healthy: 2 }]), /missing mark full_bytes/);
});

test("make-release builds release 2 with patches from the embedded bundle and from release 1", (t) => {
  if (spawnSync("python3", ["-c", "import bsdiff4"]).status !== 0) return t.skip("python bsdiff4 not installed");
  const dir = mkdtempSync(join(tmpdir(), "mk-")), root = join(dir, "cp");
  const base = Buffer.alloc(20000); for (let i = 0; i < base.length; i++) base[i] = (i * 31 + (i >> 8)) & 255;
  const r1 = Buffer.from(base); r1.write("release-one-headline", 5000);
  const r2 = Buffer.from(base); r2.write("release-two-headline", 5000);
  const [emb, f1, f2] = ["emb.bin", "r1.bin", "r2.bin"].map((n) => join(dir, n));
  writeFileSync(emb, base); writeFileSync(f1, r1); writeFileSync(f2, r2);
  const seed = JSON.parse(execFileSync(process.execPath, [new URL("./keygen.mjs", import.meta.url).pathname])).seed;
  const script = new URL("./make-release.mjs", import.meta.url).pathname;
  execFileSync(process.execPath, [script, root, "e2e", seed, "1", f1]);
  execFileSync(process.execPath, [script, root, "e2e", seed, "2", f2], { env: { ...process.env, PATCH_FROM: `${emb},${f1}` } });
  const { body } = JSON.parse(readFileSync(join(root, "p/e2e/1/ios/b0.json"), "utf8"));
  const parsed = JSON.parse(body), core = parsed.core;
  assert.equal(parsed.release, 2);
  assert.equal(core.size, r2.length);
  assert.equal(core.patches.length, 2);
  for (const p of core.patches) assert.ok(p.size > 0 && p.size < core.size / 2, `patch ${p.size} is small`);
  // The same file listed twice gives one patch.
  const root2 = join(dir, "cp2");
  execFileSync(process.execPath, [script, root2, "e2e", seed, "1", f1]);
  execFileSync(process.execPath, [script, root2, "e2e", seed, "2", f2], { env: { ...process.env, PATCH_FROM: `${f1},${f1}` } });
  const dup = JSON.parse(JSON.parse(readFileSync(join(root2, "p/e2e/1/ios/b0.json"), "utf8")).body);
  assert.equal(dup.core.patches.length, 1);
});
