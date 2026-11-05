import test from "node:test";
import assert from "node:assert/strict";
import { rows } from "./summary.mjs";

test("rows show pass or FAIL, medians and sizes", () => {
  const r = rows({ scenarios: [{ name: "a", pass: true, median: { pointerToHealthyMs: 900, downloadBytes: 2048 } }, { name: "b", pass: false }] });
  assert.equal(r[0], "| a | pass | pointer to healthy 900 ms | 2.0 KB |");
  assert.equal(r[1], "| b | FAIL | - | - |");
});

test("a refusal row shows the reason read from telemetry", () => {
  const r = rows({ scenarios: [{ name: "m", pass: true, refusalReason: "hermes_bytecode_mismatch" }, { name: "n", pass: false, refusalReason: null }] });
  assert.equal(r[0], "| m | pass | refused, reason from telemetry: hermes_bytecode_mismatch | - |");
  assert.equal(r[1], "| n | FAIL | not refused, reason from telemetry: none | - |");
});
