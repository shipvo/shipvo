#!/usr/bin/env node
// Turns the e2e server JSON log plus per-run marks into a Markdown table of medians.
//   node analyze.mjs <server.log.jsonl> <marks.json>
// Log lines: {"t": ms, "path": "/b/...", "bytes": n}. Marks: [{"pointer_published", "app_launched", "healthy"}, ...] in ms.
// For each run, only requests with app_launched <= t <= healthy count:
//   download bytes     = bytes sent on /b/ paths
//   download time      = last /b/ request time - first request time
//   apply time         = healthy - last /b/ request time
//   publish to healthy = healthy - pointer_published
//
// Patch runs (optional third file): [{"app_launched", "healthy", "full_bytes"}, ...]. Each run is a launch that updates
// from a base bundle by bsdiff patch. Within app_launched..healthy:
//   patch bytes        = bytes sent on /b/ paths ending in .bsdiff
//   full bytes         = full_bytes (size of the full release bundle, measured by the caller)
//   patch apply time   = healthy - last /b/ request time (last byte to healthy)
// Hermes marks (optional fourth file, with the text server log as fifth): {"release", "previous_release", "running_release"}.
// Crash-loop marks (optional sixth file; needs the text server log as fifth, pass "" as the fourth to skip the Hermes check):
// {"release", "previous_release", "running_release", "launches"}.
// A run that downloaded no patch, or also downloaded a full bundle, is an error: it did not take the patch path.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../packages/schema/dist/index.js";

export function median(xs) {
  if (!xs.length) throw new Error("median of empty list");
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function parseLog(text) {
  return text.split("\n").filter((l) => l.trim()).map((l, i) => {
    const e = JSON.parse(l);
    if (typeof e.t !== "number" || typeof e.path !== "string" || typeof e.bytes !== "number") throw new Error(`bad log line ${i + 1}`);
    return e;
  });
}

export function analyzeRun(entries, marks, n = 0) {
  for (const k of ["pointer_published", "app_launched", "healthy"]) if (typeof marks[k] !== "number") throw new Error(`run ${n + 1}: missing mark ${k}`);
  const reqs = entries.filter((e) => e.t >= marks.app_launched && e.t <= marks.healthy).sort((a, b) => a.t - b.t);
  const bundles = reqs.filter((e) => e.path.startsWith("/b/"));
  if (!bundles.length) throw new Error(`run ${n + 1}: no bundle download between app_launched and healthy`);
  const end = bundles[bundles.length - 1].t;
  return {
    bytes: bundles.reduce((a, e) => a + e.bytes, 0),
    downloadMs: end - reqs[0].t,
    applyMs: marks.healthy - end,
    publishToHealthyMs: marks.healthy - marks.pointer_published,
  };
}

export function analyzePatchRun(entries, marks, n = 0) {
  for (const k of ["app_launched", "healthy", "full_bytes"]) if (typeof marks[k] !== "number") throw new Error(`patch run ${n + 1}: missing mark ${k}`);
  const bundles = entries.filter((e) => e.t >= marks.app_launched && e.t <= marks.healthy && e.path.startsWith("/b/")).sort((a, b) => a.t - b.t);
  const patches = bundles.filter((e) => e.path.endsWith(".bsdiff"));
  if (!patches.length) throw new Error(`patch run ${n + 1}: no patch download between app_launched and healthy`);
  if (bundles.length > patches.length) throw new Error(`patch run ${n + 1}: downloaded a full bundle, not only a patch`);
  return {
    patchBytes: patches.reduce((a, e) => a + e.bytes, 0),
    fullBytes: marks.full_bytes,
    patchApplyMs: marks.healthy - bundles[bundles.length - 1].t,
  };
}

export function analyzePatch(entries, marks) {
  if (!marks.length) throw new Error("no runs in patch marks file");
  const runs = marks.map((m, i) => analyzePatchRun(entries, m, i));
  const med = (k) => median(runs.map((r) => r[k]));
  return [
    `| Patch runs | Median patch bytes | Median full-bundle bytes | Median patch apply time (ms) |`,
    `| --- | --- | --- | --- |`,
    `| ${runs.length} | ${med("patchBytes")} | ${med("fullBytes")} | ${med("patchApplyMs")} |`,
  ].join("\n") + "\n";
}

/** Telemetry events from the server's text log (`POST /t <json>` lines), in order. Lines that do not parse are skipped. */
export function parseTelemetry(text) {
  return text.split("\n").filter((l) => l.startsWith("POST /t ")).map((l) => { try { return JSON.parse(l.slice(8)); } catch { return null; } }).filter(Boolean);
}

/**
 * "Hermes mismatch refused": after the app was relaunched with a release of another bytecode version, the app must
 * report the typed refusal (`hermes_bytecode_mismatch`, checked against the @shipvo/schema Telemetry type) for that
 * release, must not report it applied, and must still run the previous release.
 * marks: {release, previous_release, running_release}. Returns {pass, detail}.
 */
export function analyzeHermesRefusal(events, marks) {
  for (const k of ["release", "previous_release", "running_release"]) if (typeof marks[k] !== "number") throw new Error(`hermes marks: missing ${k}`);
  const mine = events.filter((e) => e.release === marks.release);
  if (mine.some((e) => e.event === "applied" || e.event === "content_applied")) return { pass: false, detail: `release ${marks.release} was applied` };
  const refusal = mine.find((e) => e.event === "hermes_bytecode_mismatch");
  if (!refusal) return { pass: false, detail: `no hermes_bytecode_mismatch event for release ${marks.release}` };
  if (!Telemetry.safeParse(refusal).success) return { pass: false, detail: "refusal event does not match the schema Telemetry type" };
  if (marks.running_release !== marks.previous_release) return { pass: false, detail: `app runs release ${marks.running_release}, expected ${marks.previous_release}` };
  return { pass: true, detail: `release ${marks.release} refused, still on release ${marks.previous_release}` };
}

export function hermesRefusalTable(result) {
  return `| Check | Result | Detail |\n| --- | --- | --- |\n| Hermes mismatch refused | ${result.pass ? "pass" : "fail"} | ${result.detail} |\n`;
}

/**
 * "Interrupted download resumed": from the text server log. For GETs of the release bundle `bundlePath`, the log must
 * show a response cut short ("200 cut at <n>"), then a request with "range=bytes=<n>-" (n above 0) answered 206, and
 * an `applied` event for `release`. A later 200 for the bundle (a restart from byte 0) fails. Returns {pass, detail}.
 */
export function analyzeResume(text, { release, bundlePath }) {
  if (typeof release !== "number" || typeof bundlePath !== "string") throw new Error("resume marks: need release and bundlePath");
  const gets = text.split("\n").map((l) => /^GET (\S+) (\d{3})(?: (.*))?$/.exec(l)).filter((m) => m && m[1] === bundlePath);
  const cut = gets.findIndex((m) => /^cut at \d+/.test(m[3] || ""));
  if (cut < 0) return { pass: false, detail: "the server never cut the first download" };
  const after = gets.slice(cut + 1);
  if (!after.length) return { pass: false, detail: "the app did not retry the download" };
  const ranged = after.find((m) => m[2] === "206" && Number(/range=bytes=(\d+)-/.exec(m[3] || "")?.[1]) > 0);
  if (!ranged) return { pass: false, detail: after.some((m) => m[2] === "200") ? "the app re-downloaded from byte 0 (no Range request)" : "no Range request with an offset above 0 got a 206" };
  if (after.slice(after.indexOf(ranged) + 1).some((m) => m[2] === "200")) return { pass: false, detail: "the app re-downloaded from byte 0 after the ranged request" };
  if (!parseTelemetry(text).some((e) => e.release === release && e.event === "applied")) return { pass: false, detail: `release ${release} never became healthy` };
  return { pass: true, detail: `resumed with ${/range=(\S+)/.exec(ranged[3])[1]}, HTTP 206, release ${release} healthy` };
}

export function resumeTable(result) {
  return `| Check | Result | Detail |\n| --- | --- | --- |\n| Interrupted download resumed | ${result.pass ? "pass" : "fail"} | ${result.detail} |\n`;
}

/**
 * "Crash-loop reverted": a release that crashes on start was relaunched until the runtime gave it up. Passes only if the
 * app reported `crash_loop_revert` for that release (checked against the @shipvo/schema Telemetry type), the bad release
 * ran at most 3 times, and the app ends on the previous release.
 * marks: {release, previous_release, running_release, launches}. `launches` is every launch the harness used; the last
 * one is the revert, so the bad release ran launches - 1 times. Returns {pass, detail, launches}.
 */
export function analyzeCrashLoop(events, marks) {
  for (const k of ["release", "previous_release", "running_release", "launches"]) if (typeof marks[k] !== "number") throw new Error(`crash-loop marks: missing ${k}`);
  const { launches } = marks, badRuns = launches - 1;
  const fail = (detail) => ({ pass: false, detail, launches });
  const revert = events.find((e) => e.event === "crash_loop_revert" && e.release === marks.release);
  if (!revert) return fail(`no crash_loop_revert event for release ${marks.release} after ${launches} launches`);
  if (!Telemetry.safeParse(revert).success) return fail("revert event does not match the schema Telemetry type");
  if (badRuns > 3) return fail(`release ${marks.release} ran ${badRuns} times before the revert, at most 3 allowed`);
  if (marks.running_release !== marks.previous_release) return fail(`app ends on release ${marks.running_release}, expected ${marks.previous_release}`);
  return { pass: true, detail: `release ${marks.release} ran ${badRuns} times, reverted on launch ${launches}, app ends on release ${marks.previous_release}`, launches };
}

export function crashLoopTable(result) {
  return `| Check | Result | Launches used | Detail |\n| --- | --- | --- | --- |\n| Crash-loop reverted | ${result.pass ? "pass" : "fail"} | ${result.launches} | ${result.detail} |\n`;
}

export function analyze(entries, marks) {
  if (!marks.length) throw new Error("no runs in marks file");
  const runs = marks.map((m, i) => analyzeRun(entries, m, i));
  const med = (k) => median(runs.map((r) => r[k]));
  return [
    `| Runs | Median download bytes | Median download time (ms) | Median apply time (ms) | Median publish-to-healthy (ms) |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${runs.length} | ${med("bytes")} | ${med("downloadMs")} | ${med("applyMs")} | ${med("publishToHealthyMs")} |`,
  ].join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [logFile, marksFile, patchMarksFile, hermesMarksFile, textLogFile, crashMarksFile] = process.argv.slice(2);
  if (!logFile || !marksFile) { console.error("usage: node analyze.mjs <server.log.jsonl> <marks.json> [patch-marks.json]"); process.exit(2); }
  const entries = parseLog(readFileSync(logFile, "utf8"));
  process.stdout.write(analyze(entries, JSON.parse(readFileSync(marksFile, "utf8"))));
  if (patchMarksFile) process.stdout.write("\n" + analyzePatch(entries, JSON.parse(readFileSync(patchMarksFile, "utf8"))));
  if (hermesMarksFile) {
    if (!textLogFile) { console.error("hermes marks need the text server log as the fifth argument"); process.exit(2); }
    const result = analyzeHermesRefusal(parseTelemetry(readFileSync(textLogFile, "utf8")), JSON.parse(readFileSync(hermesMarksFile, "utf8")));
    process.stdout.write("\n" + hermesRefusalTable(result));
    if (!result.pass) process.exitCode = 1;
  }
  // RESUME_MARKS=<json file with {release, bundlePath}> adds the resume check; it reads the text log (fifth argument).
  if (process.env.RESUME_MARKS) {
    if (!textLogFile) { console.error("resume marks need the text server log as the fifth argument"); process.exit(2); }
    const result = analyzeResume(readFileSync(textLogFile, "utf8"), JSON.parse(readFileSync(process.env.RESUME_MARKS, "utf8")));
    process.stdout.write("\n" + resumeTable(result));
    if (!result.pass) process.exitCode = 1;
  }
  if (crashMarksFile) {
    if (!textLogFile) { console.error("crash-loop marks need the text server log as the fifth argument"); process.exit(2); }
    const result = analyzeCrashLoop(parseTelemetry(readFileSync(textLogFile, "utf8")), JSON.parse(readFileSync(crashMarksFile, "utf8")));
    process.stdout.write("\n" + crashLoopTable(result));
    if (!result.pass) process.exitCode = 1;
  }
}
