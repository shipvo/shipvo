#!/usr/bin/env node
// Prints the results table (markdown) from android-e2e-report.json.   node summary.mjs <report.json>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const kb = (n) => (n == null ? "-" : `${(n / 1024).toFixed(1)} KB`);
const ms = (n) => (n == null ? "-" : `${n} ms`);
export function rows(report) {
  return report.scenarios.map((s) => {
    const m = s.median ?? {};
    const t = [m.pointerToHealthyMs != null && `pointer to healthy ${ms(m.pointerToHealthyMs)}`, m.downloadMs != null && `download ${ms(m.downloadMs)}`, m.applyMs != null && `apply ${ms(m.applyMs)}`,
      m.totalMs != null && `am start -W ${ms(m.totalMs)}`, m.reportedColdStartMs != null && `reported cold start ${ms(m.reportedColdStartMs)}`, m.restoredMs != null && `restored ${ms(m.restoredMs)} after publish`, m.boots != null && `${m.boots} launches`,
      s.pointerToHealthyMs != null && `pointer to healthy ${ms(s.pointerToHealthyMs)}`, s.joinedAfterWideningMs != null && `joined ${ms(s.joinedAfterWideningMs)} after widening`].filter(Boolean).join("; ") || "-";
    const size = m.downloadBytes != null ? kb(m.downloadBytes) : s.downloadBytes != null ? kb(s.downloadBytes) : "-";
    return `| ${s.name} | ${s.pass ? "pass" : "FAIL"} | ${t} | ${size} |`;
  });
}
/** Seconds with two decimals, or null when the value is missing, not a finite number or not positive. Never "0.00 s". */
export function secondsOrNull(n) { return typeof n === "number" && Number.isFinite(n) && n > 0 ? (n / 1000).toFixed(2) : null; }
/** The first-run app's publish-to-healthy line from report.firstRun, or a "not measured" line. */
export function publishToHealthyLine(report) {
  const f = report.firstRun ?? {};
  const total = secondsOrNull(f.publishToHealthyMs);
  if (!total) return "Publish to healthy (first-run app, emulator): not measured";
  const parts = [["download", f.downloadMs], ["apply", f.applyMs]].map(([k, v]) => [k, secondsOrNull(v)]).filter(([, v]) => v).map(([k, v]) => `${k} ${v} s`);
  return `Publish to healthy (first-run app, emulator): ${total} s${parts.length ? ` (${parts.join(", ")})` : ""}`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
  console.log(["| Scenario | Result | Median timings (3 trials) | Download |", "| --- | --- | --- | --- |", ...rows(r)].join("\n") + "\n\n" + publishToHealthyLine(r));
}
