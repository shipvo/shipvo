import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { routeStore } from "@shipvo/store";
import { args, loadConfig } from "./config.js";
import { detectProject, type ProjectKind } from "./agents.js";

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

type Step = { command: string; why: string; blocking: boolean };
type Summary = { releases?: Row[]; halted?: Halted | null; auto_halt?: AutoHalt };

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const alive = (pid: unknown) => { if (typeof pid !== "number") return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** First store step that is not done, from store-plan.json. Null when there is no plan or every step is done. */
function storeStep(dir: string): { id: string; store: string; state: string } | null {
  const plan = readJson(join(dir, "store-plan.json"));
  if (!plan?.answers) return null;
  try {
    const r = routeStore(plan.answers);
    for (const [store, route] of [["play", r.play], ["apple", r.apple]] as const) {
      for (const st of route.steps) { const m = plan.marks?.[st.id] ?? "todo"; if (m !== "done") return { id: st.id, store, state: m }; }
    }
  } catch { /* a broken plan is reported by `shipvo store status` */ }
  return null;
}

/** Everything `shipvo status --json` reports, built from local files plus an optional control-plane summary. */
export function buildAgentStatus(dir: string, summary: Summary | null, fetchError: string | null) {
  const project: ProjectKind = detectProject(dir);
  const hasConfig = project === "shipvo";
  const runInfo = readJson(join(dir, ".shipvo", "run.json"));
  const run_server = runInfo && alive(runInfo.pid) ? { running: true, port: runInfo.port ?? null, platform: runInfo.platform ?? null } : { running: false, port: null, platform: null };
  const e = process.env;
  const signing_key = { present: !!(e.SHIPVO_SIGNING_SEED || e.PURENATIVE_SIGNING_SEED || e.SHIPVO_SIGNING_SEED_FILE || e.PURENATIVE_SIGNING_SEED_FILE || existsSync(join(dir, ".shipvo", "seed.txt"))) };
  const sim = { supported: project === "shipvo" || project === "expo" || project === "react-native" };
  const releases = summary?.releases ?? [];
  const h = summary?.halted && typeof summary.halted === "object" ? summary.halted : null;
  const pending_release = summary
    ? { latest: releases.length ? Math.max(...releases.map((r) => r.release)) : null, halted: h ? { release: h.release, failed: h.failed, reports: h.reports } : null }
    : null;
  const store_step = storeStep(dir);

  const next: Step[] = [];
  let code = "ok", summaryText = "Nothing needs doing.";
  if (!hasConfig) {
    code = "no_shipvo_project";
    summaryText = `This folder is ${project === "unknown" ? "not an app Shipvo knows" : `a ${project} app without shipvo.json`}.`;
    if (project === "capacitor") next.push({ command: "shipvo eas setup --dry-run", why: "Prepare this Capacitor repo for store builds; Shipvo OTA and the simulator need a React Native app.", blocking: true });
    else if (project === "unknown") next.push({ command: "shipvo init <dir>", why: "Create a new app wired to Shipvo, or run this inside a React Native app.", blocking: true });
    else next.push({ command: "shipvo init", why: "Make this app Shipvo-ready: writes shipvo.json and a signing key.", blocking: true });
  } else {
    if (!signing_key.present) next.push({ command: "shipvo keys import --file <seed file>", why: "No signing seed here (SHIPVO_SIGNING_SEED or .shipvo/seed.txt). Restore the one that matches shipvo.json.", blocking: true });
    if (fetchError) { code = "control_plane_unreachable"; summaryText = fetchError; next.push({ command: "shipvo doctor", why: "Check the control plane address and your setup.", blocking: true }); }
    else if (h) next.push({ command: `shipvo rollback --to ${Math.max(0, h.release - 1)}`, why: `Release ${h.release} is halted: ${h.failed} of ${h.reports} devices failed. Publish a fix or roll back.`, blocking: true });
    else if (pending_release && pending_release.latest === null) next.push({ command: "shipvo publish --dry-run", why: "No release yet. Check one offline, then run shipvo publish.", blocking: false });
    if (store_step) {
      if (store_step.state === "waiting") next.push({ command: "shipvo store status", why: `Waiting on store step "${store_step.id}" (${store_step.store}). Mark it done when it clears.`, blocking: false });
      else next.push({ command: "shipvo store status", why: `Store step "${store_step.id}" (${store_step.store}) is next.`, blocking: true });
    }
    if (!run_server.running && sim.supported) next.push({ command: "shipvo run android", why: "Open the app in the phone frame so you can see and test it.", blocking: false });
  }
  const blocking = next.some((n) => n.blocking);
  if (code === "ok" && blocking) { code = "action_needed"; summaryText = next.find((n) => n.blocking)!.why; }
  const exit = code === "control_plane_unreachable" ? 2 : blocking ? 1 : 0;
  return {
    exit,
    body: { ok: exit === 0, code, summary: summaryText, data: { project, sim, run_server, signing_key, pending_release, store_step }, next: next.map(({ command, why }) => ({ command, why })) },
  };
}

export async function status(argv: string[], fetchFn: typeof fetch = fetch): Promise<number> {
  const a = args(argv);
  if (argv.includes("--json")) return statusJson(a, fetchFn);
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

/** `shipvo status --json`: what to do next in this project. Exit 0 ok, 1 action needed, 2 error. Never throws. */
async function statusJson(a: Record<string, string | undefined>, fetchFn: typeof fetch): Promise<number> {
  const dir = process.cwd();
  let summary: Summary | null = null, err: string | null = null;
  if (existsSync(join(dir, "shipvo.json"))) {
    try {
      const cfg = loadConfig(dir);
      const appId = a.app && a.app !== "true" ? a.app : cfg.appId;
      const r = await fetchFn(`${cfg.controlPlane.replace(/\/$/, "")}/t/${encodeURIComponent(appId)}/summary`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      summary = (await r.json()) as Summary;
    } catch (e) { err = `Could not read shipvo.json or reach the control plane (${e instanceof Error ? e.message : String(e)}).`; }
  }
  const { exit, body } = buildAgentStatus(dir, summary, err);
  console.log(JSON.stringify(body, null, 2));
  return exit;
}
