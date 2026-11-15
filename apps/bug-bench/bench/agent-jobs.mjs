#!/usr/bin/env node
// The agent jobs benchmark. A real coding agent is given one screen of this app and what the screen should do, tests it
// through the Shipvo Phone MCP tools, and ends with a verdict. Each job runs on the screen with the seeded bug and on the
// fixed screen, so an agent that always says "bug" fails half its runs. Counted per run: pass or fail, tokens, tool calls, seconds.
//   node bench/agent-jobs.mjs [--runs 1] [--jobs cart-total,empty-form] [--sides changed-lines,full-screen,core-tools] [--sides-file sides.json]
//                             [--out runs.json] [--skip-build] [--port <n>] [--json]
//   BENCH_AGENT_CMD=claude  BENCH_MODEL=<model id>  BENCH_TIMEOUT_S=300
// A side is one MCP server setup. The three built in are Shipvo's server as it ships (a changed screen comes back as its changed
// lines), the same server sending whole screens, and the same server listing only its core tools (SHIPVO_MCP_TOOLS=core). --sides-file adds other MCP servers on the same jobs: see docs/bug-bench.md.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeArgs, median, parseStream } from "../../../scripts/agent-efficiency/lib.mjs";
import { refOf } from "./core.mjs";
import { build, startSim } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

/** The jobs: a case of ../src/cases.js, what its screen should do, and what a report of its seeded bug must mention. */
export const JOBS = [
  { id: "cart-total", spec: "The total is the price, 1500, times the quantity.", found: /total/i },
  { id: "stale-state", spec: "Each tap on Add two raises the count by 2.", found: /count|add two|\b1\b/i },
  { id: "delete-wrong-row", spec: "Each Delete button removes the row it names and leaves the other rows.", found: /charlie|last row|wrong row|bravo/i },
  { id: "double-submit", spec: "Tapping Place order twice places one order, not two.", found: /two|twice|2|second|double/i },
  { id: "empty-form", spec: "Sign up with an empty email shows \"Enter your email\" and does not sign up.", found: /empty|blank|without an? email|no email/i },
  { id: "pagination-repeat", spec: "Load more adds the next three items. No item is listed twice.", found: /item 3|twice|repeat|duplicate|item 6|missing/i },
  { id: "nav-state-lost", spec: "The name typed in step 1 is still in the field after going to step 2 and back.", found: /name|empty|lost|cleared|gone/i },
  { id: "button-stays-disabled", spec: "Continue is enabled after agreeing to the terms, and tapping it creates the account.", found: /continue|disabled/i },
];
export const VARIANTS = ["buggy", "fixed"];

/** The task text an agent gets for `job` on the phone session `session`. The same for every side and both variants. */
export function prompt(job, session) {
  return [
    "You are testing one screen of a phone app through the phone tools you have. The screen is already open.",
    `Phone session: ${session}. Start by reading the screen.`,
    "",
    `What this screen should do: ${job.spec}`,
    "",
    "Use the screen the way a person would and find out whether it does that. Do not guess: act, then read what the screen shows.",
    "Finish with a short report: what you did, and what the screen showed. Then end with one last line that is exactly",
    "VERDICT: BUG   (the screen does not do what it should)   or",
    "VERDICT: OK    (it does).",
  ].join("\n");
}

/** Scores one report. A buggy screen passes on VERDICT: BUG with the bug named; a fixed screen passes on VERDICT: OK. */
export function score(job, variant, report) {
  const text = String(report ?? "");
  const all = [...text.matchAll(/^\s*\**\s*VERDICT:\s*(BUG|OK)\b/gim)];
  const verdict = all.length ? all[all.length - 1][1].toUpperCase() : null;
  if (!verdict) return { pass: false, verdict, why: "the report has no VERDICT line" };
  if (variant === "fixed") return verdict === "OK" ? { pass: true, verdict, why: "" } : { pass: false, verdict, why: "reported a bug on the fixed screen" };
  if (verdict !== "BUG") return { pass: false, verdict, why: "missed the seeded bug" };
  return job.found.test(text) ? { pass: true, verdict, why: "" } : { pass: false, verdict, why: "said BUG without naming the seeded bug" };
}

/** Totals per side: runs passed, and tokens, tool calls and seconds as the sum of each job-and-variant's median. */
export function summarize(runs) {
  const sides = [...new Set(runs.map((r) => r.side))];
  return sides.map((side) => {
    const mine = runs.filter((r) => r.side === side);
    const groups = new Map();
    for (const r of mine) { const k = `${r.job}:${r.variant}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    const sum = (f) => [...groups.values()].reduce((a, g) => a + (median(g.map(f)) ?? 0), 0);
    return {
      side, runs: mine.length, passed: mine.filter((r) => r.pass).length,
      bugs_found: mine.filter((r) => r.variant === "buggy" && r.pass).length, buggy_runs: mine.filter((r) => r.variant === "buggy").length,
      false_alarms: mine.filter((r) => r.variant === "fixed" && r.verdict === "BUG").length, fixed_runs: mine.filter((r) => r.variant === "fixed").length,
      tokens: Math.round(sum((r) => r.tokens)), calls: Math.round(sum((r) => r.calls) * 10) / 10, seconds: Math.round(sum((r) => r.seconds) * 10) / 10,
    };
  });
}

/** A plain-text table of the totals. */
export function table(totals) {
  const rows = [["Side", "Passed", "Bugs found", "False alarms", "Tokens", "Tool calls", "Seconds"],
    ...totals.map((t) => [t.side, `${t.passed}/${t.runs}`, `${t.bugs_found}/${t.buggy_runs}`, `${t.false_alarms}/${t.fixed_runs}`, t.tokens.toLocaleString("en-US"), String(t.calls), String(t.seconds)])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ")).join("\n");
}

/** The agent's final text from its stream-json output. */
export function finalReport(out) {
  let text = "";
  for (const line of String(out).split("\n")) { try { const ev = JSON.parse(line); if (ev.type === "result" && typeof ev.result === "string") text = ev.result; } catch { /* not a JSON line */ } }
  return text;
}

/** The built-in sides: the MCP server of this repository as it ships, sending whole screens, and listing only its core tools. */
export function builtInSides(simUrl) {
  const server = (env) => ({ mcpServers: { phone: { command: process.execPath, args: [join(root, "packages/mcp/dist/server.js")], env: { PN_SIM: simUrl, ...env } } } });
  return [
    { name: "changed-lines", serverName: "phone", config: server({}) },
    { name: "full-screen", serverName: "phone", config: server({ SHIPVO_MCP_FULL_SCREEN: "1" }) },
    { name: "core-tools", serverName: "phone", config: server({ SHIPVO_MCP_TOOLS: "core" }) },
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const flag = (k) => process.argv.includes(`--${k}`);
  const RUNS = Number(arg("runs", 1)), AGENT = process.env.BENCH_AGENT_CMD || "claude", MODEL = process.env.BENCH_MODEL || null;
  const TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_S || 300) * 1000;
  const jobs = arg("jobs") ? JOBS.filter((j) => arg("jobs").split(",").includes(j.id)) : JOBS;
  if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 5 || !jobs.length) { console.error("--runs is 1 to 5, and --jobs must name jobs of this benchmark"); process.exit(2); }
  const state = mkdtempSync(join(tmpdir(), "agent-jobs-"));
  const runAgent = (args, env) => new Promise((done) => {
    const t0 = performance.now(); let out = "";
    const p = spawn(AGENT, args, { cwd: state, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"], detached: true });
    const kill = () => { try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } } };
    const timer = setTimeout(kill, TIMEOUT_MS);
    p.stdout.on("data", (c) => (out += c));
    p.on("close", () => { clearTimeout(timer); kill(); done({ out, seconds: (performance.now() - t0) / 1000 }); });
  });
  let data;
  try {
    if (!flag("skip-build")) build();
    const sim = await startSim(Number(arg("port", 12990 + Math.floor(Math.random() * 9))));
    try {
      const post = async (path, body) => (await fetch(`${sim.base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
      let sides = builtInSides(sim.base);
      if (arg("sides-file")) sides = [...sides, ...JSON.parse(readFileSync(resolve(arg("sides-file")), "utf8"))];
      if (arg("sides")) sides = sides.filter((s) => arg("sides").split(",").includes(s.name));
      const version = spawnSync(AGENT, ["--version"], { encoding: "utf8" }).stdout?.trim() || null;
      const runs = [], models = new Set();
      const save = (complete) => {
        data = { measured_at: new Date().toISOString(), complete, agent: `${AGENT} ${version ?? ""}`.trim(), model: MODEL, models_used: [...models], node: process.version, runs_per_job: RUNS, jobs: jobs.map((j) => ({ id: j.id, spec: j.spec })), totals: summarize(runs), runs };
        if (arg("out")) writeFileSync(resolve(arg("out")), JSON.stringify(data, null, 2) + "\n");
      };
      // Sides alternate inside each job and variant, so drift in the model service reaches all of them alike.
      for (let n = 1; n <= RUNS; n++) for (const job of jobs) for (const variant of VARIANTS) for (const side of sides) {
        const session = `job-${job.id}-${variant}-${side.name}-${n}`;
        if (side.openCmd) {
          // Another tool's device: its own command opens the case there. {id} and {variant} are replaced.
          const o = spawnSync(side.openCmd.replaceAll("{id}", job.id).replaceAll("{variant}", variant), { shell: true, encoding: "utf8" });
          if (o.status !== 0) throw new Error(`${side.name}: the open command failed: ${(o.stderr || o.stdout).slice(-300)}`);
        } else {
          const o = await post("/session", { session, app: "bug-bench", model: "Pixel 8" });
          if (!o.ok) throw new Error(`session ${session}: ${o.error ?? o.code}`);
          const t = await post("/act", { session, action: "type", ref: refOf(o.screen, "Case"), text: `${job.id}:${variant}` });
          const opened = await post("/act", { session, action: "tap", ref: refOf(t.screen, "Open case") });
          if (!opened.ok) throw new Error(`could not open ${job.id}: ${opened.error}`);
        }
        const cfg = join(state, `${session}.mcp.json`); writeFileSync(cfg, JSON.stringify(side.config));
        console.error(`run ${n}/${RUNS}  ${job.id}  ${variant}  ${side.name}`);
        const { out, seconds } = await runAgent(claudeArgs({ prompt: prompt(job, session), mcpConfigPath: cfg, serverName: side.serverName ?? "phone", model: MODEL }), {});
        const p = parseStream(out), s = score(job, variant, finalReport(out));
        for (const line of out.split("\n")) { try { const ev = JSON.parse(line); if (ev.type === "system" && ev.subtype === "init" && ev.model) models.add(ev.model); } catch { /* not a JSON line */ } }
        runs.push({ side: side.name, job: job.id, variant, run: n, pass: s.pass && p.finished, verdict: s.verdict, why: p.finished ? s.why : "the agent did not finish (time limit or crash)", tokens: p.tokensTotal, calls: p.steps, seconds: +seconds.toFixed(1), cost_usd: p.costUsd });
        save(false);
        if (!side.openCmd) await post("/end", { session });
      }
      save(true);
    } finally { await sim.stop(); }
  } catch (e) { console.error(e.message); process.exit(2); }
  console.log(flag("json") ? JSON.stringify(data, null, 2) : table(data.totals));
}
