// Attach to a live `shipvo run` phone. `open_app` reads `.shipvo/run.json`, and if the run is alive and is the
// same app, drives it over the agent channel as the `driver`. The types below mirror
// packages/cli/src/run-protocol.ts: MCP cannot import from the CLI (rootDir is src, and the CLI is not a dependency).
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type RunInfo = { port: number; platform: "android" | "ios"; app: string; token: string; pid: number };
export type DriverMessage = { id: number; type: string; [key: string]: unknown };
export type ScreenMessage = { id?: number; type?: string; ok?: boolean; error?: string; code?: string; screen?: string | null; [key: string]: unknown };

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

// Safety: run.json may come from a parent directory, but we only ever connect to 127.0.0.1 and send its token there.
/** Finds `.shipvo/run.json` in `cwd` or a parent, stopping after the git root. Returns it only if the pid is alive and the app matches. */
export function findLiveRun(app: string | undefined, cwd = process.cwd()): RunInfo | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, ".shipvo", "run.json");
    if (existsSync(file)) {
      try {
        const i = JSON.parse(readFileSync(file, "utf8")) as Partial<RunInfo>;
        if (typeof i.port === "number" && typeof i.token === "string" && typeof i.pid === "number" && typeof i.app === "string" && (app === undefined || i.app === app) && alive(i.pid)) return i as RunInfo;
      } catch {}
      return undefined; // the nearest run.json decides
    }
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return undefined;
    dir = dirname(dir);
  }
}

export type Driver = { request(type: string, args?: Record<string, unknown>, ms?: number): Promise<ScreenMessage>; close(): void; closed: boolean };

/** Connects as `driver`. Rejects if the socket cannot open within `ms`. */
export function connectDriver(info: RunInfo, ms = 3000): Promise<Driver> {
  return new Promise((ok, fail) => {
    if (typeof WebSocket === "undefined") return fail(new Error("attach needs Node 22+ (no global WebSocket in this Node version)"));
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/__shipvo/agent?role=driver&token=${encodeURIComponent(info.token)}`);
    const pending = new Map<number, (m: ScreenMessage) => void>();
    let next = 1, opened = false;
    const d: Driver = {
      closed: false,
      close: () => { try { ws.close(); } catch {} },
      request: (type, args = {}, limit = 10000) => new Promise((res) => {
        if (d.closed) return res({ ok: false, code: "attach_closed", error: "the shipvo run phone is gone: call open_app again" });
        const id = next++;
        const t = setTimeout(() => { pending.delete(id); res({ ok: false, code: "sim_timeout", error: `the live phone did not answer "${type}" within ${limit} ms. The action may still have run: call screen to see where it is.` }); }, limit);
        pending.set(id, (m) => {
          clearTimeout(t);
          // The person using the phone paused the agent. Say what to do instead of retrying.
          res(m.code === "taken_over" ? { ...m, ok: false, error: "the person took over: they are using the live phone now. Stop acting and ask them to press Hand back, then call screen to see where the app is." } : m);
        });
        ws.send(JSON.stringify({ ...args, id, type } satisfies DriverMessage));
      }),
    };
    const timer = setTimeout(() => { ws.close(); fail(new Error("timed out connecting to the shipvo run phone")); }, ms);
    ws.onopen = () => { opened = true; clearTimeout(timer); ok(d); };
    ws.onmessage = (e) => {
      try { const m = JSON.parse(String(e.data)) as ScreenMessage; if (m.id !== undefined) { pending.get(m.id)?.(m); pending.delete(m.id); } } catch {}
    };
    ws.onclose = () => {
      d.closed = true;
      for (const [id, f] of pending) { f({ ok: false, code: "attach_closed", error: "the shipvo run phone closed the connection: call open_app again" }); pending.delete(id); }
      if (!opened) { clearTimeout(timer); fail(new Error("could not connect to the shipvo run phone")); }
    };
    ws.onerror = () => {};
  });
}

// ---- Starting the phone for the user (show: true) ----

/** True when this machine has a desktop where a browser can open: not CI, and a display on Linux. */
export function hasDesktop(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  if (env.CI && env.CI !== "false" && env.CI !== "0") return false;
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** The nearest folder with shipvo.json, from `cwd` up. */
export function findProjectDir(cwd = process.cwd()): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "shipvo.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
    dir = dirname(dir);
  }
}

export const runUrl = (info: Pick<RunInfo, "port">) => `http://127.0.0.1:${info.port}/`;

/** Opens a URL in the user's browser. SHIPVO_BROWSER replaces the opener (tests, unusual desktops). Never throws. */
export function openInBrowser(url: string): void {
  const custom = process.env.SHIPVO_BROWSER;
  const [cmd, args] = custom ? [custom, [url]] : process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try { const p = spawn(cmd, args, { stdio: "ignore", detached: true }); p.on("error", () => {}); p.unref(); } catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts `shipvo run <platform> --no-open` in `dir` and waits until it writes run.json. MCP opens the browser itself,
 * so the person sees one tab. SHIPVO_BIN replaces the `shipvo` command (tests).
 */
export async function startRun(dir: string, platform: "android" | "ios", waitMs = 240_000): Promise<{ ok: true; info: RunInfo } | { ok: false; error: string }> {
  mkdirSync(join(dir, ".shipvo"), { recursive: true });
  const logFile = join(dir, ".shipvo", "run.log");
  const fd = openSync(logFile, "w");
  const bin = process.env.SHIPVO_BIN;
  let exited: number | null | undefined, spawnError: string | undefined;
  try {
    const child = bin ? spawn(bin, ["run", platform, "--no-open"], { cwd: dir, stdio: ["ignore", fd, fd], detached: true }) : spawn("npx", ["-y", "shipvo", "run", platform, "--no-open"], { cwd: dir, stdio: ["ignore", fd, fd], detached: true, shell: process.platform === "win32" });
    child.on("exit", (c) => { exited = c ?? -1; });
    child.on("error", (e) => { spawnError = e.message; exited = -1; });
    child.unref();
  } finally { closeSync(fd); }
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const info = findLiveRun(undefined, dir);
    if (info && info.platform === platform) return { ok: true, info };
    if (exited !== undefined) {
      let tail = ""; try { tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-4).join(" "); } catch {}
      return { ok: false, error: `shipvo run ${platform} stopped before the phone was ready${spawnError ? ` (${spawnError})` : ""}${tail ? `: ${tail}` : ""}` };
    }
    await sleep(250);
  }
  return { ok: false, error: `shipvo run ${platform} did not become ready within ${Math.round(waitMs / 1000)} s (log: ${logFile})` };
}

/** Asks the run's page to switch to the other skin, then waits for the reloaded page to answer. Returns the new RunInfo. */
export async function switchSkin(info: RunInfo, d: Driver, platform: "android" | "ios", dir?: string): Promise<{ ok: true; info: RunInfo } | { ok: false; error: string }> {
  const r = await d.request("skin", { platform }, 5000);
  if (r.ok === false) return { ok: false, error: r.error ?? "the phone did not switch" };
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const now = findLiveRun(info.app, dir ?? process.cwd());
    if (now?.platform !== platform) continue;
    const s = await d.request("screen", {}, 1500);
    if (s.ok !== false && !s.error) return { ok: true, info: now };
  }
  return { ok: false, error: `the phone did not come back on ${platform}` };
}
