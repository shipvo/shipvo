// The speed benchmark's own arithmetic and its run against a stand-in simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { median, summary, time, measureModel, table } from "./speed.mjs";

test("median of odd, even and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(median([5]), 5);
});

test("summary gives runs, median, min and max to one decimal", () => {
  assert.deepEqual(summary([10.04, 20.06, 30.01]), { runs: 3, median: 20.1, min: 10, max: 30 });
  assert.deepEqual(summary([]), { runs: 0, median: null, min: null, max: null });
});

test("time runs the function the asked number of times and returns one duration each", async () => {
  let calls = 0;
  const ms = await time(4, async () => { calls++; });
  assert.equal(calls, 4); assert.equal(ms.length, 4);
  assert.ok(ms.every((n) => n >= 0));
});

test("a model is measured: every action timed, and the tree compared with the picture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "speed-"));
  const shot = join(dir, "shot.png"); writeFileSync(shot, Buffer.alloc(4000));
  const picker = '- textbox "Case" [ref=e1]\n- button "Open case" [ref=e2]';
  const seen = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname, body = JSON.parse(init.body); seen.push({ path, body });
    if (path === "/session") return new Response(JSON.stringify({ ok: true, screen: picker }));
    if (path === "/end") return new Response(JSON.stringify({ ok: true }));
    if (body.action === "screenshot") return new Response(JSON.stringify({ ok: true, path: shot, screen: picker }));
    return new Response(JSON.stringify({ ok: true, screen: body.action === "tap" && body.session.includes("size") ? "x".repeat(200) : picker }));
  };
  const r = await measureModel("http://sim", "Pixel 8", { runs: 3, fetchImpl });
  assert.equal(r.model, "Pixel 8");
  assert.deepEqual(Object.keys(r.ms), ["open", "screen", "tap", "type", "screenshot", "framed_screenshot"]);
  for (const k of Object.keys(r.ms)) assert.equal(r.ms[k].runs, 3, k);
  assert.equal(r.bytes.tree_median, 200); assert.equal(r.bytes.png_median, 4000); assert.equal(r.bytes.png_per_tree, 20);
  assert.equal(r.bytes.screens.length, 5);
  assert.ok(seen.filter((c) => c.path === "/session").every((c) => c.body.model === "Pixel 8" && c.body.app === "bug-bench"));
  assert.equal(seen.filter((c) => c.body.action === "screenshot" && c.body.frame === true).length, 3);
  assert.equal(seen.filter((c) => c.path === "/session").length, seen.filter((c) => c.path === "/end").length, "every phone that was opened is closed");
});

test("a failed action stops the measurement with the model and the reason", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: false, code: "bad_model", error: "unknown phone model" }));
  await assert.rejects(measureModel("http://sim", "Nokia 3310", { runs: 1, fetchImpl }), /open failed on Nokia 3310: unknown phone model/);
});

test("the table has one column per model and the memory line", () => {
  const ms = Object.fromEntries(["open", "screen", "tap", "type", "screenshot", "framed_screenshot"].map((k, i) => [k, { median: (i + 1) * 100 }]));
  const t = table({ models: [{ model: "Pixel 8", ms, bytes: { tree_median: 205, png_median: 37833, png_per_tree: 184.6 } }], memory_mb: { model: "Pixel 8", idle: 589, one_session: 936, three_sessions: 1459, five_sessions: 2016, per_extra_session: 270 } });
  assert.match(t, /Read the screen \(ms, median\)\s+200$/m);
  assert.match(t, /PNG bytes per tree byte\s+184\.6$/m);
  assert.match(t, /Memory \(simulator and browser, Pixel 8\): 589 MB idle, 936 MB with 1 session, 1459 MB with 3, 2016 MB with 5 \(270 MB per extra session\)/);
});
