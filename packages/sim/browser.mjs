// Finds a browser for the simulator without making the user install anything by hand.
// Order: 1) Chrome or Edge already on the machine, 2) Chromium in Playwright's shared cache,
// 3) install Chromium once, then continue. A missing `playwright` package is installed as a dev dependency.
// Set SHIPVO_NO_AUTO_INSTALL=1 to turn installs off; the error then names the one command to run.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync, execSync } from "node:child_process";

export const NOT_INSTALLED = /Executable doesn't exist|is not found at|distribution '[a-z-]+' is not found/i;
export const MISSING_LIBS = /error while loading shared libraries|Host system is missing dependencies|install-deps/i;

export const autoInstallOff = (env = process.env) => /^(1|true|yes)$/i.test(String(env.SHIPVO_NO_AUTO_INSTALL || ""));

/** npm, pnpm, yarn or bun, from the lockfile in `cwd`. Defaults to npm. */
export function detectPackageManager(cwd, exists = existsSync) {
  const has = (f) => exists(join(cwd, f));
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

/** The command that adds a dev dependency with the given package manager. */
export function devInstallCommand(pm, pkg) {
  const verb = pm === "npm" ? ["install", "--save-dev"] : pm === "yarn" ? ["add", "--dev"] : ["add", "-D"];
  return { cmd: pm, args: [...verb, pkg] };
}

const defaultDeps = {
  exists: existsSync,
  run: (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: ["ignore", 2, 2], shell: process.platform === "win32" }).status ?? 1,
  log: (m) => console.error(m),
  platform: process.platform,
  env: process.env,
  requireFrom: (cwd) => createRequire(join(cwd, "package.json")),
  requireHere: createRequire(import.meta.url),
  globalRoot: () => execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),
};

function loadPlaywright(cwd, d) {
  const sources = [() => d.requireFrom(cwd), () => d.requireHere, () => { const root = d.globalRoot(); return (id) => d.requireHere(join(root, id)); }];
  for (const from of sources) {
    try {
      const r = from(); const pw = r("playwright"); let version;
      try { version = r("playwright/package.json").version; } catch {}
      return { pw, version };
    } catch {}
  }
  return null;
}

/** Loads Playwright, installing it into the project (dev dependency) when it is missing. */
export function resolvePlaywright(cwd = process.cwd(), deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const found = loadPlaywright(cwd, d);
  if (found) return found;
  if (autoInstallOff(d.env)) throw new Error("playwright is not installed. Run: npm i -D playwright (SHIPVO_NO_AUTO_INSTALL is set, so Shipvo did not install it)");
  const pm = detectPackageManager(cwd, d.exists);
  const { cmd, args } = devInstallCommand(pm, "playwright");
  d.log(`sim: playwright is not installed. Installing it as a dev dependency: ${cmd} ${args.join(" ")}`);
  if (d.run(cmd, args, cwd) !== 0) throw new Error(`could not install playwright. Run: ${cmd} ${args.join(" ")}`);
  const again = loadPlaywright(cwd, d);
  if (!again) throw new Error(`installed playwright but could not load it. Run: ${cmd} ${args.join(" ")}`);
  d.log("sim: playwright installed.");
  return again;
}

/** The command to run when Chromium cannot start for missing system libraries (Linux). */
export const installDepsCommand = "npx playwright install-deps chromium";

/**
 * Launches a browser: system Chrome, then Edge, then Playwright's cached Chromium, then a one-time Chromium install.
 * `executablePath` (the --chromium flag) wins over everything. Returns the Playwright Browser.
 */
export async function launchResolved(pw, { cwd = process.cwd(), executablePath, version } = {}, deps = {}) {
  const d = { ...defaultDeps, ...deps };
  const { chromium } = pw;
  if (executablePath) return chromium.launch({ executablePath });
  const libs = (e) => {
    if (d.platform === "linux" && MISSING_LIBS.test(String(e?.message))) {
      throw new Error(`Chromium cannot start because system libraries are missing: ${String(e.message).split("\n")[0]}\nFix: run \`${installDepsCommand}\``);
    }
  };
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel }); }
    catch (e) { libs(e); /* not installed (or unusable): try the next one */ }
  }
  try { return await chromium.launch(); }
  catch (e) {
    libs(e);
    if (!NOT_INSTALLED.test(String(e?.message))) throw e;
  }
  const manual = "npx playwright install chromium";
  if (autoInstallOff(d.env)) throw new Error(`no browser found. Run: ${manual} (SHIPVO_NO_AUTO_INSTALL is set, so Shipvo did not install it)`);
  d.log(`sim: no Chrome, Edge or Playwright Chromium found. Installing Chromium once (shared by every project on this machine)${version ? ` for playwright ${version}` : ""}…`);
  if (d.run("npx", ["playwright", "install", "chromium"], cwd) !== 0) throw new Error(`could not install Chromium. Run: ${manual}`);
  d.log("sim: Chromium installed.");
  try { return await chromium.launch(); }
  catch (e) { libs(e); throw e; }
}
