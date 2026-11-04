import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, median, parseLog } from "./analyze.mjs";

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
