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
    // Validate the mark: every field must be present and numeric, and healthy
    // must not precede app_launched, otherwise the derived metrics are NaN.
    for (const field of ["pointer_published", "app_launched", "healthy"]) {
      if (typeof run?.[field] !== "number" || Number.isNaN(run[field])) {
        throw new Error(`invalid mark: ${field} is missing or not a number`);
      }
    }
    if (run.healthy < run.app_launched) {
      throw new Error("invalid mark: healthy is before app_launched");
    }

    const inWindow = entries.filter(
      (entry) => entry.time >= run.app_launched && entry.time <= run.healthy,
    );
    // Only real bundle downloads (/b/) count. If none were seen, report 0
    // bytes and 0 download time rather than falling back to all traffic.
    const downloads = inWindow.filter((entry) =>
      /\/b\//.test(entry.path) && (entry.status === undefined || entry.status === 200),
    );

    let downloadBytes = 0;
    let downloadTimeMs = 0;
    let lastDownload = run.app_launched;
    if (downloads.length > 0) {
      downloadBytes = downloads.reduce((sum, entry) => sum + entry.bytes, 0);
      const firstDownload = downloads[0].time;
      lastDownload = downloads[downloads.length - 1].time;
      downloadTimeMs = lastDownload - firstDownload;
    }

    // downloadBytes: total bytes of bundle (/b/) responses in the window.
    // downloadTimeMs: span from first to last bundle download log entry.
    // applyTimeMs: from the last bundle download log entry to healthy. The log
    //   entry is written before the response is sent, so this is an upper bound
    //   on true apply time, not a clean measurement.
    // publishToHealthyMs: from pointer publication to healthy.
    return {
      downloadBytes,
      downloadTimeMs,
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
    console.error("marks file: array of runs or { runs: [...] }, each run:");
    console.error('  { "pointer_published": 90, "app_launched": 95, "healthy": 150 }');
    process.exit(1);
  }
  const logText = readFileSync(logFile, "utf8");
  const marks = JSON.parse(readFileSync(marksFile, "utf8"));
  console.log(formatMarkdown(analyze(logText, marks)));
}
