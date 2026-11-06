import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { routeStore } from "@shipvo/store";
import { args, loadConfig } from "./config.js";
import { detectProject, skillStatus } from "./agents.js";
import { portFree } from "./sim.js";
import { emit, type Next } from "./json-out.js";

export type { Next };

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

const BANDS = ["b0", "b1", "b2"];

/** Release number each band serves, from the public pointer. null when a band has none or cannot be read. */
export async function fetchBands(base: string, appId: string, major: number, fetchFn: typeof fetch): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(BANDS.map(async (b) => {
    out[b] = null;
    try {
      const r = await fetchFn(`${base}/p/${encodeURIComponent(appId)}/${major}/${b}`);
      if (!r.ok) return;
      const env = (await r.json()) as { body?: string };
      const rel = JSON.parse(String(env.body)).release;
      if (typeof rel === "number") out[b] = rel;
    } catch { /* unreadable: show "-" */ }
  }));
  return out;
}

/** "bands: b0=4 b1=4 b2=4", plus a hint to promote when bands differ. */
export function describeBands(bands: Record<string, number | null>): string[] {
  const line = `bands: ${BANDS.map((b) => `${b}=${bands[b] ?? "-"}`).join(" ")}`;
  const vals = BANDS.map((b) => bands[b] ?? null);
  if (vals.every((v) => v === null) || vals.every((v) => v === vals[0])) return [line];
  return [line, "Bands differ. Run shipvo promote to give every band the newest release."];
}

/** "auto-halt: off" or "auto-halt: on at 20% after 20 reports". */
export function describeAutoHalt(c: AutoHalt | undefined): string {
  if (!c || typeof c.threshold !== "number") return "auto-halt: off";
  const n = c.min_reports ?? 20;
  return `auto-halt: on at ${Math.round(c.threshold * 1000) / 10}% after ${n} report${n === 1 ? "" : "s"}`;
}

export type StatusJson = {
  ok: boolean;
  code: "ok" | "no_project" | "no_signing_key" | "release_halted" | "no_release" | "error";
  summary: string;
  data: {
    project: { kind: string; app_id: string | null };
    sim: { running: boolean; port: number };
    run_server: { running: boolean; port: number | null };
    signing_key: { present: boolean };
    pending_release: { newest: number | null; halted: Halted | null; auto_halt: AutoHalt | null } | null;
    store_step: { id: string; title: string; state: string } | null;
    skills: { package: string; name: string; synced: boolean }[];
  };
  next: Next[];
};

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Local facts for `status --json`: no network. */
async function localFacts(dir: string, simPort = 4545) {
  const hasKey = !!(process.env.SHIPVO_SIGNING_SEED || process.env.PURENATIVE_SIGNING_SEED || (process.env.SHIPVO_SIGNING_SEED_FILE && existsSync(process.env.SHIPVO_SIGNING_SEED_FILE)) || (process.env.PURENATIVE_SIGNING_SEED_FILE && existsSync(process.env.PURENATIVE_SIGNING_SEED_FILE)) || existsSync(join(dir, ".shipvo", "seed.txt")));
  let run = { running: false, port: null as number | null };
  try {
    const r = JSON.parse(readFileSync(join(dir, ".shipvo", "run.json"), "utf8"));
    if (typeof r.pid === "number" && alive(r.pid)) run = { running: true, port: typeof r.port === "number" ? r.port : null };
  } catch { /* not running */ }
  let storeStep: StatusJson["data"]["store_step"] = null;
  try {
    const plan = JSON.parse(readFileSync(join(dir, "store-plan.json"), "utf8"));
    const r = routeStore(plan.answers);
    const step = [...r.play.steps, ...r.apple.steps].find((x) => (plan.marks?.[x.id] ?? "todo") !== "done");
    if (step) storeStep = { id: step.id, title: step.title, state: plan.marks?.[step.id] ?? "todo" };
  } catch { /* no plan */ }
  return { hasKey, run, storeStep, sim: { running: !(await portFree(simPort)), port: simPort } };
}

/** `shipvo status --json`: exit 0 ok, 1 action needed, 2 error. */
export async function statusJson(appArg: string | undefined, fetchFn: typeof fetch, dir = process.cwd()): Promise<{ doc: StatusJson; exit: number }> {
  const kind = detectProject(dir);
  const f = await localFacts(dir);
  const shared = { sim: f.sim, run_server: f.run, signing_key: { present: f.hasKey }, store_step: f.storeStep, skills: skillStatus(dir) };
  const mk = (code: StatusJson["code"], summary: string, next: Next[], appId: string | null, pending: StatusJson["data"]["pending_release"], exit: number) => ({
    doc: { ok: exit === 0, code, summary, data: { project: { kind, app_id: appId }, ...shared, pending_release: pending }, next } as StatusJson, exit,
  });
  if (!existsSync(join(dir, "shipvo.json"))) {
    return mk("no_project", "No shipvo.json here.", [{ command: kind === "unknown" ? "shipvo init myapp" : "shipvo init .", why: "This folder is not set up for Shipvo yet." }], null, null, 1);
  }
  let cfg;
  try { cfg = loadConfig(dir); } catch (e) { return mk("error", e instanceof Error ? e.message : String(e), [{ command: "shipvo doctor", why: "shipvo.json is missing a field." }], null, null, 2); }
  const appId = appArg ?? cfg.appId;
  let data: { releases?: Row[]; halted?: Halted | null; auto_halt?: AutoHalt };
  const baseUrl = cfg.controlPlane.replace(/\/$/, "");
  try {
    const r = await fetchFn(`${baseUrl}/t/${encodeURIComponent(appId)}/summary`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = (await r.json()) as typeof data;
  } catch (e) {
    return mk("error", `Could not reach the control plane at ${baseUrl} (${e instanceof Error ? e.message : String(e)}).`, [{ command: "shipvo doctor", why: "Check the control plane URL and network." }], appId, null, 2);
  }
  const releases = data.releases ?? [];
  const pending = { newest: releases.length ? Math.max(...releases.map((r) => r.release)) : null, halted: data.halted ?? null, auto_halt: data.auto_halt ?? null };
  const next: Next[] = [];
  let code: StatusJson["code"] = "ok", exit = 0;
  let summary = pending.newest === null ? `No releases with telemetry yet for "${appId}".` : `Newest release ${pending.newest} is reporting for "${appId}".`;
  if (!f.hasKey) { code = "no_signing_key"; exit = 1; summary = "No signing key found."; next.push({ command: "shipvo keygen --out .shipvo/seed.txt", why: "You cannot publish without a signing key." }); }
  if (pending.halted) {
    code = "release_halted"; exit = 1; summary = `Release ${pending.halted.release} is halted: ${pending.halted.failed} of ${pending.halted.reports} devices failed.`;
    const prev = releases.map((r) => r.release).filter((n) => n < pending.halted!.release);
    const to = prev.length ? String(Math.max(...prev)) : "<release>";
    next.unshift({ command: `shipvo rollback --to ${to}`, why: "Send devices back to a release that works, or publish a fixed one." });
  } else if (code === "ok" && pending.newest === null) {
    code = "no_release"; next.push({ command: "shipvo publish --dry-run", why: "Check a first release before you publish it." });
  }
  if (!f.sim.running && !f.run.running) next.push({ command: "shipvo sim", why: "Start the simulator to try the app." });
  if (f.storeStep) next.push({ command: f.storeStep.state === "waiting" ? "shipvo store status" : `shipvo store status --mark ${f.storeStep.id}`, why: `Store step "${f.storeStep.title}" is ${f.storeStep.state === "todo" ? "next" : f.storeStep.state}.` });
  return mk(code, summary, next, appId, pending, exit);
}

export async function status(argv: string[], fetchFn: typeof fetch = fetch): Promise<number> {
  const a = args(argv);
  if (argv.includes("--json")) {
    const { doc, exit } = await statusJson(a.app && a.app !== "true" ? a.app : undefined, fetchFn);
    emit(doc);
    return exit;
  }
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
  for (const l of describeBands(await fetchBands(base, appId, cfg.shellMajor, fetchFn))) console.log(l);
  return 0;
}
