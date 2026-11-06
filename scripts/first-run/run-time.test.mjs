import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { parseListening, firstTapRef, timings, table, measureRun } from "./run-time.mjs";

test("parseListening finds the phone URL", () => {
  assert.equal(parseListening("Building…\nSimulated Android phone at http://127.0.0.1:4123/  (Ctrl+C to stop)\n"), "http://127.0.0.1:4123/");
  assert.equal(parseListening("Building…"), null);
});

test("firstTapRef prefers buttons and links", () => {
  const tree = '- heading "Hi" [level=1] [ref=e1]\n  - button "Go" [ref=e2]\n';
  assert.equal(firstTapRef(tree), "e2");
  assert.equal(firstTapRef('- heading "Hi" [ref=e7]'), "e7");
  assert.equal(firstTapRef("- text: nothing"), null);
});

test("timings are relative to start and table has four rows", () => {
  const rows = timings({ start: 1000, listening: 3500, ready: 4000, tapped: 4250 });
  assert.deepEqual(rows.map((r) => r.ms), [0, 2500, 3000, 3250]);
  const lines = table(rows).split("\n");
  assert.equal(lines.length, 6);
  assert.match(lines[5], /first tap done \| 3\.25/);
});

// A fake `shipvo run`: prints the ready line after a delay and serves the page. With delay -1 it never prints.
function fakeCli(delayMs) {
  const d = mkdtempSync(join(tmpdir(), "fake-run-"));
  const cli = join(d, "cli.js");
  writeFileSync(cli, `
import {createServer} from "node:http"; import {mkdirSync, writeFileSync} from "node:fs";
const s = createServer((q,r)=>r.end("<html></html>"));
s.listen(0,"127.0.0.1",()=>{ const p=s.address().port;
  mkdirSync(".shipvo",{recursive:true}); writeFileSync(".shipvo/run.json", JSON.stringify({token:"t"}));
  if (${delayMs} >= 0) setTimeout(()=>console.error("Simulated Android phone at http://127.0.0.1:"+p+"/  (Ctrl+C to stop)"), ${delayMs}); });
setInterval(()=>{},1000);`);
  const app = join(d, "app"); mkdirSync(app);
  return { cli, app };
}
const fakeDriver = () => ({ opened: Promise.resolve(), close() {}, request: async (type) => (type === "tree" ? { ok: true, tree: '- button "Go" [ref=e1]' } : { ok: true }) });

test("a late ready line shows up in the server listening time", async () => {
  const f = fakeCli(700);
  const rows = await measureRun({ ...f, timeoutMs: 20000, open: async () => () => {}, drive: fakeDriver, poll: 20 });
  assert.equal(rows.length, 4);
  assert.ok(rows[1].ms >= 600, `listening at ${rows[1].ms} ms`);
  assert.ok(rows[1].ms <= rows[2].ms && rows[2].ms <= rows[3].ms);
});

test("never listening fails with a clear message after the limit", async () => {
  const f = fakeCli(-1);
  await assert.rejects(measureRun({ ...f, timeoutMs: 800, open: async () => () => {}, drive: fakeDriver, poll: 20 }), /never started listening within 1 s/);
});

test("a page that never reports the app loaded fails with a clear message", async () => {
  const f = fakeCli(0);
  const drive = () => ({ opened: Promise.resolve(), close() {}, request: async () => ({ ok: false, error: "the app is not loaded yet" }) });
  await assert.rejects(measureRun({ ...f, timeoutMs: 1500, open: async () => () => {}, drive, poll: 20 }), /never reported the app loaded/);
});

test("an empty first tree is not ready; ready is stamped once a ref shows up", async () => {
  const f = fakeCli(0);
  let calls = 0, secondAt = 0;
  const drive = () => ({ opened: Promise.resolve(), close() {}, request: async (type) => {
    if (type !== "tree") return { ok: true };
    calls++;
    if (calls === 1) return { ok: true, tree: "- text: loading" };
    secondAt = performance.now();
    return { ok: true, tree: '- button "Go" [ref=e1]' };
  } });
  let start = null;
  const now = () => { const n = performance.now(); start ??= n; return n; };
  const rows = await measureRun({ ...f, timeoutMs: 20000, open: async () => () => {}, drive, poll: 20, now });
  assert.ok(calls >= 2);
  assert.ok(rows[2].ms >= Math.floor(secondAt - start), `ready at ${rows[2].ms} ms, second reply at ${secondAt - start}`);
});
