/**
 * Turns a program name and args into a spawn call that works on Windows and POSIX.
 * On Windows, `npx`, `pnpm`, `npm`, `yarn` and `node_modules/.bin` programs are `.cmd` shims.
 * Node cannot start those without a shell, and a shell joins args with spaces, so we quote them.
 * On other platforms nothing changes.
 */
import { spawnSync } from "node:child_process";

export interface SpawnCall { command: string; args: string[]; shell: boolean }

const SHIMS = new Set(["npx", "pnpm", "npm", "yarn", "corepack"]);

const isShim = (cmd: string) => SHIMS.has(cmd) || /(^|[\\/])node_modules[\\/]\.bin[\\/]/.test(cmd);

/**
 * Quotes one argument for cmd.exe. Throws on `"` (no escape is safe in cmd, so `a" & calc` could break out)
 * and on `%` (cmd expands `%VAR%` even inside quotes). Backslashes right before the closing quote are doubled.
 */
export function quoteWin(arg: string): string {
  if (arg.includes('"')) throw new Error(`Cannot pass an argument containing a double quote through cmd.exe on Windows: ${arg}`);
  if (arg.includes("%")) throw new Error(`Cannot pass an argument containing "%" through cmd.exe on Windows: ${arg}`);
  if (arg !== "" && !/[\s&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/\\+$/, (m) => m + m)}"`;
}

export function spawnBin(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): SpawnCall {
  if (platform !== "win32" || !isShim(cmd) || /\.(cmd|exe|bat)$/i.test(cmd)) return { command: cmd, args, shell: false };
  const bin = `${cmd}.cmd`;
  return { command: /\s/.test(bin) ? `"${bin}"` : bin, args: args.map(quoteWin), shell: true };
}

/** The `spawn` arguments for a call. With a shell we pass one command line and no args array (Node 24 warns DEP0190 otherwise). */
export function toSpawn(sb: SpawnCall): { file: string; args: string[]; shell: boolean } {
  return sb.shell ? { file: [sb.command, ...sb.args].join(" "), args: [], shell: true } : { file: sb.command, args: sb.args, shell: false };
}

/** Runs a program to the end with inherited stdio, through `spawnBin`. Returns the exit status (1 if it did not start). */
export function runBin(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}, platform: NodeJS.Platform = process.platform): number {
  const t = toSpawn(spawnBin(cmd, args, platform));
  return spawnSync(t.file, t.args, { stdio: "inherit", shell: t.shell, ...opts }).status ?? 1;
}
