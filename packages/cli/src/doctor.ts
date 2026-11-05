import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
});

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

  let controlPlaneOk = false;
  let cpFix = "check shipvo.json controlPlane and your network access (5 second timeout)";
  if (cfg?.controlPlane && typeof cfg.controlPlane === "string") {
    try {
      const res = await deps.fetchFn(cfg.controlPlane.replace(/\/$/, ""), { signal: AbortSignal.timeout(5000) });
      if (res.status >= 500) cpFix = `the control plane answered HTTP ${res.status}; check its deploy and logs`;
      else controlPlaneOk = true;
    } catch {}
  }
  results.push({ name: "control plane reachable", ok: controlPlaneOk, fix: !cfg ? needCfg : cpFix });

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
  if (cfg?.controlPlane && typeof cfg.controlPlane === "string") {
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
  results.push({ name: "control plane /health returns JSON", ok: healthOk, fix: !cfg ? needCfg : healthFix });

  let hermesOk = true;
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, "hermesBytecodeVersion")) {
    try {
      parseDeclared(cfg.hermesBytecodeVersion); // undefined means "not declared", which passes
    } catch {
      hermesOk = false;
    }
  }
  results.push({ name: "hermesBytecodeVersion (if present) is set", ok: hermesOk, fix: "set hermesBytecodeVersion to a positive integer or list (for example 96 or [96, 98])" });

  return results;
}

export async function doctor(argv: string[]) {
  if (argv.length) { console.error("Usage: shipvo doctor"); process.exit(2); }
  const results = await runDoctorChecks();
  for (const r of results) console.log(`${r.ok ? `PASS ${r.name}${r.note ? ` (${r.note})` : ""}` : `FAIL ${r.name} — fix: ${r.fix}`}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}
