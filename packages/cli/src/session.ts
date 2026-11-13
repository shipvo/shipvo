// `shipvo session`: a Shipvo Phone session for any Expo app, for agents that only have a shell.
// start builds the app for web and serves it on a headless phone (Android or iOS frame) that stops on its own;
// screen/tap/type/scroll/back/screenshot drive it; get/list/stop manage it. No shipvo.json and no emulator needed.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensurePlaywright } from "./ensure-playwright.js";
import { rebuildInto, waitListening } from "./sim.js";
import { describeWebBuildFailure, ensureShipvoIgnored, type Platform } from "./run.js";
import { CliFailure, UsageError, emit, envelope, type Done, type Next } from "./json-out.js";

export const SESSION_USAGE = `Usage: shipvo session <command> [options]

  start [android|ios] [--device "<model>"] [--name <n>] [--max-duration-minutes <n>] [--port <n>] [--skip-build]
  start --a2ui <file>       open A2UI messages (JSON lines or a JSON list) on a phone; needs no app folder
  a2ui send <file> | a2ui actions [--since <n>]   send more A2UI messages; read what the screen sent to the agent
  devices
  screen | back | screenshot [--out <file>] [--no-frame]
  errors                    what the app threw, and scripts that did not load
  record start | record stop [--out <file>]
  tap <ref> | type <ref> <text> | scroll <up|down|left|right> [<ref>]
  get | list | stop
  clean                     remove the folders of stopped sessions (their screenshots and videos too)

Commands after start use the newest running session; pass --id <id> to name one. Add --json for one JSON document.
Example: shipvo session start ios --max-duration-minutes 20 --json`;

export const WEB_DEPS = ["react-native-web", "react-dom", "@expo/metro-runtime"];
export const DEFAULT_MINUTES = 30;

export type PhoneModel = { name: string; platform: Platform; width: number; height: number; scale: number };

export type SessionRecord = {
  id: string; name: string; app: string; platform: Platform; device: string; status: "in_progress" | "stopped";
  port: number; pid: number; watchdog_pid?: number; url: string; watch_url: string;
  started_at: string; expires_at: string; stopped_at?: string; stop_reason?: "stopped" | "expired" | "exited";
};

export type SessionDeps = {
  root: string;
  now: () => number;
  build: (root: string) => Promise<void>;
  /** Finds the simulator's server.mjs: the app's install first, then the one next to this CLI. */
  resolveServer: (root: string) => string;
  ensureBrowser: (root: string) => void;
  freePort: () => Promise<number>;
  /** The phone models the simulator knows, and the one each platform gets by default. Read from @shipvo/sim. */
  models: (root: string) => Promise<{ models: PhoneModel[]; defaults: Record<Platform, string> }>;
  /** Starts the simulator detached and resolves with its pid once it listens. */
  startServer: (o: { server: string; port: number; app: string; dir: string; root: string }) => Promise<number>;
  /** Starts a detached timer that ends the simulator after `ms`. Returns its pid. */
  startWatchdog: (pid: number, ms: number, o: { port: number; id: string }) => number;
  alive: (pid: number) => boolean;
  kill: (pid: number) => void;
  fetch: typeof fetch;
};

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** The Expo SDK number in a version range such as "~54.0.32". Expo 49 is the first to build for web with @expo/metro-runtime. */
const expoMajor = (range: unknown) => Number(/(\d+)/.exec(String(range ?? ""))?.[1] ?? 99);

/** True when the app can load a package it does not list itself, for example one that another dependency brings in. */
const installed = (root: string, pkg: string) => { try { createRequire(join(root, "package.json")).resolve(`${pkg}/package.json`); return true; } catch { return false; } };

/** What to call the app, from shipvo.json, then app.json, then package.json. Any Expo app qualifies. */
export function projectInfo(root: string): { app: string; name: string; missingWebDeps: string[]; router: boolean } {
  const pkg = readJson(join(root, "package.json"));
  if (!pkg) throw new CliFailure("No package.json in this folder. Run this in your Expo app's folder.", "no_project", 2);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.expo) throw new CliFailure("This folder is not an Expo app: package.json has no \"expo\" dependency.", "not_expo", 2);
  const cfg = readJson(join(root, "shipvo.json")); const expo = readJson(join(root, "app.json"))?.expo ?? {};
  const raw = String(cfg?.appId ?? expo.slug ?? pkg.name ?? "app");
  const app = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  return { app, name: String(cfg?.name ?? expo.name ?? pkg.name ?? app), missingWebDeps: WEB_DEPS.filter((d) => !deps[d] && !installed(root, d) && !(d === "@expo/metro-runtime" && expoMajor(deps.expo) < 49)), router: !!(deps["expo-router"] || deps["@react-navigation/native"]) };
}

const dirOf = (root: string) => join(root, ".shipvo", "sessions");
const fileOf = (root: string, id: string) => join(dirOf(root), `${id}.json`);
const save = (root: string, r: SessionRecord) => { mkdirSync(dirOf(root), { recursive: true }); writeFileSync(fileOf(root, r.id), JSON.stringify(r, null, 2) + "\n"); };

/** Reads a session and settles its status: a session whose simulator is gone is stopped. */
function load(d: SessionDeps, id: string): SessionRecord {
  if (!/^[\w-]+$/.test(id)) throw new CliFailure(`"${id}" is not a session id.`, "no_session", 1, LIST_NEXT);
  const r = readJson(fileOf(d.root, id)) as SessionRecord | null;
  if (!r) throw new CliFailure(`No session "${id}" in this folder.`, "no_session", 1, LIST_NEXT);
  if (r.status === "in_progress" && !d.alive(r.pid)) {
    const expired = d.now() >= Date.parse(r.expires_at);
    Object.assign(r, { status: "stopped", stop_reason: expired ? "expired" : "exited", stopped_at: expired ? r.expires_at : new Date(d.now()).toISOString() });
    save(d.root, r);
  }
  return r;
}

function all(d: SessionDeps): SessionRecord[] {
  if (!existsSync(dirOf(d.root))) return [];
  return readdirSync(dirOf(d.root)).filter((f) => f.endsWith(".json")).map((f) => load(d, f.slice(0, -5)))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/** The session a command acts on: --id, or the newest one that is running. */
function pick(d: SessionDeps, id?: string): SessionRecord {
  if (id) return load(d, id);
  const r = all(d).find((s) => s.status === "in_progress");
  if (!r) throw new CliFailure("No session is running in this folder.", "no_session", 1, START_NEXT);
  return r;
}

const START_NEXT: Next[] = [{ command: "shipvo session start android --json", why: "Start a phone session." }];
const LIST_NEXT: Next[] = [{ command: "shipvo session list --json", why: "See the sessions in this folder." }];
const driveNext = (id: string): Next[] => [
  { command: `shipvo session screen --id ${id} --json`, why: "Read the screen as a tree with refs." },
  { command: `shipvo session screenshot --id ${id} --json`, why: "Save a picture of the phone." },
  { command: `shipvo session stop --id ${id} --json`, why: "End the session when you are done." },
];

/** Screenshots and recordings a session wrote, newest last. */
export function artifacts(root: string, id: string): { name: string; path: string }[] {
  const dir = join(dirOf(root), id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(png|jpg|mp4)$/.test(f)).sort().map((f) => ({ name: f, path: join(dir, f) }));
}
const view = (root: string, r: SessionRecord) => ({ ...r, artifacts: artifacts(root, r.id) });

async function post(d: SessionDeps, port: number, path: string, body: object): Promise<any> {
  let res: Response;
  try { res = await d.fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { throw new CliFailure(`The phone did not answer: ${(e as Error).message}`, "sim_unreachable", 1, LIST_NEXT); }
  return res.json();
}

const DEVICES_NEXT: Next[] = [{ command: "shipvo session devices --json", why: "See the phone models you can start." }];

/** The model a session starts as: the one named, or the platform's default. A name decides the platform. */
export async function pickModel(d: SessionDeps, o: { platform?: Platform; device?: string }): Promise<PhoneModel> {
  const { models, defaults } = await d.models(d.root);
  const want = (o.device ?? defaults[o.platform ?? "android"]).trim().replace(/\s+/g, " ").toLowerCase();
  const m = models.find((x) => x.name.toLowerCase() === want);
  if (!m) throw new CliFailure(`"${o.device}" is not a phone model Shipvo knows.`, "bad_model", 2, DEVICES_NEXT);
  if (o.device && o.platform && m.platform !== o.platform) throw new CliFailure(`${m.name} is an ${m.platform === "ios" ? "iOS" : "Android"} phone, so it cannot start as ${o.platform}.`, "bad_model", 2, DEVICES_NEXT);
  return m;
}

/** A2UI messages from a file: JSON lines as text, or a JSON list as a list. The simulator checks each message. */
export function readA2ui(root: string, file: string): string | unknown[] {
  let text: string;
  try { text = readFileSync(resolve(root, file), "utf8"); }
  catch { throw new CliFailure(`Cannot read ${file}.`, "no_file", 2); }
  if (!text.trim()) throw new CliFailure(`${file} is empty.`, "no_file", 2);
  if (text.trimStart().startsWith("[")) { try { const list = JSON.parse(text); if (Array.isArray(list)) return list; } catch { throw new CliFailure(`${file} starts like a JSON list but is not valid JSON.`, "bad_message", 2); } }
  return text;
}
const a2uiBody = (input: string | unknown[]) => (typeof input === "string" ? { jsonl: input } : { messages: input });

export async function startSession(d: SessionDeps, o: { platform?: Platform; device?: string; name?: string; minutes?: number; port?: number; skipBuild?: boolean; a2ui?: string }): Promise<Done> {
  const minutes = o.minutes ?? DEFAULT_MINUTES;
  // An A2UI session shows screens an agent describes, so it needs no app folder and no build.
  const a2ui = o.a2ui === undefined ? undefined : readA2ui(d.root, o.a2ui);
  const info = a2ui === undefined ? projectInfo(d.root) : { app: "a2ui", name: `A2UI ${basename(o.a2ui!)}`, missingWebDeps: [] as string[], router: false };
  const model = await pickModel(d, o);
  const platform = model.platform;
  if (info.missingWebDeps.length) {
    throw new CliFailure(`The app needs ${info.missingWebDeps.join(", ")} to run on Shipvo Phone.`, "web_deps_missing", 1,
      [{ command: `npx expo install ${info.missingWebDeps.join(" ")}`, why: "Add the packages Expo uses to build for web." }]);
  }
  if (a2ui === undefined && (!o.skipBuild || !existsSync(join(d.root, "sim-dist", "index.html")))) {
    console.error(`Building ${info.name} for Shipvo Phone…`);
    try { await d.build(d.root); }
    catch (e) { throw new CliFailure(describeWebBuildFailure((e as { output?: string }).output ?? (e as Error).message), "build_failed", 1); }
  }
  d.ensureBrowser(d.root);
  const server = d.resolveServer(d.root);
  const id = `${platform}-${randomBytes(4).toString("hex")}`;
  const port = o.port ?? await d.freePort();
  try { ensureShipvoIgnored(d.root); } catch { /* read-only project: the session still works */ }
  mkdirSync(join(dirOf(d.root), id), { recursive: true });
  const pid = await d.startServer({ server, port, app: info.app, dir: join(dirOf(d.root), id), root: d.root });
  let opened: any;
  try { opened = await post(d, port, "/session", a2ui === undefined ? { session: id, app: info.app, model: model.name, ...(info.router ? { root_mount: true } : {}) } : { session: id, a2ui: true, a2ui_messages: a2ui, model: model.name }); }
  catch (e) { d.kill(pid); throw e; }
  if (!opened?.ok) { d.kill(pid); throw new CliFailure(`The app did not open: ${opened?.error ?? "unknown error"}`, opened?.code ?? "open_failed", 1); }
  const started = d.now();
  const rec: SessionRecord = {
    id, name: o.name ?? info.name, app: info.app, platform, device: model.name, status: "in_progress", port, pid,
    watchdog_pid: d.startWatchdog(pid, minutes * 60_000, { port, id }), url: `http://127.0.0.1:${port}`, watch_url: `http://127.0.0.1:${port}/watch?session=${id}`,
    started_at: new Date(started).toISOString(), expires_at: new Date(started + minutes * 60_000).toISOString(),
  };
  save(d.root, rec);
  return { code: "started", summary: `${info.name} is open on a simulated ${model.name}. It stops at ${rec.expires_at}.`,
    data: { ...view(d.root, rec), screen: opened.screen, mcp_env: { PN_SIM: rec.url } }, next: driveNext(id) };
}

export async function stopSession(d: SessionDeps, id?: string): Promise<Done> {
  const r = id ? load(d, id) : pick(d);
  if (r.status === "in_progress") {
    // A recording that is still running is saved before the phone goes away.
    try { await post(d, r.port, "/act", { session: r.id, action: "record_stop" }); } catch { /* the phone is gone: nothing to save */ }
    d.kill(r.pid); if (r.watchdog_pid) d.kill(r.watchdog_pid);
    Object.assign(r, { status: "stopped", stop_reason: "stopped", stopped_at: new Date(d.now()).toISOString() });
    save(d.root, r);
  }
  return { code: "stopped", summary: `Session ${r.id} is stopped.`, data: view(d.root, r), next: START_NEXT };
}

/** Removes the record and the folder of every stopped session. Running sessions are left alone. */
export function cleanSessions(d: SessionDeps): Done {
  const stopped = all(d).filter((s) => s.status === "stopped");
  for (const s of stopped) { rmSync(join(dirOf(d.root), s.id), { recursive: true, force: true }); rmSync(fileOf(d.root, s.id), { force: true }); }
  const running = all(d).length;
  return { code: "cleaned", summary: `Removed ${stopped.length} stopped session${stopped.length === 1 ? "" : "s"}. ${running} still running.`, data: { removed: stopped.map((s) => s.id), running }, next: running ? [] : START_NEXT };
}

const DIRECTIONS = new Set(["up", "down", "left", "right"]);

/** One action on the phone. `words` are the positionals after the verb. */
export async function actSession(d: SessionDeps, verb: string, words: string[], o: { id?: string; out?: string; noFrame?: boolean; since?: number }): Promise<Done> {
  const r = pick(d, o.id);
  if (r.status !== "in_progress") throw new CliFailure(`Session ${r.id} is stopped (${r.stop_reason}).`, "session_stopped", 1, START_NEXT);
  let body: Record<string, unknown>;
  if (verb === "tap") { if (!words[0]) throw new UsageError("tap needs a ref, for example: shipvo session tap e3"); body = { ref: words[0] }; }
  else if (verb === "type") { if (words.length < 2) throw new UsageError("type needs a ref and the text, for example: shipvo session type e4 \"hello\""); body = { ref: words[0], text: words.slice(1).join(" ") }; }
  else if (verb === "scroll") { if (!DIRECTIONS.has(words[0])) throw new UsageError("scroll needs up, down, left or right."); body = { direction: words[0], ...(words[1] ? { ref: words[1] } : {}) }; }
  else if (verb === "screenshot") body = { frame: !o.noFrame };
  else if (verb === "a2ui") {
    if (words[0] === "send") { if (!words[1]) throw new UsageError("a2ui send needs a file, for example: shipvo session a2ui send update.jsonl"); verb = "a2ui_send"; body = a2uiBody(readA2ui(d.root, words[1])); }
    else if (words[0] === "actions") { verb = "a2ui_actions"; body = o.since === undefined ? {} : { since: o.since }; }
    else throw new UsageError("a2ui needs send <file> or actions.");
  }
  else if (verb === "record") { if (words[0] !== "start" && words[0] !== "stop") throw new UsageError("record needs start or stop."); verb = `record_${words[0]}`; body = {}; }
  else body = {};
  const res = await post(d, r.port, "/act", { session: r.id, action: verb, ...body });
  if (!res?.ok) throw new CliFailure(res?.error ?? "The action failed.", res?.code ?? res?.reason ?? "action_failed", 1, [driveNext(r.id)[0]]);
  if (verb === "a2ui_send") return { code: (res.errors ?? []).length ? "a2ui_errors" : "sent", summary: `${res.applied} message${res.applied === 1 ? "" : "s"} applied${(res.errors ?? []).length ? `, ${res.errors.length} refused` : ""}.`, data: { session: r.id, applied: res.applied, errors: res.errors ?? [], surfaces: res.surfaces ?? [], screen: res.screen }, next: [{ command: `shipvo session a2ui actions --id ${r.id} --json`, why: "Read what the screen sent to the agent." }] };
  if (verb === "a2ui_actions") return { code: "actions", summary: `${(res.messages ?? []).length} message${(res.messages ?? []).length === 1 ? "" : "s"} for the agent.`, data: { session: r.id, messages: res.messages ?? [], next: res.next ?? 0, effects: res.effects ?? [], surfaces: res.surfaces ?? [] }, next: driveNext(r.id) };
  if (verb === "errors") {
    const errors: string[] = Array.isArray(res.errors) ? res.errors.map(String) : [];
    return { code: errors.length ? "errors" : "no_errors", summary: errors.length ? `The app has ${errors.length} error${errors.length === 1 ? "" : "s"}.` : "The app has no errors.", data: { session: r.id, errors }, next: driveNext(r.id) };
  }
  if (verb === "record_start") return { code: "recording", summary: `Recording session ${r.id}. Run \`shipvo session record stop\` to save the video.`, data: { session: r.id, path: res.path }, next: [{ command: `shipvo session record stop --id ${r.id} --json`, why: "Save the video when the steps are done." }] };
  if (verb === "screenshot" || verb === "record_stop") {
    const path = o.out ? resolve(d.root, o.out) : String(res.path);
    if (o.out) { mkdirSync(dirname(path), { recursive: true }); copyFileSync(String(res.path), path); }
    const extra = verb === "record_stop" ? { duration_s: res.duration_s, frames: res.frames } : {};
    return { code: verb === "screenshot" ? "screenshot" : "recorded", summary: `Saved ${path}`, data: { session: r.id, path, ...extra }, next: driveNext(r.id) };
  }
  return { code: "ok", summary: `${verb} done on session ${r.id}.`, data: { session: r.id, ...(res.value !== undefined ? { value: res.value } : {}), screen: res.screen }, next: driveNext(r.id) };
}

/** JavaScript that ends a detached process and its children. Playwright catches SIGTERM and keeps the simulator alive, so this uses SIGKILL on the process group, then on the pid (Windows has no groups). */
export const killSource = (pid: number) => `try{process.kill(-${pid},"SIGKILL")}catch{try{process.kill(${pid},"SIGKILL")}catch{}}`;
const killTree = (pid: number) => { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function defaultDeps(root = process.cwd()): SessionDeps {
  return {
    root, now: Date.now, alive, fetch,
    kill: killTree,
    build: (r) => rebuildInto({ root: r }),
    ensureBrowser: (r) => { try { ensurePlaywright({ cwd: r, quiet: true }); } catch (e) { throw new CliFailure((e as Error).message, "no_browser", 2, [{ command: "shipvo doctor --json", why: "Check Chromium and your setup." }]); } },
    resolveServer: (r) => {
      for (const base of [join(r, "package.json"), import.meta.url]) { try { return createRequire(base).resolve("@shipvo/sim/server.mjs"); } catch { /* try the next place */ } }
      throw new CliFailure("@shipvo/sim was not found. Run `npm i -D @shipvo/sim`.", "no_sim", 2);
    },
    freePort: () => new Promise((done, fail) => { const s = createServer(); s.once("error", fail); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); }),
    models: async (r) => {
      const mod = await import(pathToFileURL(join(dirname(defaultDeps(r).resolveServer(r)), "models.mjs")).href);
      return { models: mod.MODELS, defaults: mod.DEFAULT_MODEL };
    },
    startServer: async ({ server, port, app, dir, root: cwd }) => {
      const log = openSync(join(dir, "sim.log"), "a");
      const p = spawn(process.execPath, [server, "--port", String(port), "--host", "127.0.0.1", "--app", app, "--dir", dir], { cwd, detached: true, stdio: ["ignore", log, log] });
      let exited = false; p.once("exit", () => { exited = true; });
      if (!(await waitListening(port, () => exited))) throw new CliFailure(`The phone stopped before it started. See ${join(dir, "sim.log")}.`, "sim_exited", 1);
      p.unref();
      return p.pid!;
    },
    startWatchdog: (pid, ms, { port, id }) => {
      // At the time limit: save a running recording (20 s at most), then end the simulator.
      const save = `fetch("http://127.0.0.1:${port}/act",{method:"POST",body:JSON.stringify({session:${JSON.stringify(id)},action:"record_stop"}),signal:AbortSignal.timeout(20000)})`;
      const p = spawn(process.execPath, ["-e", `setTimeout(()=>{${save}.catch(()=>{}).finally(()=>{${killSource(pid)};process.exit(0)})},${Math.round(ms)})`], { detached: true, stdio: "ignore" });
      p.unref();
      return p.pid!;
    },
  };
}

/** `shipvo session ...`. Returns the exit code. */
export async function session(argv: string[], deps: SessionDeps = defaultDeps()): Promise<number> {
  const json = argv.includes("--json");
  const flags: Record<string, string> = {}; const words: string[] = [];
  const VALUE = new Set(["id", "name", "max-duration-minutes", "port", "out", "device", "a2ui", "since"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) words.push(a);
    else if (VALUE.has(a.slice(2))) flags[a.slice(2)] = argv[++i] ?? "";
    else flags[a.slice(2)] = "true";
  }
  const [verb, ...rest] = words;
  if (!verb || flags.help) { console.log(SESSION_USAGE); return verb || flags.help ? 0 : 2; }
  let exit = 0, doc;
  try {
    let done: Done;
    if (verb === "start") {
      const platform = rest[0] as Platform | undefined;
      if (platform !== undefined && platform !== "android" && platform !== "ios") throw new UsageError(`"${rest[0]}" is not a phone. Use android or ios.`);
      const minutes = flags["max-duration-minutes"] === undefined ? undefined : Number(flags["max-duration-minutes"]);
      if (minutes !== undefined && !(minutes > 0 && minutes <= 24 * 60)) throw new UsageError("--max-duration-minutes needs a number from 1 to 1440.");
      const port = flags.port === undefined ? undefined : Number(flags.port);
      if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new UsageError("--port needs a number from 1 to 65535.");
      done = await startSession(deps, { platform, device: flags.device, a2ui: flags.a2ui, name: flags.name, minutes, port, skipBuild: flags["skip-build"] === "true" });
    } else if (verb === "stop") done = await stopSession(deps, flags.id);
    else if (verb === "clean") done = cleanSessions(deps);
    else if (verb === "devices") { const { models, defaults } = await deps.models(deps.root); done = { code: "listed", summary: `${models.length} phone models. Defaults: ${defaults.android} for android, ${defaults.ios} for ios.`, data: { devices: models.map(({ name, platform, width, height, scale }) => ({ name, platform, width, height, scale })), defaults }, next: START_NEXT }; }
    else if (verb === "get") { const r = pick(deps, flags.id); done = { code: r.status, summary: `Session ${r.id} is ${r.status === "in_progress" ? "running" : "stopped"}.`, data: view(deps.root, r), next: r.status === "in_progress" ? driveNext(r.id) : START_NEXT }; }
    else if (verb === "list") { const list = all(deps); done = { code: "listed", summary: `${list.length} session${list.length === 1 ? "" : "s"} in this folder.`, data: { sessions: list }, next: list.some((s) => s.status === "in_progress") ? [] : START_NEXT }; }
    else if (["screen", "tap", "type", "scroll", "back", "screenshot", "record", "errors", "a2ui"].includes(verb)) done = await actSession(deps, verb, rest, { id: flags.id, out: flags.out, noFrame: flags["no-frame"] === "true", since: flags.since === undefined ? undefined : Number(flags.since) || 0 });
    else throw new UsageError(`Unknown session command "${verb}".\n${SESSION_USAGE}`);
    doc = envelope(done.code, done.summary, done.data, done.next, 0);
  } catch (e) {
    const f = e instanceof CliFailure ? e : null;
    exit = f?.exit ?? 1;
    doc = envelope(f?.code ?? "failed", e instanceof Error ? e.message : String(e), {}, f?.next ?? [], exit);
  }
  if (json) emit(doc);
  else {
    (exit ? console.error : console.log)(doc.summary);
    const screen = (doc.data as { screen?: string }).screen;
    if (screen) console.log(screen);
    if (verb === "errors") for (const e of (doc.data as { errors?: string[] }).errors ?? []) console.log(`- ${e}`);
    if (verb === "devices") for (const m of (doc.data as { devices?: PhoneModel[] }).devices ?? []) console.log(`${m.name.padEnd(18)} ${m.platform.padEnd(8)} ${m.width}x${m.height} @${m.scale}x`);
    if (verb === "list") for (const s of (doc.data as { sessions?: SessionRecord[] }).sessions ?? []) console.log(`${s.id}  ${s.status}  ${s.device ?? s.platform}  ${s.name}  ${s.url}`);
    for (const n of doc.next) console.error(`next: ${n.command}  (${n.why})`);
  }
  return exit;
}
