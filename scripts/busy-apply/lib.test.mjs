import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, classifyState, stateReports, reloadMs, buildResult, exitCode, busySnippet } from "./lib.mjs";

test("parseArgs reads the contract flags", () => {
  const a = parseArgs(["--platform", "ios", "--applies", "50", "--out", "x.json"]);
  assert.deepEqual([a.platform, a.applies, a.out], ["ios", 50, "x.json"]);
});
test("parseArgs rejects bad input", () => {
  assert.throws(() => parseArgs(["--platform", "web", "--out", "x"]));
  assert.throws(() => parseArgs(["--platform", "ios", "--applies", "0", "--out", "x"]));
  assert.throws(() => parseArgs(["--platform", "ios"]));
});
test("classifyState", () => {
  assert.equal(classifyState("ready"), "ok");
  assert.equal(classifyState(""), "empty");
  assert.equal(classifyState("missing"), "missing");
});
test("stateReports counts empty reports for one release after since", () => {
  const t = [{ at: 5, event: "busy_state", release: 2, state: "ready" }, { at: 9, event: "busy_state", release: 2, state: "" },
    { at: 9, event: "busy_state", release: 3, state: "" }, { at: 1, event: "busy_state", release: 2, state: "" }, { at: 6, event: "applied", release: 2 }];
  assert.deepEqual(stateReports(t, 2, 2), { reports: 2, empty: 1, missing: 0, firstAt: 5 });
  assert.equal(stateReports(t, 7).firstAt, null);
});
test("reloadMs", () => {
  assert.equal(reloadMs(100, 350), 250);
  assert.equal(reloadMs(null, 350), null);
  assert.equal(reloadMs(400, 350), null);
});
test("buildResult and exitCode", () => {
  const ok = buildResult("android", 2, [{ reloadMs: 10, empty: 0 }, { reloadMs: 20, empty: 0 }]);
  assert.deepEqual(ok, { platform: "android", applies: 2, crashes: 0, reloadMs: [10, 20], emptyModuleState: 0, timeouts: 0, completed: 2 });
  assert.equal(exitCode(ok), 0);
  const empty = buildResult("ios", 2, [{ reloadMs: 10, empty: 1 }, { reloadMs: null, empty: 0, crashed: true }]);
  assert.equal(empty.emptyModuleState, 1); assert.equal(empty.crashes, 1); assert.deepEqual(empty.reloadMs, [10]);
  assert.equal(exitCode(empty), 1);
  assert.equal(exitCode(buildResult("ios", 2, [{ reloadMs: 1, empty: 0, crashed: true }, { reloadMs: 1, empty: 0 }])), 2);
  assert.equal(exitCode(buildResult("ios", 3, [{ reloadMs: 1, empty: 0 }])), 2);
});
test("busySnippet embeds the url and tag and reads the release from the runtime", () => {
  const s = busySnippet({ baseUrl: "http://10.0.2.2:8120", tag: "A" });
  assert.match(s, /http:\/\/10\.0\.2\.2:8120\/t/); assert.match(s, /"A"/); assert.match(s, /BusyState/); assert.match(s, /runningRelease/);
  assert.notEqual(s, busySnippet({ baseUrl: "http://10.0.2.2:8120", tag: "B" }));
});
