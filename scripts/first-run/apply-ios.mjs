#!/usr/bin/env node
// Times the first applied OTA of a scaffolded app on the iOS Simulator.
//   node scripts/first-run/apply-ios.mjs --server-log <server.log.jsonl> --marks <marks.json> [--out apply-ios.json]
//   node scripts/first-run/apply-ios.mjs --help | --dry-run
// The scaffold is the one scripts/first-run/measure.mjs makes. A workflow publishes it, serves it with
// scripts/ios-e2e/server.mjs (which writes <server.log.jsonl>), launches the app on the Simulator, and writes
// <marks.json> with epoch-ms marks: {"publish_start", "publish_done", "app_launched", "healthy"}.
// The download time comes from the server log (scripts/ios-e2e/analyze.mjs parseLog), so it needs no app change.
//
// Markers, in order: publish_start, publish_done, download_start, download_done, healthy.
//   publishMs  = publish_done - publish_start     (`shipvo publish`)
//   downloadMs = download_done - download_start   (first to last request of /b/ paths, after app_launched)
//   applyMs    = healthy - download_done          (last byte to the runtime reporting healthy)
//   healthyMs  = healthy - publish_done           (published to healthy on the Simulator)
//   totalMs    = healthy - publish_start
// A marker that is missing makes the numbers that need it null, never 0. Markers out of order throw.
// This slice only reads marks and the server log. It does not publish, serve or launch the Simulator; a workflow does.
// Not timed: store builds, installing the app on the Simulator before launch, reading docs, `npm install`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLog } from "../ios-e2e/analyze.mjs";

export const ORDER = ["publish_start", "publish_done", "download_start", "download_done", "healthy"];

/** events: [{name, t}] with t in ms. Returns {publishMs, downloadMs, applyMs, healthyMs, totalMs}. */
export function summarise(events) {
  const at = {};
  for (const e of events) {
    if (!ORDER.includes(e.name)) throw new Error(`unknown marker ${e.name}`);
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) throw new Error(`marker ${e.name} has no time`);
    at[e.name] = e.t;
  }
  let prev = null;
  for (const n of ORDER) {
    if (at[n] === undefined) continue;
    if (prev && at[n] < at[prev]) throw new Error(`markers out of order: ${n} (${at[n]}) is before ${prev} (${at[prev]})`);
    prev = n;
  }
  const span = (a, b) => (at[a] === undefined || at[b] === undefined ? null : at[b] - at[a]);
  return {
    publishMs: span("publish_start", "publish_done"),
    downloadMs: span("download_start", "download_done"),
    applyMs: span("download_done", "healthy"),
    healthyMs: span("publish_done", "healthy"),
    totalMs: span("publish_start", "healthy"),
  };
}

/** Markers from the Simulator marks plus the server log's bundle requests between app_launched and healthy. */
export function eventsFrom(entries, marks) {
  const ev = [];
  for (const k of ["publish_start", "publish_done", "healthy"]) if (typeof marks[k] === "number") ev.push({ name: k, t: marks[k] });
  if (typeof marks.app_launched !== "number") throw new Error("missing mark app_launched");
  const reqs = entries.filter((e) => e.t >= marks.app_launched && e.t <= (marks.healthy ?? Infinity) && e.path.startsWith("/b/")).sort((a, b) => a.t - b.t);
  if (reqs.length) ev.push({ name: "download_start", t: reqs[0].t }, { name: "download_done", t: reqs[reqs.length - 1].t });
  return ev;
}

const HELP = `usage: node scripts/first-run/apply-ios.mjs --server-log <server.log.jsonl> --marks <marks.json> [--out <file>]
       node scripts/first-run/apply-ios.mjs --dry-run | --help
Prints {publishMs, downloadMs, applyMs, healthyMs, totalMs}. A value is null when its marker is missing.
Timed: publish, download, apply, healthy on the iOS Simulator. Not timed: store builds, Simulator install, reading docs, npm install.`;

export function main(argv, io = { out: console.log, err: console.error }) {
  const bad = [];
  const opt = (n) => {
    const i = argv.indexOf(n);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) { bad.push(n); return undefined; }
    return v;
  };
  if (argv.includes("--help") || argv.includes("-h")) { io.out(HELP); return 0; }
  if (argv.includes("--dry-run")) {
    io.out(JSON.stringify({ dryRun: true, steps: ["scaffold with measure.mjs", "shipvo publish", "serve with scripts/ios-e2e/server.mjs", "launch on the iOS Simulator", "read marks and server log"], markers: ORDER }, null, 2));
    return 0;
  }
  const [logFile, marksFile] = [opt("--server-log"), opt("--marks")];
  const outFile = opt("--out");
  if (bad.length || !logFile || !marksFile) { if (bad.length) io.err(`missing value for ${bad.join(", ")}`); io.err(HELP); return 2; }
  try {
    const result = summarise(eventsFrom(parseLog(readFileSync(logFile, "utf8")), JSON.parse(readFileSync(marksFile, "utf8"))));
    const json = JSON.stringify(result);
    if (outFile) writeFileSync(outFile, json + "\n");
    io.out(json);
    return 0;
  } catch (e) { io.err(String(e.message ?? e)); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
