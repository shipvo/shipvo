// Marks file shape: either an array of run objects, or { runs: [...] }.
// Each run: { pointer_published, app_launched, healthy } (epoch ms).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyze(logText, marksInput) {
  const entries = logText
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const runs = Array.isArray(marksInput) ? marksInput : marksInput.runs;

  const perRun = runs.map((run) => {
    const inWindow = entries.filter(
      (entry) => entry.time >= run.app_launched && entry.time <= run.healthy,
    );
    const downloads = inWindow.filter((entry) =>
      /\/b\//.test(entry.path) && (entry.status === undefined || entry.status === 200),
    );
    const downloadEntries = downloads.length > 0 ? downloads : inWindow;
    const bytes = downloadEntries.reduce((sum, entry) => sum + entry.bytes, 0);
    const firstDownload = downloadEntries[0]?.time ?? run.app_launched;
    const lastDownload = downloadEntries[downloadEntries.length - 1]?.time ?? firstDownload;

    return {
      downloadBytes: bytes,
      downloadTimeMs: lastDownload - firstDownload,
      applyTimeMs: run.healthy - lastDownload,
      publishToHealthyMs: run.healthy - run.pointer_published,
    };
  });

  return {
    runs: perRun.length,
    medianDownloadBytes: median(perRun.map((run) => run.downloadBytes)),
    medianDownloadTimeMs: median(perRun.map((run) => run.downloadTimeMs)),
    medianApplyTimeMs: median(perRun.map((run) => run.applyTimeMs)),
    medianPublishToHealthyMs: median(perRun.map((run) => run.publishToHealthyMs)),
  };
}

export function formatMarkdown(result) {
  return [
    "| Metric | Median |",
    "| --- | ---: |",
    `| Runs | ${result.runs} |`,
    `| Download bytes | ${result.medianDownloadBytes} |`,
    `| Download time (ms) | ${result.medianDownloadTimeMs} |`,
    `| Apply time (ms) | ${result.medianApplyTimeMs} |`,
    `| Publish to healthy (ms) | ${result.medianPublishToHealthyMs} |`,
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [logFile, marksFile] = process.argv.slice(2);
  if (!logFile || !marksFile) {
    console.error("usage: node analyze.mjs <logFile> <marksFile>");
    process.exit(1);
  }
  const logText = readFileSync(logFile, "utf8");
  const marks = JSON.parse(readFileSync(marksFile, "utf8"));
  console.log(formatMarkdown(analyze(logText, marks)));
}
