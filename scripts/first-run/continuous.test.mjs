import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./continuous.mjs";

const dir = mkdtempSync(join(tmpdir(), "continuous-"));
const put = (name, v) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(v)); return f; };
const measure = put("measure.json", [
  { step: "init", ms: 1200, exit: 0 }, { step: "install", ms: 30500, exit: 0 }, { step: "doctor", ms: 800, exit: 0 }, { step: "total", ms: 40000, exit: 0 },
]);
const APPLIED = [["init", 1100], ["install", 30000], ["build apk", 120000], ["adb install", 6000], ["first publish", 3500], ["first open", 8000], ["publish", 4100], ["publish to healthy", 9300]];
const appliedWith = (steps) => ({ steps: steps.map(([step, ms]) => ({ step, ms, exit: 0 })), totalMs: 99999 });
const applied = put("applied.json", appliedWith(APPLIED));
const ios = put("ios.json", { publishMs: 3000, downloadMs: 700, applyMs: 400, healthyMs: 5000, totalMs: 8000 });
const SHA = "a".repeat(40), URL1 = "https://example.test/runs/1";
const run = (args, env = {}) => { const o = [], e = []; const code = main(args, { out: (s) => o.push(s), err: (s) => e.push(s) }, env); return { code, out: o.join("\n"), err: e.join("\n") }; };

test("android timeline has all eight applied-ota steps from one file", () => {
  const r = run(["--android-applied", applied, "--commit", SHA, "--run-url", URL1, "--json"]);
  assert.equal(r.code, 0, r.err);
  const [t] = JSON.parse(r.out);
  assert.deepEqual(t.rows.map((x) => [x.step, x.ms]), APPLIED);
  assert.equal(t.totalMs, APPLIED.reduce((n, [, ms]) => n + ms, 0));
  assert.ok(t.rows.every((x) => x.script === "applied-ota.mjs" && x.runUrl === URL1));
  const text = run(["--android-applied", applied, "--commit", SHA, "--run-url", URL1]).out;
  assert.match(text, new RegExp(`${t.totalMs} ms`));
  assert.match(text, /aaaaaaa/);
});

test("android needs every step, including build apk", () => {
  const f = put("nobuild.json", appliedWith(APPLIED.filter(([s]) => s !== "build apk")));
  const r = run(["--android-applied", f, "--commit", SHA]);
  assert.equal(r.code, 1);
  assert.match(r.err, /build apk/);
});

test("ios timeline splits publish, the lead time, download and apply", () => {
  const r = run(["--ios-measure", measure, "--ios-apply", ios, "--ios-measure-platform", "ios"], { GITHUB_SHA: SHA, GITHUB_SERVER_URL: "https://gh.test", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "7" });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /iOS init to applied OTA/);
  assert.match(r.out, /https:\/\/gh.test\/o\/r\/actions\/runs\/7/);
  const [t] = JSON.parse(run(["--ios-measure", measure, "--ios-apply", ios, "--json"], { GITHUB_SHA: SHA }).out);
  assert.deepEqual(t.rows.map((x) => [x.step, x.ms]), [["init", 1200], ["install", 30500], ["publish", 3000], ["publish done to download start", 3900], ["download", 700], ["apply", 400]]);
  assert.equal(t.totalMs, 1200 + 30500 + 8000);
});

test("both platforms print two timelines", () => {
  const r = run(["--android-applied", applied, "--ios-measure", measure, "--ios-apply", ios, "--commit", SHA]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Android init/);
  assert.match(r.out, /iOS init/);
});

test("different commits exit 1", () => {
  const r = run(["--ios-measure", measure, "--ios-apply", ios, "--ios-measure-commit", "aaa1111", "--ios-apply-commit", "bbb2222"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /commit mismatch/);
  assert.equal(r.out, "");
});

test("different platforms exit 1", () => {
  const r = run(["--ios-measure", measure, "--ios-apply", ios, "--commit", SHA, "--ios-apply-platform", "android"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /platform mismatch/);
});

test("platform in a meta field is checked too", () => {
  const f = put("meta.json", { meta: { platform: "android", commit: SHA }, publishMs: 1, downloadMs: 1, applyMs: 1, healthyMs: 3, totalMs: 4 });
  const r = run(["--ios-measure", measure, "--ios-apply", f, "--commit", SHA]);
  assert.equal(r.code, 1);
  assert.match(r.err, /platform mismatch/);
});

test("a missing step is an error, never 0", () => {
  const bad = put("bad.json", { steps: [{ step: "publish", ms: 5, exit: 0 }] });
  const r = run(["--android-applied", bad, "--commit", SHA]);
  assert.equal(r.code, 1);
  assert.match(r.err, /"init"/);
});

test("ios: healthyMs shorter than download + apply is an error", () => {
  const f = put("ios-short.json", { publishMs: 1, downloadMs: 700, applyMs: 400, healthyMs: 1000 });
  const r = run(["--ios-measure", measure, "--ios-apply", f, "--commit", SHA]);
  assert.equal(r.code, 1);
  assert.match(r.err, /shorter than/);
});

test("ios: a null or missing metric is an error", () => {
  const f = put("ios-null.json", { publishMs: 1, downloadMs: null, applyMs: 400, healthyMs: 2000 });
  const r = run(["--ios-measure", measure, "--ios-apply", f, "--commit", SHA]);
  assert.equal(r.code, 1);
  assert.match(r.err, /downloadMs is missing or null/);
});

test("a flag with no value, or with another flag as its value, is rejected", () => {
  const last = run(["--android-applied", applied, "--commit"]);
  assert.equal(last.code, 1);
  assert.match(last.err, /--commit needs a value/);
  const next = run(["--android-applied", applied, "--commit", "--json"]);
  assert.equal(next.code, 1);
  assert.match(next.err, /--commit needs a value/);
});
