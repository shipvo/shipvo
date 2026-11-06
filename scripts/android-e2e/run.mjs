#!/usr/bin/env node
// Android device lab: runs the over-the-air scenarios on the booted emulator and writes android-e2e-report.json.
//   node run.mjs --apk shell.apk --bundles dir --key key.json [--port 8110] [--trials 3] [--patch-trials 5] [--out android-e2e-report.json]
// bundles dir: v1.hbc .. v10.hbc and crash.hbc (make-bundles.sh). key.json: { seed, publicKey } (keygen.mjs of ios-e2e).
// The release server runs in this process, so "pointer published" and "device reported healthy" use one clock.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { startServer } from "./server.mjs";
import { publishRelease } from "./release.mjs";
import { FULL_BUNDLE_SCENARIO, firstRunFrom, hermesVersionOf, median, otherHermesVersion, parseLog, refusalReason, withHermesVersion, phaseTimeline, sha256, steadyTrials, telemetry } from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const APK = resolve(arg("apk", "shell.apk")), BUNDLES = resolve(arg("bundles", "bundles")), KEY = JSON.parse(readFileSync(arg("key", "key.json"), "utf8"));
const PORT = Number(arg("port", 8110)), TRIALS = Number(arg("trials", 3)), OUT = resolve(arg("out", "android-e2e-report.json"));
const WORK = resolve(arg("work", "/tmp/android-e2e")), PKG = "dev.shipvo.tide", APP = "tide";
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", maxBuffer: 64 << 20 });
const sh = (c) => adb("shell", c).replace(/\r/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 250) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }

rmSync(WORK, { recursive: true, force: true }); mkdirSync(join(WORK, "tree"), { recursive: true });
const TREE = join(WORK, "tree"), LOG = join(WORK, "server.log"); writeFileSync(LOG, "");
const bundle = (n) => new Uint8Array(readFileSync(join(BUNDLES, n + ".hbc")));
const entries = () => parseLog(readFileSync(LOG, "utf8"));
const tele = () => telemetry(entries());
const prefs = () => { try { const x = sh(`run-as ${PKG} cat shared_prefs/shipvo.runtime.xml`); return Object.fromEntries([...x.matchAll(/<(?:int|long) name="(\w+)" value="(-?\d+)"/g)].map((m) => [m[1], Number(m[2])])); } catch { return {}; } };
const pid = () => { try { return sh(`pidof ${PKG}`).trim(); } catch { return ""; } }; // pidof exits 1 when the process is gone
const stop = () => sh(`am force-stop ${PKG}`);
function launch() {
  sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard");
  const o = sh(`am start -W -n ${PKG}/.MainActivity`);
  return { totalMs: Number(o.match(/TotalTime: (\d+)/)?.[1]), waitMs: Number(o.match(/WaitTime: (\d+)/)?.[1]) };
}
/** The runtime's own "running and healthy" report: an `applied` event for this release without download fields. */
const healthy = (rel, since) => tele().find((e) => e.event === "applied" && e.release === rel && e.at >= since && e.bytes_downloaded === undefined);
const fatal = () => /FATAL EXCEPTION/.test(adb("logcat", "-d", "-b", "crash"));
let nextRel = 1;
const history = []; // { rel, bytes } of releases published and applied, in order

async function publish(bytes, o = {}) {
  const release = nextRel++;
  const r = publishRelease({ root: TREE, app: APP, seed: KEY.seed, release, bytes, ...o });
  return { release, ...r };
}
/** Publish a valid release and time it until the device reports it healthy. */
async function updateTrial(bytes, bases) {
  const p = await publish(bytes, { bases });
  const ev = await waitFor(() => healthy(p.release, p.at), 120_000);
  const gets = entries().filter((e) => e.method === "GET" && e.status === 200 && e.t >= p.at && e.path.startsWith("/b/") && e.path.includes(`r${p.release}.`));
  const staged = tele().find((e) => e.at >= p.at && e.bytes_downloaded !== undefined && e.published_at);
  const via = gets.some((g) => g.path.includes("/d-")) ? "patch" : "full";
  if (ev) history.push({ rel: p.release, bytes });
  return { release: p.release, ok: !!ev, pointerToHealthyMs: ev ? ev.at - p.at : null, via, downloadBytes: gets.reduce((s, g) => s + g.bytes, 0) || null,
    downloadMs: staged?.apply_ms ?? null, applyMs: ev?.apply_ms ?? null, bundleBytes: bytes.length, patchesOffered: p.patches.map((x) => x.size),
    timeline: phaseTimeline({ entries: entries(), tele: tele(), publishedAt: p.at, release: p.release, pointerPath: `/p/${APP}/1/${BAND}.json`, downloadMs: staged?.apply_ms, applyMs: ev?.apply_ms }) };
}
const summarize = (trials, keys) => Object.fromEntries(keys.map((k) => [k, median(trials.map((t) => t[k]))]));
const results = [];
const scenario = async (name, fn) => {
  const t0 = Date.now(); let r;
  try { r = await fn(); } catch (e) { r = { pass: false, error: String(e?.stack || e).split("\n").slice(0, 3).join(" | ") }; }
  results.push({ name, ...r, wallS: Math.round((Date.now() - t0) / 1000) }); console.log(`${r.pass ? "PASS" : "FAIL"} ${name}`, JSON.stringify(r).slice(0, 400));
};

const server = await startServer(TREE, PORT, LOG);
const env = {
  date: new Date().toISOString(), host: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, node: process.version },
  device: { model: sh("getprop ro.product.model").trim(), android: sh("getprop ro.build.version.release").trim(), api: Number(sh("getprop ro.build.version.sdk")), abi: sh("getprop ro.product.cpu.abi").trim(), emulator: sh("getprop ro.kernel.qemu").trim() === "1" || /sdk|emulator/i.test(sh("getprop ro.product.model")), fingerprint: sh("getprop ro.build.fingerprint").trim() },
  apk: { file: APK, bytes: readFileSync(APK).length }, publicKey: KEY.publicKey, trials: TRIALS,
  bundles: Object.fromEntries(["v1", "v2", "crash"].map((n) => [n, bundle(n).length])),
};

// Fresh install. The embedded bundle is the first patch base on a new install.
try { adb("uninstall", PKG); } catch {} // fails when the app is not installed yet
const inst = adb("install", "-r", APK); if (!/Success/.test(inst)) throw new Error("install failed: " + inst);
env.shellVersion = sh(`dumpsys package ${PKG}`).match(/versionName=(\S+)/)?.[1];
const embedded = new Uint8Array(execFileSync("unzip", ["-p", APK, "assets/index.android.bundle"], { maxBuffer: 64 << 20 })); env.embeddedBundleBytes = embedded.length;
sh("svc power stayon true"); adb("logcat", "-c");

await scenario("install and cold start on the bundled release", async () => {
  const runs = [];
  for (let i = 0; i < TRIALS; i++) {
    if (i > 0) { stop(); await sleep(1000); }
    const t0 = Date.now(), l = launch(), ev = await waitFor(() => healthy(0, t0), 30_000);
    runs.push({ ...l, reportedColdStartMs: ev?.cold_start_ms ?? null, alive: !!pid(), healthy: !!ev });
  }
  const polled = entries().some((e) => e.method === "GET" && e.path === `/p/${APP}/1/${await_band()}.json`);
  return { pass: runs.every((r) => r.healthy && r.alive) && !fatal(), firstLaunch: runs[0], runs, median: summarize(runs, ["totalMs", "waitMs", "reportedColdStartMs"]), devicePolledPointer: polled, cohort: prefs().cohort };
});
function await_band() { const c = prefs().cohort ?? 0; return c < 10 ? "b0" : c < 100 ? "b1" : "b2"; }
const BAND = await_band();

await scenario("first update after install: patch against the APK's own bundle", async () => {
  const t = await updateTrial(bundle("v1"), [embedded]);
  return { pass: t.ok && t.via === "patch", ...t, fullBundleBytes: t.bundleBytes };
});

await scenario(FULL_BUNDLE_SCENARIO, async () => {
  const trials = []; for (let i = 0; i < TRIALS; i++) trials.push(await updateTrial(bundle("v" + (2 + i)), []));
  return { pass: trials.every((t) => t.ok && t.via === "full"), trials, median: summarize(trials, ["pointerToHealthyMs", "downloadBytes", "downloadMs", "applyMs"]) };
});

const PATCH_TRIALS = Number(arg("patch-trials", 5));
const AFTER_PATCH = 2 + TRIALS + PATCH_TRIALS; // first bundle after the patch trials (needs v1..v10 with the defaults)
await scenario("update: bsdiff patch from the running release", async () => {
  const trials = [];
  for (let i = 0; i < PATCH_TRIALS; i++) { const n = 2 + TRIALS + i, prev = history.at(-1).bytes; trials.push(await updateTrial(bundle("v" + n), [prev])); }
  const steady = steadyTrials(trials), keys = ["pointerToHealthyMs", "downloadBytes", "downloadMs", "applyMs"];
  const phase = (k) => median(steady.map((t) => t.timeline.gaps[k]));
  return { pass: trials.every((t) => t.ok && t.via === "patch"), trials, trialCount: PATCH_TRIALS, trialsInMedian: steady.length, median: summarize(steady, keys),
    phaseMedianMs: { publishToPointerMs: phase("publishToPointerMs"), pointerToPatchMs: phase("pointerToPatchMs"), patchToStagedMs: phase("patchToStagedMs"), stagedToHealthyMs: phase("stagedToHealthyMs"), unaccountedMs: median(steady.map((t) => t.timeline.unaccountedMs)) } };
});

const good = () => history.at(-1);
for (const mode of ["signature", "hash", "size"]) {
  await scenario(`tampered bundle rejected: bad ${mode}`, async () => {
    const before = prefs(), cur = good().rel, t0 = Date.now();
    const p = await publish(bundle("v" + AFTER_PATCH), { tamper: mode });
    await sleep(35_000); // three or more poll cycles (the app polls every 10 s)
    const e = entries().filter((x) => x.t >= p.at), after = prefs();
    const sawPointer = e.some((x) => x.path === `/p/${APP}/1/${BAND}.json` && x.status === 200);
    const sawBundle = e.some((x) => x.path === `/b/${APP}/r${p.release}.hbc`);
    const ranIt = !!tele().find((x) => x.release === p.release && x.at >= p.at);
    const alive = !!pid();
    stop(); await sleep(800); const t1 = Date.now(); launch();
    const again = await waitFor(() => healthy(cur, t1), 30_000);
    return { pass: sawPointer && !ranIt && alive && after.current_release === cur && !after.pending_release && !!again && !fatal(),
      release: p.release, runningBefore: cur, currentAfter: after.current_release, pendingAfter: after.pending_release ?? 0, devicePolledPointer: sawPointer, deviceDownloadedBundle: sawBundle, appStayedAlive: alive, restartedOnRelease: again?.release ?? null };
  });
}
await scenario("hermes bytecode mismatch: a release for another bytecode version is refused", async () => {
  const shellVersion = hermesVersionOf(embedded);
  if (shellVersion == null) throw new Error("the shell's embedded bundle is not Hermes bytecode, so there is nothing to mismatch");
  if (!pid()) launch(); // the app only polls while it is open
  const cur = good().rel, releaseVersion = otherHermesVersion(shellVersion), before = prefs();
  const p = await publish(withHermesVersion(bundle("v" + AFTER_PATCH), releaseVersion), { bases: [], hermesBytecodeVersion: releaseVersion });
  await sleep(25_000); // several poll cycles: the release must stay refused
  const e = entries().filter((x) => x.t >= p.at), after = prefs();
  const sawPointer = e.some((x) => x.path === `/p/${APP}/1/${BAND}.json` && x.status === 200);
  const downloaded = e.some((x) => x.path.startsWith("/b/") && x.path.includes(`r${p.release}.`));
  const ranIt = !!tele().find((x) => x.event === "applied" && x.release === p.release && x.at >= p.at);
  const alive = !!pid();
  stop(); await sleep(800); const t1 = Date.now(); launch();
  const again = await waitFor(() => healthy(cur, t1), 30_000);
  // The sample app reads the runtime's queued events only when it starts (`consumeEvents` on mount), so the typed
  // reason reaches telemetry on this relaunch, not while the app stays open.
  const reason = await waitFor(() => refusalReason(tele(), p.release, p.at), 30_000);
  return { pass: reason === "hermes_bytecode_mismatch" && sawPointer && !downloaded && !ranIt && alive && after.current_release === cur && !after.pending_release && !!again && !fatal(),
    refusalReason: reason, release: p.release, shellBytecodeVersion: shellVersion, releaseBytecodeVersion: releaseVersion, runningBefore: cur, currentAfter: after.current_release, pendingAfter: after.pending_release ?? 0,
    blockedAfter: after.blocked_release ?? 0, devicePolledPointer: sawPointer, deviceDownloadedBundle: downloaded, appStayedAlive: alive, restartedOnRelease: again?.release ?? null };
});

await scenario("device recovers: valid release after tampered ones", async () => { const t = await updateTrial(bundle("v" + AFTER_PATCH), []); return { pass: t.ok, ...t }; });

await scenario("rollback to the previous release", async () => {
  const trials = [];
  for (let i = 0; i < TRIALS; i++) {
    const target = history.at(-2); // the release before the running one, republished as a new release (what `shipvo rollback` does)
    const t = await updateTrial(target.bytes, []);
    const onDevice = sh(`run-as ${PKG} sha256sum files/shipvo/r${t.release}.hbc`).split(" ")[0];
    trials.push({ ...t, rolledBackToRelease: target.rel, deviceBundleMatches: onDevice === sha256(target.bytes) });
  }
  return { pass: trials.every((t) => t.ok && t.deviceBundleMatches), trials, median: summarize(trials, ["pointerToHealthyMs", "downloadBytes", "applyMs"]) };
});

// Runs before the crash-loop scenarios: a crash-loop failure can leave the app open but dead (see the late-crash notes), and
// the staged-rollout check needs a device that is polling.
await scenario("staged rollout: a device outside the cohort does not get the release", async () => {
  if (!pid()) launch(); // the app only polls while it is open
  const others = ["b0", "b1", "b2"].filter((b) => b !== BAND), cur = good().rel;
  const p = await publish(bundle("v1"), { bands: others });
  await sleep(35_000);
  const e = entries().filter((x) => x.t >= p.at), after = prefs();
  const ownPolls = e.filter((x) => x.path === `/p/${APP}/1/${BAND}.json`);
  // The device's own band still serves the previous pointer (HTTP 200, an older release). Outside means it never
  // fetches the new release's bundle or patch, never reports it, and keeps its current release.
  const fetched = e.filter((x) => x.path.startsWith("/b/") && x.path.includes(`r${p.release}.`)).length;
  const outsideOk = ownPolls.length >= 2 && fetched === 0 && after.current_release === cur && !after.pending_release && !tele().some((x) => x.release === p.release && x.at >= p.at);
  const q = publishRelease({ root: TREE, app: APP, seed: KEY.seed, release: p.release, bytes: bundle("v1"), bands: [BAND] }); // widen the rollout to the device's band
  const ev = await waitFor(() => healthy(p.release, q.at), 120_000);
  if (ev) history.push({ rel: p.release, bytes: bundle("v1") }); // the device now runs this release, so the crash-loop scenarios must expect it as the previous one
  return { pass: outsideOk && !!ev, deviceBand: BAND, cohort: prefs().cohort, publishedToBands: others, devicePollsWhileOutside: ownPolls.length, devicePollStatuses: [...new Set(ownPolls.map((x) => x.status))], downloadsOfNewRelease: fetched, currentWhileOutside: after.current_release, joinedAfterWideningMs: ev ? ev.at - q.at : null };
});

for (const [kind, file, title, maxBadRuns] of [
  ["start", "crash", "crash-loop: a release that crashes on start is discarded", 3],
  // Reports healthy, is promoted, then dies 5 s later. The stability window must keep counting these boots: the bad release runs 3 times (the promoting boot counts as the first), and the 4th launch is the revert. That is the same rule as crash-on-start. `maxBadRuns` is how many times the bad release may run (the issue's "within 3 launches"); the last launch is the revert to the previous release, so `badRuns = boots - 1`.
  ["late", "late-crash", "crash-loop: a release that crashes 5 s after markHealthy is reverted", 3],
]) await scenario(title, async () => {
  const trials = [];
  for (let i = 0; i < TRIALS; i++) {
    const prev = good().rel, crashBytes = bundle(file);
    const p = await publish(crashBytes, { bases: [] });
    const staged = await waitFor(() => prefs().pending_release === p.release, 60_000);
    let boots = 0, restored = null; const timeline = []; // per launch: time since publish and the runtime's counters
    const mark = (what) => { const q = prefs(); timeline.push({ what, ms: Date.now() - p.at, trial_boots: q.trial_boots ?? 0, unhealthy_boots: q.unhealthy_boots ?? 0, pid: pid() || null }); };
    for (let k = 0; k < 10 && !restored; k++) {
      if (!pid()) { launch(); boots++; mark("launch"); }
      // Wait for the previous release to report healthy; stop waiting early if the process died (a crash).
      restored = await waitFor(() => healthy(prev, p.at) || (pid() ? null : "dead"), 15_000, 500);
      if (restored === "dead") restored = null; else if (!restored && pid()) { mark("force-stop"); stop(); } // a hung boot counts as a failed boot
    }
    if (boots > maxBadRuns + 1) writeFileSync(join(WORK, `logcat-${kind}-r${p.release}.txt`), adb("logcat", "-d")); // too many launches: keep the device log for the issue
    const pr = prefs(), after = entries().filter((e) => e.t >= (restored?.at ?? Infinity) && e.path.includes(`r${p.release}.hbc`)).length;
    const revertEvent = tele().some((e) => e.event === "crash_loop_revert" && e.at >= p.at);
    const badRuns = boots - 1;
    trials.push({ release: p.release, staged: !!staged, timeline, boots, badRuns, restoredRelease: restored?.release ?? null, restoredMs: restored ? restored.at - p.at : null, blocked: pr.blocked_release, currentAfter: pr.current_release,
      revertEventReported: revertEvent, redownloaded: after > 0, pass: !!restored && pr.blocked_release >= p.release && pr.current_release === prev && after === 0 && badRuns <= maxBadRuns });
  }
  return { pass: trials.every((t) => t.pass), kind, maxBadRuns, trials, median: summarize(trials, ["restoredMs", "boots", "badRuns"]) };
});

writeFileSync(join(WORK, "logcat-crash.txt"), adb("logcat", "-d", "-b", "crash"));
const report = { env, scenarios: results, allPassed: results.every((r) => r.pass), firstRun: firstRunFrom(results), serverLog: LOG };
writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`wrote ${OUT}: ${results.filter((r) => r.pass).length}/${results.length} scenarios passed`);
server.close(); process.exit(0);
