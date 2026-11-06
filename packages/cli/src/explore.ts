// `shipvo explore`: a deterministic walker over the simulator's accessibility tree. No LLM call.
// The walker (`walk`) only needs a `Driver`, so tests run it against a fake app. `explore` wires it to the simulator.
import { execSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { args as parse, loadConfig } from "./config.js";
import { portFree, waitListening } from "./sim.js";
import { ensurePlaywright } from "./ensure-playwright.js";

export type Step =
  | { action: "open" }
  | { action: "open_url"; url: string }
  | { action: "tap"; role: string; name: string; nth: number }
  | { action: "back" };
export type Reply = { ok: boolean; screen?: string | null; error?: string; code?: string; delivery?: string; reason?: string };
/** What the walker needs from a simulator session. */
export type Driver = {
  /** Start a fresh phone on the app. */
  open(): Promise<Reply>;
  openUrl(url: string): Promise<Reply>;
  tap(ref: string): Promise<Reply>;
  back(): Promise<Reply>;
  /** Uncaught page errors since the last call. */
  errors(): Promise<string[]>;
  /** Rendered size in px of each ref on the current screen. Optional: without it the size check is skipped. */
  sizes?(): Promise<Record<string, [number, number]>>;
  /** Current screen tree. Used by `shipvo smoke`. */
  screen?(): Promise<string>;
  /** console.error output since the last call. Used by `shipvo smoke`. */
  consoleErrors?(): Promise<string[]>;
};
export type Skin = "android" | "ios";
/** Smallest tap target: 44 x 44 pt on iOS (Apple HIG), 48 x 48 dp on Android (Material and Android accessibility guide). */
export const MIN_TARGET: Record<Skin, number> = { ios: 44, android: 48 };
export type Kind = "error" | "not_delivered" | "action_failed" | "dead_end" | "unnamed" | "small_target" | "duplicate_name";
export type Finding = { kind: Kind; message: string; screen: string; steps: Step[] };
export type Report = {
  app: string; generatedAt: string; steps: number; screens: number; maxSteps: number; maxDepth: number;
  stoppedEarly: string | null; error: string | null; findings: Finding[]; parityLimits: string[];
};

export const PARITY_LIMITS = [
  "The simulator runs the app's web build in headless Chromium. It is not a phone and not the native app.",
  "Camera, location, biometrics, payments and notifications are simulated. Native crashes and native-only bugs cannot show up here.",
  "The walker only taps. It does not type, scroll or swipe, so content below the fold and rails are only seen if on screen.",
  "Layout, speed and memory are not measured.",
  "See docs/parity-results.md for what was measured against Android emulators and the iOS Simulator.",
];

const ACTIONABLE = new Set(["button", "link", "tab", "checkbox", "switch", "radio", "menuitem"]);
type El = { role: string; name: string; ref: string; nth: number };

const unquote = (raw: string) => { const q = /^(\s*- )'(.*)'(:.*)?$/.exec(raw); return q ? q[1] + q[2]!.replace(/''/g, "'") + (q[3] ?? "") : raw; };

/** Actionable elements in a tree, in order. `nth` counts earlier elements with the same role and name. Disabled ones are left out. */
export function elements(tree: string): El[] {
  const out: El[] = []; const seen = new Map<string, number>();
  for (const raw of tree.split("\n")) {
    const l = unquote(raw);
    const m = /^\s*- ([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?[^\n]*?\[ref=(\w+)\]/.exec(l);
    if (!m || !ACTIONABLE.has(m[1]!) || /\[disabled\]/.test(l)) continue;
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
export const describeStep = (s: Step) => s.action === "open" ? "open the app" : s.action === "open_url" ? `open_url ${s.url}` : s.action === "tap" ? `tap ${label(s)}${s.nth ? ` (number ${s.nth + 1} with that name)` : ""}` : "back";

export async function walk(driver: Driver, o: { routes?: string[]; maxDepth?: number; maxSteps?: number; app?: string; skin?: Skin } = {}): Promise<Report> {
  const skin = o.skin ?? "android", min = MIN_TARGET[skin];
  const maxDepth = o.maxDepth ?? 3, maxSteps = o.maxSteps ?? 100;
  const findings: Finding[] = []; const seenFinding = new Set<string>();
  const seenScreens = new Set<string>(); let steps = 0; let stopped: string | null = null; let cut = 0;
  const add = (f: Finding) => { const k = `${f.kind}|${f.message}|${signature(f.screen)}`; if (!seenFinding.has(k)) { seenFinding.add(k); findings.push(f); } };
  const need = (r: Reply, what: string) => { if (!r.ok || r.screen == null) throw new Error(`explore: ${what} failed: ${r.error ?? "no screen"}`); return r.screen; };

  /** Put the phone back on the screen reached by `path`. Replays are not counted as steps. */
  async function replay(path: Step[]): Promise<{ screen: string; errors: string[] }> {
    let screen = "";
    for (const s of path) {
      const r = s.action === "open" ? await driver.open() : s.action === "open_url" ? await driver.openUrl(s.url) : s.action === "back" ? await driver.back()
        : await driver.tap(find(screen, s)?.ref ?? "missing");
      screen = need(r, `replaying "${describeStep(s)}"`);
    }
    // Errors raised while replaying are drained here. On a later replay they would repeat an earlier finding.
    // The caller of the first replay of a start path keeps them.
    return { screen, errors: await driver.errors() };
  }
  const find = (tree: string, s: { role: string; name: string; nth: number }) => elements(tree).find((e) => e.role === s.role && e.name === s.name && e.nth === s.nth);

  async function checkErrors(screen: string, path: Step[]) {
    for (const e of await driver.errors()) add({ kind: "error", message: `Uncaught error: ${e}`, screen, steps: path });
    const red = redScreen(screen);
    if (red) add({ kind: "error", message: `Red screen: the screen shows "${red}"`, screen, steps: path });
  }

  async function visit(screen: string, path: Step[], depth: number): Promise<void> {
    const sig = signature(screen);
    if (seenScreens.has(sig)) return;
    seenScreens.add(sig);
    await checkErrors(screen, path);
    const els = elements(screen);
    if (!els.length) add({ kind: "dead_end", message: "Dead end: the screen has no actionable element", screen, steps: path });
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
    let current = screen;
    for (const e of els) {
      if (!e.name || /^(back|go back)$/i.test(e.name)) continue;
      if (steps >= maxSteps) { stopped ??= `max-steps (${maxSteps}) reached`; return; }
      const target = find(current, e);
      if (!target) { current = (await replay(path)).screen; if (!find(current, e)) continue; }
      const step: Step = { action: "tap", role: e.role, name: e.name, nth: e.nth };
      const here = [...path, step]; steps++;
      const r = await driver.tap(find(current, e)!.ref);
      if (r.delivery === "not_delivered") add({ kind: "not_delivered", message: `Not delivered (${r.reason ?? "unknown reason"}): ${r.error ?? "the app did not receive the tap"}`, screen: current, steps: here });
      else if (!r.ok) add({ kind: "action_failed", message: `Action failed${r.code ? ` [${r.code}]` : ""}: ${r.error ?? "unknown"}`, screen: current, steps: here });
      const after = r.screen ?? current;
      await checkErrors(after, here);
      const crashed = !r.ok || r.screen == null || !!redScreen(after);
      const next = signature(after);
      if (!crashed && next !== signature(current) && !seenScreens.has(next)) {
        if (depth >= maxDepth) { cut++; seenScreens.add(next); }
        else {
          await visit(after, here, depth + 1);
          if (steps >= maxSteps && stopped) return;
        }
      }
      // Back to this screen: Back button first, a full replay if that does not land here.
      if (next !== signature(current) || crashed) {
        let b: Reply | undefined;
        if (!crashed && hasBack(elements(after))) b = await driver.back();
        current = b?.ok && b.screen != null && signature(b.screen) === sig ? b.screen : (await replay(path)).screen;
      } else current = after;
    }
  }

  const starts: (Step[])[] = [[{ action: "open" }], ...(o.routes ?? []).map((url): Step[] => [{ action: "open" }, { action: "open_url", url }])];
  let error: string | null = null;
  try {
    for (const path of starts) {
      if (stopped) break;
      const { screen, errors } = await replay(path);
      // The first replay of a start path is the only time load-time errors are seen.
      for (const e of errors) add({ kind: "error", message: `Uncaught error: ${e}`, screen, steps: path });
      await visit(screen, path, 1);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    stopped = `the walk failed: ${error}`;
  }
  if (!stopped && cut) stopped = `max-depth (${maxDepth}) reached: ${cut} screen${cut === 1 ? "" : "s"} were not walked`;
  return { app: o.app ?? "", generatedAt: new Date().toISOString(), steps, screens: seenScreens.size, maxSteps, maxDepth, stoppedEarly: stopped, error, findings, parityLimits: PARITY_LIMITS };
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
export function simDriver(base: string, app: string, session = `explore-${Date.now().toString(36)}`): Driver {
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(base.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
    return (await r.json()) as Reply & { errors?: string[] };
  };
  const act = (body: Record<string, unknown>) => post("/act", { session, ...body });
  return {
    open: () => post("/session", { session, app }),
    openUrl: (url) => act({ action: "open_url", url }),
    tap: (ref) => act({ action: "tap", ref }),
    back: () => act({ action: "back" }),
    errors: async () => (await act({ action: "errors" })).errors ?? [],
    screen: async () => (await act({ action: "screen" })).screen ?? "",
    consoleErrors: async () => (await act({ action: "console_errors" })).errors ?? [],
    sizes: async () => ((await act({ action: "sizes" })) as { sizes?: Record<string, [number, number]> }).sizes ?? {},
  };
}

/** Use the simulator at `--sim <url>`, or build the app and start one on `--port` (default 4546). `stop` kills the one we started. */
export async function startSim(a: Record<string, string | undefined>, cfg: { name: string; appId: string; controlPlane: string }, opts: { buildToStderr?: boolean } = {}): Promise<{ base: string; stop: () => void }> {
  let base = a.sim; let child: ReturnType<typeof spawn> | undefined;
  if (!base) {
    const port = a.port || "4546";
    if (!(await portFree(Number(port)))) throw new Error(`Port ${port} is in use. Stop the other simulator, pass --port <n>, or pass --sim <url> to use one that is running.`);
    if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
      console.error(`Building ${cfg.name} for the simulator…`);
      execSync("PN_SIM=1 npx expo export --platform web --output-dir sim-dist --clear", { stdio: opts.buildToStderr ? ["inherit", 2, 2] : "inherit", env: { ...process.env, PN_SIM: "1" } });
    }
    ensurePlaywright({ cwd: process.cwd() });
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

/** Returns the exit code. */
export async function explore(argv: string[]): Promise<number> {
  const a = parse(argv); const cfg = loadConfig();
  const num = (k: string, d: number) => { if (a[k] === undefined) return d; const n = Number(a[k]); if (!Number.isInteger(n) || n < 1) throw new Error(`--${k} must be a whole number of 1 or more`); return n; };
  const maxDepth = num("max-depth", 3), maxSteps = num("max-steps", 100);
  const sim = await startSim(a, cfg); const base = sim.base;
  try {
    if (a.skin !== undefined && a.skin !== "ios" && a.skin !== "android") throw new Error("--skin must be android or ios");
    const report = await walk(simDriver(base, cfg.appId), { routes: cfg.routes, maxDepth, maxSteps, app: cfg.appId, skin: a.skin as Skin | undefined });
    const out = a.out ?? "explore-report";
    writeFileSync(`${out}.md`, renderMarkdown(report)); writeFileSync(`${out}.json`, JSON.stringify(report, null, 2) + "\n");
    console.log(`${report.findings.length ? `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}` : `No findings in ${report.steps} steps`}${report.stoppedEarly ? `. Stopped early: ${report.stoppedEarly}` : ""}. Wrote ${out}.md and ${out}.json`);
    if (report.error) { console.error(report.error); return 1; }
    return report.findings.length && a["fail-on-findings"] === "true" ? 1 : 0;
  } finally { sim.stop(); }
}
