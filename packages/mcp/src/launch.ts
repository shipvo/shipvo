// Start `shipvo run <platform>` for open_app, so the person gets a phone in their browser without a second command.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findLiveRun, type RunInfo } from "./attach.js";

/** True when this machine has a desktop the person can look at: not CI, and on Linux a display is set. */
export function hasDesktop(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  if (env.CI && env.CI !== "false" && env.CI !== "0") return false;
  if (platform === "linux") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return true;
}

/** The nearest folder with shipvo.json, from `cwd` upward. */
export function findProjectDir(cwd = process.cwd()): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "shipvo.json"))) return dir;
    if (dirname(dir) === dir) return undefined;
    dir = dirname(dir);
  }
}

/** The `shipvo` binary installed in the project, if any. open_app starts a run on its own only with this, so it never fetches a package unasked. */
export function localShipvo(dir: string | undefined): string | undefined {
  if (!dir) return undefined;
  const bin = join(dir, "node_modules", ".bin", process.platform === "win32" ? "shipvo.cmd" : "shipvo");
  return existsSync(bin) ? bin : undefined;
}

/** The URL of a run's phone page. */
export const runUrl = (r: Pick<RunInfo, "port">) => `http://127.0.0.1:${r.port}/`;

function readRun(dir: string): RunInfo | undefined {
  try { return JSON.parse(readFileSync(join(dir, ".shipvo", "run.json"), "utf8")) as RunInfo; } catch { return undefined; }
}

/**
 * Starts `shipvo run <platform>` in `dir` (it opens the browser itself) and waits until its run.json names a live
 * process on that platform. SHIPVO_RUN_COMMAND replaces the command (a JSON array, for tests and custom installs).
 */
export async function startRun(platform: "android" | "ios", dir: string, timeoutMs = Number(process.env.SHIPVO_RUN_TIMEOUT_MS) || 120_000): Promise<RunInfo> {
  const override = process.env.SHIPVO_RUN_COMMAND ? (JSON.parse(process.env.SHIPVO_RUN_COMMAND) as string[]) : undefined;
  const [cmd, ...args] = override ?? (localShipvo(dir) ? [localShipvo(dir)!] : ["npx", "-y", "shipvo"]);
  const before = readRun(dir)?.pid;
  const child = spawn(cmd, [...args, "run", platform], { cwd: dir, stdio: "ignore", detached: true });
  let exited: string | undefined;
  child.on("error", (e) => { exited = e.message; });
  child.on("exit", (code) => { exited = `exited with code ${code}`; });
  child.unref();
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = findLiveRun(undefined, dir);
    if (r && r.platform === platform && r.pid !== before) return r;
    if (exited) throw new Error(`shipvo run ${platform} stopped before the phone was ready (${exited}). Run it in a terminal to see why.`);
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`shipvo run ${platform} did not write .shipvo/run.json within ${Math.round(timeoutMs / 1000)} s. Run it in a terminal to see why.`);
}
