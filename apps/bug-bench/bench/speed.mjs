#!/usr/bin/env node
// The Shipvo Phone speed benchmark. Builds this app, starts @shipvo/sim and times what an agent does all day:
// opening a phone, reading the screen, tapping, typing and taking screenshots, on an Android and an iOS model.
// It also measures what an agent has to read: the size of a screen as a tree against the same screen as a picture.
//   node bench/speed.mjs [--skip-build] [--out speed.json] [--json] [--models "Pixel 8,iPhone 16"] [--port <n>]
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, startSim } from "./run.mjs";
import { refOf } from "./core.mjs";

/** The middle value of a list of numbers, or null for an empty list. */
export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** { runs, median, min, max } of a list of milliseconds, rounded to one decimal. */
export function summary(ms) {
  const r = (n) => (n == null ? null : Math.round(n * 10) / 10);
  return { runs: ms.length, median: r(median(ms)), min: r(ms.length ? Math.min(...ms) : null), max: r(ms.length ? Math.max(...ms) : null) };
}

/** Times `fn` `runs` times and returns the list of milliseconds. */
export async function time(runs, fn) {
  const out = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); await fn(i); out.push(performance.now() - t0); }
  return out;
}

/** Resident memory in MB of a process and all its children, from /proc. null where /proc is not there. */
export function treeRssMb(pid) {
  try {
    const kids = (p) => { try { return readFileSync(`/proc/${p}/task/${p}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
    const all = []; const walk = (p) => { all.push(p); kids(p).forEach(walk); }; walk(pid);
    let kb = 0;
    for (const p of all) { const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${p}/status`, "utf8")); if (m) kb += Number(m[1]); }
    return Math.round(kb / 102.4) / 10;
  } catch { return null; }
}

/** Measures one phone model on a running simulator. Resolves the timings and sizes for it. */
export async function measureModel(base, model, { runs = 10, fetchImpl = fetch } = {}) {
  const post = async (path, body) => (await fetchImpl(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const act = (session, action, body = {}) => post("/act", { session, action, ...body });
  const must = (r, what) => { if (!r.ok) throw new Error(`${what} failed on ${model}: ${r.error ?? r.code}`); return r; };

  // Opening a phone: a new session each time, timed to the first screen.
  const open = await time(Math.min(runs, 5), async (i) => { const s = `speed-open-${model}-${i}`; must(await post("/session", { session: s, app: "bug-bench", model }), "open"); await post("/end", { session: s }); });

  const s = `speed-${model}`;
  const first = must(await post("/session", { session: s, app: "bug-bench", model }), "open");
  const caseRef = refOf(first.screen, "Case"), openRef = refOf(first.screen, "Open case");
  if (!caseRef || !openRef) throw new Error(`the picker screen did not open on ${model}`);
  const screen = await time(runs, async () => { must(await act(s, "screen"), "screen"); });
  const type = await time(runs, async (i) => { must(await act(s, "type", { ref: caseRef, text: `speed-${i}` }), "type"); });
  // "Open case" with a name that is no case clears the field and stays on the picker, so the same tap repeats.
  const tap = await time(runs, async () => { must(await act(s, "tap", { ref: openRef }), "tap"); });
  let plainBytes = 0, framedBytes = 0;
  const screenshot = await time(runs, async () => { plainBytes = statSync(must(await act(s, "screenshot"), "screenshot").path).size; });
  const framed = await time(runs, async () => { framedBytes = statSync(must(await act(s, "screenshot", { frame: true }), "framed screenshot").path).size; });

  // What an agent reads: the tree of a screen against the picture of the same screen.
  const sizes = [];
  for (const id of ["cart-total", "delete-wrong-row", "pagination-repeat", "empty-form", "wrong-screen"]) {
    const t = `speed-size-${model}-${id}`;
    const o = must(await post("/session", { session: t, app: "bug-bench", model }), "open");
    must(await act(t, "type", { ref: refOf(o.screen, "Case"), text: `${id}:fixed` }), "type");
    const tree = must(await act(t, "tap", { ref: refOf(o.screen, "Open case") }), "tap").screen ?? "";
    const png = statSync(must(await act(t, "screenshot"), "screenshot").path).size;
    sizes.push({ screen: id, tree_bytes: Buffer.byteLength(tree), png_bytes: png });
    await post("/end", { session: t });
  }
  await post("/end", { session: s });
  const tree = median(sizes.map((x) => x.tree_bytes)), png = median(sizes.map((x) => x.png_bytes));
  return {
    model, ms: { open: summary(open), screen: summary(screen), tap: summary(tap), type: summary(type), screenshot: summary(screenshot), framed_screenshot: summary(framed) },
    bytes: { screenshot: plainBytes, framed_screenshot: framedBytes, tree_median: tree, png_median: png, png_per_tree: tree ? Math.round((png / tree) * 10) / 10 : null, screens: sizes },
  };
}

/** A plain-text table of the result. */
export function table(result) {
  const rows = [["", ...result.models.map((m) => m.model)]];
  for (const [key, label] of [["open", "Open a phone"], ["screen", "Read the screen"], ["tap", "Tap"], ["type", "Type"], ["screenshot", "Screenshot"], ["framed_screenshot", "Screenshot in the frame"]]) rows.push([`${label} (ms, median)`, ...result.models.map((m) => String(m.ms[key].median))]);
  rows.push(["Screen as a tree (bytes, median)", ...result.models.map((m) => String(m.bytes.tree_median))]);
  rows.push(["Same screen as a PNG (bytes, median)", ...result.models.map((m) => String(m.bytes.png_median))]);
  rows.push(["PNG bytes per tree byte", ...result.models.map((m) => String(m.bytes.png_per_tree))]);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const m = result.memory_mb;
  const mem = m ? `\nMemory (simulator and browser, ${m.model}): ${m.idle} MB idle, ${m.one_session} MB with 1 session, ${m.three_sessions} MB with 3, ${m.five_sessions} MB with 5 (${m.per_extra_session} MB per extra session)` : "";
  return rows.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ")).join("\n") + mem;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const flag = (k) => process.argv.includes(`--${k}`);
  const models = arg("models", "Pixel 8,iPhone 16").split(",").map((m) => m.trim()).filter(Boolean);
  let result;
  try {
    if (!flag("skip-build")) build();
    const sim = await startSim(Number(arg("port", 12900 + Math.floor(Math.random() * 40))));
    try {
      // Memory first, on a simulator that has done nothing else: the browser is up after one session has opened and closed.
      const post = async (path, body) => (await fetch(`${sim.base}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
      const settle = () => new Promise((r) => setTimeout(r, 1500));
      await post("/session", { session: "warm", app: "bug-bench", model: models[0] }); await post("/end", { session: "warm" }); await settle();
      const idle = treeRssMb(sim.pid);
      const held = [];
      for (let i = 0; i < 5; i++) { await post("/session", { session: `mem-${i}`, app: "bug-bench", model: models[0] }); await settle(); held.push(treeRssMb(sim.pid)); }
      for (let i = 0; i < 5; i++) await post("/end", { session: `mem-${i}` });
      const out = [];
      for (const m of models) out.push(await measureModel(sim.base, m));
      result = { measured_at: new Date().toISOString(), node: process.version, models: out, memory_mb: idle == null ? null : { model: models[0], idle, one_session: held[0], three_sessions: held[2], five_sessions: held[4], per_extra_session: Math.round(((held[4] - held[0]) / 4) * 10) / 10 } };
    } finally { await sim.stop(); }
  } catch (e) { console.error(e.message); process.exit(2); }
  if (arg("out")) writeFileSync(resolve(arg("out")), JSON.stringify(result, null, 2) + "\n");
  console.log(flag("json") ? JSON.stringify(result, null, 2) : table(result));
}
