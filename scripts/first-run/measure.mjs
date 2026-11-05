// Times a new developer's first run: `shipvo init`, `shipvo doctor --offline --skip-sim`, then `shipvo publish --dry-run`.
// Usage: node scripts/first-run/measure.mjs [--cli path/to/cli.js] [--out first-run.json] [--with-install]
// The CLI must be built first (pnpm --filter @shipvo/cli build). No login, no secrets.
// Default run uses no network. With --with-install, also times an install in the scaffolded app,
// which downloads packages (network). init prints `npm install (or pnpm / bun)`; we prefer pnpm
// when it is on PATH, so the recorded number is quoted honestly.
// The bundle export (`expo export`) needs an install and network, so it is not timed: a small
// plain-JS bundle is staged where the export would write it, and publish runs with --skip-export.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function runStep(name, cli, args, cwd) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: cleanEnv() });
  const ms = Math.round(performance.now() - t0);
  const exit = r.status ?? (r.error ? 127 : 1);
  return { step: name, ms, exit, stderr: [r.stdout, r.stderr, r.error ? String(r.error) : ""].filter(Boolean).join("\n") };
}

// No secrets in, nothing to log in to: the seed comes from the .shipvo/seed.txt that init writes.
function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/SIGNING_SEED|TOKEN|SHIPVO_API|CLOUDFLARE/i.test(k)) delete e[k];
  return e;
}

function detectPackageManager() {
  const v = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (!v.error && v.status === 0) return "pnpm";
  return "npm";
}

function runInstallStep(cwd) {
  const pm = detectPackageManager();
  const t0 = performance.now();
  const r = spawnSync(pm, ["install"], { cwd, encoding: "utf8", env: cleanEnv() });
  const ms = Math.round(performance.now() - t0);
  const exit = r.status ?? (r.error ? 127 : 1);
  const v = spawnSync(pm, ["--version"], { encoding: "utf8" });
  const version = (v.stdout || "").trim();
  return { step: "install", ms, exit, stderr: r.stderr || (r.error ? String(r.error) : ""), pm, version };
}

export function table(results) {
  return ["| step | ms | exit |", "| --- | ---: | ---: |", ...results.map((r) => `| ${r.step} | ${r.ms} | ${r.exit} |`)].join("\n");
}

export function measure(cli, withInstall = false) {
  const root = mkdtempSync(join(tmpdir(), "shipvo-first-run-"));
  const app = join(root, "app");
  const results = [];
  try {
    results.push(runStep("init", cli, ["init", app], root));
    let ok = results[0].exit === 0;
    if (ok && withInstall) {
      const inst = runInstallStep(app);
      results.push(inst);
      ok = inst.exit === 0;
    }
    if (ok) {
      const doc = runStep("doctor", cli, ["doctor", "--offline", "--skip-sim"], app);
      results.push(doc);
      ok = doc.exit === 0;
    }
    if (ok) {
      const js = join(app, "dist-ota/_expo/static/js/android");
      mkdirSync(js, { recursive: true });
      writeFileSync(join(js, "index.js"), "console.log('first run');\n");
      results.push(runStep("publish --dry-run", cli, ["publish", "--dry-run", "--skip-export", "true", "--skip-web", "true", "--platform", "android", "--bands", "b0"], app));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  return results;
}

export function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = resolve(opt("--cli", join(here, "../../packages/cli/dist/cli.js")));
  const out = resolve(opt("--out", "first-run.json"));
  const withInstall = argv.includes("--with-install");
  const results = measure(cli, withInstall);
  writeFileSync(out, JSON.stringify(results.map(({ step, ms, exit }) => ({ step, ms, exit })), null, 2) + "\n");
  console.log(table(results));
  if (withInstall) {
    const inst = results.find((r) => r.step === "install");
    const pm = inst?.pm;
    const ver = inst?.version;
    console.log(`package manager: ${pm} ${ver}`);
  }
  const bad = results.filter((r) => r.exit !== 0);
  for (const r of bad) console.error(`\nstep "${r.step}" failed with exit ${r.exit}:\n${r.stderr}`);
  return bad.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
