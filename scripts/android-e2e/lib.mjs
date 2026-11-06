// Pure helpers for the Android device lab: pointer building, tamper modes, statistics, log parsing.
import { createHash } from "node:crypto";
import { signBytes } from "../../packages/cli/dist/index.js";

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

/**
 * Builds the signed pointer envelope the runtime fetches, in the same wire format `shipvo publish` writes.
 * tamper: undefined | "signature" | "hash" | "size".
 *  - signature: the body is signed, then one byte of the body changes, so the signature no longer matches.
 *  - hash: the pointer is validly signed but names the wrong sha256 for the bundle.
 *  - size: the pointer is validly signed but names the wrong size.
 */
export function buildPointer({ app, seed, release, band, bytes, url, patches = [], minShell = "1.0.0", tamper, hermesBytecodeVersion, issuedAt = new Date().toISOString() }) {
  const core = { version: `1.0.${release}`, sha256: sha256(bytes), size: bytes.length, url, patches };
  if (tamper === "hash") core.sha256 = sha256(Buffer.concat([Buffer.from(bytes), Buffer.from("x")]));
  if (tamper === "size") core.size = bytes.length + 7;
  const body = JSON.stringify({ schema_version: "1.0", app_id: app, shell_major: 1, band, release, issued_at: issuedAt, core, addons: [], screens: [], min_shell_version: minShell, ...(hermesBytecodeVersion ? { hermes_bytecode_version: hermesBytecodeVersion } : {}) });
  const signature = signBytes(new TextEncoder().encode(body), seed);
  if (tamper === "signature") return { body: body.replace('"issued_at":"', '"issued_at":"0'), signature };
  return { body, signature };
}

/** Parses the server's JSON-lines log. */
export const parseLog = (text) => text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

/** Telemetry events (POST /t) from a parsed log, with the server receive time in ms. */
export const telemetry = (entries) => entries.filter((e) => e.method === "POST" && e.path === "/t").map((e) => { try { return { at: e.t, ...JSON.parse(e.body) }; } catch { return null; } }).filter(Boolean);

/**
 * What happened to one bundle path in the "resumed download" scenario, from the parsed server log. Requests are GETs of
 * `path` at or after `since`. `usedRange` is true when the second request carried a Range header; `resumed` also needs a
 * 206 answer. `bytesSent` adds up the bytes the server wrote, including the cut first response. `healthyAt` (ms) is
 * when the app reported healthy; `firstToHealthyMs` is null without it.
 */
export function resumeFacts({ entries, path, since = 0, healthyAt = null }) {
  const reqs = entries.filter((e) => e.method === "GET" && e.path === path && e.t >= since);
  const [first, second] = reqs;
  const usedRange = !!second?.range;
  return { requests: reqs.length, firstCut: !!first?.cut, bytesSent: reqs.reduce((s, e) => s + (e.bytes || 0), 0), firstBytes: first?.bytes ?? null,
    secondRange: second?.range ?? null, secondStatus: second?.status ?? null, usedRange, resumed: usedRange && second.status === 206,
    firstToHealthyMs: healthyAt != null && first ? healthyAt - (first.t) : null };
}

/** Percent change from base to now; positive means slower or larger. */
export const pctChange = (base, now) => (base ? Math.round(((now - base) / base) * 1000) / 10 : null);

/**
 * Per-phase timeline of one update trial, in ms after the pointer was published (`publishedAt`). Inputs are the parsed
 * server log (`entries`, GET lines are written when the response ends) and the telemetry events (`tele`, with `at`).
 * Phases: pointerSeen (first pointer GET after publish), patchReceived (last bundle or patch GET for the release),
 * staged (telemetry with bytes_downloaded: the runtime finished download and verify), healthy (`applied` telemetry,
 * sent after markHealthy). Gaps are null when a phase is missing. `unaccountedMs` is what the runtime's own
 * download and apply numbers do not explain.
 */
export function phaseTimeline({ entries, tele, publishedAt, release, pointerPath, downloadMs, applyMs }) {
  const rel = (t) => (t == null ? null : t - publishedAt);
  const gets = entries.filter((e) => e.method === "GET" && e.status === 200 && e.t >= publishedAt);
  const pointerSeen = gets.find((e) => e.path === pointerPath)?.t ?? null;
  const blobs = gets.filter((e) => e.path.startsWith("/b/") && e.path.includes(`r${release}.`));
  const patchReceived = blobs.length ? Math.max(...blobs.map((e) => e.t)) : null;
  const staged = tele.find((e) => e.at >= publishedAt && e.bytes_downloaded !== undefined && e.published_at)?.at ?? null;
  const healthy = tele.find((e) => e.event === "applied" && e.release === release && e.at >= publishedAt && e.bytes_downloaded === undefined)?.at ?? null;
  const gap = (a, b) => (a == null || b == null ? null : b - a);
  const total = gap(publishedAt, healthy);
  return {
    pointerSeenMs: rel(pointerSeen), patchReceivedMs: rel(patchReceived), stagedMs: rel(staged), healthyMs: rel(healthy),
    gaps: { publishToPointerMs: gap(publishedAt, pointerSeen), pointerToPatchMs: gap(pointerSeen, patchReceived), patchToStagedMs: gap(patchReceived, staged), stagedToHealthyMs: gap(staged, healthy) },
    unaccountedMs: total == null ? null : total - (downloadMs ?? 0) - (applyMs ?? 0),
  };
}

/**
 * Trials that are safe to put in a median. A trial is a poll miss when the device fetched the pointer later than
 * `pollMissMs` after publish (the app polls every 10 s, so a miss costs up to 10 s). The trial right after a miss is
 * dropped too: it starts while the poll phase is still lined up with the previous publish.
 */
export function steadyTrials(trials, pollMissMs = 3000) {
  const miss = trials.map((t) => t.timeline?.pointerSeenMs == null || t.timeline.pointerSeenMs > pollMissMs);
  return trials.filter((_, i) => !miss[i] && !(i > 0 && miss[i - 1]));
}

export const FULL_BUNDLE_SCENARIO = "update: full bundle (no patches offered)";

/**
 * The `firstRun` block of the report. The first-run app is not published in this job, so the honest equivalent is the
 * median of the full-bundle update scenario: a device with no patch base, which is what a new app's first update is.
 * Returns null when that scenario failed or has no timing, so the summary says "not measured".
 */
export function firstRunFrom(scenarios) {
  const s = scenarios.find((x) => x.name === FULL_BUNDLE_SCENARIO);
  const m = s?.pass ? s.median : null;
  if (!m || !(typeof m.pointerToHealthyMs === "number" && m.pointerToHealthyMs > 0)) return null;
  return { source: s.name, publishToHealthyMs: m.pointerToHealthyMs, downloadMs: m.downloadMs ?? null, applyMs: m.applyMs ?? null };
}

const HBC_MAGIC = [0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f];

/** Hermes bytecode version in a bundle header (8-byte magic, then a 32-bit little-endian version), or null for plain JS. Same rule as `HermesGuard.versionOf`. */
export function hermesVersionOf(bytes) {
  if (bytes.length < 12 || HBC_MAGIC.some((m, i) => bytes[i] !== m)) return null;
  const v = bytes[8] + bytes[9] * 2 ** 8 + bytes[10] * 2 ** 16 + bytes[11] * 2 ** 24;
  return v >= 1 && v <= 0x7fffffff ? v : null;
}

/** A copy of a Hermes bundle with its header version set to `version`. */
export function withHermesVersion(bytes, version) {
  if (hermesVersionOf(bytes) == null) throw new Error("not a Hermes bytecode bundle");
  const out = Uint8Array.from(bytes); new DataView(out.buffer).setUint32(8, version, true);
  return out;
}

/** A release with a different bytecode version than the shell's. */
export const otherHermesVersion = (shell) => (shell === 1 ? 2 : shell - 1);

/**
 * The refusal reason in telemetry for `release` since `since`, or null. The event name is the reason
 * (`hermes_bytecode_mismatch`), sent under the refused release's id.
 */
export const refusalReason = (tele, release, since) => tele.find((e) => e.release === release && e.at >= since && e.event === "hermes_bytecode_mismatch")?.event ?? null;

/** Where `release` is in the prefs: "pending" (trial stage seen), "current" (already promoted, stage was too short to see), or null. */
export const releaseReached = (prefs, release) => (prefs.pending_release === release ? "pending" : prefs.current_release === release ? "current" : null);

export const ROLLBACK_SCENARIO = "on-device Runtime.rollback(): previous release restored and kept after a restart";

/** Center of the node with this content-desc or text in a `uiautomator dump` XML, or null. */
export function tapTarget(xml, label) {
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const n = m[0], attr = (k) => n.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
    if (attr("content-desc") !== label && attr("text") !== label) continue;
    const b = attr("bounds")?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (b) return { x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2) };
  }
  return null;
}

/** The `rolled_back` telemetry event the app sends (under the rolled-back release id) after `since`, or null. */
export const rolledBackEvent = (tele, release, since) => tele.find((e) => e.event === "rolled_back" && e.release === release && e.at >= since) ?? null;

/**
 * Verdict of the rollback scenario. `bad` is the release that was rolled back, `good` the one that must run.
 * `prefs` are the runtime prefs after the relaunch, `runningAfterRelaunch` the release that reported healthy
 * after it, `badRefetched` whether the device fetched the bad release's bundle after the rollback call.
 * Returns { pass, failures[] }; a bad release that comes back is named as such.
 */
export function rollbackVerdict({ good, bad, prefs, runningAfterRelaunch, badRefetched, telemetryEvent, goodActiveMs }) {
  const failures = [];
  if (goodActiveMs == null) failures.push(`release ${good} was not active after the rollback call`);
  if (runningAfterRelaunch === bad || prefs.current_release === bad) failures.push(`release ${bad} came back after the relaunch`);
  else if (runningAfterRelaunch !== good || prefs.current_release !== good) failures.push(`after the relaunch the app ran release ${runningAfterRelaunch ?? "none"}, expected ${good}`);
  if (badRefetched) failures.push(`release ${bad} was downloaded again after the rollback`);
  if (!(prefs.blocked_release >= bad)) failures.push(`release ${bad} is not blocked (blocked_release ${prefs.blocked_release ?? 0})`);
  if (!telemetryEvent) failures.push("no rolled_back telemetry event");
  return { pass: failures.length === 0, failures };
}
