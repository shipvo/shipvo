// `shipvo eval`: score an agent on an app task. The harness never calls a model. It opens a session, puts a
// recording proxy in front of the MCP server, and the agent (whoever runs it) connects to the proxy as usual.
import http from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emit, envelope } from "./json-out.js";

export type Check =
  | { id?: string; type: "order_exists"; items: { id?: string; name?: string; quantity?: number }[]; count?: number }
  | { id?: string; type: "screen_shown" | "text_present" | "text_absent" | "text_seen"; text: string }
  | { id?: string; type: "no_crash" };
export type Task = {
  name: string; app: string; platform: "android" | "ios"; instruction: string;
  start?: { seed_cart?: unknown[]; device?: Record<string, unknown>; network?: Record<string, unknown> };
  limits: { seconds: number; steps: number };
  checks: Check[];
};
export type Step = { n: number; t: number; tool: string; args: Record<string, unknown>; ok: boolean; code?: string; text: string };
export type CheckResult = { id: string; type: string; pass: boolean; detail: string };
export type RunResult = {
  id: string; task: string; agent: string; model?: string; platform: string; ended: "agent" | "step_limit" | "time_limit";
  pass: boolean; steps: number; seconds: number; errors: number; retries: number;
  findings: { code: string; tool: string; count: number }[]; checks: CheckResult[]; stepsFile: string; recording?: string;
};

export function loadTask(arg: string, cwd = process.cwd()): Task {
  const p = [resolve(cwd, arg), resolve(cwd, "tasks", `${arg}.task.json`)].find((f) => /\.json$/.test(f) && existsSync(f));
  if (!p) throw new Error(`no task "${arg}": expected tasks/${arg}.task.json`);
  const t = JSON.parse(readFileSync(p, "utf8")) as Task;
  const bad = (m: string) => { throw new Error(`${p}: ${m}`); };
  if (!t.name || !t.app || !t.instruction) bad("name, app and instruction are required");
  if (t.platform !== "android" && t.platform !== "ios") bad('platform must be "android" or "ios"');
  if (!(t.limits?.seconds > 0) || !(t.limits?.steps > 0)) bad("limits.seconds and limits.steps must be positive numbers");
  if (!Array.isArray(t.checks) || !t.checks.length) bad("checks must list at least one check");
  const types = ["order_exists", "screen_shown", "text_present", "text_absent", "text_seen", "no_crash"];
  for (const c of t.checks) if (!types.includes(c.type)) bad(`unknown check type "${c.type}"`);
  return t;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase();
type Order = Record<string, unknown>;
const lines = (o: Order): Order[] => { const l = o.items ?? o.lines ?? o.cart; return Array.isArray(l) ? l as Order[] : []; };
function orderHas(o: Order, want: { id?: string; name?: string; quantity?: number }) {
  return lines(o).some((l) => {
    const ids = [l.id, l.product_id, l.name].map(norm);
    const named = (want.id !== undefined && ids.includes(norm(want.id))) || (want.name !== undefined && ids.includes(norm(want.name)));
    const q = l.quantity ?? l.qty ?? 1;
    return named && (want.quantity === undefined || Number(q) === want.quantity);
  });
}

/** Evaluate the task's checks against what the run produced. Pure, so the same trace always scores the same. */
export function score(task: Task, trace: { steps: Step[]; finalScreen: string; orders: Order[] }): CheckResult[] {
  return task.checks.map((c, i): CheckResult => {
    const id = c.id ?? `${c.type}-${i + 1}`;
    const r = (pass: boolean, detail: string) => ({ id, type: c.type, pass, detail });
    switch (c.type) {
      case "order_exists": {
        const hit = trace.orders.filter((o) => c.items.every((w) => orderHas(o, w)));
        if (!hit.length) return r(false, `no order with ${c.items.map((w) => `${w.quantity ?? 1} x ${w.id ?? w.name}`).join(", ")} (${trace.orders.length} orders)`);
        if (c.count !== undefined && trace.orders.length !== c.count) return r(false, `${trace.orders.length} orders, expected ${c.count}`);
        return r(true, `${hit.length} matching order(s)`);
      }
      case "screen_shown": case "text_present": return r(norm(trace.finalScreen).includes(norm(c.text)), `"${c.text}" on the final screen`);
      case "text_absent": return r(!norm(trace.finalScreen).includes(norm(c.text)), `"${c.text}" not on the final screen`);
      case "text_seen": return r(trace.steps.some((s) => norm(s.text).includes(norm(c.text))), `"${c.text}" shown at some step`);
      case "no_crash": {
        const bad = trace.steps.find((s) => /crash/i.test(s.code ?? "") || /app (has )?crashed|unhandled exception/i.test(s.text));
        return r(!bad, bad ? `crash at step ${bad.n}` : "no crash");
      }
    }
  });
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

type Rpc = { result?: { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { message: string } };
async function post(url: string, key: string | undefined, body: string): Promise<{ status: number; text: string; json?: Rpc }> {
  const r = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) } });
  const text = await r.text();
  const data = text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) : text;
  let json: Rpc | undefined; try { json = data ? JSON.parse(data) : undefined; } catch {}
  return { status: r.status, text, json };
}
const textOf = (j?: Rpc) => (j?.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

export type RunOpts = { agent: string; model?: string; mcp?: string; key?: string; port?: number; dir?: string; now?: () => number; onReady?: (i: { url: string; session: string; instruction: string; screen: string }) => void };

export async function evalRun(task: Task, o: RunOpts): Promise<RunResult> {
  const now = o.now ?? Date.now, upstream = o.mcp ?? "http://localhost:8787/mcp";
  const stamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const id = `${task.name}-${o.agent}-${stamp}`.replace(/[^A-Za-z0-9_.-]/g, "-");
  const session = `eval-${id}`;
  let n = 0;
  const call = async (tool: string, args: Record<string, unknown>) => post(upstream, o.key, JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: tool, arguments: args } }));
  const must = async (tool: string, args: Record<string, unknown>) => {
    const r = await call(tool, args);
    if (r.status >= 400 || r.json?.error || r.json?.result?.isError) throw new Error(`${tool} failed at the start of the run: ${textOf(r.json) || r.json?.error?.message || r.status}`);
    return textOf(r.json);
  };
  const first = await must("open_app", { app: task.app, session, platform: task.platform, show: false, ...(task.start?.seed_cart ? { seed_cart: task.start.seed_cart } : {}) });
  const device = { ...(task.start?.device ?? {}), ...(task.start?.network ?? {}) };
  if (Object.keys(device).length) await must("set_device", { session, ...device });

  const steps: Step[] = [];
  const t0 = now();
  let finalScreen = first, orders: Order[] = [], recording: string | undefined, ended: RunResult["ended"] | undefined;
  let done!: (e: RunResult["ended"]) => void;
  const finished = new Promise<RunResult["ended"]>((res) => { done = res; });

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/mcp")) { res.writeHead(404).end(); return; }
    let raw = ""; for await (const ch of req) raw += ch;
    if (ended) { res.writeHead(410, { "content-type": "application/json" }).end(JSON.stringify({ error: "the eval run is over" })); return; }
    let msg: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } | undefined;
    try { msg = JSON.parse(raw); } catch {}
    const up = await post(upstream, o.key, raw).catch((e: Error) => ({ status: 502, text: JSON.stringify({ error: e.message }), json: undefined as Rpc | undefined }));
    res.writeHead(up.status, { "content-type": "application/json" }).end(up.text);
    if (msg?.method !== "tools/call" || !msg.params?.name) return;
    const tool = msg.params.name, args = msg.params.arguments ?? {};
    if (args.session !== undefined && args.session !== session) return;
    const text = textOf(up.json), isErr = Boolean(up.json?.result?.isError) || up.status >= 400;
    const code = (up.json?.result?.structuredContent?.code as string | undefined) ?? /^Error \[([^\]]+)\]/.exec(text)?.[1];
    if (tool === "end_session") {
      try { orders = (JSON.parse(text) as { orders?: Order[] }).orders ?? []; } catch {}
      steps.push({ n: steps.length + 1, t: now() - t0, tool, args, ok: !isErr, code, text });
      return done("agent");
    }
    if (tool === "record_stop" && !isErr) recording = (up.json?.result?.structuredContent?.file as string | undefined) ?? /"file":\s*"([^"]+)"/.exec(text)?.[1] ?? recording;
    if (!isErr && text && !["record_start", "record_stop", "record_marker", "export_test"].includes(tool)) finalScreen = text;
    steps.push({ n: steps.length + 1, t: now() - t0, tool, args, ok: !isErr, code, text });
    if (steps.length >= task.limits.steps) done("step_limit");
  });
  await new Promise<void>((ok) => server.listen(o.port ?? 0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  const timer = setTimeout(() => done("time_limit"), task.limits.seconds * 1000);
  o.onReady?.({ url, session, instruction: task.instruction, screen: first });
  const why = await finished;
  ended = why; clearTimeout(timer);
  const seconds = Math.round((now() - t0) / 1000);
  if (why !== "agent") {
    // The limit was hit: read the screen and the orders ourselves, then close the session.
    const s = await call("screen", { session }).catch(() => undefined);
    if (s && !s.json?.result?.isError) finalScreen = textOf(s.json);
    const e = await call("end_session", { session }).catch(() => undefined);
    try { orders = (JSON.parse(textOf(e?.json)) as { orders?: Order[] }).orders ?? []; } catch {}
  }
  await new Promise<void>((ok) => server.close(() => ok()));

  const checks = score(task, { steps, finalScreen, orders });
  const acting = steps.filter((s) => s.tool !== "end_session");
  const counts = new Map<string, { code: string; tool: string; count: number }>();
  let retries = 0, prev: Step | undefined;
  for (const s of acting) {
    if (!s.ok) { const k = `${s.tool}:${s.code ?? "error"}`; const f = counts.get(k) ?? { code: s.code ?? "error", tool: s.tool, count: 0 }; f.count++; counts.set(k, f); }
    if (prev && !prev.ok && prev.tool === s.tool && JSON.stringify(prev.args) === JSON.stringify(s.args)) retries++;
    prev = s;
  }
  const dir = resolve(o.dir ?? join(".shipvo", "eval"), id);
  mkdirSync(dir, { recursive: true });
  const stepsFile = join(dir, "steps.jsonl");
  writeFileSync(stepsFile, steps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  const result: RunResult = {
    id, task: task.name, agent: o.agent, ...(o.model ? { model: o.model } : {}), platform: task.platform, ended: why,
    pass: checks.every((c) => c.pass), steps: acting.length, seconds, errors: acting.filter((s) => !s.ok).length, retries,
    findings: [...counts.values()], checks, stepsFile, ...(recording ? { recording } : {}),
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

export type Row = { agent: string; model?: string; task: string; runs: number; passed: number; passRate: number; medianSteps: number; medianSeconds: number; links: { id: string; pass: boolean; steps: string; recording?: string }[] };
export function loadRuns(dir: string): RunResult[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((d) => { const f = join(dir, d, "run.json"); return existsSync(f) ? [JSON.parse(readFileSync(f, "utf8")) as RunResult] : []; });
}
export function buildReport(runs: RunResult[]): Row[] {
  const g = new Map<string, RunResult[]>();
  for (const r of runs) { const k = `${r.agent}\u0000${r.model ?? ""}\u0000${r.task}`; g.set(k, [...(g.get(k) ?? []), r]); }
  return [...g.values()].map((rs) => {
    const p = rs.filter((r) => r.pass).length;
    return { agent: rs[0]!.agent, ...(rs[0]!.model ? { model: rs[0]!.model } : {}), task: rs[0]!.task, runs: rs.length, passed: p, passRate: Math.round((p / rs.length) * 100) / 100, medianSteps: median(rs.map((r) => r.steps)), medianSeconds: median(rs.map((r) => r.seconds)),
      links: rs.map((r) => ({ id: r.id, pass: r.pass, steps: r.stepsFile, ...(r.recording ? { recording: r.recording } : {}) })) };
  }).sort((a, b) => (a.task + a.agent + (a.model ?? "")).localeCompare(b.task + b.agent + (b.model ?? "")));
}
export function reportMarkdown(rows: Row[]): string {
  const head = "| Agent | Model | Task | Runs | Pass rate | Median steps | Median seconds | Runs (steps, recording) |\n|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => `| ${r.agent} | ${r.model ?? ""} | ${r.task} | ${r.runs} | ${r.passed}/${r.runs} (${Math.round(r.passRate * 100)}%) | ${r.medianSteps} | ${r.medianSeconds} | ${r.links.map((l) => `[${l.pass ? "pass" : "fail"}](${l.steps})${l.recording ? ` [video](${l.recording})` : ""}`).join(" ")} |`);
  return [head, ...body].join("\n") + "\n";
}

const USAGE = "Usage:\n  shipvo eval run <task> --agent <name> [--model <name>] [--mcp <url>] [--key <key>] [--port <n>] [--dir <path>] [--json]\n  shipvo eval report [--dir <path>] [--json] [--out <file>]";
export async function evalCmd(args: string[]): Promise<number> {
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const json = args.includes("--json"), dir = flag("--dir") ?? join(".shipvo", "eval");
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--") && args[i - 1] !== "--json"));
  const [sub, taskArg] = positional;
  if (sub === "report") {
    const rows = buildReport(loadRuns(dir)), md = reportMarkdown(rows);
    const out = flag("--out");
    if (out) { writeFileSync(out, md); writeFileSync(out.replace(/\.md$/, "") + ".json", JSON.stringify(rows, null, 2) + "\n"); }
    if (json) emit(envelope("eval_report", `${rows.length} rows`, { rows, markdown: md }, [], 0)); else console.log(md);
    return 0;
  }
  const agent = flag("--agent");
  if (sub !== "run" || !taskArg || !agent) { console.error(USAGE); return 2; }
  const task = loadTask(taskArg);
  const r = await evalRun(task, {
    agent, model: flag("--model"), mcp: flag("--mcp") ?? process.env.SHIPVO_EVAL_MCP, key: flag("--key") ?? process.env.SHIPVO_EVAL_KEY, port: flag("--port") ? Number(flag("--port")) : 0, dir,
    onReady: (i) => console.error(`Eval run ready.\nMCP URL for the agent: ${i.url}\nSession: ${i.session}\n\nGive the agent this instruction:\n${i.instruction}\nUse session "${i.session}" in every tool call. The run ends when the agent calls end_session, after ${task.limits.steps} steps or after ${task.limits.seconds} seconds.\n`),
  });
  if (json) emit(envelope("eval_run", `${r.task}: ${r.pass ? "passed" : "failed"}`, r, [{ command: "shipvo eval report", why: "Compare runs." }], r.pass ? 0 : 1));
  else console.log(`${r.pass ? "PASS" : "FAIL"} ${r.task} (${r.agent}) ended by ${r.ended}: ${r.steps} steps, ${r.seconds}s, ${r.errors} errors, ${r.retries} retries\n${r.checks.map((c) => `  ${c.pass ? "ok  " : "FAIL"} ${c.id}: ${c.detail}`).join("\n")}\nSteps: ${r.stepsFile}`);
  return r.pass ? 0 : 1;
}
