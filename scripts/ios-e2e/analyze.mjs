#!/usr/bin/env node
// Turns the e2e server JSON log plus per-run marks into a Markdown table of medians.
//   node analyze.mjs <server.log.jsonl> <marks.json>
// Log lines: {"t": ms, "path": "/b/...", "bytes": n}. Marks: [{"pointer_published", "app_launched", "healthy"}, ...] in ms.
// For each run, only requests with app_launched <= t <= healthy count:
//   download bytes     = bytes sent on /b/ paths
//   download time      = last /b/ request time - first request time
//   apply time         = healthy - last /b/ request time
//   publish to healthy = healthy - pointer_published
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
  const [logFile, marksFile] = process.argv.slice(2);
  if (!logFile || !marksFile) { console.error("usage: node analyze.mjs <server.log.jsonl> <marks.json>"); process.exit(2); }
  process.stdout.write(analyze(parseLog(readFileSync(logFile, "utf8")), JSON.parse(readFileSync(marksFile, "utf8"))));
}
