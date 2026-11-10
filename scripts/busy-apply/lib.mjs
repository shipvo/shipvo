// Pure helpers for the busy-apply harness: argument parsing, reading the app's state reports, and the result.

/** Parses `--platform android|ios --applies N --out file [--port N] [--timeout-s N]`. Throws on bad input. */
export function parseArgs(argv) {
  const get = (k) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
  const platform = get("platform");
  if (platform !== "android" && platform !== "ios") throw new Error("--platform must be android or ios");
  const applies = Number(get("applies") ?? 50);
  if (!Number.isInteger(applies) || applies < 1) throw new Error("--applies must be a whole number of 1 or more");
  const out = get("out");
  if (!out) throw new Error("--out <file.json> is required");
  const port = Number(get("port") ?? 8120), timeoutS = Number(get("timeout-s") ?? 120);
  if (!Number.isInteger(port) || port < 1) throw new Error("--port must be a port number");
  if (!(timeoutS > 0)) throw new Error("--timeout-s must be above 0");
  return { platform, applies, out, port, timeoutMs: timeoutS * 1000 };
}

/** "ok": state set. "empty": cleared (the bug). "missing": the native module is not in the build (a setup error). */
export const classifyState = (s) => (s === "ready" ? "ok" : s === "missing" ? "missing" : "empty");

/**
 * The `busy_state` reports for one release, from telemetry events ({at, event, release, state}) at or after `since`.
 * Returns { reports, empty, missing, firstAt }.
 */
export function stateReports(tele, release, since = 0) {
  const r = tele.filter((e) => e.event === "busy_state" && e.release === release && e.at >= since);
  const kinds = r.map((e) => classifyState(e.state));
  return { reports: r.length, empty: kinds.filter((k) => k === "empty").length, missing: kinds.filter((k) => k === "missing").length, firstAt: r.length ? Math.min(...r.map((e) => e.at)) : null };
}

/** Reload time of one apply: the first state report minus the moment the update was staged. Null when either is missing or the order is wrong. */
export const reloadMs = (stagedAt, firstReportAt) => (stagedAt == null || firstReportAt == null || firstReportAt < stagedAt ? null : firstReportAt - stagedAt);

/** The file the harness writes. `samples`: one { reloadMs, empty, crashed, timedOut } per apply. */
export function buildResult(platform, applies, samples) {
  return {
    platform, applies,
    crashes: samples.filter((s) => s.crashed).length,
    reloadMs: samples.map((s) => s.reloadMs).filter((x) => typeof x === "number"),
    emptyModuleState: samples.reduce((n, s) => n + (s.empty || 0), 0),
    timeouts: samples.filter((s) => s.timedOut).length,
    completed: samples.length,
  };
}

/** 1 when the module state was empty after any reload, 2 when the run did not finish cleanly (crash, timeout, fewer applies), else 0. */
export function exitCode(r) {
  if (r.emptyModuleState > 0) return 1;
  if (r.crashes > 0 || r.timeouts > 0 || r.completed < r.applies) return 2;
  return 0;
}

/**
 * The JS the harness adds to the app entry: reports the native module state twice per load (the release comes from the
 * runtime, so one export serves many releases) and keeps the JS thread busy. `tag` makes two exports differ in bytes.
 */
export function busySnippet({ baseUrl, tag }) {
  return `
import { requireOptionalNativeModule as __busyModule } from "expo-modules-core";
const __busy = __busyModule("BusyState"), __rt = __busyModule("ShipvoRuntime"), __tag = ${JSON.stringify(String(tag))};
const __report = () => {
  let state = "missing", release = -1;
  try { if (__busy) state = __busy.get(); } catch (e) { state = "missing"; }
  try { release = __rt.getState().runningRelease; } catch (e) {}
  fetch(${JSON.stringify(baseUrl + "/t")}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "busy_state", release, state, tag: __tag }) }).catch(() => {});
};
setTimeout(__report, 1500);
setTimeout(__report, 5000);
setInterval(() => { const end = Date.now() + 80; while (Date.now() < end) {} }, 100);
`;
}
