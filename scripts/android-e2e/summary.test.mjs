import test from "node:test";
import assert from "node:assert/strict";
import { rows, publishToHealthyLine, secondsOrNull } from "./summary.mjs";

test("rows show pass or FAIL, medians and sizes", () => {
  const r = rows({ scenarios: [{ name: "a", pass: true, median: { pointerToHealthyMs: 900, downloadBytes: 2048 } }, { name: "b", pass: false }] });
  assert.equal(r[0], "| a | pass | pointer to healthy 900 ms | 2.0 KB |");
  assert.equal(r[1], "| b | FAIL | - | - |");
});

test("publish-to-healthy line shows seconds and phases", () => {
  assert.equal(publishToHealthyLine({ firstRun: { publishToHealthyMs: 4200, downloadMs: 800, applyMs: 150 } }), "Publish to healthy (first-run app, emulator): 4.20 s (download 0.80 s, apply 0.15 s)");
});

test("a missing, zero or invalid value is never shown as 0 s", () => {
  for (const r of [{}, { firstRun: {} }, { firstRun: { publishToHealthyMs: 0 } }, { firstRun: { publishToHealthyMs: null } }, { firstRun: { publishToHealthyMs: NaN } }])
    assert.equal(publishToHealthyLine(r), "Publish to healthy (first-run app, emulator): not measured");
  assert.equal(secondsOrNull(undefined), null);
  assert.equal(publishToHealthyLine({ firstRun: { publishToHealthyMs: 3000, downloadMs: 0 } }), "Publish to healthy (first-run app, emulator): 3.00 s");
});

test("a refusal row shows the reason read from telemetry", () => {
  const r = rows({ scenarios: [{ name: "m", pass: true, refusalReason: "hermes_bytecode_mismatch" }, { name: "n", pass: false, refusalReason: null }] });
  assert.equal(r[0], "| m | pass | refused, reason from telemetry: hermes_bytecode_mismatch | - |");
  assert.equal(r[1], "| n | FAIL | not refused, reason from telemetry: none | - |");
});
