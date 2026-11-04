import { test } from "node:test";
import assert from "node:assert/strict";
import { median, parseLog, loadMarks, analyze, formatMarkdown } from "./analyze.mjs";

test("median odd count", () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3);
});

test("median even count", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median empty", () => {
  assert.equal(median([]), 0);
});

test("parseLog reads json lines", () => {
  const entries = parseLog('{"time":1,"path":"/a","bytes":10}\n{"time":2,"path":"/b","bytes":20}\n');
  assert.equal(entries.length, 2);
  assert.equal(entries[1].bytes, 20);
});

test("loadMarks supports array and object", () => {
  assert.equal(loadMarks("[{\"app_launched\":1}]").length, 1);
  assert.equal(loadMarks("{\"runs\":[{\"app_launched\":1},{\"app_launched\":2}]}").length, 2);
});

test("analyze odd runs", () => {
  const log = [
    '{"time":100,"path":"/bundle.js","bytes":1000}',
    '{"time":110,"path":"/bundle.js","bytes":500}',
    '{"time":200,"path":"/bundle.js","bytes":1000}',
    '{"time":210,"path":"/bundle.js","bytes":500}',
    '{"time":300,"path":"/bundle.js","bytes":1000}',
    '{"time":310,"path":"/bundle.js","bytes":500}',
  ].join("\n");
  const marks = JSON.stringify({
    runs: [
      { pointer_published: 0, app_launched: 90, healthy: 120 },
      { pointer_published: 0, app_launched: 190, healthy: 220 },
      { pointer_published: 0, app_launched: 290, healthy: 320 },
    ],
  });
  const r = analyze(log, marks);
  assert.equal(r.runs, 3);
  assert.equal(r.medianDownloadBytes, 1500);
  assert.equal(r.medianDownloadTime, 10);
  assert.equal(r.medianApplyTime, 10);
  assert.equal(r.medianPublishToHealthy, 120);
});

test("analyze even runs", () => {
  const log = [
    '{"time":100,"path":"/bundle.js","bytes":1000}',
    '{"time":110,"path":"/bundle.js","bytes":500}',
    '{"time":200,"path":"/bundle.js","bytes":1000}',
    '{"time":210,"path":"/bundle.js","bytes":500}',
  ].join("\n");
  const marks = JSON.stringify({
    runs: [
      { pointer_published: 0, app_launched: 90, healthy: 120 },
      { pointer_published: 0, app_launched: 190, healthy: 220 },
    ],
  });
  const r = analyze(log, marks);
  assert.equal(r.runs, 2);
  assert.equal(r.medianDownloadBytes, 1500);
  assert.equal(r.medianDownloadTime, 10);
  assert.equal(r.medianApplyTime, 10);
  assert.equal(r.medianPublishToHealthy, 120);
});

test("formatMarkdown includes metrics", () => {
  const md = formatMarkdown({ runs: 2, medianDownloadBytes: 10, medianDownloadTime: 1, medianApplyTime: 2, medianPublishToHealthy: 3 });
  assert.match(md, /Download bytes/);
  assert.match(md, /Runs: 2/);
});
