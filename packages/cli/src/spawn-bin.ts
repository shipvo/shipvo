/**
 * Turns a program name and args into a spawn call that works on Windows and POSIX.
 * On Windows, `npx`, `pnpm`, `npm`, `yarn` and `node_modules/.bin` programs are `.cmd` shims.
 * Node cannot start those without a shell, and a shell joins args with spaces, so we quote them.
 * On other platforms nothing changes.
 */
export interface SpawnCall { command: string; args: string[]; shell: boolean }

const SHIMS = new Set(["npx", "pnpm", "npm", "yarn", "corepack"]);

const isShim = (cmd: string) => SHIMS.has(cmd) || /(^|[\\/])node_modules[\\/]\.bin[\\/]/.test(cmd);

/** Quotes one argument for cmd.exe. */
export function quoteWin(arg: string): string {
  if (arg !== "" && !/[\s"&|<>^%()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function spawnBin(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): SpawnCall {
  if (platform !== "win32" || !isShim(cmd) || /\.(cmd|exe|bat)$/i.test(cmd)) return { command: cmd, args, shell: false };
  return { command: `${quoteWin(cmd)}.cmd`.replace(/"\.cmd$/, '.cmd"'), args: args.map(quoteWin), shell: true };
}
