// `shipvo sim`: build the app's web bundle with the simulated device and serve it in the simulator.
import { execSync, spawn } from "node:child_process";
import { existsSync, watch, rmSync, renameSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, connect } from "node:net";
import { args as parse, loadConfig } from "./config.js";

const IGNORED = new Set(["node_modules", "sim-dist", ".shipvo", ".git", ".expo"]);

export function isIgnoredPath(p: string): boolean {
  return p.split(/[\\/]/).some((part) => IGNORED.has(part));
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as T & { cancel(): void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

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

export function buildBundle(cfg: any, a: any, force = false, watchMode = false): { ok: boolean; ms: number; error?: string } {
  const start = Date.now();
  if (!force && a["skip-build"] === "true" && existsSync("sim-dist/index.html")) {
    return { ok: true, ms: 0 };
  }
  console.error(`Building ${cfg.name} for the simulator…`);
  const tmp = ".shipvo/sim-next";
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true, force: true } as any);
  const stdio = watchMode ? "pipe" : "inherit";
  try {
    execSync("npx expo export --platform web --output-dir " + tmp + " --clear", { stdio, env: { ...process.env, PN_SIM: "1" } });
    rmSync("sim-dist", { recursive: true, force: true });
    renameSync(tmp, "sim-dist");
    return { ok: true, ms: Date.now() - start };
  } catch (e: any) {
    rmSync(tmp, { recursive: true, force: true });
    const out = [e.stdout?.toString?.(), e.stderr?.toString?.(), e.message].filter(Boolean).join("\n");
    return { ok: false, ms: Date.now() - start, error: out };
  }
}

export async function sim(argv: string[]) {
  const a = parse(argv); const cfg = loadConfig();
  const watchMode = argv.includes("--watch");
  const port = a.port || "4545";
  if (!(await portFree(Number(port)))) {
    console.error(`Port ${port} is in use. Stop the other \`shipvo sim\` or pass --port <n>.`);
    process.exit(1);
  }

  const initial = buildBundle(cfg, a, false, false);
  if (!initial.ok) {
    console.error(initial.error);
    if (!watchMode || !existsSync("sim-dist/index.html")) process.exit(1);
  }

  let server: string;
  try { server = createRequire(process.cwd() + "/package.json").resolve("@shipvo/sim/server.mjs"); }
  catch { console.error("Install @shipvo/sim (and playwright) in this app: npm i -D @shipvo/sim playwright && npx playwright install chromium"); process.exit(2); }
  const p = spawn(process.execPath, [server, "--port", port, "--app", cfg.appId, ...(a.dir ? ["--dir", a.dir] : [])], { stdio: "inherit", env: { ...process.env, PN_CONTROL: cfg.controlPlane } });
  let exited = false;
  p.on("exit", (c) => { exited = true; process.exit(c ?? 0); });
  if (await waitListening(Number(port), () => exited)) {
    console.error(`Simulator on http://localhost:${port}  (open_app("${cfg.appId}") from @shipvo/mcp; Ctrl-C to stop)`);
  }

  if (!watchMode) return;

  let building = false;
  let dirty = false;

  const runBuild = () => {
    if (building) { dirty = true; return; }
    building = true;
    const r = buildBundle(cfg, a, true, true);
    building = false;
    if (r.ok) console.log(`rebuilt in ${(r.ms / 1000).toFixed(1)} s`);
    else console.error(`Build failed, still serving the last good build:\n${r.error}`);
    if (dirty) { dirty = false; runBuild(); }
  };

  const rebuild = debounce(() => { runBuild(); }, 300);

  const watcher = watch(process.cwd(), { recursive: true }, (_event, filename) => {
    if (!filename || isIgnoredPath(String(filename))) return;
    rebuild();
  });
  watcher.on("error", () => {});

  p.on("exit", () => {
    watcher.close();
    rebuild.cancel();
  });
}
