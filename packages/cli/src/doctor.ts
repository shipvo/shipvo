import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { portFree } from "./sim.js";
import { args as parseArgs } from "./config.js";
import { b64, keyFromSeed } from "./index.js";
import { parseDeclared } from "./hermes.js";

type CheckResult = { name: string; ok: boolean; fix: string; note?: string };
type ShipvoConfig = { publicKey?: unknown; controlPlane?: unknown; hermesBytecodeVersion?: unknown };
type DoctorDeps = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  fetchFn: typeof fetch;
  fileExists: typeof existsSync;
  readText: (path: string) => string;
  platform: NodeJS.Platform;
  fileMode: (path: string) => number | null;
  /** Port the simulator will use (default 4545). */
  port: number;
  /** Path of the Playwright Chromium binary, or null if Playwright is not installed. */
  chromiumPath: (cwd: string) => string | null;
  /** Version of the playwright that chromiumPath resolved, or null if unknown. */
  playwrightVersion: (cwd: string) => string | null;
  portFree: (port: number) => Promise<boolean>;
  /** Skip the checks that need the network (control plane reachable and /health). */
  offline: boolean;
  /** Skip the simulator checks (Chromium, port) even when package.json has a `sim` script. */
  skipSim: boolean;
};

const defaultDeps = (): DoctorDeps => ({
  cwd: process.cwd(),
  env: process.env,
  nodeVersion: process.versions.node,
  fetchFn: fetch,
  fileExists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  platform: process.platform,
  fileMode: (path) => { try { return statSync(path).mode & 0o777; } catch { return null; } },
  port: 4545,
  chromiumPath: playwrightChromiumPath,
  playwrightVersion: (cwd) => { try { return createRequire(join(cwd, "package.json"))("playwright/package.json").version as string; } catch { return null; } },
  portFree,
  offline: false,
  skipSim: false,
});

/** Finds Playwright the way packages/sim/server.mjs does (the app's install, then this package's and @shipvo/sim's, then the global npm root) and asks it where Chromium should be. */
function playwrightChromiumPath(cwd: string): string | null {
  const tries: Array<() => any> = [
    () => createRequire(join(cwd, "package.json"))("playwright"),
    () => createRequire(import.meta.url)("playwright"),
    () => createRequire(createRequire(import.meta.url).resolve("@shipvo/sim/package.json"))("playwright"),
    () => createRequire(import.meta.url)(join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")),
  ];
  for (const get of tries) {
    try { return get().chromium.executablePath() as string; } catch {}
  }
  return null;
}

/** Same wording as `shipvo sim` prints when the launch fails. */
function chromiumFix(version: string | null): string {
  return `Shipvo uses Chrome or Edge if installed, else installs Chromium on first run (unless SHIPVO_NO_AUTO_INSTALL=1). To do it now, run \`npx playwright install chromium\` in the app folder${version ? ` (playwright ${version})` : ""}. On Linux, if Chromium then fails to start, run \`npx playwright install-deps chromium\`.`;
}

function hasSimScript(deps: DoctorDeps): boolean {
  try {
    const pkg = JSON.parse(deps.readText(join(deps.cwd, "package.json")));
    return typeof pkg?.scripts?.sim === "string";
  } catch { return false; }
}

const parseMajor = (v: string) => Number(v.split(".")[0] || 0);
const pub = (s: string) => b64(keyFromSeed(s).publicKey);

function seedFilePath(env: NodeJS.ProcessEnv, cwd: string): string | null {
  if (env.SHIPVO_SIGNING_SEED || env.PURENATIVE_SIGNING_SEED) return null;
  return env.SHIPVO_SIGNING_SEED_FILE || env.PURENATIVE_SIGNING_SEED_FILE || join(cwd, ".shipvo", "seed.txt");
}

function resolveSeed(env: NodeJS.ProcessEnv, cwd: string, readText: (path: string) => string): string | null {
  const direct = env.SHIPVO_SIGNING_SEED || env.PURENATIVE_SIGNING_SEED;
  if (direct) return direct;
  const file = env.SHIPVO_SIGNING_SEED_FILE || env.PURENATIVE_SIGNING_SEED_FILE;
  if (file) {
    try { return readText(file).trim() || null; } catch { return null; }
  }
  try { return readText(join(cwd, ".shipvo", "seed.txt")).trim() || null; } catch { return null; }
}

function loadShipvoConfig(deps: DoctorDeps): { cfg: ShipvoConfig | null; parseCheck: CheckResult } {
  const path = join(deps.cwd, "shipvo.json");
  if (!deps.fileExists(path)) {
    return { cfg: null, parseCheck: { name: "shipvo.json parses", ok: false, fix: "run this in your app root (or create shipvo.json with `shipvo init`)" } };
  }
  try {
    const cfg = JSON.parse(deps.readText(path)) as ShipvoConfig;
    return { cfg, parseCheck: { name: "shipvo.json parses", ok: true, fix: "none" } };
  } catch {
    return { cfg: null, parseCheck: { name: "shipvo.json parses", ok: false, fix: "fix JSON syntax in shipvo.json" } };
  }
}

export async function runDoctorChecks(overrides: Partial<DoctorDeps> = {}): Promise<CheckResult[]> {
  const deps = { ...defaultDeps(), ...overrides };
  const results: CheckResult[] = [];

  const nodeMajor = parseMajor(deps.nodeVersion);
  results.push({
    name: "Node version (>=22)",
    ok: Number.isInteger(nodeMajor) && nodeMajor >= 22,
    fix: "use Node 22 or newer (for example: `nvm use 22`)",
  });

  const { cfg, parseCheck } = loadShipvoConfig(deps);
  results.push(parseCheck);

  const signingOk = (() => {
    if (!cfg?.publicKey || typeof cfg.publicKey !== "string") return false;
    const s = resolveSeed(deps.env, deps.cwd, deps.readText);
    if (!s) return false;
    try { return pub(s) === cfg.publicKey; } catch { return false; }
  })();
  const needCfg = "fix shipvo.json first";
  results.push({ name: "signing key matches shipvo.json publicKey", ok: signingOk, fix: !cfg ? needCfg : "restore the right seed with `shipvo keys import` (or set SHIPVO_SIGNING_SEED)" });

  const skipped = "skipped, --offline";
  let controlPlaneOk = false;
  let cpFix = "check shipvo.json controlPlane and your network access (5 second timeout)";
  if (!deps.offline && cfg?.controlPlane && typeof cfg.controlPlane === "string") {
    try {
      const res = await deps.fetchFn(cfg.controlPlane.replace(/\/$/, ""), { signal: AbortSignal.timeout(5000) });
      if (res.status >= 500) cpFix = `the control plane answered HTTP ${res.status}; check its deploy and logs`;
      else controlPlaneOk = true;
    } catch {}
  }
  if (deps.offline) results.push({ name: "control plane reachable", ok: true, fix: "none", note: skipped });
  else results.push({ name: "control plane reachable", ok: controlPlaneOk, fix: !cfg ? needCfg : cpFix });

  const keyName = "signing key file is private";
  const keyPath = seedFilePath(deps.env, deps.cwd);
  if (deps.platform === "win32") {
    results.push({ name: keyName, ok: true, fix: "none", note: "skipped on Windows, file modes do not apply" });
  } else if (!keyPath) {
    results.push({ name: keyName, ok: true, fix: "none", note: "skipped, the seed comes from an environment variable" });
  } else {
    const mode = deps.fileMode(keyPath);
    if (mode === null) results.push({ name: keyName, ok: true, fix: "none", note: "skipped, no key file found" });
    else results.push({ name: keyName, ok: (mode & 0o077) === 0, fix: `run \`chmod 600 ${keyPath}\` (it is mode ${mode.toString(8).padStart(3, "0")})` });
  }

  let healthOk = false;
  let healthFix = "check shipvo.json controlPlane and your network access (5 second timeout)";
  if (!deps.offline && cfg?.controlPlane && typeof cfg.controlPlane === "string") {
    try {
      const res = await deps.fetchFn(cfg.controlPlane.replace(/\/$/, "") + "/health", { signal: AbortSignal.timeout(5000) });
      if (res.status !== 200) healthFix = `/health answered HTTP ${res.status}, expected 200; check the control plane URL and deploy`;
      else {
        try { await res.json(); healthOk = true; } catch { healthFix = "/health answered 200 but not JSON; controlPlane may point at the wrong service"; }
      }
    } catch (e) {
      healthFix = e instanceof Error && e.name === "TimeoutError" ? "/health did not answer within 5 seconds; check the URL and your network" : healthFix;
    }
  }
  if (deps.offline) results.push({ name: "control plane /health returns JSON", ok: true, fix: "none", note: skipped });
  else results.push({ name: "control plane /health returns JSON", ok: healthOk, fix: !cfg ? needCfg : healthFix });

  let hermesOk = true;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, "hermesBytecodeVersion")) {
    try {
      parseDeclared(cfg.hermesBytecodeVersion); // undefined means "not declared", which passes
    } catch {
      hermesOk = false;
    }
  }
  results.push({ name: "hermesBytecodeVersion (if present) is set", ok: hermesOk, fix: "set hermesBytecodeVersion to a positive integer or list (for example 96 or [96, 98])" });

  // Simulator checks only apply to projects that have a `sim` script.
  if (!deps.skipSim && hasSimScript(deps)) {
    const exe = deps.chromiumPath(deps.cwd);
    results.push({ name: "Playwright Chromium installed", ok: !!exe && deps.fileExists(exe), fix: chromiumFix(deps.playwrightVersion(deps.cwd)) });
    results.push({ name: `sim port ${deps.port} is free`, ok: await deps.portFree(deps.port), fix: "Stop the other process or pass --port <n>" });
  }

  return results;
}

export async function doctor(argv: string[]) {
  const a = parseArgs(argv);
  const port = a.port === undefined ? 4545 : Number(a.port);
  const offline = argv.includes("--offline");
  const skipSim = argv.includes("--skip-sim");
  const stray = argv.some((x, i) => !x.startsWith("--") && argv[i - 1] !== "--port");
  if (stray || !Number.isInteger(port) || port < 1 || port > 65535) { console.error("Usage: shipvo doctor [--port <n>] [--offline] [--skip-sim]"); process.exit(2); }
  const results = await runDoctorChecks({ port, offline, skipSim });
  for (const r of results) console.log(`${r.ok ? `PASS ${r.name}${r.note ? ` (${r.note})` : ""}` : `FAIL ${r.name} — fix: ${r.fix}`}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}
