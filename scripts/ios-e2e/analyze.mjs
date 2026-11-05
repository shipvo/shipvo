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
// A run that downloaded no patch, or also downloaded a full bundle, is an error: it did not take the patch path.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  const [logFile, marksFile, patchMarksFile] = process.argv.slice(2);
  if (!logFile || !marksFile) { console.error("usage: node analyze.mjs <server.log.jsonl> <marks.json> [patch-marks.json]"); process.exit(2); }
  const entries = parseLog(readFileSync(logFile, "utf8"));
  process.stdout.write(analyze(entries, JSON.parse(readFileSync(marksFile, "utf8"))));
  if (patchMarksFile) process.stdout.write("\n" + analyzePatch(entries, JSON.parse(readFileSync(patchMarksFile, "utf8"))));
}
