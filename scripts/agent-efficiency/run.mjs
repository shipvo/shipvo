#!/usr/bin/env node
// Same task, two ways (#837). Runs one shop task with the same agent and model on two sides, N times each (1 to 5):
//   screenshots: screenshot + coordinate taps (baseline-mcp.mjs)    labelled: Shipvo's labelled screen via @shipvo/mcp
// Writes the raw runs as JSON and the docs page. Needs the web build (see scripts/sim-bench/run.mjs) and `claude` signed in.
//   node scripts/agent-efficiency/run.mjs --runs 5 --out docs/agent-efficiency-runs.json [--docs docs/agent-efficiency.md]
//   BENCH_AGENT_CMD=claude  BENCH_MODEL=<model id, same for both sides>  BENCH_TIMEOUT_S=900
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStream, grade, renderMarkdown, summarize, claudeArgs, TASK_PREFIX } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg("runs", 5)), OUT = arg("out", "docs/agent-efficiency-runs.json"), DOCS = arg("docs", "docs/agent-efficiency.md");
const PORT = Number(arg("port", 4751)), AGENT = process.env.BENCH_AGENT_CMD || "claude", MODEL = process.env.BENCH_MODEL || null;
const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_S || 900) * 1000;
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5) { console.error("--runs must be a whole number from 1 to 5"); process.exit(2); }
const app = join(root, "apps/tide-and-tackle");
if (!existsSync(join(app, "sim-dist/index.html"))) {
  console.error("No web build found; building it with expo export (PN_SIM=1).");
  const b = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", "sim-dist"], { cwd: app, env: { ...process.env, PN_SIM: "1" }, stdio: "inherit" });
  if (b.status !== 0 || !existsSync(join(app, "sim-dist/index.html"))) { console.error("The web build failed. Run by hand: cd apps/tide-and-tackle && PN_SIM=1 npx expo export --platform web --output-dir sim-dist"); process.exit(2); }
}
const task = JSON.parse(readFileSync(join(app, "agent-eval/tasks.json"), "utf8")).find((t) => t.id === "T1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = mkdtempSync(join(tmpdir(), "agent-eff-"));
const simUrl = `http://localhost:${PORT}`;
const sim = spawn(process.execPath, [join(root, "packages/sim/server.mjs"), "--port", String(PORT), "--dir", state], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
let simDown = false; sim.on("exit", () => { simDown = true; });

function runAgent(args, env) {
  return new Promise((done) => {
    const t0 = performance.now(); let out = "";
    const p = spawn(AGENT, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"], detached: true });
    // Kill the whole process group so the MCP child cannot outlive a hung run.
    const killGroup = () => { try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch {} } };
    const timer = setTimeout(killGroup, TIMEOUT_MS);
    p.stdout.on("data", (c) => (out += c));
    p.on("close", () => { clearTimeout(timer); killGroup(); done({ out, seconds: (performance.now() - t0) / 1000 }); });
  });
}

const runs = [];
let version = null;
const models = new Set();
const build = (complete) => ({ date: new Date().toISOString().slice(0, 10), complete, runsPerSide: RUNS, task: task.task, agent: `${AGENT} ${version ?? ""}`.trim(), model: MODEL, modelsUsed: [...models], app: "apps/tide-and-tackle (Tide & Tackle)", node: process.version, runs, summary: summarize(runs) });
const save = (complete) => { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(OUT, JSON.stringify(build(complete), null, 2) + "\n"); };
try {
  for (let i = 0; i < 120 && !simDown; i++) { try { if ((await fetch(`${simUrl}/apps`)).ok) break; } catch {} await sleep(500); }
  if (simDown) throw new Error("the simulator exited before it was ready");
  version = spawnSync(AGENT, ["--version"], { encoding: "utf8" }).stdout?.trim() || null;
  // Alternate sides inside each round so drift in the service hits both equally.
  for (let n = 1; n <= RUNS; n++) for (const side of ["screenshots", "labelled"]) {
    const session = `bench-${side}-${n}`;
    const r = await (await fetch(`${simUrl}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session }) })).json();
    if (!r.ok) throw new Error(`session ${session}: ${JSON.stringify(r).slice(0, 200)}`);
    const env = { PN_SIM: simUrl, PN_SIM_DIR: state, BENCH_SESSION: session };
    const server = side === "screenshots" ? { command: process.execPath, args: [join(root, "scripts/agent-efficiency/baseline-mcp.mjs")], env }
      : { command: process.execPath, args: [join(root, "packages/mcp/dist/server.js")], env };
    const cfg = join(state, `${session}.mcp.json`); writeFileSync(cfg, JSON.stringify({ mcpServers: { phone: server } }));
    const prompt = `${TASK_PREFIX}${task.task}` + `\n\n(Your session id is ${session}.)`;
    console.error(`run ${side} ${n}/${RUNS}`);
    const { out, seconds } = await runAgent(claudeArgs({ prompt, mcpConfigPath: cfg, serverName: "phone", model: MODEL }), env);
    const p = parseStream(out);
    for (const line of out.split("\n")) { try { const ev = JSON.parse(line); if (ev.type === "system" && ev.subtype === "init" && ev.model) models.add(ev.model); } catch {} }
    let sessionState = null; try { sessionState = JSON.parse(readFileSync(join(state, `${session}.json`), "utf8")); } catch {}
    const g = grade(sessionState, task.expect);
    if (!p.finished) g.why.push("agent did not finish (timeout or crash)");
    runs.push({ side, run: n, success: g.success && p.finished, why: g.why, seconds: +seconds.toFixed(1), steps: p.steps, turns: p.turns, tokens: p.tokens, tokensTotal: p.tokensTotal, costUsd: p.costUsd });
    save(false);   // keep finished runs even if a later one throws
  }
  const data = build(true);
  save(true);
  mkdirSync(dirname(resolve(DOCS)), { recursive: true });
  writeFileSync(DOCS, renderMarkdown(data));
  console.log(renderMarkdown(data));
} catch (e) { console.error(`agent-efficiency failed: ${e.message}`); if (runs.length) { save(false); console.error(`partial results (${runs.length} runs) saved to ${OUT}`); } process.exitCode = 1; }
finally { sim.kill(); }
