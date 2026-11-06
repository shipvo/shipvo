// Runs the first-run path from packed tarballs, on any OS, and prints one JSON line per step.
// Usage: node scripts/first-run/cross-os.mjs --pack <dir>
//        node scripts/first-run/cross-os.mjs --tarballs <dir> [--work <dir>] [--registry <url>]
// --pack runs `pnpm pack` into <dir> for @shipvo/cli, shipvo, create-shipvo and every workspace
// @shipvo/* package they depend on (transitively), so unpublished versions install from disk.
// <dir> holds those tarballs.
// Steps: npm create shipvo myshop, npm install, npx shipvo doctor --json, npx shipvo publish --dry-run.
// Each line: {"step":"...","exit":0,"ms":123}. Stops with a non-zero exit at the first failed step.
// With --tarballs, the scaffold's package.json is edited so @shipvo/cli and shipvo come from the tarballs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  out.all = {};
  for (const n of files.filter((f) => /^shipvo-.+?-\d.*\.tgz$/.test(f)).sort()) {
    out.all[`@shipvo/${n.match(/^shipvo-(.+?)-\d/)[1]}`] = join(dir, n);
  }
  return out;
}

/** Reads every workspace package.json under packages/ and services/. Returns Map name -> { dir, deps }. */
export function workspacePackages(root) {
  const map = new Map();
  for (const group of ["packages", "services"]) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const f = join(base, d, "package.json");
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, "utf8"));
      // A private package (services/sim is also named @shipvo/sim) is never published, so it never stands in for one.
      if (j.name && !j.private) map.set(j.name, { dir: join(base, d), deps: Object.keys({ ...j.dependencies, ...j.optionalDependencies, ...j.peerDependencies }).filter((n) => n.startsWith("@shipvo/")) });
    }
  }
  return map;
}

/** Names of the roots plus every @shipvo/* workspace package they depend on, transitively. */
export function packClosure(workspace, roots = ["@shipvo/cli", "shipvo", "create-shipvo"]) {
  const seen = new Set(), todo = [...roots];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n)) continue;
    const w = workspace.get(n);
    if (!w) throw new Error(`workspace package ${n} not found`);
    seen.add(n);
    todo.push(...w.deps.filter((d) => workspace.has(d)));
  }
  return [...seen].sort();
}

/** The steps, in order. `cwd` is "work" (the parent dir) or "app" (the scaffold). */
export function stepList(tarballs) {
  // `npm create` cannot take a tarball, so tarball mode runs the same bin with `npm exec --package`.
  // Every tarball is its own --package so dependencies resolve from disk, not the registry.
  const pkgs = tarballs ? [...new Set([tarballs.create, tarballs.cli, tarballs.shipvo, ...Object.values(tarballs.all ?? {})])] : [];
  const create = tarballs ? ["exec", "--yes", ...pkgs.map((t) => `--package=${t}`), "--", "create-shipvo", APP_NAME] : ["create", "shipvo", APP_NAME];
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
  // Every other @shipvo/* tarball is an override with its file URL, so transitive deps never hit the registry.
  const others = {};
  for (const [name, path] of Object.entries(tarballs.all ?? {})) if (name !== "@shipvo/cli") others[name] = pathToFileURL(path).href;
  return { ...pkg, devDependencies: { ...(pkg.devDependencies ?? {}), "@shipvo/cli": cli, shipvo: sv }, overrides: { ...(pkg.overrides ?? {}), ...others, "@shipvo/cli": "$@shipvo/cli" } };
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

/** Packs the roots and their @shipvo/* dependencies into `dest` with pnpm (which rewrites workspace:^ to real versions). */
export function pack(dest, root = resolve(fileURLToPath(import.meta.url), "..", "..", "..")) {
  mkdirSync(dest, { recursive: true });
  const ws = workspacePackages(root);
  for (const name of packClosure(ws)) {
    const c = commandLine("pnpm", ["pack", "--pack-destination", dest]);
    const r = spawnSync(c.cmd, c.args, { cwd: ws.get(name).dir, shell: c.shell, stdio: "inherit" });
    if (r.status !== 0) { console.error(`pnpm pack failed for ${name}`); return 1; }
  }
  return 0;
}

export function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  if (opt("--pack")) return pack(resolve(opt("--pack")));
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
