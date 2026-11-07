// Times `shipvo run android` and `shipvo run ios` on a scaffolded app (one after the other): process start, server listening, phone page ready, first tap done.
// Usage: node scripts/first-run/run-time.mjs [--cli path/to/cli.js] [--template blank] [--out run-time.json] [--timeout 120] [--with-install]
// "Phone page ready" means the page answers and the frame reports the app loaded (a `tree` request on the agent channel succeeds).
// The tap goes through the same agent channel `shipvo run` serves (.shipvo/run.json gives the port and token).
// Install time is not part of the numbers; --with-install installs the scaffold first (network). The page is opened with
// playwright's chromium, resolved from packages/sim. The CLI must be built. No login, no secrets.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv, runInstallStep, runStep, sleep } from "./measure.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** The URL from the line `shipvo run` prints when it listens, or null. */
export function parseListening(text) {
  const m = /phone at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text);
  return m ? m[1] : null;
}

/** A ref to tap in a tree: the first button, link or tab, else the first ref of any kind. Null if the tree has none. */
export function firstTapRef(tree) {
  const lines = String(tree).split("\n");
  const pick = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m[1]; } return null; };
  return pick(/^\s*- (?:button|link|tab)\b.*\[ref=(e\d+)\]/) ?? pick(/\[ref=(e\d+)\]/);
}

const secs = (ms) => (ms / 1000).toFixed(2);

/** Rows for the four timings. `t` holds absolute ms stamps from one clock: start, listening, ready, tapped. */
export function timings(t) {
  const rel = (k) => Math.round(t[k] - t.start);
  return [
    { step: "start (process spawned)", ms: 0 },
    { step: "server listening", ms: rel("listening") },
    { step: "phone page ready (app loaded)", ms: rel("ready") },
    { step: "first tap done", ms: rel("tapped") },
  ];
}

export function table(rows) {
  return ["| step | seconds since start |", "| --- | ---: |", ...rows.map((r) => `| ${r.step} | ${secs(r.ms)} |`)].join("\n");
}

/** One table with an Android and an iOS column. `byPlatform` is { android: rows, ios: rows } from `timings`. */
export function tableBoth(byPlatform) {
  const { android, ios } = byPlatform;
  return ["| step | Android (seconds since start) | iOS (seconds since start) |", "| --- | ---: | ---: |",
    ...android.map((r, i) => `| ${r.step} | ${secs(r.ms)} | ${secs(ios[i].ms)} |`)].join("\n");
}

/** Minimal request/reply client for the driver side of the agent channel. */
function driverClient(port, token, WS = globalThis.WebSocket) {
  const ws = new WS(`ws://127.0.0.1:${port}/__shipvo/agent?role=driver&token=${encodeURIComponent(token)}`);
  const waiting = new Map();
  let id = 0;
  const opened = new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("agent channel refused the connection")); });
  ws.onmessage = (e) => { try { const m = JSON.parse(String(e.data)); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch { /* ignore */ } };
  const request = (type, extra = {}, ms = 5000) => new Promise((ok) => {
    const n = ++id;
    const timer = setTimeout(() => { waiting.delete(n); ok({ ok: false, error: `no reply to ${type} in ${ms} ms` }); }, ms);
    waiting.set(n, (m) => { clearTimeout(timer); ok(m); });
    ws.send(JSON.stringify({ id: n, type, ...extra }));
  });
  return { opened, request, close: () => ws.close() };
}

/** Opens the phone page in chromium (playwright from packages/sim). Returns a closer. */
async function openPage(url) {
  const req = createRequire(resolve(here, "../../packages/sim/package.json"));
  let pw;
  try { pw = req("playwright"); } catch { try { pw = req("playwright-core"); } catch { throw new Error("playwright is not installed (looked in packages/sim). Run pnpm install."); } }
  let browser;
  try { browser = await pw.chromium.launch(); }
  catch (e) { throw new Error(`chromium could not start: ${String(e.message).split("\n")[0]}. Install it with: npx playwright install chromium`); }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url, { waitUntil: "load" });
  return () => browser.close();
}

/**
 * Starts `shipvo run <platform> --no-open` in `app` and times it. Throws a plain message if a stage does not finish in `timeoutMs`
 * (the whole run, from start). `open(url)` opens the page and `drive(port, token)` returns {request, close}; both can be faked in tests.
 */
export async function measureRun({ cli, app, platform = "android", timeoutMs = 120000, now = () => performance.now(), open = openPage, drive = (p, t) => driverClient(p, t), poll = 200 }) {
  const t = { start: now() };
  const out = [];
  // spawn directly (not the CLI helper): we need the live child and its streams to stamp the ready line and stop the process group.
  const child = spawn(process.execPath, [cli, "run", platform, "--no-open"], { cwd: app, env: cleanEnv(), detached: process.platform !== "win32" });
  let exited = null;
  const sink = (d) => { out.push(String(d)); if (t.listening === undefined && parseListening(out.join(""))) t.listening = now(); };
  child.stdout.on("data", sink);
  child.stderr.on("data", sink);
  child.on("error", (e) => { out.push(String(e)); exited = 127; });
  child.on("exit", (c) => { exited = c ?? 1; });
  const left = () => timeoutMs - (now() - t.start);
  const fail = (what) => new Error(`${what}${exited !== null ? ` (shipvo run exited with ${exited})` : ` within ${Math.round(timeoutMs / 1000)} s`}.\n${out.join("").trim()}`);
  let closePage, driver;
  try {
    while (t.listening === undefined) {
      if (exited !== null || left() <= 0) throw fail("shipvo run never started listening");
      await sleep(poll);
    }
    const url = parseListening(out.join(""));
    const port = Number(new URL(url).port);
    // The page must answer before we open it; then wait for the frame to report the app loaded.
    for (;;) {
      if (exited !== null || left() <= 0) throw fail("the phone page never answered");
      if (await fetch(url, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false)) break;
      await sleep(poll);
    }
    const token = JSON.parse(readFileSync(join(app, ".shipvo", "run.json"), "utf8")).token;
    closePage = await open(url);
    driver = drive(port, token);
    await driver.opened;
    let tree;
    for (;;) {
      if (exited !== null || left() <= 0) throw fail("the phone page never reported the app loaded");
      const r = await driver.request("tree", {}, Math.max(1000, Math.min(5000, left())));
      // A blank first frame has a body but no refs, so keep polling until something is tappable.
      if (r.ok && r.tree && firstTapRef(r.tree) !== null) { tree = r.tree; break; }
      await sleep(poll);
    }
    t.ready = now();
    const ref = firstTapRef(tree);
    const tap = await driver.request("tap", { ref });
    if (!tap.ok) throw new Error(`the tap on ${ref} failed: ${tap.error}`);
    t.tapped = now();
    return timings(t);
  } finally {
    try { driver?.close(); } catch { /* already closed */ }
    try { await closePage?.(); } catch { /* already closed */ }
    if (exited === null) {
      const gone = new Promise((r) => child.once("exit", r));
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      await Promise.race([gone, sleep(5000)]);
    }
  }
}

export async function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const cli = resolve(opt("--cli", join(here, "../../packages/cli/dist/cli.js")));
  const outFile = resolve(opt("--out", "run-time.json"));
  const template = opt("--template", "blank");
  const timeoutMs = Number(opt("--timeout", "120")) * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { console.error("--timeout must be a positive number of seconds"); return 2; }
  const root = mkdtempSync(join(tmpdir(), "shipvo-run-time-"));
  const app = join(root, "app");
  try {
    const init = runStep("init", cli, ["init", app, ...(template === "blank" ? [] : ["--template", template])], root);
    if (init.exit !== 0) { console.error(`init failed with exit ${init.exit}:\n${init.stderr}`); return 1; }
    if (argv.includes("--with-install")) {
      const inst = runInstallStep(app);
      if (inst.exit !== 0) { console.error(`install failed with exit ${inst.exit}:\n${inst.stderr}`); return 1; }
    }
    const result = {};
    for (const platform of ["android", "ios"]) {
      try { result[platform] = await measureRun({ cli, app, platform, timeoutMs }); }
      catch (e) { console.error(`shipvo run ${platform}: ${e.message}`); return 1; }
    }
    writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n");
    console.log(tableBoth(result));
    return 0;
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
