#!/usr/bin/env node
// Measures the simulator for the sample app: time from /session to the first screen, and RSS of the sim process
// plus its Chromium children while sessions stay open. RSS is read from /proc (Linux only; "n/a" elsewhere).
//   node scripts/sim-bench/run.mjs [--sessions 5] [--out .shipvo/sim-bench.json] [--port 4749]
// Needs a web build of the app first:  cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { cpus, totalmem, platform, tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { median, max, parseVmRssMb, parsePpid, descendants } from "./stats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SESSIONS = Number(arg("sessions", 5)), OUT = arg("out", ".shipvo/sim-bench.json"), PORT = Number(arg("port", 4749));
if (!Number.isInteger(SESSIONS) || SESSIONS < 1) { console.error("--sessions must be a whole number, 1 or more"); process.exit(2); }
const app = join(root, "apps/tide-and-tackle");
if (!existsSync(join(app, "sim-dist/index.html"))) {
  console.error("No web build found. Run: cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist"); process.exit(2);
}
const HAS_PROC = platform() === "linux" && existsSync("/proc/self/status");
const CHECKPOINTS = [1, 3, 5].filter((n) => n <= SESSIONS);

function rssMb(rootPid) {
  if (!HAS_PROC) return null;
  const ppids = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try { const pp = parsePpid(readFileSync(`/proc/${d}/stat`, "utf8")); if (pp !== null) ppids.set(Number(d), pp); } catch {}
  }
  let total = 0;
  for (const pid of descendants(rootPid, ppids)) {
    try { total += parseVmRssMb(readFileSync(`/proc/${pid}/status`, "utf8")) ?? 0; } catch {}
  }
  return total;
}
const childCount = (pid) => { const m = new Map(); for (const d of readdirSync("/proc")) if (/^\d+$/.test(d)) try { m.set(Number(d), parsePpid(readFileSync(`/proc/${d}/stat`, "utf8"))); } catch {} return descendants(pid, m).length - 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 0) => (n === null || n === undefined ? "n/a" : n.toFixed(d));

const state = mkdtempSync(join(tmpdir(), "sim-bench-"));
const sim = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(PORT), "--dir", state], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
let exited = false; sim.on("exit", () => { exited = true; });
const post = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

try {
  for (let i = 0; i < 120 && !exited; i++) { try { if ((await fetch(`http://localhost:${PORT}/apps`)).ok) break; } catch {} await sleep(500); }
  if (exited) throw new Error("the simulator exited before it was ready");
  // Chromium launches after the server listens. Wait for it so session 1 does not pay for the browser launch.
  if (HAS_PROC) for (let i = 0; i < 120 && childCount(sim.pid) < 1; i++) await sleep(500); else await sleep(5000);
  const baseline = rssMb(sim.pid);

  const startMs = [], memory = {};
  for (let n = 1; n <= SESSIONS; n++) {
    const t0 = performance.now();
    const r = await post("/session", { session: `bench-${n}` });
    const ms = performance.now() - t0;
    if (!r.ok || !r.screen) throw new Error(`session ${n} did not return a screen: ${JSON.stringify(r).slice(0, 200)}`);
    startMs.push(ms);
    if (CHECKPOINTS.includes(n)) { await sleep(1000); memory[n] = rssMb(sim.pid); }
  }

  const result = {
    date: new Date().toISOString(), app: "apps/tide-and-tackle",
    machine: { platform: platform(), cpus: cpus().length, cpuModel: cpus()[0]?.model ?? null, ramGb: Math.round((totalmem() / 2 ** 30) * 10) / 10 },
    node: process.version, sessions: SESSIONS,
    sessionStartMs: { all: startMs.map((x) => Math.round(x)), median: Math.round(median(startMs)), max: Math.round(max(startMs)) },
    rssMb: { idle: baseline, bySessions: memory },
    note: "RSS sums the sim process and its descendants; pages shared between Chromium processes are counted once per process.",
  };
  console.log(`Simulator bench: ${SESSIONS} sessions, ${result.machine.cpus} CPUs, ${result.machine.ramGb} GB RAM (${result.machine.platform})`);
  console.log(`Session start (ms): median ${result.sessionStartMs.median}, max ${result.sessionStartMs.max}`);
  console.log("\nopen sessions | RSS MB (sim + Chromium)\n--------------|------------------------");
  console.log(`${"0 (idle)".padEnd(13)} | ${fmt(baseline, 1)}`);
  for (const n of CHECKPOINTS) console.log(`${String(n).padEnd(13)} | ${fmt(memory[n], 1)}`);
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nWrote ${OUT}`);
} catch (e) {
  console.error(`sim-bench failed: ${e.message}`); process.exitCode = 1;
} finally {
  sim.kill("SIGTERM"); await sleep(500); if (!exited) sim.kill("SIGKILL");
}
