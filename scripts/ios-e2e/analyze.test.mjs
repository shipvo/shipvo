import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, analyzePatch, median, parseLog, analyzeResume, resumeTable } from "./analyze.mjs";

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

import { analyzeHermesRefusal, hermesRefusalTable, parseTelemetry } from "./analyze.mjs";

const tl = (o) => `POST /t ${JSON.stringify({ schema_version: "1.0", app_id: "e2e", ...o })}`;
const hm = { release: 3, previous_release: 2, running_release: 2 };

test("Hermes mismatch refused: passing log", () => {
  const ev = parseTelemetry(["GET /p/e2e/1/ios/b0 200", tl({ release: 2, event: "applied" }), tl({ release: 3, event: "hermes_bytecode_mismatch" })].join("\n"));
  const r = analyzeHermesRefusal(ev, hm);
  assert.equal(r.pass, true);
  assert.match(hermesRefusalTable(r), /Hermes mismatch refused \| pass/);
});

test("Hermes mismatch refused: failing logs", () => {
  const applied = parseTelemetry(tl({ release: 3, event: "applied" }));
  assert.equal(analyzeHermesRefusal(applied, { ...hm, running_release: 3 }).pass, false);
  const none = parseTelemetry(tl({ release: 2, event: "applied" }));
  assert.match(analyzeHermesRefusal(none, hm).detail, /no hermes_bytecode_mismatch/);
  const wrong = parseTelemetry(tl({ release: 3, event: "verify_failed" }));
  assert.equal(analyzeHermesRefusal(wrong, hm).pass, false);
  const ok = parseTelemetry(tl({ release: 3, event: "hermes_bytecode_mismatch" }));
  assert.equal(analyzeHermesRefusal(ok, { ...hm, running_release: 3 }).pass, false);
  assert.match(hermesRefusalTable({ pass: false, detail: "x" }), /\| fail \|/);
  assert.throws(() => analyzeHermesRefusal(ok, {}), /missing release/);
});


const rm = { release: 3, bundlePath: "/b/e2e/ios-r3.hbc" };
const rl = (...lines) => lines.join("\n");
const P = "/b/e2e/ios-r3.hbc";

test("Interrupted download resumed: passing log", () => {
  const r = analyzeResume(rl(`GET ${P} 200 cut at 500`, `GET ${P} 206 from 500 range=bytes=500-`, tl({ release: 3, event: "applied" })), rm);
  assert.equal(r.pass, true);
  assert.match(resumeTable(r), /Interrupted download resumed \| pass/);
});

test("Interrupted download resumed: failing logs", () => {
  const cut = `GET ${P} 200 cut at 500`, ok = `GET ${P} 206 from 500 range=bytes=500-`, applied = tl({ release: 3, event: "applied" });
  assert.match(analyzeResume(rl(`GET ${P} 200`, applied), rm).detail, /never cut/);
  assert.match(analyzeResume(rl(cut, applied), rm).detail, /did not retry/);
  assert.match(analyzeResume(rl(cut, `GET ${P} 200`, applied), rm).detail, /byte 0/);
  assert.equal(analyzeResume(rl(cut, `GET ${P} 206 from 0 range=bytes=0-`, applied), rm).pass, false);
  assert.match(analyzeResume(rl(cut, ok), rm).detail, /never became healthy/);
  assert.match(analyzeResume(rl(cut, ok, tl({ release: 2, event: "applied" })), rm).detail, /never became healthy/);
  assert.match(analyzeResume(rl(cut, ok, `GET ${P} 200`, applied), rm).detail, /after the ranged request/);
  assert.throws(() => analyzeResume("", {}), /need release/);
});

test("RESUME_MARKS without the text log exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "rm-")), f = join(dir, "m.json");
  const jl = join(dir, "s.jsonl");
  writeFileSync(f, JSON.stringify([{ pointer_published: 900, app_launched: 1000, healthy: 2000 }]));
  writeFileSync(jl, L(1300, "/b/e2e/ios-r1.hbc", 1000) + "\n");
  const r = spawnSync(process.execPath, [new URL("./analyze.mjs", import.meta.url).pathname, jl, f], { env: { ...process.env, RESUME_MARKS: f }, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /resume marks need the text server log as the fifth argument/);
});

test("server CUT_ONCE closes the first response early, then serves Range with 206", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cut-")), port = 18000 + (process.pid % 1000);
  execFileSync("mkdir", ["-p", join(dir, "b")]);
  writeFileSync(join(dir, "b/x.hbc"), Buffer.alloc(1000, 7));
  const logf = join(dir, "s.log");
  const srv = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname, dir, String(port), logf], { env: { ...process.env, CUT_ONCE: "/b/x.hbc:400" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) {
      if (await new Promise((r) => net.connect(port, "127.0.0.1").once("connect", function () { this.destroy(); r(true); }).once("error", () => r(false)))) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${port}`;
    await assert.rejects(async () => { const r = await fetch(base + "/b/x.hbc"); await r.arrayBuffer(); });
    const r2 = await fetch(base + "/b/x.hbc", { headers: { range: "bytes=400-" } });
    assert.equal(r2.status, 206); assert.equal((await r2.arrayBuffer()).byteLength, 600);
    assert.equal((await (await fetch(base + "/b/x.hbc")).arrayBuffer()).byteLength, 1000);
    const text = readFileSync(logf, "utf8");
    assert.match(text, /GET \/b\/x\.hbc 200 cut at 400\nGET \/b\/x\.hbc 206 from 400 range=bytes=400-\n/);
  } finally { srv.kill(); }
});

import { analyzeCrashLoop, crashLoopTable } from "./analyze.mjs";

const cm = { release: 3, previous_release: 2, running_release: 2, launches: 4 };

test("Crash-loop reverted: passing log", () => {
  const ev = parseTelemetry([tl({ release: 2, event: "applied" }), tl({ release: 3, event: "crash_loop_revert" })].join("\n"));
  const r = analyzeCrashLoop(ev, cm);
  assert.equal(r.pass, true);
  assert.match(crashLoopTable(r), /Crash-loop reverted \| pass \| 4 \|/);
});

test("Crash-loop reverted: failing logs", () => {
  const ok = parseTelemetry(tl({ release: 3, event: "crash_loop_revert" }));
  // reverted too late: the bad release ran 4 times
  const late = analyzeCrashLoop(ok, { ...cm, launches: 5 });
  assert.equal(late.pass, false);
  assert.match(late.detail, /ran 4 times/);
  // never reverted: no event, app still on the bad release
  const none = parseTelemetry(tl({ release: 3, event: "applied" }));
  const never = analyzeCrashLoop(none, { ...cm, running_release: 3, launches: 4 });
  assert.equal(never.pass, false);
  assert.match(never.detail, /no crash_loop_revert/);
  // event for another release only
  assert.equal(analyzeCrashLoop(parseTelemetry(tl({ release: 2, event: "crash_loop_revert" })), cm).pass, false);
  // wrong final release
  const wrong = analyzeCrashLoop(ok, { ...cm, running_release: 0 });
  assert.equal(wrong.pass, false);
  assert.match(wrong.detail, /ends on release 0, expected 2/);
  assert.match(crashLoopTable(wrong), /\| fail \| 4 \|/);
  assert.throws(() => analyzeCrashLoop(ok, {}), /missing release/);
});

test("make-release CRASH_ON_START compiles a throwing script with HERMESC", () => {
  const dir = mkdtempSync(join(tmpdir(), "crash-")), root = join(dir, "cp"), out = join(dir, "crash.hbc");
  const fake = join(dir, "hermesc.sh");
  writeFileSync(fake, '#!/bin/sh\n# hermesc -emit-binary -out <out> <src>\ngrep -q "throw new Error" "$4" && cp "$4" "$3"\n', { mode: 0o755 });
  const seed = JSON.parse(execFileSync(process.execPath, [new URL("./keygen.mjs", import.meta.url).pathname])).seed;
  const script = new URL("./make-release.mjs", import.meta.url).pathname;
  execFileSync(process.execPath, [script, root, "e2e", seed, "3", out], { env: { ...process.env, CRASH_ON_START: "1", HERMESC: fake } });
  assert.match(readFileSync(out, "utf8"), /crash on start/);
  assert.equal(readFileSync(join(root, "b/e2e/ios-r3.hbc"), "utf8"), readFileSync(out, "utf8"));
  const r = spawnSync(process.execPath, [script, root, "e2e", seed, "4", out], { env: { ...process.env, CRASH_ON_START: "1", HERMESC: "" }, encoding: "utf8" });
  assert.notEqual(r.status, 0);
});
