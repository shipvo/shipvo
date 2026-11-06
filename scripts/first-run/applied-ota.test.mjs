import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { releaseFrom, parsePrefs, nextAction, stepResults, report } from "./applied-ota.mjs";

const T = { init: 1200, publish: 3400, "publish to healthy": 8100 };
test("releaseFrom takes the last JSON line", () => {
  assert.equal(releaseFrom('x\n{"release":3}\nlog\n{"release":4,"a":1}\n'), 4);
  assert.equal(releaseFrom("nothing"), undefined);
});
test("releaseFrom reads the plain publish sentence", () => {
  assert.equal(releaseFrom("Published release 4 to b0, b1, b2. Next: shipvo status.\n"), 4);
  assert.equal(releaseFrom("Published release 3 to b0.\nlog\nPublished release 5 to b0.\n"), 5);
});
test("parsePrefs", () => {
  const p = parsePrefs('<map><int name="current_release" value="2" /><long name="pending_release" value="3" /></map>');
  assert.deepEqual(p, { current_release: 2, pending_release: 3 });
});
test("step table keeps step order and omits steps that did not run", () => {
  const t = T;
  assert.deepEqual(stepResults(t).map((r) => r.step), ["init", "publish", "publish to healthy"]);
  const out = report(t, 20000);
  assert.match(out, /\| init \| 1\.20 \|/);
  assert.match(out, /\| publish to healthy \| 8\.10 \|/);
  assert.match(out, /\| total \| 20\.00 \|/);
  assert.match(out, /publish to healthy on the Android emulator: 8\.10 s/);
  assert.doesNotMatch(out, /install/);
});
test("report says not measured without a healthy time", () => {
  assert.match(report({ init: 500 }), /publish to healthy: not measured/);
});
test("--dry-run exits 0 and prints the plan", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./applied-ota.mjs", import.meta.url)), "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /publish to healthy/);
  assert.match(r.stdout, /dry run: nothing was run/);
});
test("nextAction: done when current, relaunch only after the grace period, wait otherwise", () => {
  assert.equal(nextAction({ current_release: 3 }, 3), "done");
  assert.equal(nextAction({ pending_release: 3 }, 3, 1000), "wait");
  assert.equal(nextAction({ pending_release: 3 }, 3, 9000), "relaunch");
  assert.equal(nextAction({ current_release: 2, pending_release: 2 }, 3, 99999), "wait");
});
test("nextAction never passes on an undefined release, even with empty prefs", () => {
  assert.equal(nextAction({}, undefined), "wait");
  assert.equal(nextAction({ current_release: undefined }, undefined, 99999), "wait");
});
