// `shipvo sim`: build the app's web bundle with the simulated device and serve it in the simulator.
import { execSync, spawn } from "node:child_process";
import { spawnBin } from "./spawn-bin.js";
import { existsSync, mkdirSync, renameSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer, connect } from "node:net";
import { ensurePlaywright } from "./ensure-playwright.js";
import { args as parse, loadConfig } from "./config.js";
import { openBrowser } from "./run.js";
import { CliFailure, runJson, takeJson, type Done } from "./json-out.js";

/** True if nothing is listening on the port (checks by binding, then closing). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

/** Resolves true once something accepts connections on the port, false if `stop` says to give up. */
export function waitListening(port: number, stop: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (stop()) return resolve(false);
      const c = connect(port, "127.0.0.1");
      c.once("connect", () => { c.destroy(); resolve(true); });
      c.once("error", () => { c.destroy(); setTimeout(tryOnce, 100); });
    };
    tryOnce();
  });
}

const IGNORED = new Set(["node_modules", "sim-dist", ".shipvo", ".git", ".expo", "dist", "dist-ota", "web-build", "ios", "android"]);

/** True if a path (relative to the project) is inside a folder that never triggers a rebuild. */
export const ignoredPath = (rel: string) => rel.split(/[\\/]/).some((seg) => IGNORED.has(seg));

/** Turns a build error into a short plain message. Unknown errors keep their first line only. */
export function friendlyBuildError(message: string, verbose = false): string {
  if (verbose) return `build failed, still serving the last good build: ${message}`;
  const m = /in file (\S+\.json) at (\d+):(\d+)/.exec(message);
  if (m && /Unexpected token|SyntaxError/.test(message)) {
    const comma = /expected punc [«"']?,/.test(message) || /Unexpected token string/.test(message);
    const what = comma ? "check for a missing or extra comma" : "a character is missing, extra or in the wrong place";
    return `Your file ${m[1]} has a mistake at line ${m[2]}, column ${m[3]}: ${what}. The page still shows your last good version.`;
  }
  return `build failed, still serving the last good build: ${message.split("\n")[0]} (run with --verbose for details)`;
}

/**
 * Calls `build` once after changes settle for `debounceMs`. A change during a build queues one more build.
 * `build` rejects with the build error; it is printed and the caller keeps serving the last good build.
 * Returns a function that stops watching.
 */
export function watchAndRebuild(opts: { dir: string; build: () => Promise<void>; debounceMs?: number; log?: (line: string) => void; verbose?: boolean; onStart?: () => void; onResult?: (r: { ok: true; seconds: number } | { ok: false; message: string }) => void }): () => void {
  const { dir, build, debounceMs = 300, log = (l) => console.error(l), verbose = false, onStart, onResult } = opts;
  let announced = false;
  let timer: NodeJS.Timeout | undefined; let running = false; let again = false; let closed = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true; announced = false;
    const t0 = Date.now();
    try { await build(); const seconds = (Date.now() - t0) / 1000; log(`rebuilt in ${seconds.toFixed(1)} s`); onResult?.({ ok: true, seconds }); }
    catch (e) { const message = friendlyBuildError((e as Error).message, verbose); log(message); onResult?.({ ok: false, message }); }
    running = false;
    if (again && !closed) { again = false; onStart?.(); void run(); }
  };
  const w = watch(dir, { recursive: true }, (_ev, file) => {
    if (closed || (file && ignoredPath(String(file)))) return;
    // Say right away that the save was seen, once per rebuild.
    if (!announced) { announced = true; log("Rebuilding..."); onStart?.(); }
    clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
  });
  const stop = () => { closed = true; clearTimeout(timer); w.close(); };
  w.on("error", (e) => { log(`file watcher failed, no longer watching: ${(e as Error).message}`); stop(); });
  return stop;
}

/**
 * Builds into `<root>/.shipvo/sim-next` and swaps it into `<root>/sim-dist` only if the build succeeds.
 * The old build is moved aside first and moved back if the swap fails.
 * `command` is the shell command; it gets the output dir as its last argument.
 * A failed build rejects with an Error whose `output` property holds the last 4000 characters of stdout and stderr.
 */
export function rebuildInto(opts: { root?: string; command?: string; echo?: boolean } = {}): Promise<void> {
  const root = opts.root ?? process.cwd();
  const next = join(root, ".shipvo", "sim-next"), live = join(root, "sim-dist"), prev = join(root, ".shipvo", "sim-prev");
  return new Promise((resolve, reject) => {
    mkdirSync(join(root, ".shipvo"), { recursive: true });
    rmSync(next, { recursive: true, force: true });
    // A custom command is a shell string. The default goes through spawnBin so Windows runs npx.cmd.
    const call = opts.command
      ? { command: `${opts.command} "${next}"`, args: [] as string[], shell: true }
      : spawnBin("npx", ["expo", "export", "--platform", "web", "--clear", "--output-dir", next]);
    const p = spawn(call.command, call.args, { cwd: root, shell: call.shell, env: { ...process.env, PN_SIM: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    // Metro and Expo print resolve errors to either stream, so keep both. `echo` also shows them.
    for (const [stream, out] of [[p.stdout!, process.stdout], [p.stderr!, process.stderr]] as const) {
      stream.on("data", (d) => { if (opts.echo) out.write(d); tail = (tail + d).slice(-4000); });
    }
    p.on("error", (e) => { rmSync(next, { recursive: true, force: true }); reject(e); });
    p.on("close", (code) => {
      if (code !== 0) {
        rmSync(next, { recursive: true, force: true });
        const err = new Error(tail.trim().split("\n").slice(-5).join("\n") || `build exited with code ${code}`);
        return reject(Object.assign(err, { output: tail }));
      }
      let moved = false;
      try {
        rmSync(prev, { recursive: true, force: true });
        if (existsSync(live)) { renameSync(live, prev); moved = true; }
        renameSync(next, live);
      } catch (e) {
        try { if (moved && !existsSync(live)) renameSync(prev, live); } catch { /* keep the original error */ }
        rmSync(next, { recursive: true, force: true });
        return reject(e);
      }
      rmSync(prev, { recursive: true, force: true });
      resolve();
    });
  });
}

/** True if `shipvo sim` should open the /watch page: not with --no-open and not with --json. */
export const shouldOpenWatch = (o: { noOpen?: boolean; json?: boolean }) => !o.noOpen && !o.json;

const SIM_NEXT = [{ command: "shipvo doctor --json", why: "Check Chromium, the port and your setup." }];

/**
 * `shipvo sim [--port n] [--watch] [--no-open] [--json]`. With `--json` stdout holds one envelope, printed once the simulator
 * listens (or once it fails to start). The simulator keeps running after that; its output goes to stderr.
 */
export async function sim(argv: string[]) {
  const { json, rest } = takeJson(argv);
  if (!json) return simRun(rest, false);
  await runJson(() => simRun(rest, true) as Promise<Done>, SIM_NEXT);
}

async function simRun(argv: string[], json: boolean): Promise<Done | void> {
  // Text mode keeps its plain messages and exit codes. JSON mode throws, so runJson prints the envelope.
  const die = (msg: string, status: number, code: string): never => {
    if (json) throw new CliFailure(msg, code, status, SIM_NEXT);
    console.error(msg); process.exit(status);
  };
  const a = parse(argv); const cfg = loadConfig();
  if (a.hosted === "true") {
    const { uploadHosted } = await import("./sim-hosted.js");
    try {
      const b = await uploadHosted({ skipBuild: a["skip-build"] === "true" });
      console.error(`Uploaded. It expires ${b.expires_at}. On the hosted phone: open_app("${b.open}")`);
      return { code: "uploaded", summary: `Uploaded build ${b.id}`, data: b, next: [] } as Done;
    } catch (e) { return die((e as Error).message, 1, (e as { code?: string }).code ?? "upload_failed"); }
  }
  const port = a.port || "4545";
  if (!(await portFree(Number(port)))) {
    die(`Port ${port} is in use. Stop the other \`shipvo sim\` or pass --port <n>.`, 1, "port_in_use");
  }
  const stdio: "inherit" | ("ignore" | number)[] = json ? ["ignore", 2, 2] : "inherit";
  if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
    console.error(`Building ${cfg.name} for the simulator…`);
    try { execSync("npx expo export --platform web --output-dir sim-dist --clear", { stdio, env: { ...process.env, PN_SIM: "1" } }); }
    catch (e) { if (!json) throw e; die(`The simulator build failed: ${(e as Error).message.split("\n")[0]}`, 1, "build_failed"); }
  }
  try { ensurePlaywright({ cwd: process.cwd() }); }
  catch (e) { die(e instanceof Error ? e.message : String(e), 2, "no_browser"); }
  let server = "";
  try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
  catch { die("@shipvo/sim is not installed in this app. Run `npm i -D @shipvo/sim` (or use your package manager).", 2, "no_sim"); }
  const p = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId, ...(a.dir ? ["--dir", a.dir] : [])], { stdio, env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
  let exited = false;
  p.on("exit", (c) => { exited = true; process.exit(c ?? 0); });
  if (await waitListening(Number(port), () => exited)) {
    console.error(`Simulator on http://localhost:${port}/app/  (open_app("${cfg.appId}") from @shipvo/mcp; Ctrl-C to stop)`);
    const watchUrl = `http://localhost:${port}/watch`;
    console.error(`Watch the agent: ${watchUrl}`);
    if (shouldOpenWatch({ noOpen: a["no-open"] === "true", json })) openBrowser(watchUrl);
    if (a.watch === "true") {
      watchAndRebuild({ dir: process.cwd(), build: () => rebuildInto(), verbose: a.verbose === "true" });
      console.error("Watching for changes (ignoring node_modules, sim-dist, .shipvo, .expo, dist, dist-ota, web-build, ios, android)");
    }
    if (json) return { code: "listening", summary: `Simulator on http://localhost:${port}/app/`, data: { url: `http://localhost:${port}/app/`, port: Number(port), app_id: cfg.appId, watch_url: watchUrl, watch: a.watch === "true" }, next: [{ command: `shipvo explore --json --sim http://localhost:${port}`, why: "Walk the app in the running simulator." }, { command: "shipvo test --json", why: "Run the app's tests." }] };
  } else if (json) die("The simulator stopped before it started listening.", 1, "sim_exited");
}
