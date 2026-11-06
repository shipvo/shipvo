// Times a first applied OTA of a scaffolded app on the Android emulator.
// Usage: node scripts/first-run/applied-ota.mjs --control-url http://localhost:8787 [--cli path/to/cli.js] [--out applied-ota.json] [--dry-run]
// Steps: init, install (pnpm), build apk (expo prebuild + gradle, pinned to the control plane at 10.0.2.2), adb install,
// publish release 1 and open the app, then edit src/release.ts, `shipvo publish` again and time the second publish
// ("publish") and the wait until the app's prefs show that release as current ("publish to healthy").
// "Healthy" = the runtime promoted the release to current_release (it does that after markHealthy), read with `adb run-as`.
// Needs: built CLI, a control plane at --control-url (SHIPVO_LOCAL_DEV_KEY, default sv_test_localdev), one booted emulator.
// --dry-run prints the plan and exits 0 without touching anything (no emulator needed).
// Reuses runStep, table, pickAppId and logTail from measure.mjs.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runStep, table, pickAppId } from "./measure.mjs";

export const STEPS = ["init", "install", "build apk", "adb install", "first publish", "first open", "publish", "publish to healthy"];

/** `key=value` timing marks from a log: lines like `[first-run] publish 1234ms`. Returns { step: ms } for positive whole numbers; later lines win. */
export function parseTimings(text) {
  const out = {};
  for (const m of String(text).matchAll(/^\[first-run\] (.+?) (\d+)ms\s*$/gm)) {
    const ms = Number(m[2]);
    if (ms > 0) out[m[1]] = ms;
  }
  return out;
}

/** The release number the CLI reports on its last JSON line (`{"release":N,...}`), or undefined. */
export function releaseFrom(output) {
  for (const l of String(output).split("\n").reverse()) {
    if (!l.startsWith("{")) continue;
    try { const n = JSON.parse(l).release; if (Number.isInteger(n)) return n; } catch {}
  }
  return undefined;
}

/** Integer values from an Android shared_prefs xml string. */
export function parsePrefs(xml) {
  return Object.fromEntries([...String(xml).matchAll(/<(?:int|long) name="(\w+)" value="(-?\d+)"/g)].map((m) => [m[1], Number(m[2])]));
}

/** "current" when the release is promoted, "pending" when staged, else null. */
export const reached = (prefs, release) => (prefs.current_release === release ? "current" : prefs.pending_release === release ? "pending" : null);

/** Step results from timings, in the fixed step order. A step with no timing is left out, never shown as 0 s. */
export function stepResults(timings) {
  return STEPS.filter((s) => timings[s] > 0).map((s) => ({ step: s, ms: timings[s], exit: 0 }));
}

/** The one table: step and seconds, plus the publish-to-healthy headline as its own line. */
export function report(timings, totalMs) {
  const rows = stepResults(timings);
  const h = timings["publish to healthy"];
  return table(rows, totalMs ?? rows.reduce((n, r) => n + r.ms, 0)) + (h ? `\n\npublish to healthy on the Android emulator: ${(h / 1000).toFixed(2)} s` : "\n\npublish to healthy: not measured");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timed = async (timings, name, fn) => { const t0 = performance.now(); const r = await fn(); timings[name] = Math.max(1, Math.round(performance.now() - t0)); return r; };
const run = (cmd, args, cwd, env = {}) => { const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 256 << 20 }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status ?? r.error}):\n${(r.stdout ?? "").slice(-2000)}\n${(r.stderr ?? "").slice(-2000)}`); return r.stdout; };
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", maxBuffer: 64 << 20 }).replace(/\r/g, "");

export function plan(controlUrl) {
  return STEPS.map((s, i) => `${i + 1}. ${s}`).concat([`control plane: ${controlUrl}`, "emulator reaches it at http://10.0.2.2:<port>"]).join("\n");
}

export async function main(argv) {
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const here = dirname(fileURLToPath(import.meta.url));
  const cli = resolve(opt("--cli", join(here, "../../packages/cli/dist/cli.js")));
  const out = resolve(opt("--out", "applied-ota.json"));
  const controlUrl = (opt("--control-url", "http://localhost:8787")).replace(/\/$/, "");
  if (argv.includes("--dry-run")) {
    const emu = spawnSync("adb", ["devices"], { encoding: "utf8" });
    console.log(plan(controlUrl));
    console.log(`\ndry run: nothing was run. ${emu.error ? "adb not found" : /\tdevice/.test(emu.stdout) ? "an adb device is connected" : "no adb device is connected"}.`);
    return 0;
  }
  const port = new URL(controlUrl).port || "80";
  const key = process.env.SHIPVO_LOCAL_DEV_KEY ?? "sv_test_localdev";
  const timings = {};
  const start = performance.now();
  const root = mkdtempSync(join(tmpdir(), "shipvo-applied-ota-"));
  const app = join(root, "app");
  const appId = pickAppId(), pkg = "dev.shipvo.firstrun";
  let created = false;
  try {
    if (!/\tdevice/.test(adb("devices"))) throw new Error("no booted emulator: adb devices lists none");
    const init = runStep("init", cli, ["init", app, "--app-id", appId, "--bundle-id", pkg, "--control-plane", `http://10.0.2.2:${port}`], root);
    timings.init = Math.max(1, init.ms);
    if (init.exit !== 0) throw new Error(`init failed:\n${init.stderr}`);
    const cfgPath = join(app, "shipvo.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const r = await fetch(`${controlUrl}/apps`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ app_id: appId, name: appId, public_key: cfg.publicKey }) });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 201 || !j.publish_token) throw new Error(`create app: HTTP ${r.status}`);
    created = true;
    const env = { SHIPVO_PUBLISH_TOKEN: j.publish_token, CI: "1" };
    await timed(timings, "install", () => run("pnpm", ["install"], app));
    await timed(timings, "build apk", () => {
      run("npx", ["expo", "prebuild", "-p", "android", "--no-install", "--clean"], app, { CI: "1" });
      const man = join(app, "android/app/src/main/AndroidManifest.xml");
      writeFileSync(man, readFileSync(man, "utf8").replace("<application ", '<application android:usesCleartextTraffic="true" android:debuggable="true" '));
      run("./gradlew", ["assembleRelease", "-x", "lintVitalRelease", "-PreactNativeArchitectures=x86_64", "--no-daemon"], join(app, "android"));
    });
    const apkDir = join(app, "android/app/build/outputs/apk/release");
    const apk = join(apkDir, readdirSync(apkDir).find((f) => f.endsWith(".apk")));
    await timed(timings, "adb install", () => { try { adb("uninstall", pkg); } catch {} if (!/Success/.test(adb("install", "-r", apk))) throw new Error("adb install failed"); });
    // The control plane is reached by the host at controlUrl; the shell at 10.0.2.2. Publish from the host.
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, controlPlane: controlUrl }, null, 2) + "\n");
    const publish = (label) => new Promise((done) => {
      const t0 = performance.now(), buf = [];
      const c = spawn(process.execPath, [cli, "publish", "--skip-web", "true", "--platform", "android", "--bands", "b0"], { cwd: app, env: { ...process.env, ...env } });
      c.stdout.on("data", (d) => buf.push(String(d))); c.stderr.on("data", (d) => buf.push(String(d)));
      c.on("close", (code) => done({ label, code: code ?? 1, ms: Math.max(1, Math.round(performance.now() - t0)), out: buf.join("") }));
    });
    const p1 = await publish("first publish");
    timings["first publish"] = p1.ms;
    if (p1.code !== 0) throw new Error(`first publish failed:\n${p1.out}`);
    const prefs = () => { try { return parsePrefs(adb("shell", `run-as ${pkg} cat shared_prefs/shipvo.runtime.xml`)); } catch { return {}; } };
    const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(250); } };
    await timed(timings, "first open", async () => {
      adb("shell", "input keyevent KEYCODE_WAKEUP"); adb("shell", `am start -W -n ${pkg}/.MainActivity`);
      if (!(await waitFor(() => prefs().current_release === releaseFrom(p1.out), 180_000))) throw new Error(`the app did not report release ${releaseFrom(p1.out)} healthy within 180 s`);
    });
    const rel = join(app, "src/release.ts");
    writeFileSync(rel, readFileSync(rel, "utf8").replace(/headline: "[^"]*"/, 'headline: "Second release"'));
    const p2 = await publish("publish");
    timings.publish = p2.ms;
    if (p2.code !== 0) throw new Error(`publish failed:\n${p2.out}`);
    const r2 = releaseFrom(p2.out);
    if (r2 === undefined) throw new Error(`publish printed no release number:\n${p2.out}`);
    const t0 = performance.now();
    if (!(await waitFor(() => reached(prefs(), r2) === "current", 180_000))) throw new Error(`release ${r2} was not healthy on the device within 180 s (prefs: ${JSON.stringify(prefs())})`);
    timings["publish to healthy"] = Math.max(1, Math.round(performance.now() - t0));
    const total = Math.round(performance.now() - start);
    writeFileSync(out, JSON.stringify({ steps: stepResults(timings), totalMs: total, device: { api: adb("shell", "getprop ro.build.version.sdk").trim(), abi: adb("shell", "getprop ro.product.cpu.abi").trim(), fingerprint: adb("shell", "getprop ro.build.fingerprint").trim() } }, null, 2) + "\n");
    console.log(report(timings, total));
    return 0;
  } catch (e) {
    console.error(e.message);
    if (Object.keys(timings).length) console.error("\ncompleted steps:\n" + report(timings));
    return 1;
  } finally {
    if (created) await fetch(`${controlUrl}/apps/${appId}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
