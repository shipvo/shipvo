import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface EnsurePlaywrightDeps {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Does this path exist? Used to find the lockfile. */
  exists: (path: string) => boolean;
  /** Runs a command in `cwd`. Throws if it fails. */
  run: (cmd: string, args: string[], cwd: string) => void;
  log: (line: string) => void;
  /** True when `playwright` resolves from the app. Defaults to the same lookup order as `doctor`. */
  resolves?: (cwd: string) => boolean;
}

const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

export function detectPackageManager(cwd: string, exists: (path: string) => boolean): PackageManager {
  for (const [file, pm] of LOCKFILES) if (exists(join(cwd, file))) return pm;
  return "npm";
}

export function installCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "pnpm": return { cmd: "pnpm", args: ["add", "-D", "playwright"] };
    case "yarn": return { cmd: "yarn", args: ["add", "-D", "playwright"] };
    case "bun": return { cmd: "bun", args: ["add", "-d", "playwright"] };
    default: return { cmd: "npm", args: ["install", "--save-dev", "playwright"] };
  }
}

/** Same lookup order as doctor's playwrightChromiumPath: the app, this package, @shipvo/sim, then the global npm root. */
function playwrightResolves(cwd: string): boolean {
  const tries: Array<() => unknown> = [
    () => createRequire(join(cwd, "package.json")).resolve("playwright"),
    () => createRequire(import.meta.url).resolve("playwright"),
    () => createRequire(createRequire(import.meta.url).resolve("@shipvo/sim/package.json")).resolve("playwright"),
    () => createRequire(import.meta.url).resolve(join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")),
  ];
  for (const t of tries) {
    try { t(); return true; } catch {}
  }
  return false;
}

/** Installs `playwright` as a dev dependency with the app's package manager when it is missing. */
export function ensurePlaywright(deps: Partial<EnsurePlaywrightDeps> & { cwd: string }): void {
  const { cwd } = deps;
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const run = deps.run ?? ((cmd, args, dir) => { execFileSync(cmd, args, { cwd: dir, stdio: "inherit" }); });
  const log = deps.log ?? ((line) => console.log(line));
  if ((deps.resolves ?? playwrightResolves)(cwd)) return;

  const { cmd, args } = installCommand(detectPackageManager(cwd, exists));
  const line = [cmd, ...args].join(" ");
  if (env.SHIPVO_NO_AUTO_INSTALL === "1") {
    throw new Error(`playwright is not installed and SHIPVO_NO_AUTO_INSTALL=1 is set. Run \`${line}\` in ${cwd}.`);
  }
  log(`playwright is not installed. Running: ${line}`);
  try {
    run(cmd, args, cwd);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`\`${line}\` failed: ${msg}`);
  }
}
