// The benchmark itself, as a test: it builds this app, runs every seeded bug on the Android and iOS phones and fails
// if one is missed or a case stops being valid. BUG_BENCH=off skips it (it builds the app and needs Chromium).
import { test } from "node:test";
import assert from "node:assert/strict";
import { measure } from "./run.mjs";
import { CASES } from "./cases.mjs";
import { table } from "./core.mjs";

test("every seeded bug shows up on Shipvo Phone, on Android and iOS", { skip: process.env.BUG_BENCH === "off" && "BUG_BENCH=off", timeout: 900_000 }, async () => {
  const { rows, summary } = await measure();
  console.log(table(rows));
  assert.equal(rows.length, CASES.reduce((n, c) => n + (c.platforms?.length ?? 2), 0));
  assert.deepEqual(summary.invalid, [], "a check fails on the fixed app, or a run broke");
  assert.deepEqual(summary.missed, [], "a seeded bug did not show up");
  assert.equal(summary.total.caught, rows.length);
});
