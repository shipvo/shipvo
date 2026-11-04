import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, analyzeRun, median, parseLog, loadMarks } from "./analyze.mjs";

test("median of empty is 0", () => {
  assert.equal(median([]), 0);
});

test("median odd/even", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("parseLog skips blanks", () => {
  const out = parseLog('{"a":1}\n\n{"b":2}\n');
  assert.equal(out.length, 2);
});

test("loadMarks supports array and runs/marks", () => {
  assert.deepEqual(loadMarks("[1,2]"), [1, 2]);
  assert.deepEqual(loadMarks('{"runs":[3]}'), [3]);
  assert.deepEqual(loadMarks('{"marks":[4]}'), [4]);
});

test("analyzeRun with real bundle path shape", () => {
  const run = { app_launched: 0, healthy: 100, pointer_published: 0 };
  const entries = [
    { time: 10, path: "/b/e2e/ios-r1.hbc", bytes: 50 },
    { time: 20, path: "/p/e2e/1/ios/b0.json", bytes: 10 },
  ];
  const r = analyzeRun(run, entries);
  assert.equal(r.downloadBytes, 50);
  assert.equal(r.downloadTime, 0);
});

test("run with no matching log entries", () => {
  const run = { app_launched: 0, healthy: 100, pointer_published: 0 };
  const entries = [{ time: 10, path: "/p/e2e/1/ios/b0.json", bytes: 10 }];
  const r = analyzeRun(run, entries);
  assert.equal(r.downloadBytes, 0);
  assert.equal(r.downloadTime, 0);
});

test("analyze aggregates", () => {
  const logText = '{"time":10,"path":"/b/e2e/ios-r1.hbc","bytes":50}\n';
  const marksText = JSON.stringify([{ app_launched: 0, healthy: 100, pointer_published: 0 }]);
  const r = analyze(logText, marksText);
  assert.equal(r.runs, 1);
});
