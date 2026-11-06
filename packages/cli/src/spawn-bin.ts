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
 * Quotes one argument for cmd.exe. Quotes become `\"`, which most programs read.
 * Does not handle a backslash right before a quote. Throws on `%`, because cmd expands `%VAR%` even inside quotes.
 */
export function quoteWin(arg: string): string {
  if (arg.includes("%")) throw new Error(`Cannot pass an argument containing "%" through cmd.exe on Windows: ${arg}`);
  if (arg !== "" && !/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function spawnBin(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): SpawnCall {
  if (platform !== "win32" || !isShim(cmd) || /\.(cmd|exe|bat)$/i.test(cmd)) return { command: cmd, args, shell: false };
  const bin = `${cmd}.cmd`;
  return { command: /\s/.test(bin) ? `"${bin}"` : bin, args: args.map(quoteWin), shell: true };
}

/** Runs a program to the end with inherited stdio, through `spawnBin`. Returns the exit status (1 if it did not start). */
export function runBin(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}, platform: NodeJS.Platform = process.platform): number {
  const sb = spawnBin(cmd, args, platform);
  return spawnSync(sb.command, sb.args, { stdio: "inherit", shell: sb.shell, ...opts }).status ?? 1;
}
