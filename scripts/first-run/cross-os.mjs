// First-run check for Windows, macOS and Linux, from packed tarballs (what a user gets from npm).
// Usage: node scripts/first-run/cross-os.mjs --tarballs <dir> [--work <dir>] [--out cross-os.json]
// <dir> holds the .tgz files from `pnpm pack` of @shipvo/cli, sim, test, device, runtime, schema, store (and any other @shipvo package they need).
// The app is made in a folder whose name has a space, to catch quoting bugs. Steps (each timed, in ms):
//   init, npm install, doctor --json, sim (background) + GET /app/, publish --dry-run, run android --no-open + GET frame page.
// Needs network for `npm install`. Exits 1 at the first failed step and prints its output.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const isWin = process.platform === "win32";
const tarDir = resolve(opt("tarballs", "."));
const work = resolve(opt("work", mkdtempSync(join(tmpdir(), "shipvo first-run "))));
const outFile = opt("out", "cross-os.json");

/** Quote for cmd.exe when a shell is needed (npm, npx are .cmd shims on Windows). */
const q = (s) => (/^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '""')}"`);
const line = (cmd, args) => [cmd, ...args].map(q).join(" ");
const env = { ...process.env, CI: "1", npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false", SHIPVO_NO_AUTO_INSTALL: "1" };

const steps = [];
function fail(name, text) {
  console.error(`\nFAILED: ${name}\n${text}`);
  console.error(`\nSteps before the failure: ${JSON.stringify(steps)}`);
  writeFileSync(outFile, JSON.stringify({ os: platform(), node: process.version, ok: false, failed: name, steps }, null, 2) + "\n");
  process.exit(1);
}
function run(name, cmd, args, cwd) {
  const t0 = performance.now();
  const r = isWin ? spawnSync(line(cmd, args), { cwd, env, encoding: "utf8", shell: true }) : spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  const ms = Math.round(performance.now() - t0);
  if (r.status !== 0) fail(name, [r.signal && `killed by ${r.signal}`, r.stdout, r.stderr, r.error && String(r.error)].filter(Boolean).join("\n"));
  steps.push({ step: name, ms });
  return r.stdout;
}
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a long-running command, resolves with the child and a log getter once `ready(log)` is true. */
async function background(name, cmd, args, cwd, ready, timeoutMs = 300000) {
  const t0 = performance.now();
  const c = isWin ? spawn(line(cmd, args), { cwd, env, shell: true }) : spawn(cmd, args, { cwd, env, detached: true });
  let log = "";
  c.stdout.on("data", (d) => (log += d)); c.stderr.on("data", (d) => (log += d));
  let exited = false; c.on("exit", () => { exited = true; });
  while (!ready(log)) {
    if (exited) fail(name, `exited early\n${log}`);
    if (performance.now() - t0 > timeoutMs) { stop(c); fail(name, `timed out\n${log}`); }
    await sleep(200);
  }
  return { child: c, ms: () => Math.round(performance.now() - t0) };
}
function stop(c) {
  try { if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/t", "/f"]); else process.kill(-c.pid, "SIGTERM"); } catch { /* already gone */ }
}
async function get(name, url, mustHave) {
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok || !body.includes(mustHave)) fail(name, `GET ${url} -> ${r.status}; expected body to contain ${JSON.stringify(mustHave)}\n${body.slice(0, 500)}`);
  return body;
}

const tgz = readdirSync(tarDir).filter((f) => f.endsWith(".tgz"));
const find = (n) => { const f = tgz.find((t) => t.startsWith(`${n}-`)); if (!f) { console.error(`No tarball for ${n} in ${tarDir}`); process.exit(2); } return join(tarDir, f); };
find("shipvo-cli");
const pkgNames = tgz.filter((f) => f.startsWith("shipvo-")).map((f) => f.replace(/-\d.*$/, "").replace(/^shipvo-/, ""));

rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
console.error(`OS ${platform()} ${process.arch}, node ${process.version}, work dir "${work}"`);

// Packed tarball paths as file: specs. Overrides make npm use them for nested @shipvo/* uses too, not the registry copies.
const spec = (n) => `file:${join(tarDir, tgz.find((t) => t.startsWith(`shipvo-${n}-`))).replace(/\\/g, "/")}`;
const overrides = {};
for (const n of pkgNames) overrides[`@shipvo/${n}`] = spec(n);

// 1. Install the packed CLI with those overrides in a tool folder, then run its init (as `npx -y @shipvo/cli init myshop` would).
const tool = join(work, "tool"); mkdirSync(tool, { recursive: true });
writeFileSync(join(tool, "package.json"), JSON.stringify({ name: "tool", version: "0.0.0", private: true, dependencies: { "@shipvo/cli": overrides["@shipvo/cli"] }, overrides }, null, 2));
run("install cli", "npm", ["install", "--no-audit", "--no-fund"], tool);
const appParent = join(work, "apps"); mkdirSync(appParent);
run("init", process.execPath, [join(tool, "node_modules", "@shipvo", "cli", "dist", "cli.js"), "init", "myshop", "--name", "My Shop"], appParent);
const app = join(appParent, "myshop");

// 2. Pin the app to the packed tarballs too.
const pj = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
for (const sec of ["dependencies", "devDependencies"]) for (const k of Object.keys(pj[sec] ?? {})) if (overrides[k]) pj[sec][k] = overrides[k];
pj.overrides = { ...(pj.overrides ?? {}), ...overrides };
writeFileSync(join(app, "package.json"), JSON.stringify(pj, null, 2) + "\n");

run("npm install", "npm", ["install", "--no-audit", "--no-fund"], app);
run("playwright chromium", "npx", ["playwright", "install", "chromium"], app);

// 3. doctor --json must print JSON.
const t = performance.now();
const d = spawnSync(isWin ? line("npx", ["shipvo", "doctor", "--json", "--offline"]) : "npx", isWin ? [] : ["shipvo", "doctor", "--json", "--offline"], { cwd: app, env, encoding: "utf8", shell: isWin });
try { JSON.parse(d.stdout); } catch { fail("doctor --json", `exit ${d.status}, stdout is not JSON:\n${d.stdout}\n${d.stderr}`); }
steps.push({ step: "doctor --json", ms: Math.round(performance.now() - t), exit: d.status });

// 4. sim in the background, fetch the app page.
const simPort = await freePort();
const sim = await background("sim", "npx", ["shipvo", "sim", "--port", String(simPort)], app, (l) => l.includes(`localhost:${simPort}`));
steps.push({ step: "sim ready", ms: sim.ms() });
const t1 = performance.now();
await get("sim page", `http://127.0.0.1:${simPort}/app/`, "<");
steps.push({ step: "sim GET /app/", ms: Math.round(performance.now() - t1) });
stop(sim.child);

// 5. publish --dry-run (no network, no login).
run("publish --dry-run", "npx", ["shipvo", "publish", "--dry-run"], app);

// 6. run android --no-open, fetch the frame page.
const runPort = await freePort();
const ra = await background("run android", "npx", ["shipvo", "run", "android", "--no-open", "--port", String(runPort)], app, (l) => l.includes("Simulated Android phone at"));
steps.push({ step: "run android ready", ms: ra.ms() });
const t2 = performance.now();
await get("frame page", `http://127.0.0.1:${runPort}/`, "phone");
steps.push({ step: "run android GET /", ms: Math.round(performance.now() - t2) });
stop(ra.child);

console.log(`\nFirst run on ${platform()} (${process.arch}), node ${process.version}`);
console.log("step".padEnd(26) + "seconds");
for (const s of steps) console.log(s.step.padEnd(26) + (s.ms / 1000).toFixed(1));
writeFileSync(outFile, JSON.stringify({ os: platform(), arch: process.arch, node: process.version, ok: true, steps }, null, 2) + "\n");
process.exit(0);
