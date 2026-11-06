// Runs the Lumi engine (flows, then the walker) on apps with a fixed step budget and counts what it finds.
// `engine` is `{ walk, runFlows, FLOW_NAMES }` from @shipvo/cli, so tests can pass the TypeScript source and the CLI the build.
import { SPEC_APPS, specDriver } from "./spec-app.mjs";

/** Counts actions (tap, type, open_url, back) and stops the run once the budget is used. `open` is free: it is a fresh phone, not a step. */
export function budgeted(driver, budget) {
  const c = { used: 0 };
  const spend = () => { if (c.used >= budget) throw new Error("step budget reached"); c.used++; };
  const d = { ...driver, open: () => driver.open(), openUrl: (u) => { spend(); return driver.openUrl(u); }, tap: (r) => { spend(); return driver.tap(r); }, back: () => { spend(); return driver.back(); }, errors: () => driver.errors() };
  if (driver.type) d.type = (r, t, e) => { spend(); return driver.type(r, t, e); };
  if (driver.snapshot) d.snapshot = () => driver.snapshot();
  if (driver.sizes) d.sizes = () => driver.sizes();
  return { driver: d, counter: c };
}

/**
 * One app at one budget. Flows run first, each with valid then invalid input, until the budget is used.
 * The walker gets what is left. Returns counts only, so the same seed gives the same result.
 * `bugs` is the list of planted bugs to look for ({ id, kind, found(walkReport, flowReport) }).
 */
export async function runApp(engine, { id, makeDriver, bugs = [], budget, seed, settleMs = 0, skin = "android" }) {
  const { driver, counter } = budgeted(makeDriver(), budget);
  const flows = await engine.runFlows(driver, { app: id });
  const spentOnFlows = counter.used;
  const left = Math.max(0, budget - spentOnFlows);
  const walkBudget = budgeted(makeDriver(), left);
  const walk = left > 0
    ? await engine.walk(walkBudget.driver, { app: id, seed, maxSteps: left, maxDepth: 4, settleMs, skin })
    : { screens: 0, steps: 0, findings: [], error: null };
  const finished = flows.flows.filter((f) => f.status === "passed").length;
  const found = bugs.filter((b) => b.found(walk, flows)).map((b) => b.id);
  return {
    app: id, budget, seed,
    stepsUsed: spentOnFlows + walk.steps,
    screens: walk.screens,
    flowsFinished: finished, flowsTotal: flows.flows.length,
    bugsFound: found.length, bugsPlanted: bugs.length, bugIds: found,
    findings: walk.findings.length,
  };
}

/** Spec apps (with planted bugs on, or off) at each budget. Returns rows in a fixed order. */
export async function runSpecApps(engine, { budgets, seed, bugsOn = true, apps = SPEC_APPS }) {
  const rows = [];
  for (const app of apps) {
    for (const budget of budgets) {
      const flags = new Set(bugsOn ? Object.values(app.bugFlags) : []);
      const r = await runApp(engine, { id: app.id, makeDriver: () => specDriver(app, flags), bugs: bugsOn ? app.bugs : [], budget, seed });
      rows.push({ ...r, heldOut: app.heldOut });
    }
  }
  return rows;
}

/** Totals per budget, for tuning apps and held-out apps apart. */
export function summarize(rows) {
  const out = [];
  for (const group of [false, true]) {
    for (const budget of [...new Set(rows.map((r) => r.budget))]) {
      const rs = rows.filter((r) => r.heldOut === group && r.budget === budget);
      if (!rs.length) continue;
      const sum = (k) => rs.reduce((a, r) => a + r[k], 0);
      out.push({ set: group ? "held out" : "tuning", budget, screens: sum("screens"), flowsFinished: sum("flowsFinished"), flowsTotal: sum("flowsTotal"), bugsFound: sum("bugsFound"), bugsPlanted: sum("bugsPlanted") });
    }
  }
  return out;
}

export function table(rows) {
  const head = ["app", "set", "budget", "steps", "screens", "flows", "bugs"];
  const body = rows.map((r) => [r.app, r.heldOut ? "held out" : "tuning", r.budget, r.stepsUsed, r.screens, `${r.flowsFinished}/${r.flowsTotal}`, r.bugsPlanted ? `${r.bugsFound}/${r.bugsPlanted}` : "n/a"].map(String));
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => "| " + cells.map((c, i) => c.padEnd(w[i])).join(" | ") + " |";
  return [line(head), line(w.map((n) => "-".repeat(n))), ...body.map(line)].join("\n");
}
