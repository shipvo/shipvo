// Times a new developer's first run: `shipvo init`, `shipvo doctor --offline --skip-sim`, then `shipvo publish --dry-run`.
// Usage: node scripts/first-run/measure.mjs [--cli path/to/cli.js] [--out first-run.json] [--with-install] [--with-session] [--control-url <url>] [--apply-report android-e2e-report.json]
// Against a local control plane (docker compose up, or wrangler dev):
//   node scripts/first-run/measure.mjs --control-url http://localhost:8787
// With --control-url, after the dry run it registers the scaffolded app with the local dev key
// (SHIPVO_LOCAL_DEV_KEY, default sv_test_localdev), points shipvo.json "controlPlane" at the URL, runs a real
// `shipvo publish`, then GETs the pointer and checks it is signed and names the release just published.
// Steps recorded: "publish" (real), "pointer" and "bundle" (fetches the bundle the pointer names; checks signature, size and sha256). A non-2xx publish exits 1 and prints the server's message.
// With --with-install --with-session, a "first agent session" step then starts `shipvo sim` for the scaffolded app (its web build
// counts), opens the app with @shipvo/test, reads the screen and stops the simulator. Needs playwright's chromium.
// --template <name>: blank (default), shop or content, passed to `shipvo init`.
// --with-test (needs --with-install): runs the scaffold's own generated test (`npm test`) against `shipvo sim`, as step "app test". A failing test exits 1 and prints its output.
// The CLI must be built first (pnpm --filter @shipvo/cli build). No login, no secrets.
// Default run uses no network. With --with-install, also times an install in the scaffolded app,
// which downloads packages (network). init prints `npm install (or pnpm / bun)`; we prefer pnpm
// when it is on PATH, so the recorded number is quoted honestly.
// Prints one table (step, seconds) and a total (wall time). The JSON keeps milliseconds and ends with a "total" row.
// A failed step prints its output and exits 1. Nothing is recorded as 0 s for a step that did not run.
// Full path on a clean Linux runner (no secrets), after `pnpm --filter @shipvo/cli build`:
//   node scripts/first-run/measure.mjs --with-install --with-export --control-url http://localhost:8787
// --control-log <file>: the file the local control plane writes its log to. If the real publish fails, the last 20 lines
// of that file are added to the failure output, so a failed run shows what the server saw (or that it saw nothing).
// --with-export (needs --with-install and --control-url) runs the real bundle export (`expo export`) inside the
// real `shipvo publish`, so "publish" includes the export. Without it, a small plain-JS bundle is staged where
// the export would write it, and publish runs with --skip-export.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createPublicKey, createHash, verify } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function runStep(name, cli, args, cwd) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: cleanEnv() });
  const ms = Math.round(performance.now() - t0);
  const exit = r.status ?? (r.error ? 127 : 1);
  return { step: name, ms, exit, stderr: [r.stdout, r.stderr, r.error ? String(r.error) : ""].filter(Boolean).join("\n") };
}

function runStepAsync(name, cli, args, cwd, extraEnv) {
  return new Promise((done) => {
    const t0 = performance.now();
    const out = [];
    const c = spawn(process.execPath, [cli, ...args], { cwd, env: { ...cleanEnv(), ...extraEnv } });
    c.stdout.on("data", (d) => out.push(String(d)));
    c.stderr.on("data", (d) => out.push(String(d)));
    c.on("error", (e) => { out.push(String(e)); done({ step: name, ms: Math.round(performance.now() - t0), exit: 127, stderr: out.join("\n") }); });
    c.on("close", (code) => done({ step: name, ms: Math.round(performance.now() - t0), exit: code ?? 1, stderr: out.join("") }));
  });
}

const devKey = () => process.env.SHIPVO_LOCAL_DEV_KEY ?? "sv_test_localdev";

/** A fresh app id for the measured app. The scaffold's own id ("app") is reserved by the control plane. */
export function pickAppId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `first-run-${id}`;
}

/** The last `n` lines of the control plane log, ready to append to a failure message. */
export function logTail(file, n = 20) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { return `\n(control plane log ${file} could not be read: ${e.code ?? e.message})`; }
  const lines = text.split("\n"); if (lines[lines.length - 1] === "") lines.pop();
  return `\n--- last ${Math.min(n, lines.length)} lines of the control plane log (${file}) ---\n${lines.slice(-n).join("\n")}`;
}

/**
 * Fetches the bundle the pointer names and checks it the way a shell does: the pointer signature first, then the
 * size and sha256 the signed body promises. A phone would refuse the update on any mismatch.
 */
export async function bundleStep(base, env, body, key) {
  const t0 = performance.now();
  const res = (exit, msg) => ({ step: "bundle", ms: Math.round(performance.now() - t0), exit, stderr: msg });
  try {
    if (!verify(null, Buffer.from(env.body), key, Buffer.from(env.signature, "base64"))) return res(1, "bundle: pointer signature does not verify, so its hash cannot be trusted");
    const core = body.core;
    if (!core || typeof core.url !== "string" || typeof core.sha256 !== "string") return res(1, "bundle: pointer has no core.url and core.sha256");
    const r = await fetch(`${base}/${core.url.replace(/^\//, "")}`);
    if (!r.ok) return res(1, `bundle: GET ${core.url} returned HTTP ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (typeof core.size === "number" && bytes.length !== core.size) return res(1, `bundle: ${core.url} is ${bytes.length} bytes, the signed pointer says ${core.size}`);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== core.sha256) return res(1, `bundle: ${core.url} has sha256 ${sha}, the signed pointer says ${core.sha256}`);
    return res(0, "");
  } catch (e) { return res(1, `bundle: ${e.message}`); }
}

/** Real publish against a control plane, then check the pointer it serves. Returns the steps to record. */
async function realPublish(cli, app, controlUrl, withExport, controlLog) {
  const base = controlUrl.replace(/\/$/, "");
  const cfgPath = join(app, "shipvo.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.appId = pickAppId();
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  const fail = (step, ms, stderr) => ({ step, ms, exit: 1, stderr });
  let token;
  try {
    const r = await fetch(`${base}/apps`, { method: "POST", headers: { authorization: `Bearer ${devKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ app_id: cfg.appId, name: cfg.appId, public_key: cfg.publicKey }) });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch {}
    if (r.status !== 201 || !j?.publish_token) return [fail("app create", 0, `create app: HTTP ${r.status} ${text}`)];
    token = j.publish_token;
  } catch (e) { return [fail("app create", 0, `create app: ${e.cause?.code ?? e.message}`)]; }
  try {
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, controlPlane: base }, null, 2) + "\n");
    const pub = await runStepAsync(withExport ? "publish (includes export)" : "publish", cli, ["publish", ...(withExport ? [] : ["--skip-export", "true"]), "--skip-web", "true", "--platform", "android", "--bands", "b0"], app, { SHIPVO_PUBLISH_TOKEN: token });
    if (pub.exit !== 0) return [controlLog ? { ...pub, stderr: pub.stderr + logTail(controlLog) } : pub];
    const t0 = performance.now();
    const pointer = (exit, msg) => ({ step: "pointer", ms: Math.round(performance.now() - t0), exit, stderr: msg });
    let released;
    try { released = JSON.parse(pub.stderr.trim().split("\n").filter((l) => l.startsWith("{")).pop()).release; } catch {}
    try {
      const r = await fetch(`${base}/p/${cfg.appId}/${cfg.shellMajor ?? 1}/b0`);
      const text = await r.text();
      if (!r.ok) return [pub, pointer(1, `pointer: HTTP ${r.status} ${text}`)];
      const env = JSON.parse(text);
      const raw = Buffer.from(cfg.publicKey, "base64");
      const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
      if (typeof env.body !== "string" || typeof env.signature !== "string" || !verify(null, Buffer.from(env.body), key, Buffer.from(env.signature, "base64"))) return [pub, pointer(1, "pointer: response is not signed with the app's key")];
      const body = JSON.parse(env.body);
      if (body.app_id !== cfg.appId || released === undefined || body.release !== released) return [pub, pointer(1, `pointer names release ${body.release} of ${body.app_id}, expected release ${released} of ${cfg.appId}`)];
      return [pub, pointer(0, ""), await bundleStep(base, env, body, key)];
    } catch (e) { return [pub, pointer(1, `pointer: ${e.message}`)]; }
  } finally {
    await fetch(`${base}/apps/${cfg.appId}`, { method: "DELETE", headers: { authorization: `Bearer ${devKey()}` } }).catch(() => {});
  }
}

const STEP_BROWSER = "browser install";

/** Installs the Chromium that the scaffold's own playwright wants, so the session step finds the matching revision. */
export function installBrowser(app, spawnFn = spawnSync) {
  const t0 = performance.now();
  const r = spawnFn("npx", ["playwright", "install", "chromium"], { cwd: app, encoding: "utf8", env: cleanEnv() });
  const exit = r.status ?? (r.error ? 127 : 1);
  return { step: STEP_BROWSER, ms: Math.round(performance.now() - t0), exit, stderr: [r.stdout, r.stderr, r.error ? String(r.error) : ""].filter(Boolean).join("\n") };
}

const STEP_SESSION = "first agent session";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}

// Runs in the scaffolded app: open the app through @shipvo/test and read the first screen.
// Uses the app's own @shipvo/test; falls back to the one built in this repo.
const sessionScript = (fallback) => `
import { createRequire } from "node:module";
const req = createRequire(process.cwd() + "/package.json");
let mod; try { mod = await import(req.resolve("@shipvo/test")); } catch { mod = await import(${JSON.stringify(fallback)}); }
const phone = await mod.openApp({ sim: process.env.FIRST_RUN_SIM });
if (!phone.screen.trim()) { console.error("the simulator returned an empty screen"); process.exit(1); }
console.log("screen: " + phone.screen.split("\\n").length + " lines");
`;

function runNode(args, cwd, env, timeout) {
  return new Promise((done) => {
    const out = [];
    const c = spawn(process.execPath, args, { cwd, env: { ...cleanEnv(), ...env }, timeout: Math.max(Math.round(timeout), 1000) });
    c.stdout.on("data", (d) => out.push(String(d)));
    c.stderr.on("data", (d) => out.push(String(d)));
    c.on("error", (e) => done({ exit: 127, out: String(e) }));
    c.on("close", (code) => done({ exit: code ?? 1, out: out.join("") }));
  });
}

/** Starts `shipvo sim` for the app, waits for it, runs fn(url, remainingMs), then stops it. Returns a step result. */
async function withSim(name, cli, app, timeoutMs, fn) {
  const t0 = performance.now();
  const done = (exit, stderr) => ({ step: name, ms: Math.round(performance.now() - t0), exit, stderr });
  let port;
  try { port = await freePort(); } catch (e) { return done(1, `no free port: ${e.message}`); }
  const url = `http://127.0.0.1:${port}`;
  const out = [];
  const simProc = spawn(process.execPath, [cli, "sim", "--port", String(port)], { cwd: app, env: cleanEnv(), detached: true });
  let exited = false;
  simProc.stdout.on("data", (d) => out.push(String(d)));
  simProc.stderr.on("data", (d) => out.push(String(d)));
  simProc.on("error", (e) => { out.push(String(e)); exited = true; });
  simProc.on("exit", () => { exited = true; });
  try {
    let up = false;
    while (!up && !exited && performance.now() - t0 < timeoutMs) {
      up = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
      if (!up) await sleep(200);
    }
    if (!up) return done(1, `simulator did not start${exited ? " (it exited)" : " in time"}:\n${out.join("")}`);
    const r = await fn(url, timeoutMs - (performance.now() - t0));
    return done(r.exit, r.exit === 0 ? "" : `${r.out}\n${out.join("")}`);
  } finally {
    if (!exited) {
      const gone = new Promise((r) => simProc.once("exit", r));
      try { process.kill(-simProc.pid, "SIGTERM"); } catch { simProc.kill("SIGTERM"); }
      await Promise.race([gone, sleep(5000)]);
    }
  }
}

/**
 * Times a first agent session in the scaffolded app: start `shipvo sim` (its web build counts), open the app
 * with @shipvo/test and read the screen. Needs the app's dependencies installed. Stops the simulator after.
 */
export function firstAgentSession(cli, app, timeoutMs = 300000) {
  const fallback = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/test/dist/index.js")).href;
  return withSim(STEP_SESSION, cli, app, timeoutMs, (url, left) => runNode(["--input-type=module", "-e", sessionScript(fallback)], app, { FIRST_RUN_SIM: url }, left));
}

export const STEP_TEST = "app test";

/**
 * Runs the scaffolded app's own generated test (`npm test`, which is vitest) against a running simulator.
 * A failing test makes the step fail and its output is kept for the report.
 */
export function appTest(cli, app, timeoutMs = 300000) {
  return withSim(STEP_TEST, cli, app, timeoutMs, (url, left) => new Promise((done) => {
    const out = [];
    const c = spawn(detectPackageManager(), ["run", "test"], { cwd: app, env: { ...cleanEnv(), PN_SIM: url, CI: "1" }, timeout: Math.max(Math.round(left), 1000) });
    c.stdout.on("data", (d) => out.push(String(d)));
    c.stderr.on("data", (d) => out.push(String(d)));
    c.on("error", (e) => done({ exit: 127, out: String(e) }));
    c.on("close", (code) => done({ exit: code ?? 1, out: out.join("") }));
  }));
}

// No secrets in, nothing to log in to: the seed comes from the .shipvo/seed.txt that init writes.
export function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/SIGNING_SEED|TOKEN|SHIPVO_API|CLOUDFLARE/i.test(k)) delete e[k];
  return e;
}

function detectPackageManager() {
  const v = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (!v.error && v.status === 0) return "pnpm";
  return "npm";
}

export function runInstallStep(cwd) {
  const pm = detectPackageManager();
  const t0 = performance.now();
  const r = spawnSync(pm, ["install"], { cwd, encoding: "utf8", env: cleanEnv() });
  const ms = Math.round(performance.now() - t0);
  const exit = r.status ?? (r.error ? 127 : 1);
  const v = spawnSync(pm, ["--version"], { encoding: "utf8" });
  const version = (v.stdout || "").trim();
  return { step: "install", ms, exit, stderr: [r.stdout, r.stderr, r.error ? String(r.error) : ""].filter(Boolean).join("\n"), pm, version };
}

const secs = (ms) => (ms / 1000).toFixed(2);

/** One table: step and seconds, then the total. `totalMs` is wall time; it defaults to the sum of the steps. */
export function table(results, totalMs = results.reduce((n, r) => n + r.ms, 0)) {
  return ["| step | seconds |", "| --- | ---: |", ...results.map((r) => `| ${r.step} | ${secs(r.ms)} |`), `| total | ${secs(totalMs)} |`].join("\n");
}

// withExport: run the real bundle export inside `shipvo publish` (needs install and network).
export async function measure(cli, withInstall = false, controlUrl, withExport = false, withSession = false, controlLog, template = "blank", withTest = false) {
  if (withTest && !withInstall) throw new Error("--with-test needs --with-install");
  if (withSession && !withInstall) throw new Error("--with-session needs --with-install");
  if (withExport && !(withInstall && controlUrl)) throw new Error("--with-export needs --with-install and --control-url");
  const start = performance.now();
  const root = mkdtempSync(join(tmpdir(), "shipvo-first-run-"));
  const app = join(root, "app");
  const results = [];
  try {
    results.push(runStep("init", cli, ["init", app, ...(template === "blank" ? [] : ["--template", template])], root));
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
    if (ok && !withExport) {
      const js = join(app, "dist-ota/_expo/static/js/android");
      mkdirSync(js, { recursive: true });
      writeFileSync(join(js, "index.js"), "console.log('first run');\n");
      const dry = runStep("publish --dry-run", cli, ["publish", "--dry-run", "--skip-export", "true", "--skip-web", "true", "--platform", "android", "--bands", "b0"], app);
      results.push(dry);
      ok = dry.exit === 0;
    }
    if (ok && withSession) {
      const br = installBrowser(app);
      results.push(br);
      ok = br.exit === 0;
    }
    if (ok && withSession) {
      const sess = await firstAgentSession(cli, app);
      results.push(sess);
      ok = sess.exit === 0;
    }
    if (ok && withTest) {
      const t = await appTest(cli, app);
      results.push(t);
      ok = t.exit === 0;
    }
    if (ok && controlUrl) results.push(...(await realPublish(cli, app, controlUrl, withExport, controlLog)));
  } finally { rmSync(root, { recursive: true, force: true }); }
  results.totalMs = Math.round(performance.now() - start);
  return results;
}

/** The "publish to healthy" row from an android-e2e report's `firstRun` block, or null if it is missing or not a positive number. */
export function applyRow(report) {
  const ms = report?.firstRun?.publishToHealthyMs;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const { downloadMs, applyMs } = report.firstRun;
  const ok = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);
  const row = { step: "publish to healthy (full-bundle update scenario, emulator)", ms: Math.round(ms), exit: 0 };
  if (ok(downloadMs)) row.downloadMs = Math.round(ok(downloadMs));
  if (ok(applyMs)) row.applyMs = Math.round(ok(applyMs));
  return row;
}

export async function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = resolve(opt("--cli", join(here, "../../packages/cli/dist/cli.js")));
  const out = resolve(opt("--out", "first-run.json"));
  const withInstall = argv.includes("--with-install");
  const controlUrl = opt("--control-url", undefined);
  let results;
  try { results = await measure(cli, withInstall, controlUrl, argv.includes("--with-export"), argv.includes("--with-session"), opt("--control-log", undefined), opt("--template", "blank"), argv.includes("--with-test")); }
  catch (e) { console.error(e.message); return 1; }
  const applyPath = opt("--apply-report", undefined);
  let apply = null, applyErr = false;
  if (applyPath) { try { apply = applyRow(JSON.parse(readFileSync(applyPath, "utf8"))); } catch (e) { applyErr = true; console.error(`--apply-report ${applyPath}: ${e.code === "ENOENT" ? "file not found" : e.message}`); }
    if (!apply && !applyErr) console.error(`--apply-report ${applyPath}: report has no firstRun timing (the full-bundle update scenario failed or was not run)`); }
  writeFileSync(out, JSON.stringify([...results.map(({ step, ms, exit }) => ({ step, ms, exit })), { step: "total", ms: results.totalMs, exit: results.some((r) => r.exit !== 0) ? 1 : 0 }, ...(apply ? [apply] : [])], null, 2) + "\n");
  console.log(table(results, results.totalMs));
  if (applyPath) console.log(apply ? `\npublish to healthy (full-bundle update scenario, emulator): ${secs(apply.ms)} s (not part of the total above)` : "\npublish to healthy (full-bundle update scenario, emulator): not measured");
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
