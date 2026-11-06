import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { createSign } from "node:crypto";
import { checkScreenshot, checkSet, renderFrame, SCREENSHOT_SETS, deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy, routeStore, SHIPVO_TESTERS_GROUP, SHIPVO_TESTERS_JOIN_URL } from "@shipvo/store";
import type { RouteAnswers, ScreenshotSetId, StoreRoute } from "@shipvo/store";
import { args, loadConfig } from "./config.js";
import { startSim } from "./explore.js";
import { CliFailure, classifyExit, runJson, takeJson, trapExit, type Done, type Next } from "./json-out.js";

/** `shipvo store details --dry-run [--out dir]`: print the answers, write two files. Nothing is uploaded; no credentials are read. */
export async function store(argv: string[]): Promise<void> {
  const { json, rest: plain } = takeJson(argv);
  if (json) return storeJson(plain);
  return storeRun(plain);
}

const STORE_NEXT: Next[] = [{ command: "shipvo store setup --json", why: "Write your store plan." }, { command: "shipvo doctor --json", why: "Check your setup." }];
const STORE_RULES: [RegExp, string][] = [
  [/^No store-plan\.json/, "no_plan"], [/^Unknown step/, "unknown_step"], [/must be yes or no|--as must be|--play-key needs|only fast mode/, "usage"],
  [/upload is not available/, "usage"], [/^Usage:/, "usage"], [/No shipvo\.json/, "no_config"],
];

/** `--json` for every `store` subcommand: one envelope on stdout, the text output on stderr. */
async function storeJson(argv: string[]): Promise<void> {
  const sub = argv[0] ?? "";
  const read = (): Plan | null => existsSync(PLAN_FILE) ? JSON.parse(readFileSync(PLAN_FILE, "utf8")) as Plan : null;
  const stepNext = (plan: Plan): Next[] => {
    const r = routeStore(plan.answers);
    const open = [...r.play.steps, ...r.apple.steps].find((x) => (plan.marks[x.id] ?? "todo") !== "done");
    return open ? [{ command: `shipvo store status --mark ${open.id} --json`, why: `${open.title}. Mark it when it is finished.` }] : [{ command: "shipvo publish --json", why: "Both stores are set up. Publish a release." }];
  };
  await runJson(async (): Promise<Done> => {
    // `testers` builds its own envelope data, so it runs apart from the text-mode wrapper.
    if (sub === "testers") return testersDone(argv.slice(1));
    process.exitCode = undefined; // a stale value must not turn a success into screenshots_failed
    try { await trapExit(() => storeRun(argv), classifyExit(STORE_RULES, STORE_NEXT)); }
    catch (e) {
      // `loadConfig` throws instead of exiting, so classify its message here.
      if (e instanceof Error && !(e instanceof CliFailure) && /^No shipvo\.json/.test(e.message)) throw new CliFailure(e.message, "no_config", 1, STORE_NEXT);
      throw e;
    }
    const plan = read();
    if (sub === "setup") return { code: "plan_written", summary: `Wrote ${PLAN_FILE}.`, data: { file: PLAN_FILE, answers: plan?.answers ?? null }, next: plan ? stepNext(plan) : STORE_NEXT };
    if (sub === "status" && plan) {
      const r = routeStore(plan.answers), steps = [...r.play.steps, ...r.apple.steps];
      const done = steps.filter((x) => plan.marks[x.id] === "done").length;
      return { code: done === steps.length ? "live" : "in_progress", summary: `${done} of ${steps.length} store steps done.`, data: { done, total: steps.length, marks: plan.marks, steps: steps.map((x) => ({ id: x.id, title: x.title, state: plan.marks[x.id] ?? "todo" })) }, next: stepNext(plan) };
    }
    if (sub === "screenshots") {
      if (process.exitCode) throw new CliFailure("Some store screenshots failed the size or format checks.", "screenshots_failed", 1, [{ command: "shipvo store screenshots --json", why: "Run it again after fixing the app screens." }]);
      return { code: "screenshots_ready", summary: "Screenshots written and checked.", data: { out: argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "store-assets/raw" }, next: [{ command: "shipvo store status --json", why: "See the next store step." }] };
    }
    const cfg = loadConfig(), d = deriveStoreDetails(cfg);
    return { code: "details_written", summary: `Wrote data safety answers for ${d.appName}.`, data: { app: d.appName, rows: d.rows.length, unknown: d.unknown.map((u) => u.question), filled: d.fill.filled, total: d.fill.total }, next: [{ command: "shipvo store setup --json", why: "Plan the store steps." }] };
  }, STORE_NEXT);
}

async function storeRun(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "setup") return setup(rest);
  if (sub === "status") return status(rest);
  if (sub === "testers") return testers(rest);
  if (sub === "screenshots") return screenshots(rest);
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir] | store setup | store status | store screenshots | store testers"); process.exit(2); }
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
export type Renderer = (size: { width: number; height: number; scale: number }, route: string | undefined, format?: "jpeg" | "png") => Promise<Uint8Array>;

/** Output options. With `caption`, raw PNG renders are drawn into a phone or tablet frame (frames mode). */
export interface FrameOptions {
  /** Caption for a screen: `store.captions` by route or file name, else the screen title. */
  caption?: (route: string | undefined, slug: string) => string;
  /** Print one JSON envelope instead of lines. */
  json?: boolean;
}

/** The screen title used when `store.captions` has no entry: the app name for the start screen, else the route words. */
export function screenTitle(slug: string, appName: string): string {
  if (slug === "start") return appName;
  const t = slug.replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Caption lookup: the config's `store.captions` is keyed by route ("tide://cart"), by file name ("cart") or "start". */
export function captionFor(cfg: { name: string; store?: { captions?: Record<string, string> } }): NonNullable<FrameOptions["caption"]> {
  const caps = cfg.store?.captions ?? {};
  return (route, slug) => {
    const c = (route !== undefined ? caps[route] : undefined) ?? caps[slug];
    return typeof c === "string" && c.trim() ? c.trim() : screenTitle(slug, cfg.name);
  };
}

/** Fast mode: render each route at each set's size, write files, print the checker result per file. Returns the exit code. */
export async function renderScreenshots(routes: string[] | undefined, render: Renderer, outDir: string, opts?: FrameOptions): Promise<number> {
  const frames = opts?.caption ? { caption: opts.caption } : undefined;
  const json = opts?.json === true;
  const log = (m: string) => { if (!json) console.log(m); };
  const report: { set: string; file: string; ok: boolean; problems: string[] }[] = [];
  const notes: string[] = [];
  log(frames ? "frames mode: simulator render drawn into a device frame, not the native UI" : "fast mode: simulator render, not the native UI");
  const screens: (string | undefined)[] = [undefined, ...(routes ?? [])];
  let failed = 0;
  for (const { set, width, height, scale } of RENDER_SETS) {
    const spec = SCREENSHOT_SETS[set];
    const dir = join(outDir, set);
    mkdirSync(dir, { recursive: true });
    const used = screens.slice(0, spec.max);
    if (used.length < screens.length) log(`${spec.label}: the store takes ${spec.max} at most; rendering the first ${spec.max} of ${screens.length} screens.`);
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const [i, route] of used.entries()) {
      const slug = route === undefined ? "start" : route.replace(/^[a-z][a-z0-9+.-]*:\/*/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "route";
      const base = `${String(i + 1).padStart(2, "0")}-${slug}`;
      let bytes: Uint8Array;
      if (frames) {
        try { bytes = renderFrame({ png: await render({ width, height, scale }, route, "png"), set, width, height, caption: frames.caption(route, slug) }); }
        catch (e) { failed++; const msg = `${base}: ${(e as Error).message}`; report.push({ set, file: join(dir, base), ok: false, problems: [msg] }); log(`${join(dir, base)}: FAILED\n  - ${(e as Error).message}`); continue; }
      } else bytes = await render({ width, height, scale }, route);
      const r = checkScreenshot({ name: base, bytes }, set);
      const file = join(dir, `${base}.${r.format === "png" ? "png" : r.format === "jpeg" ? "jpg" : "bin"}`);
      writeFileSync(file, bytes);
      files.push({ name: file, bytes });
      report.push({ set, file, ok: r.ok, problems: r.problems });
      if (r.ok) log(`${file}: ok`);
      else { failed++; log(`${file}: FAILED`); for (const p of r.problems) log(`  - ${p}`); }
    }
    const c = checkSet(files, set);
    for (const p of c.problems.filter((p) => /file\(s\)/.test(p))) { failed++; report.push({ set, file: dir, ok: false, problems: [p] }); log(`${spec.label}: ${p}`); }
    for (const n of c.notes ?? []) { notes.push(`${spec.label}: ${n}`); log(`${spec.label}: note: ${n}`); }
  }
  if (json) console.log(JSON.stringify({ ok: failed === 0, mode: frames ? "frames" : "fast", out: outDir, files: report, notes }, null, 2));
  else console.log(`\nFiles are in ${outDir}. Check the sizes against the store pages before you submit.`);
  return failed ? 1 : 0;
}

/** `shipvo store screenshots [--out dir] [--sim url] [--port n] [--skip-build]`: fast mode only. */
async function screenshots(argv: string[]): Promise<void> {
  const a = args(argv);
  if (a.mode !== undefined && a.mode !== "fast" && a.mode !== "frames") fail(`shipvo store screenshots: --mode must be fast or frames, not ${a.mode}.`);
  const framed = a.mode === "frames";
  const cfg = loadConfig() as ReturnType<typeof loadConfig> & { store?: { captions?: Record<string, string> } };
  const out = a.out && a.out !== "true" ? a.out : framed ? "store-assets/frames" : "store-assets/raw";
  const json = a.json !== undefined && a.json !== "false";
  const sim = await startSim(a, cfg);
  let code = 1;
  try {
    const post = async (path: string, body: Record<string, unknown>) => {
      const r = await fetch(sim.base.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
      return (await r.json()) as { ok?: boolean; error?: string; data?: string };
    };
    const session = `shots-${Date.now().toString(36)}`;
    code = await renderScreenshots(cfg.routes, async (size, route, format = "jpeg") => {
      const open = await post("/session", { session, app: cfg.appId, ...size });
      if (open.ok === false) throw new Error(`could not open the app: ${open.error ?? "unknown error"}`);
      if (route !== undefined) {
        const r = await post("/act", { session, action: "open_url", url: route });
        if (!r.ok) throw new Error(`could not open ${route}: ${r.error ?? "unknown error"}`);
      }
      const shot = await post("/act", { session, action: "screenshot", format, inline: true });
      if (!shot.ok || !shot.data) throw new Error(`screenshot failed: ${shot.error ?? "no data"}`);
      return new Uint8Array(Buffer.from(shot.data, "base64"));
    }, out, { caption: framed ? captionFor(cfg) : undefined, json });
  } finally { sim.stop(); }
  process.exitCode = code;
}

const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Trade a Play service account key for an access token. The key stays in memory; it is never stored. */
async function playToken(key: { client_email: string; private_key: string }, f: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const sig = createSign("RSA-SHA256").update(head).sign(key.private_key).toString("base64url");
  const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${sig}` }) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in with the service account key failed (${r.status})`);
  return j.access_token;
}

/** Add the group to a track's Google Groups through one Play edit, keeping groups already there. Returns the final list. */
export async function addTesterGroup(opts: { pkg: string; token: string; group: string; track?: string; fetch?: typeof fetch }): Promise<{ groups: string[]; added: boolean }> {
  const f = opts.fetch ?? fetch, track = opts.track ?? "alpha", base = `${PLAY_API}/${encodeURIComponent(opts.pkg)}/edits`;
  const call = async (url: string, method: string, body?: unknown) => {
    const r = await f(url, { method, headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) throw new Error(`Play API ${method} ${url.replace(PLAY_API, "")} -> ${r.status}${j.error?.message ? `: ${j.error.message}` : ""}`);
    return j;
  };
  const edit = await call(base, "POST", {});
  const cur = await call(`${base}/${edit.id}/testers/${track}`, "GET");
  const groups: string[] = Array.isArray(cur.googleGroups) ? cur.googleGroups : [];
  if (groups.includes(opts.group)) { await call(`${base}/${edit.id}`, "DELETE").catch(() => {}); return { groups, added: false }; }
  const next = [...groups, opts.group];
  await call(`${base}/${edit.id}/testers/${track}`, "PUT", { googleGroups: next });
  await call(`${base}/${edit.id}:commit`, "POST");
  return { groups: next, added: true };
}

export function testersGuide(pkg: string, track = "alpha") {
  return {
    package: pkg, track,
    group: SHIPVO_TESTERS_GROUP, joinUrl: SHIPVO_TESTERS_JOIN_URL,
    optInUrl: `https://play.google.com/apps/testing/${pkg}`,
    firstUploadByHand: "Play requires the first upload of a new app to be made by hand in Play Console. This command cannot do that.",
    steps: [
      "In Play Console, open Testing > Closed testing and create a track (or use the default one).",
      "Upload your first build by hand. Play does not allow the API to do the first upload.",
      `Add testers as Google Groups: ${SHIPVO_TESTERS_GROUP}, plus a group of your own people. Or run \`shipvo store testers --play-key <file>\` to add it through the API.`,
      `Share your opt-in link: https://play.google.com/apps/testing/${pkg}`,
      `Join Shipvo Testers yourself (${SHIPVO_TESTERS_JOIN_URL}) and test other founders' apps. The community works because everyone tests.`,
      "Keep at least 12 testers opted in for 14 days in a row. The clock starts when 12 have opted in; if the count drops below 12 it resets.",
    ],
  };
}

/** Runs the `testers` work: the guide, plus the Play call when --play-key is given. */
async function testersData(argv: string[]) {
  const a = args(argv);
  const pkg = a.package && a.package !== "true" ? a.package : loadConfig().appId;
  const track = a.track && a.track !== "true" ? a.track : "alpha";
  const guide = testersGuide(pkg, track);
  let api: { added: boolean; groups: string[] } | { error: string } | undefined;
  if (a["play-key"] !== undefined) {
    if (a["play-key"] === "true") fail("shipvo store testers: --play-key needs a file path.");
    try {
      const key = JSON.parse(readFileSync(a["play-key"], "utf8"));
      api = await addTesterGroup({ pkg, track, group: SHIPVO_TESTERS_GROUP, token: await playToken(key, fetch) });
    } catch (e) { api = { error: (e as Error).message }; }
  }
  return { pkg, track, guide, api };
}

async function testersDone(argv: string[]): Promise<Done> {
  let r!: Awaited<ReturnType<typeof testersData>>;
  await trapExit(async () => { r = await testersData(argv); }, classifyExit(STORE_RULES, STORE_NEXT));
  if (r.api && "error" in r.api) throw new CliFailure(`Could not update the track: ${r.api.error}`, "remote_failed", 1, [{ command: "shipvo store testers --json", why: "Print the steps and add the group by hand." }]);
  return { code: r.api ? "testers_updated" : "testers_guide", summary: r.api ? `${SHIPVO_TESTERS_GROUP} is on the "${r.track}" track.` : `Steps to get 12 testers for ${r.pkg}.`, data: { ...r.guide, ...(r.api ? { api: r.api } : {}) }, next: [{ command: "shipvo store status --json", why: "See the next store step." }] };
}

/** `shipvo store testers [--package id] [--track alpha] [--play-key file]`: print the steps. Calls Play only with --play-key. */
async function testers(argv: string[]): Promise<void> {
  const { pkg, track, guide, api } = await testersData(argv);
  if (api && "error" in api) process.exitCode = 1;
  console.log(`Get your 12 testers for ${pkg} (closed track "${track}"):\n`);
  guide.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log(`\n${guide.firstUploadByHand}`);
  if (api) console.log("error" in api ? `\nCould not update the track: ${api.error}` : api.added ? `\nAdded ${SHIPVO_TESTERS_GROUP} to the "${track}" track. Groups now: ${api.groups.join(", ")}.` : `\n${SHIPVO_TESTERS_GROUP} was already on the "${track}" track. Nothing changed.`);
  else console.log("\nNo Play call was made. Pass --play-key <service-account.json> to add the group through the API; the key is read once and never stored.");
}
