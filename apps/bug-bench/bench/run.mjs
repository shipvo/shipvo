#!/usr/bin/env node
// The Shipvo bug-catch benchmark. Builds this app for the simulator, starts @shipvo/sim, opens every seeded bug
// both ways (fixed and buggy) on the Android and iOS phones, and prints how many bugs showed up.
//   node bench/run.mjs [--skip-build] [--out results.json] [--json] [--parallel 4] [--port <n>]
// Exit 0 when every case is valid, 1 when a check fails on the fixed app, 2 when the setup fails.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBench, summarize, table } from "./core.mjs";
import { CASES } from "./cases.mjs";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Builds the web export the simulator serves. Throws with the end of the build output when it fails. */
export function build() {
  const r = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", "sim-dist", "--clear"], { cwd: app, env: { ...process.env, PN_SIM: "1" }, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`the web build failed:\n${(r.stdout + r.stderr).trim().split("\n").slice(-12).join("\n")}`);
}

/** Starts the simulator for this app. Resolves { base, stop } once it listens. */
export async function startSim(port) {
  const server = createRequire(join(app, "package.json")).resolve("@shipvo/sim/server.mjs");
  const dir = mkdtempSync(join(tmpdir(), "bug-bench-"));
  const proc = spawn(process.execPath, [server, "--port", String(port), "--app", "bug-bench", "--dir", dir, "--dist", join(app, "sim-dist")], { cwd: app, stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; proc.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  const stop = async () => { if (proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; } proc.stderr.destroy(); rmSync(dir, { recursive: true, force: true }); };
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 450; i++) {
    try { await fetch(`${base}/sessions`); return { base, stop }; }
    catch { if (proc.exitCode !== null) { await stop(); throw new Error(`the simulator stopped: ${err}`); } await new Promise((r) => setTimeout(r, 200)); }
  }
  await stop(); throw new Error(`the simulator did not start on port ${port}: ${err}`);
}

/** Builds (unless skipBuild), runs the whole corpus and resolves { rows, summary }. */
export async function measure({ skipBuild = false, port = 12950 + Math.floor(Math.random() * 40), parallel = 4, onRow } = {}) {
  if (!skipBuild || !existsSync(join(app, "sim-dist", "index.html"))) build();
  const sim = await startSim(port);
  try { const rows = await runBench(sim.base, CASES, { parallel, onRow }); return { rows, summary: summarize(rows) }; }
  finally { await sim.stop(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const flag = (k) => process.argv.includes(`--${k}`);
  const parallel = Number(arg("parallel", 4));
  if (!Number.isInteger(parallel) || parallel < 1) { console.error("--parallel must be a whole number of 1 or more"); process.exit(2); }
  let result;
  try {
    result = await measure({ skipBuild: flag("skip-build"), parallel, ...(arg("port") ? { port: Number(arg("port")) } : {}), onRow: (r) => { if (!flag("json")) console.error(`${r.result.padEnd(7)} ${r.platform.padEnd(7)} ${r.id}`); } });
  } catch (e) { console.error(e.message); process.exit(2); }
  const doc = { measured_at: new Date().toISOString(), cases: CASES.length, ...result };
  if (arg("out")) writeFileSync(resolve(arg("out")), JSON.stringify(doc, null, 2) + "\n");
  console.log(flag("json") ? JSON.stringify(doc, null, 2) : table(result.rows));
  process.exit(result.summary.total.invalid ? 1 : 0);
}
