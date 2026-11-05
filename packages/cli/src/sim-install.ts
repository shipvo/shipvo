import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** npm, pnpm, yarn or bun, from the lockfile in `cwd`. Defaults to npm. */
// Keep in step with packages/sim/browser.mjs (this package cannot import it).
export function detectPackageManager(cwd: string, exists: (p: string) => boolean = existsSync): PackageManager {
  const has = (f: string) => exists(join(cwd, f));
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

export function devInstallArgs(pm: PackageManager, pkg: string): string[] {
  return pm === "npm" ? ["install", "--save-dev", pkg] : pm === "yarn" ? ["add", "--dev", pkg] : ["add", "-D", pkg];
}

export interface SimInstallDeps {
  resolve: (cwd: string) => string;
  run: (cmd: string, args: string[], cwd: string) => number;
  exists: (p: string) => boolean;
  log: (m: string) => void;
  env: NodeJS.ProcessEnv;
}
const defaults: SimInstallDeps = {
  resolve: (cwd) => createRequire(join(cwd, "package.json")).resolve("@shipvo/sim/server.mjs"),
  run: (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: ["ignore", 2, 2], shell: process.platform === "win32" }).status ?? 1,
  exists: existsSync,
  log: (m) => console.error(m),
  env: process.env,
};

/** Path of @shipvo/sim's server in the app. If the package is missing, installs it as a dev dependency (unless SHIPVO_NO_AUTO_INSTALL=1). Playwright and the browser are resolved by the server itself. */
export function ensureSimServer(cwd: string = process.cwd(), over: Partial<SimInstallDeps> = {}): string {
  const d = { ...defaults, ...over };
  try { return d.resolve(cwd); } catch {}
  const pm = detectPackageManager(cwd, d.exists);
  const cmd = `${pm} ${devInstallArgs(pm, "@shipvo/sim").join(" ")}`;
  if (/^(1|true|yes)$/i.test(d.env.SHIPVO_NO_AUTO_INSTALL ?? "")) throw new Error(`@shipvo/sim is not installed. Run: ${cmd} (SHIPVO_NO_AUTO_INSTALL is set, so Shipvo did not install it)`);
  d.log(`@shipvo/sim is not installed. Installing it as a dev dependency: ${cmd}`);
  if (d.run(pm, devInstallArgs(pm, "@shipvo/sim"), cwd) !== 0) throw new Error(`could not install @shipvo/sim. Run: ${cmd}`);
  try { return d.resolve(cwd); } catch { throw new Error(`installed @shipvo/sim but could not load it. Run: ${cmd}`); }
}
