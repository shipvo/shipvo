// Run with: node --test scripts/ios-e2e/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { analyze, formatMarkdown, median } from "./analyze.mjs";

test("median handles odd and even counts", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("analyzer is deterministic for an odd number of runs", () => {
  const log = [
    { time: 100, path: "/p/e2e/1/ios/b0.json", bytes: 10 },
    { time: 110, path: "/b/e2e/ios-r1.hbc", bytes: 1000 },
    { time: 200, path: "/p/e2e/1/ios/b0.json", bytes: 10 },
    { time: 210, path: "/b/e2e/ios-r2.hbc", bytes: 1100 },
    { time: 300, path: "/p/e2e/1/ios/b0.json", bytes: 10 },
    { time: 310, path: "/b/e2e/ios-r3.hbc", bytes: 1200 },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  const marks = {
    runs: [
      { pointer_published: 90, app_launched: 95, healthy: 150 },
      { pointer_published: 190, app_launched: 195, healthy: 250 },
      { pointer_published: 290, app_launched: 295, healthy: 350 },
    ],
  };

  const result = analyze(log, marks);
  assert.deepEqual(result, {
    runs: 3,
    medianDownloadBytes: 1100,
    medianDownloadTimeMs: 0,
    medianApplyTimeMs: 40,
    medianPublishToHealthyMs: 60,
  });
  assert.match(formatMarkdown(result), /Download bytes \| 1100/);
});

test("no bundle download reports zero bytes and zero download time", () => {
  const log = [{ time: 100, path: "/p/e2e/1/ios/b0.json", bytes: 10 }]
    .map((e) => JSON.stringify(e))
    .join("\n");
  const marks = { runs: [{ pointer_published: 90, app_launched: 95, healthy: 150 }] };
  const result = analyze(log, marks);
  assert.equal(result.medianDownloadBytes, 0);
  assert.equal(result.medianDownloadTimeMs, 0);
});

test("invalid marks throw a clear error", () => {
  const log = "";
  assert.throws(() => analyze(log, { runs: [{ pointer_published: 90, app_launched: 95, healthy: 90 }] }), /healthy is before app_launched/);
  assert.throws(() => analyze(log, { runs: [{ pointer_published: 90, app_launched: "x", healthy: 150 }] }), /missing or not a number/);
  assert.throws(() => analyze(log, { runs: [{ pointer_published: 90, healthy: 150 }] }), /missing or not a number/);
});

test("analyzer is deterministic for an even number of runs", () => {
  const log = [
    { time: 100, path: "/bundle.js", bytes: 1000 },
    { time: 120, path: "/bundle.js", bytes: 1200 },
    { time: 140, path: "/bundle.js", bytes: 1400 },
    { time: 160, path: "/bundle.js", bytes: 1600 },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  const marks = [
    { pointer_published: 90, app_launched: 95, healthy: 110 },
    { pointer_published: 115, app_launched: 118, healthy: 130 },
    { pointer_published: 135, app_launched: 138, healthy: 150 },
    { pointer_published: 155, app_launched: 158, healthy: 170 },
  ];

  const result = analyze(log, marks);
  assert.deepEqual(result, {
    runs: 4,
    medianDownloadBytes: 1300,
    medianDownloadTimeMs: 0,
    medianApplyTimeMs: 15,
    medianPublishToHealthyMs: 20,
  });
});
