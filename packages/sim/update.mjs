// Simulated OTA update lifecycle for the phone: idle, checking, downloading, ready, applied, reverted.
// Pure rules plus one injected fetch: no DOM, no timers. The server drives it from the MCP tools check_for_update and apply_update,
// and tells it how each boot went (a page error while the new bundle loads is a failed boot). Nothing real is installed.
// The pointer is checked the same way the runtime checks it: an ed25519 signature over the canonical JSON (sorted keys, no
// `signature` field), then the bundle's sha256. Signing and verification code is not changed: this only follows its format.
import { createPublicKey, verify, createHash } from "node:crypto";

/** Typed error: no_update or not_ready. */
export class UpdateError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const UPDATE_STATES = ["idle", "checking", "downloading", "ready", "applied", "reverted"];
export const UPDATE_REASONS = ["verify_failed", "download_failed", "crash_loop"];
/** Failed boots of a new release before the phone goes back to the one it had. Same number as docs/spike-results.md. */
export const CRASH_LIMIT = 3;

/** `running` is { release, url }: the bundle the phone runs now (the first one is the app the session opened). */
export function createUpdate(running) {
  return { state: "idle", reason: null, running, previous: null, pending: null, trial: null, blocked: [], bundles: new Map(), log: [] };
}

const set = (st, state, reason = null, extra = {}) => {
  st.state = state; st.reason = reason;
  st.log.push({ at: Date.now(), name: "update_state", state, release: st.running.release, reason, ...extra, source: "simulated" });
};

/** What tools and tests read. */
export function updateView(st) {
  return { state: st.state, release: st.running.release, pending_release: st.pending?.release ?? null, reason: st.reason, blocked: [...st.blocked] };
}

/** Same bytes the signer used: sorted keys, no whitespace, no `signature`. */
export function canonical(value) {
  const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, strip(v[k])])) : v;
  const { signature: _s, ...rest } = value ?? {};
  return JSON.stringify(strip(rest));
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
/** True when `pointer.signature` is a valid ed25519 signature by the base64 public key. Never throws. */
export function verifyPointer(pointer, publicKeyB64) {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(publicKeyB64, "base64")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonical(pointer)), key, Buffer.from(pointer.signature, "base64"));
  } catch { return false; }
}

/**
 * Ask the update source for the latest release: GET <url>/pointer.json, check it, download its web bundle, check the hash.
 * Ends in `ready` (a new release is held), or `idle` with a reason (verify_failed, download_failed).
 * Throws no_update when there is nothing newer (the state goes back to what it was). `fetchFn` is fetch-like.
 */
export async function checkForUpdate(st, { url, publicKey, fetchFn = fetch }) {
  if (!url || !publicKey) throw new UpdateError("no_update", "no update source: start the simulator with --update-url and --update-key (or PN_UPDATE_URL and PN_UPDATE_KEY)");
  const was = { state: st.state, reason: st.reason };
  set(st, "checking");
  const fail = (reason, error) => { set(st, "idle", reason, { error }); return updateView(st); };
  let pointer;
  try {
    const r = await fetchFn(`${url.replace(/\/$/, "")}/pointer.json`);
    if (!r.ok) return fail("download_failed", `pointer.json answered ${r.status}`);
    pointer = await r.json();
  } catch (e) { return fail("download_failed", `could not read pointer.json: ${String(e?.message ?? e).split("\n")[0]}`); }
  if (!pointer || typeof pointer !== "object" || !verifyPointer(pointer, publicKey)) return fail("verify_failed", "the release pointer has no valid signature for this app's key");
  const n = pointer.release;
  if (!Number.isInteger(n) || !pointer.web?.base || !pointer.web?.entry || !/^[0-9a-f]{64}$/.test(String(pointer.web.sha256))) return fail("verify_failed", "the signed pointer has no usable web bundle");
  if (typeof st.running.release === "number" ? n <= st.running.release : false) { st.state = was.state; st.reason = was.reason; throw new UpdateError("no_update", `release ${n} is not newer than the running release ${st.running.release}`); }
  if (st.blocked.includes(n)) { st.state = was.state; st.reason = was.reason; throw new UpdateError("no_update", `release ${n} crashed on this phone and is blocked`); }
  set(st, "downloading", null, { target: n });
  let bytes;
  try {
    const entry = new URL(`${String(pointer.web.base).replace(/\/$/, "")}/${pointer.web.entry}`, `${url.replace(/\/$/, "")}/`);
    if (!/^https?:$/.test(entry.protocol)) return fail("download_failed", "the bundle URL is not http(s)");
    const r = await fetchFn(entry.href);
    if (!r.ok) return fail("download_failed", `the bundle answered ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  } catch (e) { return fail("download_failed", `could not download the bundle: ${String(e?.message ?? e).split("\n")[0]}`); }
  if (createHash("sha256").update(bytes).digest("hex") !== pointer.web.sha256) return fail("verify_failed", "the bundle does not match the signed sha256");
  st.bundles.set(n, bytes); st.pending = { release: n };
  set(st, "ready", null, { target: n });
  return updateView(st);
}

/** Make the held release the running one on the next boot. Throws not_ready unless the state is `ready`. `urlFor(release)` is where the server serves it. */
export function applyUpdate(st, urlFor) {
  if (st.state !== "ready" || !st.pending) throw new UpdateError("not_ready", `no update is ready (state: ${st.state}). Call check_for_update first.`);
  st.previous = st.running; st.running = { release: st.pending.release, url: urlFor(st.pending.release) }; st.pending = null;
  st.trial = { release: st.running.release, fails: 0 };
  set(st, "applied");
  return st.running;
}

/**
 * Tell the rules how a boot went. A new release must boot without a page error to count as good. After CRASH_LIMIT failed boots in a row
 * it is dropped and blocked and the phone goes back: { revert: true, url } with the previous bundle's url.
 */
export function bootDone(st, crashed) {
  if (!st.trial) return { revert: false };
  if (!crashed) { st.trial = null; return { revert: false }; }
  if (++st.trial.fails < CRASH_LIMIT) return { revert: false };
  const bad = st.trial.release;
  st.blocked.push(bad); st.bundles.delete(bad); st.trial = null; st.running = st.previous; st.previous = null;
  set(st, "reverted", "crash_loop", { reverted: bad });
  return { revert: true, url: st.running.url };
}

const WORDS = { ready: (r) => `update ready: release ${r}`, applied: (r) => `update applied: release ${r}`, reverted: (r, why) => `update reverted${why ? ` (${why})` : ""}: back on release ${r}` };
/** The banner text for ready, applied and reverted; null for the other states. Starts with "Simulated". */
export function bannerText(st) {
  const f = WORDS[st.state]; if (!f) return null;
  return `Simulated: ${f(st.state === "ready" ? st.pending?.release : st.running.release, st.reason)}`;
}

/** Banner markup for the phone frame (both skins). Hidden until the page gets a "pn:update" message. */
export function updateBannerHtml() {
  return `<div class="sf-update" data-part="update-banner" role="status" aria-live="polite" aria-label="Simulated update status" hidden><span data-part="update-banner-text"></span></div>`;
}
export const updateCss = `.sf-update{position:absolute;left:10px;right:10px;top:48px;z-index:4;padding:8px 12px;border-radius:12px;background:#1d2733;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 4px 16px #0006}.sf-update[hidden]{display:none}`;
/** Browser script: shows the banner for { type: "pn:update", text } messages (null text hides it). */
export function updateClientScript() {
  return `(function(){var b=document.querySelector('[data-part="update-banner"]');if(!b)return;var t=b.querySelector('[data-part="update-banner-text"]');
window.addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="pn:update")return;if(typeof d.text==="string"&&d.text.indexOf("Simulated")===0){t.textContent=d.text.slice(0,120);b.hidden=false}else b.hidden=true})})();`;
}
