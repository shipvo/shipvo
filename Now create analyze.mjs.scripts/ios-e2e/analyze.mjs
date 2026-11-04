import { readFileSync } from "node:fs";

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function parseLog(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function loadMarks(text) {
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : data.runs || data.marks || [];
}

export function analyzeRun(run, entries) {
  const inWindow = entries.filter((e) => e.time >= run.app_launched && e.time <= run.healthy);
  const downloads = inWindow.filter((e) => /bundle/i.test(e.path));
  const downloadBytes = downloads.reduce((s, e) => s + e.bytes, 0);
  const downloadTime = downloads.length
    ? downloads[downloads.length - 1].time - downloads[0].time
    : 0;
  const lastDownload = downloads.length ? downloads[downloads.length - 1].time : run.app_launched;
  const applyTime = run.healthy - lastDownload;
  const publishToHealthy = run.healthy - run.pointer_published;
  return { downloadBytes, downloadTime, applyTime, publishToHealthy };
}

export function analyze(logText, marksText) {
  const entries = parseLog(logText);
  const runs = loadMarks(marksText);
  const perRun = runs.map((r) => analyzeRun(r, entries));
  return {
    runs: perRun.length,
    medianDownloadBytes: median(perRun.map((r) => r.downloadBytes)),
    medianDownloadTime: median(perRun.map((r) => r.downloadTime)),
    medianApplyTime: median(perRun.map((r) => r.applyTime)),
    medianPublishToHealthy: median(perRun.map((r) => r.publishToHealthy)),
  };
}

export function formatMarkdown(result) {
  return [
    "| Metric | Median |",
    "| --- | --- |",
    `| Download bytes | ${result.medianDownloadBytes} |`,
    `| Download time (ms) | ${result.medianDownloadTime} |`,
    `| Apply time (ms) | ${result.medianApplyTime} |`,
    `| Publish to healthy (ms) | ${result.medianPublishToHealthy} |`,
    "",
    `Runs: ${result.runs}`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [logFile, marksFile] = process.argv.slice(2);
  const result = analyze(readFileSync(logFile, "utf8"), readFileSync(marksFile, "utf8"));
  console.log(formatMarkdown(result));
}
