#!/usr/bin/env node
// Measures how many simulators one machine runs at once. Opens sessions in batches, and at each checkpoint records
// the memory of the sim process plus its Chromium children, the time the batch took to start, and whether a sample
// of sessions still answers a screen read. RSS is read from /proc (Linux only).
//   node scripts/sim-bench/scale.mjs [--max 100] [--step 10] [--app apps/chess] [--out .shipvo/sim-scale.json] [--port 4751]
// Needs a web build in <app>/sim-dist (see run.mjs).
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { cpus, totalmem, platform, tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { median, max, parseVmRssMb, parsePpid, descendants } from "./stats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MAX = Number(arg("max", 100)), STEP = Number(arg("step", 10)), OUT = arg("out", ".shipvo/sim-scale.json"), PORT = Number(arg("port", 4751));
if (![MAX, STEP].every((n) => Number.isInteger(n) && n >= 1)) { console.error("--max and --step must be whole numbers, 1 or more"); process.exit(2); }
const app = resolve(root, arg("app", "apps/chess"));
if (!existsSync(join(app, "sim-dist/index.html"))) { console.error(`No web build in ${app}/sim-dist. See scripts/sim-bench/run.mjs for the export command.`); process.exit(2); }
if (platform() !== "linux") { console.error("scale.mjs reads memory from /proc, so it runs on Linux."); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function table() {
  const ppids = new Map();
  for (const d of readdirSync("/proc")) if (/^\d+$/.test(d)) try { const pp = parsePpid(readFileSync(`/proc/${d}/stat`, "utf8")); if (pp !== null) ppids.set(Number(d), pp); } catch {}
  return ppids;
}
const rssMb = (pid) => { let t = 0; for (const p of descendants(pid, table())) try { t += parseVmRssMb(readFileSync(`/proc/${p}/status`, "utf8")) ?? 0; } catch {} return t; };
const procs = (pid) => descendants(pid, table()).length;
const availMb = () => { const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8")); return m ? Math.round(Number(m[1]) / 1024) : null; };

const state = mkdtempSync(join(tmpdir(), "sim-scale-"));
const sim = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(PORT), "--dir", state], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
let exited = false; sim.on("exit", () => { exited = true; });
const post = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

try {
  for (let i = 0; i < 120 && !exited; i++) { try { if ((await fetch(`http://localhost:${PORT}/apps`)).ok) break; } catch {} await sleep(500); }
  if (exited) throw new Error("the simulator exited before it was ready");
  for (let i = 0; i < 120 && procs(sim.pid) < 2; i++) await sleep(500);
  await sleep(1000);
  const idle = rssMb(sim.pid), idleAvail = availMb();
  const steps = [];
  let open = 0, stopped = null;
  while (open < MAX && !stopped) {
    const n = Math.min(STEP, MAX - open);
    const t0 = performance.now();
    const results = await Promise.all(Array.from({ length: n }, (_, k) => {
      const t = performance.now();
      return post("/session", { session: `s${open + k + 1}` }).then((r) => ({ ok: !!(r.ok && r.screen), ms: performance.now() - t }));
    }));
    const batchMs = performance.now() - t0;
    const failed = results.filter((r) => !r.ok).length;
    open += n - failed;
    await sleep(1500);
    // a sample of sessions, oldest and newest, still answers a screen read
    const sample = [1, Math.ceil(open / 2), open].filter((v, i, a) => v >= 1 && a.indexOf(v) === i);
    const answers = await Promise.all(sample.map((i) => post("/act", { session: `s${i}`, action: "screen" }).then((r) => !!r.ok).catch(() => false)));
    const step = { open, batchSeconds: Math.round(batchMs / 100) / 10, medianStartMs: Math.round(median(results.map((r) => r.ms))), failed, answering: answers.filter(Boolean).length + "/" + answers.length, rssMb: Math.round(rssMb(sim.pid)), processes: procs(sim.pid), availableMb: availMb() };
    steps.push(step);
    console.log(JSON.stringify(step));
    if (failed) stopped = `${failed} sessions did not start at ${open + failed}`;
    else if (step.availableMb !== null && step.availableMb < 600) stopped = "stopped with 600 MB of memory still free, to keep the machine responsive";
    else if (exited) stopped = "the simulator exited";
  }
  const last = steps.at(-1);
  const result = {
    date: new Date().toISOString(), app: arg("app", "apps/chess"),
    machine: { platform: platform(), cpus: cpus().length, cpuModel: cpus()[0]?.model ?? null, ramGb: Math.round((totalmem() / 2 ** 30) * 10) / 10 },
    node: process.version, requested: MAX, step: STEP, idleRssMb: Math.round(idle), idleAvailableMb: idleAvail, steps, stopped,
    // Memory the machine gave up per open simulator: the fall in MemAvailable, which counts shared pages once.
    // taken at the last step that started in under 10 s, before memory ran short
    perSimulatorMb: (() => { const ok = steps.filter((x) => x.medianStartMs < 10000 && !x.failed).at(-1); return ok && idleAvail !== null && ok.availableMb !== null ? Math.round(((idleAvail - ok.availableMb) / ok.open) * 10) / 10 : null; })(),
    note: "rssMb sums the sim process and its descendants and counts shared pages once per process, so it over-counts. perSimulatorMb uses the fall in MemAvailable.",
  };
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\n${last?.open ?? 0} simulators open, ${result.perSimulatorMb} MB each (measured below memory pressure). Wrote ${OUT}`);
} catch (e) {
  console.error(`sim-scale failed: ${e.message}`); process.exitCode = 1;
} finally {
  sim.kill("SIGTERM"); await sleep(500); if (!exited) sim.kill("SIGKILL");
}
