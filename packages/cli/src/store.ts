import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { checkScreenshot, checkSet, SCREENSHOT_SETS, deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy, routeStore } from "@shipvo/store";
import type { RouteAnswers, ScreenshotSetId, StoreRoute } from "@shipvo/store";
import { args, loadConfig } from "./config.js";
import { startSim } from "./explore.js";

/** `shipvo store details --dry-run [--out dir]`: print the answers, write two files. Nothing is uploaded; no credentials are read. */
export async function store(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "setup") return setup(rest);
  if (sub === "status") return status(rest);
  if (sub === "screenshots") return screenshots(rest);
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir] | store setup | store status | store screenshots"); process.exit(2); }
  const a = args(rest);
  if (a["dry-run"] === undefined || a["dry-run"] === "false") { console.error("shipvo store details: upload is not available yet; use --dry-run"); process.exit(2); }
  const cfg = loadConfig();
  const d = deriveStoreDetails(cfg);
  const out = a.out && a.out !== "true" ? a.out : ".shipvo/store";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "data-safety.csv"), renderDataSafetyCsv(d));
  writeFileSync(join(out, "privacy-policy.md"), renderPrivacyPolicy(d));
  console.log(`Data safety answers for ${d.appName} (derived from shipvo.json):`);
  if (d.rows.length === 0) console.log("  No declared capability touches user data.");
  for (const r of d.rows) console.log(`  ${r.dataType}: collected ${r.collected}, shared ${r.shared}, purpose ${r.purpose}`);
  if (d.fill.total > 0) console.log(`Filled without you: ${d.fill.filled} of ${d.fill.total} fields.`);
  console.log(`\nYou still need to answer (${d.unknown.length}):`);
  for (const u of d.unknown) console.log(`  - ${u.question}`);
  console.log(`\nWrote ${join(out, "data-safety.csv")} and ${join(out, "privacy-policy.md")}. Nothing was uploaded.`);
}

const PLAN_FILE = "store-plan.json";
type Mark = "waiting" | "done";
interface Plan { version: 1; answers: RouteAnswers; marks: Record<string, Mark> }

function fail(msg: string): never { console.error(msg); process.exit(2); }

function yesNo(flag: string, v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (["yes", "true"].includes(v)) return true;
  if (["no", "false"].includes(v)) return false;
  return fail(`shipvo store setup: --${flag} must be yes or no, not "${v}".`);
}

async function ask(rl: ReturnType<typeof createInterface>, q: string, def: boolean): Promise<boolean> {
  const r = (await rl.question(`${q} [${def ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
  return r === "" ? def : r.startsWith("y");
}

function describe(title: string, r: StoreRoute, marks: Record<string, Mark>, withStatus: boolean): void {
  console.log(`${title}: ${r.account} account. ${r.accountNote}`);
  let next: typeof r.steps[number] | undefined;
  for (const s of r.steps) {
    const m = marks[s.id] ?? "todo";
    if (!next && m !== "done") next = s;
    console.log(`  ${withStatus ? `[${m}] ` : "- "}${s.id}: ${s.title}${s.wait ? ` (wait: ${s.wait})` : ""}`);
  }
  if (!withStatus) return;
  if (!next) console.log("  Done: this store is live.");
  else if ((marks[next.id] ?? "todo") === "waiting") console.log(`  Next: wait. ${next.wait ?? next.title}. Then run \`shipvo store status --mark ${next.id}\`.`);
  else console.log(`  Next: ${next.action} Then run \`shipvo store status --mark ${next.id}\`.`);
}

function printPlan(plan: Plan, withStatus: boolean): void {
  const r = routeStore(plan.answers);
  describe("Google Play", r.play, plan.marks, withStatus);
  console.log("");
  describe("App Store", r.apple, plan.marks, withStatus);
  if (!withStatus) for (const n of r.notes) console.log(`\n${n}`);
}

/** `shipvo store setup [--company yes|no] [--android-now] [--play-account-before-2023-11-13]`: write store-plan.json. No store calls. */
async function setup(argv: string[]): Promise<void> {
  const a = args(argv);
  let company = yesNo("company", a.company);
  let androidNow = yesNo("android-now", a["android-now"]);
  let before = yesNo("play-account-before-2023-11-13", a["play-account-before-2023-11-13"]);
  if (company === undefined && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    company = await ask(rl, "Do you have a registered company?", false);
    if (!company) {
      androidNow ??= await ask(rl, "Do you need Android live right now?", false);
      before ??= await ask(rl, "Did you make a Google Play developer account before 13 Nov 2023?", false);
    }
    rl.close();
  }
  const answers: RouteAnswers = { company: company ?? false, androidNow: androidNow ?? false, playAccountBefore20231113: before ?? false };
  const plan: Plan = { version: 1, answers, marks: {} };
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
  console.log("Your store plan:\n");
  printPlan(plan, false);
  console.log(`\nWrote ${PLAN_FILE}. Run \`shipvo store status\` to see what to do next. Nothing was uploaded.`);
}

/** `shipvo store status [--mark <step> [--as waiting|done]]`: one timeline per store. */
async function status(argv: string[]): Promise<void> {
  if (!existsSync(PLAN_FILE)) fail(`No ${PLAN_FILE} here. Run \`shipvo store setup\` first.`);
  const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan;
  const a = args(argv);
  if (a.mark !== undefined) {
    const r = routeStore(plan.answers);
    const ids = [...r.play.steps, ...r.apple.steps].map((s) => s.id);
    if (!ids.includes(a.mark)) fail(`Unknown step "${a.mark}". Steps: ${ids.join(", ")}.`);
    const as = a.as ?? "done";
    if (as !== "waiting" && as !== "done") fail(`--as must be waiting or done, not "${as}".`);
    plan.marks[a.mark] = as;
    writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n");
    console.log(`Marked ${a.mark} as ${as}.\n`);
  }
  printPlan(plan, true);
}

/** Sets filled from app routes, with the one size we render each at and the pixel ratio. Feature graphic and icon are not app screens. */
export const RENDER_SETS: { set: ScreenshotSetId; width: number; height: number; scale: number }[] = [
  { set: "iphone", width: 1290, height: 2796, scale: 3 },
  { set: "ipad-13", width: 2064, height: 2752, scale: 2 },
  { set: "play-phone", width: 1080, height: 1920, scale: 3 },
  { set: "play-tablet-7", width: 1200, height: 1920, scale: 2 },
  { set: "play-tablet-10", width: 1200, height: 1920, scale: 2 },
];

/** Renders one screen at a size and returns JPEG bytes. `route` is undefined for the start screen. */
export type Renderer = (size: { width: number; height: number; scale: number }, route: string | undefined) => Promise<Uint8Array>;

/** Fast mode: render each route at each set's size, write files, print the checker result per file. Returns the exit code. */
export async function renderScreenshots(routes: string[] | undefined, render: Renderer, outDir: string): Promise<number> {
  console.log("fast mode: simulator render, not the native UI");
  const screens: (string | undefined)[] = [undefined, ...(routes ?? [])];
  let failed = 0;
  for (const { set, width, height, scale } of RENDER_SETS) {
    const spec = SCREENSHOT_SETS[set];
    const dir = join(outDir, set);
    mkdirSync(dir, { recursive: true });
    const used = screens.slice(0, spec.max);
    if (used.length < screens.length) console.log(`${spec.label}: the store takes ${spec.max} at most; rendering the first ${spec.max} of ${screens.length} screens.`);
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const [i, route] of used.entries()) {
      const slug = route === undefined ? "start" : route.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "route";
      const base = `${String(i + 1).padStart(2, "0")}-${slug}`;
      const bytes = await render({ width, height, scale }, route);
      const r = checkScreenshot({ name: base, bytes }, set);
      const file = join(dir, `${base}.${r.format === "png" ? "png" : r.format === "jpeg" ? "jpg" : "bin"}`);
      writeFileSync(file, bytes);
      files.push({ name: file, bytes });
      if (r.ok) console.log(`${file}: ok`);
      else { failed++; console.log(`${file}: FAILED`); for (const p of r.problems) console.log(`  - ${p}`); }
    }
    const c = checkSet(files, set);
    for (const p of c.problems.filter((p) => /file\(s\)/.test(p))) { failed++; console.log(`${spec.label}: ${p}`); }
    for (const n of c.notes ?? []) console.log(`${spec.label}: note: ${n}`);
  }
  console.log(`\nFiles are in ${outDir}. Check the sizes against the store pages before you submit.`);
  return failed ? 1 : 0;
}

/** `shipvo store screenshots [--out dir] [--sim url] [--port n] [--skip-build]`: fast mode only. */
async function screenshots(argv: string[]): Promise<void> {
  const a = args(argv);
  if (a.mode !== undefined && a.mode !== "fast") fail(`shipvo store screenshots: only fast mode exists so far; --mode ${a.mode} is not available.`);
  const cfg = loadConfig();
  const out = a.out && a.out !== "true" ? a.out : "store-assets/raw";
  const sim = await startSim(a, cfg);
  let code = 1;
  try {
    const post = async (path: string, body: Record<string, unknown>) => {
      const r = await fetch(sim.base.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
      return (await r.json()) as { ok?: boolean; error?: string; data?: string };
    };
    const session = `shots-${Date.now().toString(36)}`;
    code = await renderScreenshots(cfg.routes, async (size, route) => {
      const open = await post("/session", { session, app: cfg.appId, ...size });
      if (open.ok === false) throw new Error(`could not open the app: ${open.error ?? "unknown error"}`);
      if (route !== undefined) {
        const r = await post("/act", { session, action: "open_url", url: route });
        if (!r.ok) throw new Error(`could not open ${route}: ${r.error ?? "unknown error"}`);
      }
      const shot = await post("/act", { session, action: "screenshot", format: "jpeg", inline: true });
      if (!shot.ok || !shot.data) throw new Error(`screenshot failed: ${shot.error ?? "no data"}`);
      return new Uint8Array(Buffer.from(shot.data, "base64"));
    }, out);
  } finally { sim.stop(); }
  process.exitCode = code;
}
