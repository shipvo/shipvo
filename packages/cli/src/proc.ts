import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";

/**
 * On Windows, npm, npx, pnpm and yarn are `.cmd` shims. Node (22) refuses to spawn a `.cmd` without a shell,
 * and plain `spawn("npx")` finds no `npx.exe`. So on Windows we run these through the shell with every part
 * quoted, which also keeps paths with spaces in one piece. Elsewhere nothing changes.
 */
export function shellForm(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
  if (platform !== "win32" || cmd === process.execPath) return { command: cmd, args, shell: false };
  const q = (s: string) => (/^[\w@+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);
  return { command: [cmd, ...args].map(q).join(" "), args: [], shell: true };
}

export function spawnBin(cmd: string, args: string[], opts: SpawnOptions = {}) {
  const f = shellForm(cmd, args);
  return spawn(f.command, f.args, { ...opts, shell: f.shell });
}

export function spawnBinSync(cmd: string, args: string[], opts: SpawnSyncOptions = {}) {
  const f = shellForm(cmd, args);
  return spawnSync(f.command, f.args, { ...opts, shell: f.shell });
}

export function execBinSync(cmd: string, args: string[], opts: { cwd?: string; stdio?: "inherit"; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnBinSync(cmd, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with code ${r.status}`);
}

/** Names to try for Python 3. Windows usually has `python` or the `py` launcher, not `python3`. */
export const pythonNames = (platform: NodeJS.Platform = process.platform) => (platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"]);

/** Runs `python -c <code> ...args` with the first Python name that exits 0. Returns false if none does (missing Python, or the code failed). */
export function runPython(code: string, args: string[] = []): boolean {
  return pythonNames().some((name) => spawnBinSync(name, ["-c", code, ...args], { stdio: "ignore" }).status === 0);
}
