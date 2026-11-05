#!/usr/bin/env node
// Measures simulator cost: session start time and memory per session.
// Usage: node scripts/sim-bench/run.mjs [--sessions 5] [--out .shipvo/sim-bench.json] [--port 4599] [--dist apps/tide-and-tackle/sim-dist]
// Needs the sample app's web build first:  cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist
// Start time: ms from sending POST /session to receiving its response, which carries the first screen.
// Memory: RSS of the sim process plus its Chromium children, read from /proc (Linux only; "n/a" elsewhere),
// with exactly 1, 3 and 5 sessions open (the warm-up session counts as the first open session).
// Sessions are never closed, so sessions 2..N are timed while earlier ones are still open.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { cpus, totalmem, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { median, max, treeRssMb } from "../../packages/sim/bench-stats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`--${k} needs a value`);
  return v;
};

async function main() {
  const N = Number(arg("sessions", 5));
  if (!Number.isInteger(N) || N < 1) throw new Error("--sessions must be a positive integer");
  const out = arg("out", ".shipvo/sim-bench.json");
  const port = Number(arg("port", 4599));
  const app = join(root, "apps/tide-and-tackle");
  const dist = resolve(arg("dist", join(app, "sim-dist")));
  if (!existsSync(join(dist, "index.html"))) throw new Error(`no web build at ${dist}. Build it: cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist`);
  const dir = join(process.env.TMPDIR || "/tmp", `sim-bench-${process.pid}`);
  const base = `http://localhost:${port}`;
  const sim = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(port), "--dir", dir, "--dist", dist], { cwd: app, stdio: ["ignore", "pipe", "pipe"] });
  let simLog = ""; sim.stdout.on("data", (d) => (simLog += d)); sim.stderr.on("data", (d) => (simLog += d));
  let exited = false; sim.on("exit", () => { exited = true; });
  try {
    for (let i = 0; i < 60; i++) {
      if (exited) throw new Error(`sim exited early:\n${simLog}`);
      try { if ((await fetch(`${base}/app/`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    const post = async (path, body) => { const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.json(); };
    await post("/session", { session: "warmup" });   // first launch loads Chromium and caches; not timed, but it stays open and counts as open session 1
    const rss = () => (platform() === "linux" ? treeRssMb(sim.pid) : null);
    const baseline = rss();
    const startMs = [], memory = [];
    for (let i = 1; i <= N; i++) {
      const t0 = performance.now();
      const r = await post("/session", { session: `bench-${i}` });
      if (!r.ok || !r.screen) throw new Error(`session ${i} failed: ${JSON.stringify(r).slice(0, 200)}`);
      startMs.push(Math.round(performance.now() - t0));
      const open = i + 1;   // the warm-up session is still open
      if (open === 3 || open === 5) memory.push({ sessions: open, rss_mb: rss() });
    }
    const result = {
      date: new Date().toISOString(), sessions: N, platform: platform(), node: process.version,
      cpus: cpus().length, cpu_model: cpus()[0]?.model ?? null, ram_gb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
      baseline_rss_mb: baseline, baseline_open_sessions: 1, start_ms: startMs, start_median_ms: median(startMs), start_max_ms: max(startMs), memory,
    };
    mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
    const na = (v) => (v == null ? "n/a" : v);
    console.log(`Session start (ms), ${N} sessions: median ${result.start_median_ms}, max ${result.start_max_ms}`);
    console.log("| open sessions | RSS MB (sim + Chromium) | RSS MB per session |\n|---|---|---|");
    console.log(`| 1 (warm-up only) | ${na(baseline)} | n/a |`);
    for (const m of memory) console.log(`| ${m.sessions} | ${na(m.rss_mb)} | ${m.rss_mb == null ? "n/a" : Math.round((m.rss_mb / m.sessions) * 10) / 10} |`);
    console.log(`Machine: ${result.cpus} CPUs, ${result.ram_gb} GB RAM, ${result.platform}. JSON: ${out}`);
  } finally { sim.kill(); setTimeout(() => sim.kill("SIGKILL"), 2000).unref(); }
}
main().catch((e) => { console.error(`sim-bench: ${e.message}`); process.exit(1); });
