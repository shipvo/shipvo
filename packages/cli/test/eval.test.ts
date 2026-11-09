import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, evalRun, loadRuns, loadTask, reportMarkdown, type Task } from "../src/eval";

// A fake MCP server for a shop: enough state to place an order, and a first payment that declines when asked.
type S = { cart: string[]; screen: string; decline: boolean; orders: unknown[] };
const sessions = new Map<string, S>();
let up: http.Server, upUrl: string;
const reply = (id: unknown, text: string, isError = false, structured?: unknown) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}), ...(structured ? { structuredContent: structured } : {}) } });
beforeAll(async () => {
  up = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const m = JSON.parse(raw), { name, arguments: a } = m.params;
    const s = sessions.get(a.session) ?? { cart: [], screen: "", decline: false, orders: [] };
    let out;
    if (name === "open_app") { s.cart = (a.seed_cart ?? []).map((l: { id: string }) => l.id); s.screen = "heading Shop\nbutton Canvas tote"; sessions.set(a.session, s); out = reply(m.id, `session: ${a.session}\n\n${s.screen}`); }
    else if (name === "set_device") { s.decline = a.payment?.nextResult === "decline"; out = reply(m.id, s.screen); }
    else if (name === "tap") {
      if (a.ref === "tote") { s.cart.push("canvas-tote"); s.screen = "heading Cart\nbutton Pay"; }
      else if (a.ref === "pay" && s.decline) { s.decline = false; s.screen = "text Your payment was declined. Try another method.\nbutton Pay"; }
      else if (a.ref === "pay") { s.orders.push({ id: "o1", items: [{ id: "canvas-tote", name: "Canvas tote", quantity: 1 }] }); s.screen = "heading Order placed"; }
      else { sessions.set(a.session, s); res.end(JSON.stringify(reply(m.id, "Error [no_such_ref]: nothing there", true, { code: "no_such_ref" }))); return; }
      out = reply(m.id, s.screen);
    }
    else if (name === "set_device_pay") out = reply(m.id, "");
    else if (name === "end_session") out = reply(m.id, JSON.stringify({ session: a.session, steps: 3, orders: s.orders }));
    else out = reply(m.id, s.screen);
    sessions.set(a.session, s);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out));
  });
  await new Promise<void>((ok) => up.listen(0, "127.0.0.1", ok));
  upUrl = `http://127.0.0.1:${(up.address() as { port: number }).port}/mcp`;
});
afterAll(() => { up.close(); });

const rpc = (url: string, id: number, name: string, args: Record<string, unknown>) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json());

// The scripted client: no model. It plays a fixed list of calls through the proxy.
async function play(task: Task, agent: string, dir: string, script: [string, Record<string, unknown>][]) {
  let now = 1_000_000;
  const run = evalRun(task, { agent, model: "scripted-1", mcp: upUrl, dir, now: () => (now += 2000), onReady: async ({ url, session }) => {
    let i = 0;
    for (const [tool, args] of script) await rpc(url, ++i, tool, { session, ...args });
  } });
  return run;
}

describe("shipvo eval", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-"));
  const root = join(__dirname, "..", "..", "..");
  const tote = loadTask(join(root, "tasks", "buy-canvas-tote.task.json"));
  const declined = loadTask(join(root, "tasks", "declined-card-then-pay.task.json"));

  it("ships the two sample tasks", () => {
    expect(tote.checks.map((c) => c.type)).toContain("order_exists");
    expect(declined.start?.seed_cart).toHaveLength(1);
  });

  it("scores a run that completes the task", async () => {
    const r = await play(tote, "scripted", dir, [["tap", { ref: "tote" }], ["tap", { ref: "pay" }], ["end_session", {}]]);
    expect(r.ended).toBe("agent");
    expect(r.pass).toBe(true);
    expect(r.steps).toBe(2);
    expect(r.checks.every((c) => c.pass)).toBe(true);
  });

  it("records the trace id from a valid traceparent and ignores a bad one", async () => {
    const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const call = (url: string, id: number, name: string, args: Record<string, unknown>, meta: object) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: meta } }) });
    let now = 1_000_000;
    const r = await evalRun(tote, { agent: "scripted", mcp: upUrl, dir: mkdtempSync(join(tmpdir(), "eval-trace-")), now: () => (now += 2000), onReady: async ({ url, session }) => {
      await call(url, 1, "tap", { session, ref: "tote" }, { traceparent: tp, baggage: "k=secret" });
      await call(url, 2, "tap", { session, ref: "pay" }, { traceparent: "bad" });
      await call(url, 3, "tap", { session, ref: "pay" }, { traceparent: "00-00000000000000000000000000000000-00f067aa0ba902b7-01" });
      await call(url, 4, "tap", { session, ref: "pay" }, { traceparent: "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" });
      await call(url, 5, "tap", { session, ref: "pay" }, { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01" });
      await call(url, 6, "end_session", { session }, {});
    } });
    expect(r.traceIds).toEqual(["4bf92f3577b34da6a3ce929d0e0e4736"]);
    expect(readFileSync(r.stepsFile, "utf8")).not.toContain("secret");
  });

  it("fails a run on purpose: the payment is declined and the agent gives up", async () => {
    const r = await play(declined, "scripted", dir, [["tap", { ref: "pay" }], ["tap", { ref: "missing" }], ["tap", { ref: "missing" }], ["end_session", {}]]);
    expect(r.pass).toBe(false);
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
    expect(by).toEqual({ "declined-shown": true, order: false, confirmation: false, "no-crash": true });
    expect(r.errors).toBe(2);
    expect(r.retries).toBe(1);
    expect(r.findings).toEqual([{ code: "no_such_ref", tool: "tap", count: 2 }]);
  });

  it("ends at the step limit and still scores", async () => {
    const r = await play({ ...tote, limits: { seconds: 300, steps: 1 } }, "limited", dir, [["tap", { ref: "tote" }]]);
    expect(r.ended).toBe("step_limit");
    expect(r.pass).toBe(false);
  });

  it("reports a table and JSON across runs", () => {
    const rows = buildReport(loadRuns(dir).filter((r) => r.agent === "scripted"));
    expect(rows.map((r) => [r.task, r.runs, r.passed, r.passRate, r.medianSteps])).toEqual([
      ["buy-canvas-tote", 1, 1, 1, 2],
      ["declined-card-then-pay", 1, 0, 0, 3],
    ]);
    const md = reportMarkdown(rows);
    expect(md).toContain("| scripted | scripted-1 | buy-canvas-tote | 1 | 1/1 (100%) |");
    expect(md).toContain("| scripted | scripted-1 | declined-card-then-pay | 1 | 0/1 (0%) |");
    expect(md).toMatch(/\[pass\]\(.*steps\.jsonl\)/);
    expect(JSON.parse(JSON.stringify(rows))[0].links[0].steps).toMatch(/steps\.jsonl$/);
  });
});
