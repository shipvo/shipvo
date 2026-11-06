// `shipvo explore`: a deterministic walker over the simulator's accessibility tree. No LLM call.
// The walker (`walk`) only needs a `Driver`, so tests run it against a fake app. `explore` wires it to the simulator.
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { args as parse, loadConfig } from "./config.js";
import { portFree, waitListening } from "./sim.js";
import { ensurePlaywright } from "./ensure-playwright.js";
import { writeIssues } from "./explore-issues.js";
import { emit, envelope } from "./json-out.js";
import { runFlows, renderFlows, parseFlowNames } from "./flows.js";

export type Step =
  | { action: "open" }
  | { action: "open_url"; url: string }
  | { action: "tap"; role: string; name: string; nth: number }
  | { action: "type"; role: string; name: string; nth: number; text: string; enter?: boolean }
  | { action: "back" };
export type Reply = { ok: boolean; screen?: string | null; error?: string; code?: string; delivery?: string; reason?: string };
/** What the walker needs from a simulator session. */
export type Driver = {
  /** Start a fresh phone on the app. */
  open(): Promise<Reply>;
  openUrl(url: string): Promise<Reply>;
  tap(ref: string): Promise<Reply>;
  back(): Promise<Reply>;
  /** Type into a text field. Optional: without it the walker does not fill fields. `enter` presses Enter after the text. */
  type?(ref: string, text: string, enter?: boolean): Promise<Reply>;
  /** Look at the current screen again without acting. Optional: without it `stuck_loading` is not checked. */
  snapshot?(): Promise<Reply>;
  /** Uncaught page errors since the last call. */
  errors(): Promise<string[]>;
  /** Rendered size in px of each ref on the current screen. Optional: without it the size check is skipped. */
  sizes?(): Promise<Record<string, [number, number]>>;
};
export type Skin = "android" | "ios";
/** Smallest tap target: 44 x 44 pt on iOS (Apple HIG), 48 x 48 dp on Android (Material and Android accessibility guide). */
export const MIN_TARGET: Record<Skin, number> = { ios: 44, android: 48 };
export type Kind = "error" | "not_delivered" | "action_failed" | "dead_end" | "unnamed" | "small_target" | "duplicate_name" | "network_failed" | "stuck_loading" | "blank_screen";
export type Finding = { kind: Kind; message: string; screen: string; steps: Step[] };
export type Report = {
  app: string; generatedAt: string; steps: number; screens: number; maxSteps: number; maxDepth: number;
  stoppedEarly: string | null; error: string | null; findings: Finding[]; parityLimits: string[];
};

export const PARITY_LIMITS = [
  "The simulator runs the app's web build in headless Chromium. It is not a phone and not the native app.",
  "Camera, location, biometrics, payments and notifications are simulated. Native crashes and native-only bugs cannot show up here.",
  "The walker taps and types into text fields. It does not scroll or swipe, so content below the fold and rails are only seen if on screen.",
  "Layout, speed and memory are not measured.",
  "See docs/parity-results.md for what was measured against Android emulators and the iOS Simulator.",
];

const ACTIONABLE = new Set(["button", "link", "tab", "checkbox", "switch", "radio", "menuitem"]);
const FIELDS = new Set(["textbox", "searchbox"]);
/** Labels that end a session or destroy data. The walker taps them last. `cancel` is here too; being last, it is still tapped, so a modal is not skipped. */
const RISKY = /\b(log ?out|sign ?out|delete|remove|cancel|erase|deactivate|clear all|unsubscribe)\b/i;
const NETWORK = /network request failed|network error|networkerror|failed to fetch|no internet|you(?:'| a)re offline|(?:can't|cannot|couldn't|unable to) connect|connection (?:failed|lost|error)|ERR_(?:INTERNET|CONNECTION|NAME_NOT)\w*/i;
/** Only loading indicators count. Text such as a heading "Loading history" does not. */
const loading = (tree: string) => /^\s*- (?:progressbar|spinner|activity ?indicator)\b/im.test(tree);
/** Nothing drawn: no names and no text anywhere in the tree. */
const blank = (tree: string) => !/"|: \S/.test(tree);
/** Small seeded random numbers (mulberry32), so a seed repeats a run exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
/** A value for a field, from its label: one the field should accept, or one it should reject. */
export function sampleValue(name: string, invalid: boolean): string {
  const n = name.toLowerCase();
  const pick = (ok: string, bad: string) => (invalid ? bad : ok);
  if (/e-?mail/.test(n)) return pick("ada@example.com", "not-an-email");
  if (/pass/.test(n)) return pick("Correct-Horse-9", "1");
  if (/phone|tel|mobile/.test(n)) return pick("+14155550123", "12");
  if (/zip|postal|post code/.test(n)) return pick("94107", "00");
  if (/url|website|link/.test(n)) return pick("https://example.com", "not a url");
  if (/age|qty|quantity|number|amount|count|price|year/.test(n)) return pick("42", "abc");
  if (/search|find|query/.test(n)) return pick("test", "");
  if (/name/.test(n)) return pick("Ada Lovelace", "");
  return pick("hello", "");
}
type El = { role: string; name: string; ref: string; nth: number };

const unquote = (raw: string) => { const q = /^(\s*- )'(.*)'(:.*)?$/.exec(raw); return q ? q[1] + q[2]!.replace(/''/g, "'") + (q[3] ?? "") : raw; };

/** Actionable elements in a tree, in order. `nth` counts earlier elements with the same role and name. Disabled ones are left out. */
export const elements = (tree: string): El[] => parseEls(tree, ACTIONABLE);
function parseEls(tree: string, roles: Set<string>): El[] {
  const out: El[] = []; const seen = new Map<string, number>();
  for (const raw of tree.split("\n")) {
    const l = unquote(raw);
    const m = /^\s*- ([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?[^\n]*?\[ref=(\w+)\]/.exec(l);
    if (!m || !roles.has(m[1]!) || /\[disabled\]/.test(l)) continue;
    let name = ""; try { name = m[2] ? (JSON.parse(m[2]) as string).trim() : ""; } catch { name = m[2]!.slice(1, -1).trim(); }
    const key = `${m[1]}|${name}`; const nth = seen.get(key) ?? 0; seen.set(key, nth + 1);
    out.push({ role: m[1]!, name, ref: m[3]!, nth });
  }
  return out;
}
/** The tree without refs, to tell whether two screens are the same. */
export const signature = (tree: string) => tree.replace(/\s*\[ref=\w+\]/g, "");
const redScreen = (tree: string) => /Uncaught (\w*Error)|Unhandled Runtime Error|Application error|Something went wrong/i.exec(tree)?.[0];
// Accepts "close" too, but the sim `back` action only clicks a button named exactly "Back"; the replay fallback covers the rest.
const hasBack = (els: El[]) => els.some((e) => /^(back|go back|close)$/i.test(e.name));
const label = (e: { role: string; name: string }) => `${e.role} "${e.name}"`;

/** Steps in plain lines, for the report. */
export const describeStep = (s: Step) => s.action === "open" ? "open the app" : s.action === "open_url" ? `open_url ${s.url}` : s.action === "type" ? `type "${s.text}" into ${label(s)}${s.nth ? ` (number ${s.nth + 1} with that name)` : ""}${s.enter ? " and press Enter" : ""}` : s.action === "tap" ? `tap ${label(s)}${s.nth ? ` (number ${s.nth + 1} with that name)` : ""}` : "back";

export type WalkOptions = {
  routes?: string[]; onlyRoutes?: boolean; maxDepth?: number; maxSteps?: number; app?: string; skin?: Skin;
  /** Seed for tie-breaks and tap order. The same seed on the same app repeats the same walk. Default 1. */
  seed?: number;
  /** Wait in ms between looks at a screen that shows a loading indicator. Default 400. */
  settleMs?: number;
};
type Act = { kind: "tap" | "type"; el: El; text?: string; enter?: boolean; risky: boolean; done: boolean };
type Node = { sig: string; path: Step[]; depth: number; acts: Act[]; n: number; reward: number };

/**
 * Walks the app. Each round it picks the screen to work on with an upper confidence bound: screens with nothing tried yet
 * come first, then screens whose taps found new screens, with a bonus for rarely tried ones. On that screen it takes safe actions
 * before risky ones (log out, delete, cancel, remove). Text fields get a valid value, then an invalid one.
 */
export async function walk(driver: Driver, o: WalkOptions = {}): Promise<Report> {
  const skin = o.skin ?? "android", min = MIN_TARGET[skin];
  const maxDepth = o.maxDepth ?? 3, maxSteps = o.maxSteps ?? 100, settleMs = o.settleMs ?? 400;
  const rand = rng(o.seed ?? 1);
  const findings: Finding[] = []; const seenFinding = new Set<string>();
  const seen = new Set<string>(); const nodes = new Map<string, Node>();
  let steps = 0, cut = 0; let stopped: string | null = null;
  const add = (f: Finding) => { const k = `${f.kind}|${f.message}|${signature(f.screen)}`; if (!seenFinding.has(k)) { seenFinding.add(k); findings.push(f); } };
  const need = (r: Reply, what: string) => { if (!r.ok || r.screen == null) throw new Error(`explore: ${what} failed: ${r.error ?? "no screen"}`); return r.screen; };
  const find = (tree: string, s: { role: string; name: string; nth: number }, roles = ACTIONABLE) => parseEls(tree, roles).find((e) => e.role === s.role && e.name === s.name && e.nth === s.nth);

  /** Put the phone back on the screen reached by `path`. Replays are not counted as steps. */
  async function replay(path: Step[]): Promise<{ screen: string; errors: string[] }> {
    let screen = "";
    for (const s of path) {
      let r: Reply;
      if (s.action === "open") r = await driver.open();
      else if (s.action === "open_url") r = await driver.openUrl(s.url);
      else if (s.action === "back") r = await driver.back();
      else if (s.action === "type") r = driver.type ? await driver.type(find(screen, s, FIELDS)?.ref ?? "missing", s.text, s.enter) : { ok: false, error: "this simulator cannot type" };
      else r = await driver.tap(find(screen, s)?.ref ?? "missing");
      screen = need(r, `replaying "${describeStep(s)}"`);
    }
    // Errors raised while replaying are drained here. On a later replay they would repeat an earlier finding.
    // The caller of the first replay of a start path keeps them.
    return { screen, errors: await driver.errors() };
  }

  const addError = (e: string, screen: string, path: Step[]) =>
    add(NETWORK.test(e) ? { kind: "network_failed", message: `Network failed: ${e}`, screen, steps: path } : { kind: "error", message: `Uncaught error: ${e}`, screen, steps: path });
  async function checkErrors(screen: string, path: Step[]) {
    for (const e of await driver.errors()) addError(e, screen, path);
    const red = redScreen(screen);
    if (red) add({ kind: "error", message: `Red screen: the screen shows "${red}"`, screen, steps: path });
    const net = NETWORK.exec(screen)?.[0];
    if (net) add({ kind: "network_failed", message: `Network failed: the screen shows "${net}"`, screen, steps: path });
  }

  /** A screen seen for the first time: run the per-screen checks and list what can be done on it. */
  async function register(screen: string, path: Step[], depth: number): Promise<void> {
    const sig = signature(screen);
    if (seen.has(sig)) return;
    seen.add(sig);
    await checkErrors(screen, path);
    const els = elements(screen);
    if (!els.length) add({ kind: "dead_end", message: "Dead end: the screen has no actionable element", screen, steps: path });
    if (blank(screen)) add({ kind: "blank_screen", message: "Blank screen: nothing is drawn on it", screen, steps: path });
    for (const e of els) if (!e.name) add({ kind: "unnamed", message: `Unnamed ${e.role}: it has no accessible name`, screen, steps: path });
    for (const e of els) if (e.name && e.nth === 1) {
      const n = els.filter((x) => x.role === e.role && x.name === e.name).length;
      add({ kind: "duplicate_name", message: `Duplicate name: ${n} ${e.role}s are named "${e.name}", so a screen reader cannot tell them apart`, screen, steps: path });
    }
    if (driver.sizes) {
      // A simulator without the `sizes` action must not break the walk: skip the size check for this screen.
      const sizes = await driver.sizes!().catch(() => ({} as Record<string, [number, number]>));
      for (const e of els) {
        const z = sizes[e.ref]; if (!z || (z[0] >= min && z[1] >= min)) continue;
        add({ kind: "small_target", message: `Small target: ${e.name ? label(e) : e.role}${e.nth ? ` (number ${e.nth + 1})` : ""} is ${z[0]} x ${z[1]}, under the ${min} x ${min} minimum for ${skin}`, screen, steps: path });
      }
    }
    if (driver.snapshot && loading(screen)) {
      // Look again, twice. A screen that still shows a loading indicator after that is stuck.
      let still = true;
      for (let i = 0; i < 2 && still; i++) {
        await new Promise((r) => setTimeout(r, settleMs));
        const r = await driver.snapshot().catch(() => null);
        still = !!r?.ok && r.screen != null && loading(r.screen);
      }
      if (still) add({ kind: "stuck_loading", message: "Stuck loading: the screen still shows a loading indicator after waiting", screen, steps: path });
    }
    const taps: Act[] = shuffle(els.filter((e) => e.name && !/^(back|go back)$/i.test(e.name)), rand).map((el) => ({ kind: "tap", el, risky: RISKY.test(el.name), done: false }));
    const fs = driver.type ? parseEls(screen, FIELDS) : [];
    const typeActs = (invalid: boolean): Act[] => fs.map((el) => ({ kind: "type", el, text: sampleValue(el.name, invalid), enter: invalid, risky: false, done: false }));
    nodes.set(sig, { sig, path, depth, acts: [...typeActs(false), ...taps, ...typeActs(true)], n: 0, reward: 0 });
  }

  const todo = (n: Node) => n.acts.filter((a) => !a.done);
  /** Upper confidence bound over the screens that still have something to try. Untried screens first, risky-only screens last. */
  function pick(here: string | null, total: number): Node | null {
    const all = [...nodes.values()].filter((n) => todo(n).length);
    const safe = all.filter((n) => todo(n).some((a) => !a.risky));
    let best: Node | null = null, bestScore = -Infinity;
    for (const n of safe.length ? safe : all) {
      const ucb = n.n === 0 ? 1e9 : n.reward / n.n + Math.sqrt((2 * Math.log(total + 1)) / n.n);
      const score = ucb + (n.sig === here ? 0.01 : 0) + rand() * 1e-6;
      if (score > bestScore) { best = n; bestScore = score; }
    }
    return best;
  }

  const starts: (Step[])[] = [...(o.onlyRoutes ? [] : [[{ action: "open" }] as Step[]]), ...(o.routes ?? []).map((url): Step[] => [{ action: "open" }, { action: "open_url", url }])];
  let error: string | null = null;
  try {
    for (const path of starts) {
      const { screen, errors } = await replay(path);
      // The first replay of a start path is the only time load-time errors are seen.
      for (const e of errors) addError(e, screen, path);
      await register(screen, path, 1);
    }
    let screen: string | null = null; let at: Node | null = null;
    for (;;) {
      const node = pick(screen == null ? null : signature(screen), steps);
      if (!node) break;
      if (steps >= maxSteps) { stopped = `max-steps (${maxSteps}) reached`; break; }
      // Get to the node's screen: the Back button when it is one step up, a full replay otherwise.
      if (screen == null || signature(screen) !== node.sig) {
        let landed: string | null = null;
        if (at && screen != null && at.path.length === node.path.length + 1 && hasBack(elements(screen))) {
          const b = await driver.back();
          if (b.ok && b.screen != null && signature(b.screen) === node.sig) landed = b.screen;
        }
        screen = landed ?? (await replay(node.path)).screen;
      }
      const a = todo(node).find((x) => !x.risky) ?? todo(node)[0]!;
      a.done = true;
      const target = find(screen, a.el, a.kind === "type" ? FIELDS : ACTIONABLE);
      if (!target) { at = node; continue; }
      const step: Step = a.kind === "type" ? { action: "type", role: a.el.role, name: a.el.name, nth: a.el.nth, text: a.text!, ...(a.enter ? { enter: true } : {}) } : { action: "tap", role: a.el.role, name: a.el.name, nth: a.el.nth };
      const here = [...node.path, step]; steps++; node.n++;
      const r = a.kind === "type" ? await driver.type!(target.ref, a.text!, a.enter) : await driver.tap(target.ref);
      if (r.delivery === "not_delivered") add({ kind: "not_delivered", message: `Not delivered (${r.reason ?? "unknown reason"}): ${r.error ?? "the app did not receive the tap"}`, screen, steps: here });
      else if (!r.ok) add({ kind: "action_failed", message: `Action failed${r.code ? ` [${r.code}]` : ""}: ${r.error ?? "unknown"}`, screen, steps: here });
      const after: string = r.screen ?? screen;
      await checkErrors(after, here);
      const crashed = !r.ok || r.screen == null || !!redScreen(after);
      const next = signature(after);
      if (crashed) { screen = null; at = null; continue; }
      if (next !== node.sig && !seen.has(next)) {
        node.reward++;
        if (node.depth >= maxDepth) { cut++; seen.add(next); }
        else await register(after, here, node.depth + 1);
      }
      screen = after; at = nodes.get(next) ?? null;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    stopped = `the walk failed: ${error}`;
  }
  if (!stopped && cut) stopped = `max-depth (${maxDepth}) reached: ${cut} screen${cut === 1 ? "" : "s"} were not walked`;
  return { app: o.app ?? "", generatedAt: new Date().toISOString(), steps, screens: seen.size, maxSteps, maxDepth, stoppedEarly: stopped, error, findings, parityLimits: PARITY_LIMITS };
}

export function renderMarkdown(r: Report): string {
  const L = [`# Explore report: ${r.app}`, "", "## Simulator limits", "", ...r.parityLimits.map((p) => `- ${p}`), "", "## Run", "",
    `- Steps taken: ${r.steps} (limit ${r.maxSteps}). Screens seen: ${r.screens}. Depth limit: ${r.maxDepth}.`,
    `- ${r.stoppedEarly ? `Stopped early: ${r.stoppedEarly}.` : "Stopped early: no. The walk ended because every reachable screen within the limits was visited."}`, ""];
  L.push("## Findings", "");
  if (!r.findings.length) L.push(`No findings in ${r.steps} steps.`, "");
  r.findings.forEach((f, i) => {
    L.push(`### ${i + 1}. ${f.message}`, "", "Steps to reproduce:", "", ...f.steps.map((s, j) => `${j + 1}. ${describeStep(s)}`), "", "Typed steps:", "", "```json", JSON.stringify(f.steps), "```", "");
  });
  return L.join("\n");
}

/** Driver for a running simulator. */
export function simDriver(base: string, app: string, session = `explore-${Date.now().toString(36)}`, platform?: Skin): Driver {
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(base.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
    return (await r.json()) as Reply & { errors?: string[] };
  };
  const act = (body: Record<string, unknown>) => post("/act", { session, ...body });
  return {
    open: () => post("/session", { session, app, ...(platform ? { device: { platform } } : {}) }),
    openUrl: (url) => act({ action: "open_url", url }),
    tap: (ref) => act({ action: "tap", ref }),
    back: () => act({ action: "back" }),
    type: (ref, text, enter) => act({ action: "type", ref, text, ...(enter ? { enter: true } : {}) }),
    snapshot: () => act({ action: "screen" }),
    errors: async () => (await act({ action: "errors" })).errors ?? [],
    sizes: async () => ((await act({ action: "sizes" })) as { sizes?: Record<string, [number, number]> }).sizes ?? {},
  };
}

/** Use the simulator at `--sim <url>`, or build the app and start one on `--port` (default 4546). `stop` kills the one we started. */
export async function startSim(a: Record<string, string | undefined>, cfg: { name: string; appId: string; controlPlane: string }, quiet = false): Promise<{ base: string; stop: () => void }> {
  let base = a.sim; let child: ReturnType<typeof spawn> | undefined;
  if (!base) {
    const port = a.port || "4546";
    if (!(await portFree(Number(port)))) throw new Error(`Port ${port} is in use. Stop the other simulator, pass --port <n>, or pass --sim <url> to use one that is running.`);
    if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
      console.error(`Building ${cfg.name} for the simulator…`);
      execSync("npx expo export --platform web --output-dir sim-dist --clear", { stdio: quiet ? ["ignore", 2, 2] : "inherit", env: { ...process.env, PN_SIM: "1" } });
    }
    ensurePlaywright({ cwd: process.cwd(), quiet });
    let server: string;
    try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
    catch { throw new Error("@shipvo/sim is not installed in this app. Run `npm i -D @shipvo/sim` (or use your package manager)."); }
    let exited = false;
    child = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId], { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
    child.on("exit", () => { exited = true; });
    if (!(await waitListening(Number(port), () => exited))) throw new Error("the simulator exited before it was ready");
    base = `http://localhost:${port}`;
  }
  return { base, stop: () => { child?.kill(); } };
}

/** Returns the exit code. With `--json`, stdout is one envelope and everything else goes to stderr. */
export async function explore(argv: string[]): Promise<number> {
  if (!argv.includes("--json")) return exploreRun(argv, false);
  try { return await exploreRun(argv, true); }
  catch (e) {
    emit(envelope("error", e instanceof Error ? e.message : String(e), { findings: [] }, [{ command: "shipvo doctor --json", why: "Check the setup." }], 2));
    return 2;
  }
}

/** The app's URL scheme: `expo.scheme` in app.json, else the scheme of a configured route such as "tide://cart". */
export function appScheme(routes: string[] | undefined, dir = process.cwd()): string | undefined {
  try {
    const j = JSON.parse(readFileSync(join(dir, "app.json"), "utf8")) as { expo?: { scheme?: string | string[] }; scheme?: string };
    const sc = j.expo?.scheme ?? j.scheme;
    const first = Array.isArray(sc) ? sc[0] : sc;
    if (first) return first;
  } catch { /* no app.json: try the configured routes */ }
  return routes?.map((r) => /^([a-z][a-z0-9+.-]*):\/\//i.exec(r)?.[1]).find(Boolean);
}

/**
 * Deep links to walk for `--changed-from <sha>`: the changed, routable screens (up to four), as `<scheme>://<screen>`.
 * The walker opens them with the simulator's `open_url` action, which needs a URL the app's `onUrl` listener understands.
 * If the diff cannot be read (for example a shallow checkout), or the app has no known scheme, say so and fall back to the full walk.
 */
export async function routesFromChange(sha: string, log: (s: string) => void = console.error, scheme?: string): Promise<{ routes?: string[]; onlyRoutes: boolean }> {
  const { changedFiles, changedScreens } = await import("./ci-comment.js");
  const { routableScreens } = await import("./ci-shots.js");
  let files: string[];
  try { files = changedFiles(sha); }
  catch (e) { log(`could not read the diff: ${e instanceof Error ? e.message : e}. Walking the whole app.`); return { onlyRoutes: false }; }
  const screens = routableScreens(changedScreens(files));
  if (!screens.length) return { routes: [], onlyRoutes: true };
  if (!scheme) { log("could not find the app's URL scheme (expo.scheme in app.json), so changed screens cannot be opened. Walking the whole app."); return { onlyRoutes: false }; }
  return { routes: screens.map(([, r]) => `${scheme}://${r === "/" ? "" : r.slice(1)}`), onlyRoutes: true };
}

async function exploreRun(argv: string[], json: boolean): Promise<number> {
  const a = parse(argv); const cfg = loadConfig();
  const num = (k: string, d: number) => { if (a[k] === undefined) return d; const n = Number(a[k]); if (!Number.isInteger(n) || n < 1) throw new Error(`--${k} must be a whole number of 1 or more`); return n; };
  const maxDepth = num("max-depth", 3), maxSteps = num("max-steps", 100);
  const sim = await startSim(a, cfg, json); const base = sim.base;
  try {
    if (a.skin !== undefined && a.skin !== "ios" && a.skin !== "android") throw new Error("--skin must be android or ios");
    let routes = cfg.routes, onlyRoutes = false;
    if (a["changed-from"] !== undefined) {
      if (a["changed-from"] === "true") throw new Error("--changed-from needs a commit sha");
      // With --changed-from, the changed screens replace the configured routes. Only a failed diff falls back to them.
      ({ routes = cfg.routes, onlyRoutes } = await routesFromChange(a["changed-from"], console.error, appScheme(cfg.routes)));
    }
    let seed: number | undefined;
    if (a.seed !== undefined) { seed = Number(a.seed); if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a whole number of 0 or more"); }
    const flowNames = a.flows !== undefined ? parseFlowNames(a.flows) : undefined;
    const report = await walk(simDriver(base, cfg.appId), { routes, onlyRoutes, maxDepth, maxSteps, seed, app: cfg.appId, skin: a.skin as Skin | undefined });
    const out = a.out ?? "explore-report";
    const nothingChanged = onlyRoutes && !routes?.length;
    if (nothingChanged) console.error("No screens changed, nothing explored.");
    writeFileSync(`${out}.md`, (nothingChanged ? "No screens changed, nothing explored.\n\n" : "") + renderMarkdown(report)); writeFileSync(`${out}.json`, JSON.stringify(report, null, 2) + "\n");
    let flowsFailed = false;
    if (flowNames) {
      const fr = await runFlows(simDriver(base, cfg.appId), { flows: flowNames!, app: cfg.appId });
      writeFileSync(`${out}-flows.md`, renderFlows(fr)); writeFileSync(`${out}-flows.json`, JSON.stringify(fr, null, 2) + "\n");
      flowsFailed = fr.flows.some((f) => f.status === "failed");
      const msg = `Flows: ${fr.flows.map((f) => `${f.flow} ${f.status}`).join(", ")}. Wrote ${out}-flows.md and ${out}-flows.json`;
      if (json) console.error(msg); else console.log(msg);
    }
    let issueInfo: Record<string, unknown> = {};
    const line = `${report.findings.length ? `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}` : `No findings in ${report.steps} steps`}${report.stoppedEarly ? `. Stopped early: ${report.stoppedEarly}` : ""}. Wrote ${out}.md and ${out}.json`;
    if (a["issues-dir"] !== undefined) {
      if (a["issues-dir"] === "true") throw new Error("--issues-dir needs a directory");
      const { files, commands } = writeIssues(report.findings, (a.skin as Skin | undefined) ?? "android", a["issues-dir"]);
      if (!json) {
        if (!files.length) console.log("No findings, so no issue files written.");
        else console.log(`Wrote ${files.length} issue file${files.length === 1 ? "" : "s"} to ${a["issues-dir"]}. To file them:\n${commands.join("\n")}`);
      } else issueInfo = { issue_files: files, file_commands: commands };
    }
    const failOn = a["fail-on-findings"] === "true";
    const exit = report.error ? 1 : (report.findings.length || flowsFailed) && failOn ? 1 : 0;
    if (json) {
      const data = { ...issueInfo, report_files: [`${out}.md`, `${out}.json`], steps: report.steps, screens: report.screens, stopped_early: report.stoppedEarly, error: report.error, findings: report.findings.map((f) => ({ kind: f.kind, message: f.message, steps: f.steps.map(describeStep) })) };
      const code = report.error ? "walk_failed" : report.findings.length ? "findings" : "ok";
      const next = report.error ? [{ command: "shipvo doctor --json", why: "Check the simulator setup." }]
        : report.findings.length ? [{ command: `open ${out}.md`, why: "Read the steps to reproduce each finding." }, { command: "shipvo explore --json", why: "Run again after fixing to confirm." }]
        : [{ command: "shipvo test --json", why: "Run your step files." }];
      emit(envelope(code, report.error ?? line, data, next, exit));
    } else console.log(line);
    if (report.error && !json) console.error(report.error);
    return exit;
  } finally { sim.stop(); }
}
