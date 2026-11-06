import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTimings, releaseFrom, parsePrefs, reached, stepResults, report } from "./applied-ota.mjs";

const LOG = `noise
[first-run] init 1200ms
[first-run] publish 3400ms
[first-run] publish to healthy 8100ms
[first-run] install 0ms
[first-run] bogus abcms
`;

test("parseTimings reads marks, drops zero and malformed ones", () => {
  assert.deepEqual(parseTimings(LOG), { init: 1200, publish: 3400, "publish to healthy": 8100 });
});
test("releaseFrom takes the last JSON line", () => {
  assert.equal(releaseFrom('x\n{"release":3}\nlog\n{"release":4,"a":1}\n'), 4);
  assert.equal(releaseFrom("nothing"), undefined);
});
test("parsePrefs and reached", () => {
  const p = parsePrefs('<map><int name="current_release" value="2" /><long name="pending_release" value="3" /></map>');
  assert.deepEqual(p, { current_release: 2, pending_release: 3 });
  assert.equal(reached(p, 2), "current"); assert.equal(reached(p, 3), "pending"); assert.equal(reached(p, 9), null);
});
test("step table keeps step order and omits steps that did not run", () => {
  const t = parseTimings(LOG);
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
