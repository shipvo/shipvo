import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { routeStore } from "@shipvo/store";
import { args, loadConfig } from "./config.js";
import { detectProject } from "./agents.js";
import type { ProjectKind } from "./agents.js";

type Row = { release: number; events: Record<string, number>; apply_ms_median: number | null; cold_start_ms_median: number | null };

type AutoHalt = { threshold: number; min_reports: number } | null;
type Halted = { release: number; reports: number; failed: number; threshold: number };

const ms = (v: number | null | undefined) => (typeof v === "number" ? String(Math.round(v)) : "-");

/** Plain-text table: one row per release, one column per event name, then the two medians. */
export function formatStatus(releases: Row[]): string {
  const names = [...new Set(releases.flatMap((r) => Object.keys(r.events ?? {})))].sort();
  const rows = [["release", ...names, "apply ms", "cold start ms"],
    ...releases.map((r) => [String(r.release), ...names.map((n) => String(r.events?.[n] ?? 0)), ms(r.apply_ms_median), ms(r.cold_start_ms_median)])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ")).join("\n");
}

/** "auto-halt: off" or "auto-halt: on at 20% after 20 reports". */
export function describeAutoHalt(c: AutoHalt | undefined): string {
  if (!c || typeof c.threshold !== "number") return "auto-halt: off";
  const n = c.min_reports ?? 20;
  return `auto-halt: on at ${Math.round(c.threshold * 1000) / 10}% after ${n} report${n === 1 ? "" : "s"}`;
}

export type NextStep = { command: string; why: string };
export type StatusJson = {
  ok: boolean;
  code: "ok" | "action_needed";
  summary: string;
  data: {
    project: { kind: ProjectKind; app_id: string | null };
    sim: { running: boolean; url: string };
    run_server: { running: boolean; port: number | null };
    signing_key: { present: boolean; source: "env" | "file" | "none" };
    pending_release: { latest: number | null; halted: number | null; dry_run_ready: boolean };
    store_step: { id: string; title: string } | null;
  };
  next: NextStep[];
};

export type StatusDeps = { probe: (url: string) => Promise<boolean>; alive: (pid: number) => boolean; dir: string };
const defaultDeps = (): StatusDeps => ({
  dir: process.cwd(),
  probe: async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(500) })).status < 500; } catch { return false; } },
  alive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
});

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

type Local = Omit<StatusJson["data"], "pending_release"> & { dry_run_ready: boolean };

/** Everything `status --json` says about the folder, except the control plane. */
export async function localState(simPort: string, deps: StatusDeps): Promise<Local> {
  const { dir } = deps;
  const kind = detectProject(dir);
  const cfg = readJson(join(dir, "shipvo.json"));
  const url = `http://127.0.0.1:${simPort}`;
  const run = readJson(join(dir, ".shipvo", "run.json"));
  const runUp = Boolean(run && typeof run.pid === "number" && deps.alive(run.pid));
  const e = process.env;
  const envSeed = e.SHIPVO_SIGNING_SEED || e.PURENATIVE_SIGNING_SEED || e.SHIPVO_SIGNING_SEED_FILE || e.PURENATIVE_SIGNING_SEED_FILE;
  const fileSeed = existsSync(join(dir, ".shipvo", "seed.txt"));
  const plan = readJson(join(dir, "store-plan.json"));
  return {
    project: { kind, app_id: typeof cfg?.appId === "string" ? cfg.appId : null },
    sim: { running: await deps.probe(url), url },
    run_server: { running: runUp, port: runUp && typeof run.port === "number" ? run.port : null },
    signing_key: { present: Boolean(envSeed) || fileSeed, source: envSeed ? "env" : fileSeed ? "file" : "none" },
    store_step: plan ? nextStoreStep(plan) : null,
    dry_run_ready: existsSync(join(dir, ".shipvo", "dry-run")),
  };
}

function nextStoreStep(plan: any): { id: string; title: string } | null {
  try {
    const r = routeStore(plan.answers);
    for (const s of [...r.play.steps, ...r.apple.steps]) if ((plan.marks?.[s.id] ?? "todo") !== "done") return { id: s.id, title: s.title };
  } catch { /* unreadable plan */ }
  return null;
}

/** Build the agent-facing document. `summary` is the control plane's /summary, or null when it could not be read. */
export function buildStatus(local: Local, summary: { releases?: Row[]; halted?: Halted | null } | null, cpError: string | null): StatusJson {
  const { dry_run_ready, ...rest } = local;
  const latest = summary?.releases?.length ? Math.max(...summary.releases.map((r) => r.release)) : null;
  const halted = summary?.halted && typeof summary.halted === "object" ? summary.halted.release : null;
  const data = { ...rest, pending_release: { latest, halted, dry_run_ready } };
  const next: NextStep[] = [];
  const kind = data.project.kind;
  if (kind !== "shipvo") {
    next.push(kind === "unknown"
      ? { command: "npx -y @shipvo/cli init <dir>", why: "this folder is not a React Native or Capacitor app; start a new Shipvo app" }
      : { command: "npx -y @shipvo/cli init", why: `this ${kind} app has no shipvo.json yet; adopt it` });
  } else {
    if (!data.signing_key.present) next.push({ command: "npx -y @shipvo/cli keys import --file <seed file>", why: "no signing key found; restore it, or releases cannot be signed" });
    if (cpError) next.push({ command: "npx -y @shipvo/cli doctor", why: `could not read releases: ${cpError}` });
    if (halted !== null) next.push({ command: `npx -y @shipvo/cli rollback --to ${Math.max(1, halted - 1)}`, why: `release ${halted} was halted because devices failed; roll back or publish a fix` });
    else if (dry_run_ready && !cpError) next.push({ command: "npx -y @shipvo/cli publish", why: "a dry run is ready; publish it when you are happy" });
    else if (latest === null && !cpError && data.signing_key.present) next.push({ command: "npx -y @shipvo/cli publish --dry-run", why: "nothing has been published yet; check a release offline first" });
    if (!data.run_server.running && !data.sim.running) next.push({ command: "npx -y @shipvo/cli sim", why: "the simulator is not running; start it so you can drive the app over MCP" });
  }
  if (data.store_step) next.push({ command: "npx -y @shipvo/cli store status", why: `next store step: ${data.store_step.title}` });
  const ok = next.length === 0;
  return {
    ok, code: ok ? "ok" : "action_needed",
    summary: ok ? "Nothing to do." : `${next.length} thing${next.length === 1 ? "" : "s"} to do: ${next[0].why}`,
    data, next,
  };
}

/** With --json: 0 ok, 1 action needed, 2 error. Without it: 0, or 1 when the control plane is unreachable. */
export async function status(argv: string[], fetchFn: typeof fetch = fetch, deps: StatusDeps = defaultDeps()): Promise<number> {
  const a = args(argv);
  if (argv.includes("--json")) return statusJson(a, fetchFn, deps);
  const cfg = loadConfig();
  const appId = a.app && a.app !== "true" ? a.app : cfg.appId;
  const base = cfg.controlPlane.replace(/\/$/, "");
  const url = `${base}/t/${encodeURIComponent(appId)}/summary`;
  let data: { releases?: Row[]; halted?: Halted | null; auto_halt?: AutoHalt };
  try {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = (await r.json()) as { releases?: Row[]; halted?: Halted | null; auto_halt?: AutoHalt };
  } catch (e) {
    console.error(`Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`);
    return 1;
  }
  const releases = data.releases ?? [];
  // An older control plane has no auto_halt field: say nothing rather than a wrong "off".
  if ("auto_halt" in data) console.log(describeAutoHalt(data.auto_halt));
  if (!releases.length) { console.log(`No telemetry yet for "${appId}".`); return 0; }
  const h = data.halted;
  if (h && typeof h === "object") {
    const pct = Math.round(h.threshold * 1000) / 10;
    console.log(`Release ${h.release} is halted: ${h.failed} of ${h.reports} devices failed (limit ${pct}%). Publish a new release or run shipvo rollback to clear.`);
  }
  console.log(formatStatus(releases));
  return 0;
}

async function statusJson(a: Record<string, string | undefined>, fetchFn: typeof fetch, deps: StatusDeps): Promise<number> {
  try {
    const local = await localState(a.port && a.port !== "true" ? a.port : "4545", deps);
    let summary: Parameters<typeof buildStatus>[1] = null, cpError: string | null = null;
    if (local.project.kind === "shipvo") {
      const cfg = loadConfig(deps.dir);
      const appId = a.app && a.app !== "true" ? a.app : cfg.appId;
      try {
        const r = await fetchFn(`${cfg.controlPlane.replace(/\/$/, "")}/t/${encodeURIComponent(appId)}/summary`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        summary = (await r.json()) as typeof summary;
      } catch (e) { cpError = e instanceof Error ? e.message : String(e); }
    }
    const doc = buildStatus(local, summary, cpError);
    console.log(JSON.stringify(doc, null, 2));
    return doc.ok ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: "error", summary: e instanceof Error ? e.message : String(e), data: null, next: [] }, null, 2));
    return 2;
  }
}
