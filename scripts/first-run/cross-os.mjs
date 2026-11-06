// Runs the first-run path from packed tarballs, on any OS, and prints one JSON line per step.
// Usage: node scripts/first-run/cross-os.mjs --tarballs <dir> [--work <dir>] [--registry <url>]
// <dir> holds the output of `npm pack` for @shipvo/cli, shipvo and create-shipvo.
// Steps: npm create shipvo myshop, npm install, npx shipvo doctor --json, npx shipvo publish --dry-run.
// Each line: {"step":"...","exit":0,"ms":123}. Stops with a non-zero exit at the first failed step.
// With --tarballs, the scaffold's package.json is edited so @shipvo/cli and shipvo come from the tarballs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP_NAME = "myshop";
const PATTERNS = { cli: /^shipvo-cli-\d.*\.tgz$/, shipvo: /^shipvo-\d.*\.tgz$/, create: /^create-shipvo-\d.*\.tgz$/ };

/** Finds the three tarballs in `dir`. Throws a message naming what is missing. */
export function findTarballs(dir, files = readdirSync(dir)) {
  const out = {};
  for (const [key, re] of Object.entries(PATTERNS)) {
    const f = files.filter((n) => re.test(n)).sort().pop();
    if (!f) throw new Error(`no tarball for ${key} (${re}) in ${dir}`);
    out[key] = join(dir, f);
  }
  return out;
}

/** The steps, in order. `cwd` is "work" (the parent dir) or "app" (the scaffold). */
export function stepList(tarballs) {
  // `npm create` cannot take a tarball, so tarball mode runs the same bin with `npm exec --package`.
  const create = tarballs ? ["exec", "--yes", `--package=${tarballs.create}`, "--", "create-shipvo", APP_NAME] : ["create", "shipvo", APP_NAME];
  return [
    { name: "npm create shipvo", cwd: "work", cmd: "npm", args: create },
    { name: "npm install", cwd: "app", cmd: "npm", args: ["install"] },
    { name: "shipvo doctor --json", cwd: "app", cmd: "npx", args: ["--no-install", "shipvo", "doctor", "--json"] },
    { name: "shipvo publish --dry-run", cwd: "app", cmd: "npx", args: ["--no-install", "shipvo", "publish", "--dry-run"] },
  ];
}

/** One JSON line for a step result. */
export function jsonLine(name, exit, ms) {
  return JSON.stringify({ step: name, exit, ms: Math.round(ms) });
}

/** Points devDependencies (and an override for the transitive copy) at the tarballs so the scaffold installs the packed CLI, not the registry copy. Takes and returns a parsed package.json. */
export function withOverrides(pkg, tarballs) {
  const cli = pathToFileURL(tarballs.cli).href, sv = pathToFileURL(tarballs.shipvo).href;
  // The scaffold already depends on @shipvo/cli, so set it directly and make `shipvo` reuse it with "$".
  return { ...pkg, devDependencies: { ...(pkg.devDependencies ?? {}), "@shipvo/cli": cli, shipvo: sv }, overrides: { ...(pkg.overrides ?? {}), "@shipvo/cli": "$@shipvo/cli" } };
}

/** On Windows npm and npx are .cmd files and need a shell, so quote args that hold spaces. */
export function commandLine(cmd, args, platform = process.platform) {
  if (platform !== "win32") return { cmd, args, shell: false };
  const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  return { cmd: [cmd, ...args].map(q).join(" "), args: [], shell: true };
}

export function run(step, cwd, env) {
  const c = commandLine(step.cmd, step.args);
  const t0 = performance.now();
  const r = spawnSync(c.cmd, c.args, { cwd, env, shell: c.shell, encoding: "utf8" });
  const ms = performance.now() - t0;
  const exit = r.status ?? (r.error ? 127 : 1);
  return { exit, ms, output: [r.stdout, r.stderr, r.error ? String(r.error) : ""].filter(Boolean).join("\n") };
}

export function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const dir = opt("--tarballs"), registry = opt("--registry");
  if (!dir && !registry) { console.error("usage: cross-os.mjs --tarballs <dir> | --registry <url> [--work <dir>]"); return 2; }
  let tarballs;
  try { tarballs = dir ? findTarballs(resolve(dir)) : undefined; } catch (e) { console.error(e.message); return 2; }
  const own = !opt("--work");
  const work = own ? mkdtempSync(join(tmpdir(), "shipvo cross-os ")) : resolve(opt("--work"));
  if (!own) mkdirSync(work, { recursive: true });
  const app = join(work, APP_NAME);
  const env = { ...process.env, CI: "1", npm_config_update_notifier: "false", ...(registry ? { npm_config_registry: registry } : {}) };
  try {
    for (const step of stepList(tarballs)) {
      if (step.name === "npm install" && tarballs) {
        const p = join(app, "package.json");
        writeFileSync(p, JSON.stringify(withOverrides(JSON.parse(readFileSync(p, "utf8")), tarballs), null, 2) + "\n");
      }
      const r = run(step, step.cwd === "work" ? work : app, env);
      console.log(jsonLine(step.name, r.exit, r.ms));
      if (r.exit !== 0) { console.error(`step "${step.name}" failed with exit ${r.exit}:\n${r.output}`); return 1; }
    }
    return 0;
  } finally { if (own) rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
