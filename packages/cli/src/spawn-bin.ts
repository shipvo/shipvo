export interface SpawnCall {
  command: string;
  args: string[];
  shell?: boolean;
}

const WIN_CMD_SHIMS = new Set(["npx", "npm", "pnpm"]);
const NEEDS_QUOTES = /[\s&|<>^(),;=]/;

function quoteForCmd(arg: string): string {
  if (!NEEDS_QUOTES.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Build the arguments for `spawn`. On Windows, npx, npm and pnpm are `.cmd`
 * shims, which need a shell, so the args are quoted for cmd.exe.
 * On other platforms the call is returned unchanged.
 */
export function spawnBin(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): SpawnCall {
  if (platform !== "win32") return { command, args };
  return {
    command: WIN_CMD_SHIMS.has(command) ? `${command}.cmd` : command,
    args: args.map(quoteForCmd),
    shell: true,
  };
}
