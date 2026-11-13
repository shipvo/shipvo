#!/usr/bin/env node
// Busy-apply harness (#1523): applies a staged update N times while the JS thread is busy, on the Android emulator or
// the iOS Simulator, and checks that a native module's global state (set in init, cleared in invalidate) is still set
// after every reload.
//   node scripts/busy-apply/run.mjs --platform android|ios --applies 50 --out <file.json> [--port 8120] [--timeout-s 120]
// Needs the CLI built (`pnpm --filter "@shipvo/cli..." build`), one booted emulator (Android, adb) or macOS with Xcode (iOS).
// It builds apps/tide-and-tackle with the native module from ./native copied in, and restores the app files afterwards.
// Writes {"platform","applies","crashes","reloadMs":[...],"emptyModuleState":<n>} plus "timeouts" and "completed".
// reloadMs: from the runtime's "staged" telemetry to the first state report of the new load, on the server's clock.
// Exit codes: 0 clean, 1 module state was empty after a reload, 2 crash or timeout, 3 setup error.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../../packages/cli/dist/index.js";
import { startServer } from "../android-e2e/server.mjs";
import { publishRelease } from "../android-e2e/release.mjs";
import { parseLog, telemetry } from "../android-e2e/lib.mjs";
import { buildResult, busySnippet, exitCode, parseArgs, reloadMs, stateReports } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, "../..");
const APP_DIR = join(ROOT, "apps/tide-and-tackle"), APP = "busy", PKG = "dev.shipvo.tide";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "inherit"], ...o });
async function waitFor(fn, ms, step = 250) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(3); }
const { platform, applies, out, port, timeoutMs } = opts;
const WORK = `/tmp/busy-apply-${platform}`, TREE = join(WORK, "tree"), LOG = join(WORK, "server.log");
rmSync(WORK, { recursive: true, force: true }); mkdirSync(TREE, { recursive: true }); writeFileSync(LOG, "");
const seed = b64(randomBytes(32)), publicKey = b64(keyFromSeed(seed).publicKey);
const baseUrl = platform === "android" ? `http://10.0.2.2:${port}` : `http://localhost:${port}`;

// ---- build the app with the native module and the busy snippet; app files are restored afterwards ----
const files = ["app.json", "index.ts"].map((f) => [join(APP_DIR, f), readFileSync(join(APP_DIR, f), "utf8")]);
const MODULE_DIR = join(APP_DIR, "modules/busy-state"), hadModules = existsSync(join(APP_DIR, "modules"));
const restore = () => { for (const [f, c] of files) writeFileSync(f, c); rmSync(MODULE_DIR, { recursive: true, force: true }); if (!hadModules) rmSync(join(APP_DIR, "modules"), { recursive: true, force: true }); };
const setTag = (tag) => writeFileSync(join(APP_DIR, "index.ts"), files[1][1] + busySnippet({ baseUrl, tag }));
const exportBundle = (tag) => {
  setTag(tag);
  const dir = join(WORK, "x-" + tag);
  run("npx", ["expo", "export", "--platform", platform, "--output-dir", dir, "--clear"], { cwd: APP_DIR });
  const js = join(dir, "_expo/static/js", platform), f = readdirSync(js).find((x) => x.endsWith(".hbc"));
  const bytes = new Uint8Array(readFileSync(join(js, f))), file = join(WORK, `bundle-${tag}.hbc`); writeFileSync(file, bytes);
  return { bytes, file };
};
let bundles, installTarget, bundleId = PKG;
try {
  cpSync(join(HERE, "native"), MODULE_DIR, { recursive: true });
  const j = JSON.parse(files[0][1]), p = j.expo.plugins.find((x) => Array.isArray(x) && x[0] === "@shipvo/runtime");
  p[1] = { ...p[1], baseUrl, publicKey, appId: APP, shellMajor: 1 };
  writeFileSync(join(APP_DIR, "app.json"), JSON.stringify(j, null, 2));
  setTag("E"); // the embedded bundle also reports
  if (platform === "android") {
    run("npx", ["expo", "prebuild", "-p", "android", "--no-install", "--clean"], { cwd: APP_DIR, env: { ...process.env, CI: "1" } });
    const man = join(APP_DIR, "android/app/src/main/AndroidManifest.xml");
    writeFileSync(man, readFileSync(man, "utf8").replace("<application ", '<application android:usesCleartextTraffic="true" '));
    run("./gradlew", ["assembleRelease", "-x", "lintVitalRelease", "-PreactNativeArchitectures=x86_64", "--no-daemon"], { cwd: join(APP_DIR, "android") });
    const d = join(APP_DIR, "android/app/build/outputs/apk/release");
    installTarget = join(d, readdirSync(d).find((x) => x.endsWith(".apk")));
  } else {
    run("npx", ["expo", "prebuild", "-p", "ios", "--no-install", "--clean"], { cwd: APP_DIR, env: { ...process.env, CI: "1" } });
    run("pod", ["install"], { cwd: join(APP_DIR, "ios") });
    const ws = readdirSync(join(APP_DIR, "ios")).find((x) => x.endsWith(".xcworkspace"));
    run("xcodebuild", ["-workspace", ws, "-scheme", ws.replace(".xcworkspace", ""), "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", "build", "CODE_SIGNING_ALLOWED=NO", "build"], { cwd: join(APP_DIR, "ios") });
    const d = join(APP_DIR, "ios/build/Build/Products/Release-iphonesimulator");
    installTarget = join(d, readdirSync(d).find((x) => x.endsWith(".app")));
    bundleId = run("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleIdentifier", join(installTarget, "Info.plist")]).trim();
  }
  bundles = { A: exportBundle("A"), B: exportBundle("B") };
} catch (e) { console.error("setup failed:", e.message); restore(); process.exit(3); }
restore();

// ---- device ----
let udid;
const adb = (...a) => run("adb", a);
const sh = (c) => adb("shell", c).replace(/\r/g, "");
const simctl = (...a) => run("xcrun", ["simctl", ...a]);
if (platform === "ios") {
  udid = process.env.SIM_UDID || simctl("list", "devices", "booted").match(/\(([0-9A-F-]{36})\) \(Booted\)/)?.[1];
  if (!udid) {
    const rt = simctl("list", "runtimes", "available").split("\n").filter((l) => /iOS/i.test(l)).pop()?.match(/com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+/)?.[0];
    const dev = simctl("list", "devicetypes").match(/com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-1[0-9][-A-Za-z]*/)?.[0];
    udid = simctl("create", "busy-apply", dev, rt).trim(); simctl("boot", udid); simctl("bootstatus", udid, "-b");
  }
}
const pid = () => {
  try {
    if (platform === "android") return sh(`pidof ${PKG}`).trim() || null;
    const m = run("xcrun", ["simctl", "spawn", udid, "launchctl", "list"]).split("\n").find((l) => l.includes(bundleId));
    const n = m?.trim().split(/\s+/)[0]; return n && n !== "-" ? n : null;
  } catch { return null; } // pidof exits 1 when the process is gone
};
const launch = () => {
  if (platform === "android") { sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard"); sh(`am start -W -n ${PKG}/.MainActivity`); }
  else simctl("launch", udid, bundleId);
};
if (platform === "android") { try { adb("uninstall", PKG); } catch {} adb("install", "-r", installTarget); sh("svc power stayon true"); }
else { try { simctl("uninstall", udid, bundleId); } catch {} simctl("install", udid, installTarget); }

// ---- server and applies ----
await startServer(TREE, port, LOG);
const tele = () => telemetry(parseLog(readFileSync(LOG, "utf8")));
const publish = (release, { bytes, file }) => {
  if (platform === "android") return publishRelease({ root: TREE, app: APP, seed, release, bytes }).at;
  run("node", [join(ROOT, "scripts/ios-e2e/make-release.mjs"), TREE, APP, seed, String(release), file]); return Date.now();
};
const bootAndWait = async () => { const t0 = Date.now(); launch(); return !!(await waitFor(() => tele().some((e) => e.event === "busy_state" && e.at >= t0), timeoutMs)); };
const samples = [];
if (!(await bootAndWait())) { console.error("the app did not report its state after install"); process.exit(3); }
let lastPid = pid();
for (let i = 1; i <= applies; i++) {
  const at = publish(i, i % 2 ? bundles.A : bundles.B);
  const reached = await waitFor(() => stateReports(tele(), i, at).reports >= 2, timeoutMs);
  const r = stateReports(tele(), i, at), now = pid();
  const crashed = !now || now !== lastPid;
  const staged = tele().find((e) => e.at >= at && e.bytes_downloaded !== undefined && e.published_at)?.at ?? null;
  if (r.missing) { console.error("the BusyState native module is not in the build"); process.exit(3); }
  samples.push({ reloadMs: reloadMs(staged, r.firstAt), empty: r.empty, crashed, timedOut: !reached && !crashed });
  console.log(`apply ${i}/${applies}: reports=${r.reports} empty=${r.empty} reloadMs=${samples.at(-1).reloadMs}${crashed ? " CRASH" : ""}${reached ? "" : " TIMEOUT"}`);
  if (crashed && !(await bootAndWait())) break;
  lastPid = pid();
}
const result = buildResult(platform, applies, samples);
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
process.exit(exitCode(result));
