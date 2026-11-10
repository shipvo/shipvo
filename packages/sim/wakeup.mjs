// Webhook wake-ups: when an event arrives for an assistant's name, the phone POSTs { to, event, summary } to the URL it registered.
// The body is signed with HMAC-SHA256 using a per-registration secret (shown once) in x-shipvo-signature: "sha256=<hex>".
// Same private-address rule as the hosted CORS proxy: no localhost, private, link-local or other reserved address, re-checked on every redirect.
import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class WakeupError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const WAKEUP_EVENTS = ["message", "handoff"];
export const RETRY_WAITS_MS = [1000, 4000, 16000];   // three retries after the first attempt, then stop
const MAX_REGISTRATIONS = 20;

const v4 = (ip) => { const p = ip.split("."); return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && +x < 256) ? p.map(Number) : null; };
function v6(ip) {
  const s = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  let str = s;
  if (tail) { const a = v4(tail[2]); if (!a) return null; str = `${tail[1]}${((a[0] << 8) | a[1]).toString(16)}:${((a[2] << 8) | a[3]).toString(16)}`; }
  const halves = str.split("::"); if (halves.length > 2) return null;
  const a = halves[0] ? halves[0].split(":") : []; const b = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - a.length - b.length; if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const g = [...a, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...b].map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return g.length === 8 && g.every((x) => !Number.isNaN(x)) ? g : null;
}
/** True for every address a webhook must never reach: private, loopback, link-local, shared, multicast, reserved and unparseable. */
export function isBlockedAddress(ip) {
  const a = v4(ip);
  if (a) {
    const [o1, o2, o3] = a;
    return o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224 || (o1 === 100 && o2 >= 64 && o2 <= 127) || (o1 === 169 && o2 === 254) || (o1 === 172 && o2 >= 16 && o2 <= 31)
      || (o1 === 192 && o2 === 168) || (o1 === 192 && o2 === 0 && (o3 === 0 || o3 === 2)) || (o1 === 198 && (o2 === 18 || o2 === 19))
      || (o1 === 192 && o2 === 88 && o3 === 99) || (o1 === 198 && o2 === 51 && o3 === 100) || (o1 === 203 && o2 === 0 && o3 === 113);
  }
  const g = v6(ip); if (!g) return true;
  if ((g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)))
    return isBlockedAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if (g.slice(0, 5).every((x) => x === 0)) return true;   // ::, ::1, IPv4-compatible
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00 || (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) || g[0] === 0x2002;
}

const defaultResolve = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export function sign(secret, body) { return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`; }

/**
 * One phone's wake-up registrations. Options: allowLocal (local runs only: http and private addresses are allowed),
 * fetch, resolve, sleep (replaceable in tests), log (called once per attempt).
 */
export function createWakeups({ allowLocal = false, fetch: doFetch = globalThis.fetch, resolve = defaultResolve, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  const regs = new Map();

  // Throws WakeupError bad_url or private_address.
  async function check(u) {
    if (u.protocol !== "https:" && !(allowLocal && u.protocol === "http:")) throw new WakeupError("bad_url", "the wake-up URL must start with https://");
    if (u.username || u.password) throw new WakeupError("bad_url", "the wake-up URL must not contain a user name or password");
    if (allowLocal) return;
    const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new WakeupError("private_address", `${host} is a private address`);
    let addrs = isIP(host) ? [host] : null;
    if (!addrs) { try { addrs = await resolve(host); } catch { throw new WakeupError("bad_url", `${host} does not resolve`); } }
    if (!addrs.length || addrs.some(isBlockedAddress)) throw new WakeupError("private_address", `${host} is a private address`);
  }

  async function post(url, body, headers) {
    let cur = new URL(url);
    for (let hop = 0; hop < 4; hop++) {
      await check(cur);   // every hop, so a redirect cannot reach a private address
      const res = await doFetch(cur.href, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(10000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { cur = new URL(res.headers.get("location"), cur); continue; }
      return res.status;
    }
    throw new Error("too many redirects");
  }

  async function deliver(reg, payload) {
    const body = JSON.stringify(payload);
    const headers = { "content-type": "application/json", "x-shipvo-signature": sign(reg.secret, body) };
    for (let attempt = 1; attempt <= RETRY_WAITS_MS.length + 1; attempt++) {
      let status = null; let error = null;
      try { status = await post(reg.url, body, headers); } catch (e) { error = e instanceof WakeupError ? e.code : String(e?.message ?? e).slice(0, 200); }
      const ok = status !== null && status >= 200 && status < 300;
      log({ at: Date.now(), name: "wakeup_attempt", wakeup: reg.name, event: payload.event, attempt, ok, ...(status !== null ? { status } : {}), ...(error ? { error } : {}), source: "simulated" });
      if (ok || error === "private_address") return ok;
      if (attempt <= RETRY_WAITS_MS.length) await sleep(RETRY_WAITS_MS[attempt - 1]);
    }
    return false;
  }

  return {
    async register({ name, url, events }) {
      const n = String(name ?? "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(n)) throw new WakeupError("bad_name", "name is the assistant's short name: letters, digits, . _ -");
      const evs = Array.isArray(events) ? [...new Set(events.map(String))] : [];
      const bad = evs.find((e) => !WAKEUP_EVENTS.includes(e));
      if (!evs.length || bad) throw new WakeupError("bad_event", `events must be a list from: ${WAKEUP_EVENTS.join(", ")}${bad ? ` (got '${bad}')` : ""}`);
      let u; try { u = new URL(String(url)); } catch { throw new WakeupError("bad_url", "url is not a valid URL"); }
      await check(u);
      if (!regs.has(n) && regs.size >= MAX_REGISTRATIONS) throw new WakeupError("too_many_wakeups", "too many wake-ups on this phone: remove one first");
      const secret = randomBytes(32).toString("hex");
      regs.set(n, { name: n, url: u.href, events: evs, secret });
      return { name: n, url: u.href, events: evs, secret };
    },
    list() { return [...regs.values()].map(({ name, url, events }) => ({ name, url, events })); },
    remove(name) {
      const n = String(name ?? "").trim().toLowerCase();
      if (!regs.delete(n)) throw new WakeupError("no_wakeup", `no wake-up registered for '${n}'`);
      return { removed: n };
    },
    // Fire and forget from the caller's side: returns the promise so tests can await it. Never rejects.
    notify({ to, event, summary }) {
      const reg = regs.get(String(to ?? "").trim().toLowerCase());
      if (!reg || !reg.events.includes(event)) return Promise.resolve(false);
      return deliver(reg, { to: reg.name, event, summary: String(summary ?? "").slice(0, 200) }).catch(() => false);
    },
  };
}
