// `shipvo sim`: build the app's web bundle with the simulated device and serve it in the simulator.
import { execSync, spawn, exec } from "node:child_process";
import { existsSync, renameSync, rmSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { createServer, connect } from "node:net";
import { args as parse, loadConfig } from "./config.js";

/** True if nothing is listening on the port (checks by binding, then closing). */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}

/** Resolves true once something accepts connections on the port, false if `stop` says to give up. */
function waitListening(port: number, stop: () => boolean): Promise<boolean> {
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

const IGNORED = new Set(["node_modules", "sim-dist", ".shipvo", ".git"]);

/** True if a path (relative to the project) is inside a folder that never triggers a rebuild. */
export const ignoredPath = (rel: string) => rel.split(/[\\/]/).some((seg) => IGNORED.has(seg));

/**
 * Calls `build` once after changes settle for `debounceMs`. A change during a build queues one more build.
 * `build` rejects with the build error; it is printed and the caller keeps serving the last good build.
 * Returns a function that stops watching.
 */
export function watchAndRebuild(opts: { dir: string; build: () => Promise<void>; debounceMs?: number; log?: (line: string) => void }): () => void {
  const { dir, build, debounceMs = 300, log = (l) => console.error(l) } = opts;
  let timer: NodeJS.Timeout | undefined; let running = false; let again = false; let closed = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    const t0 = Date.now();
    try { await build(); log(`rebuilt in ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
    catch (e) { log(`build failed, still serving the last good build: ${(e as Error).message}`); }
    running = false;
    if (again && !closed) { again = false; void run(); }
  };
  const w = watch(dir, { recursive: true }, (_ev, file) => {
    if (closed || (file && ignoredPath(String(file)))) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
  });
  return () => { closed = true; clearTimeout(timer); w.close(); };
}

/** Builds into .shipvo/sim-next and swaps it into sim-dist only if the build succeeds. */
function rebuildInto(): Promise<void> {
  const next = ".shipvo/sim-next";
  return new Promise((resolve, reject) => {
    exec(`npx expo export --platform web --output-dir ${next} --clear`, { env: { ...process.env, PN_SIM: "1" } }, (err, _out, stderr) => {
      if (err) { rmSync(next, { recursive: true, force: true }); return reject(new Error((stderr || err.message).trim().split("\n").slice(-5).join("\n"))); }
      rmSync("sim-dist", { recursive: true, force: true });
      renameSync(next, "sim-dist");
      resolve();
    });
  });
}

export async function sim(argv: string[]) {
  const a = parse(argv); const cfg = loadConfig();
  const port = a.port || "4545";
  if (!(await portFree(Number(port)))) {
    console.error(`Port ${port} is in use. Stop the other \`shipvo sim\` or pass --port <n>.`);
    process.exit(1);
  }
  if (a["skip-build"] !== "true" || !existsSync("sim-dist/index.html")) {
    console.error(`Building ${cfg.name} for the simulator…`);
    execSync("PN_SIM=1 npx expo export --platform web --output-dir sim-dist --clear", { stdio: "inherit", env: { ...process.env, PN_SIM: "1" } });
  }
  let server: string;
  try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
  catch { console.error("Install @shipvo/sim (and playwright) in this app: npm i -D @shipvo/sim playwright && npx playwright install chromium"); process.exit(2); }
  const p = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId, ...(a.dir ? ["--dir", a.dir] : [])], { stdio: "inherit", env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
  let exited = false;
  p.on("exit", (c) => { exited = true; process.exit(c ?? 0); });
  if (await waitListening(Number(port), () => exited)) {
    console.error(`Simulator on http://localhost:${port}  (open_app("${cfg.appId}") from @shipvo/mcp; Ctrl-C to stop)`);
    if (a.watch === "true") {
      watchAndRebuild({ dir: process.cwd(), build: rebuildInto });
      console.error("Watching for changes (ignoring node_modules, sim-dist, .shipvo)");
    }
  }
}
