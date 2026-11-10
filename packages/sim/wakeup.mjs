// Webhook wake-ups: when a message or task arrives for an assistant name in the Assistant Inbox app, POST a signed
// note to the URL registered for that name. This is how an assistant that is not in a turn gets woken: the URL can be
// a Claude Code scheduled task, a GitHub repository_dispatch, an OpenAI background run, Slack or Zapier.
import { createHmac, randomBytes } from "node:crypto";
import { pendingIds } from "./banner.mjs";
import { checkUrl } from "./phone-browser.mjs";

export class WakeupError extends Error { constructor(code, message) { super(message); this.code = code; } }

const EVENTS = ["message", "task"];
const MAX_WAKEUPS = 20;
const RETRY_DELAYS_MS = [1000, 3000];
const TIMEOUT_MS = 5000;

/** Signature header value for a body sent at `ts` (seconds): `t=<ts>,v1=<hex hmac-sha256 of "<ts>.<body>">`. */
export function sign(secret, ts, body) { return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`; }

function summary(name, m, t) {
  const parts = [];
  if (m) parts.push(`${m} new ${m === 1 ? "message" : "messages"}`);
  if (t) parts.push(`${t} new ${t === 1 ? "task" : "tasks"}`);
  return `${parts.join(" and ")} for ${name} on the phone`;
}

/**
 * @param read      () => the Inbox app's data ({ messages, handoffs }) or undefined
 * @param log       (entry) => void, called once per delivery with { name, to, ok, status, attempts, ... } (never the secret)
 * @param opts      { fetch, resolve, delays, timeoutMs, intervalMs } for tests
 */
export function createWakeups(read, log, opts = {}) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const entries = new Map();   // name -> { url, secret, events, sent:Set }
  let timer = null;
  const inflight = new Set();

  async function deliver(name, e, payload) {
    const body = JSON.stringify(payload);
    let attempts = 0, status = 0, error = "";
    for (const wait of [0, ...delays]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      attempts++;
      const ts = Math.floor(Date.now() / 1000);
      try {
        // Re-check on every attempt: a name can start pointing at a private address after it was registered.
        await checkUrl(e.url, { allowPrivate: e.allowPrivate }, opts.resolve);
        const r = await doFetch(e.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
          headers: { "content-type": "application/json", "user-agent": "shipvo-phone/wakeup", "x-shipvo-signature": sign(e.secret, ts, body), "x-shipvo-event": payload.event }, body });
        status = r.status; error = "";
        if (r.status >= 200 && r.status < 300) break;
        error = `the URL answered ${r.status}`;
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) break;   // a client error will not get better
      } catch (err) { error = String(err?.message ?? err); }
    }
    log({ name: "wakeup", to: name, event: payload.event, ok: !error, status, attempts, ...(error ? { error } : {}), source: "real" });
  }

  function tick() {
    const data = read();
    for (const [name, e] of entries) {
      const now = pendingIds(data, name);
      const fresh = { messages: now.messages.filter((id) => !e.sent.has(`m:${id}`)), tasks: now.tasks.filter((id) => !e.sent.has(`t:${id}`)) };
      for (const id of now.messages) e.sent.add(`m:${id}`);
      for (const id of now.tasks) e.sent.add(`t:${id}`);
      const m = e.events.includes("message") ? fresh.messages : [], t = e.events.includes("task") ? fresh.tasks : [];
      if (!m.length && !t.length) continue;
      const payload = { to: name, event: m.length && t.length ? "message_and_task" : m.length ? "message" : "task", summary: summary(name, m.length, t.length), messages: m, tasks: t, at: new Date().toISOString() };
      const p = deliver(name, e, payload).catch(() => {}).finally(() => inflight.delete(p));
      inflight.add(p);
    }
  }
  const start = () => { if (!timer && entries.size) { timer = setInterval(tick, opts.intervalMs ?? 500); timer.unref?.(); } };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  return {
    tick,
    /** Registers (or replaces) the URL for an assistant name. Anything already waiting is the starting point: only later arrivals wake. Returns the secret when it was generated. */
    async register({ name, url, events, secret, allowPrivate = false }) {
      const n = String(name ?? "").trim().toLowerCase();
      if (!n) throw new WakeupError("bad_name", "name is the assistant to wake, such as chatgpt or claude");
      const ev = events == null ? [...EVENTS] : events;
      if (!Array.isArray(ev) || !ev.length || ev.some((x) => !EVENTS.includes(x))) throw new WakeupError("bad_events", `events can be ${EVENTS.map((x) => `"${x}"`).join(" and ")}`);
      if (typeof secret === "string" && secret.length > 0 && secret.length < 16) throw new WakeupError("bad_secret", "a secret must be at least 16 characters, or leave it out and one is generated");
      try { await checkUrl(url, { allowPrivate }, opts.resolve); } catch (e) { throw new WakeupError(e.code === "host_not_allowed" ? "host_not_allowed" : "bad_url", e.message); }
      if (!/^https?:/i.test(String(url))) throw new WakeupError("bad_url", "only http and https URLs can be called");
      if (!entries.has(n) && entries.size >= MAX_WAKEUPS) throw new WakeupError("too_many", `at most ${MAX_WAKEUPS} wake-ups per phone`);
      const generated = !(typeof secret === "string" && secret);
      const s = generated ? randomBytes(24).toString("hex") : secret;
      const now = pendingIds(read(), n);
      const sent = new Set([...now.messages.map((id) => `m:${id}`), ...now.tasks.map((id) => `t:${id}`)]);
      entries.set(n, { url: String(url), secret: s, events: [...ev], sent, allowPrivate });
      start();
      return { name: n, url: String(url), events: [...ev], ...(generated ? { secret: s } : {}) };
    },
    list() { return [...entries].map(([name, e]) => ({ name, url: e.url, events: e.events })); },
    clear(name) { const had = entries.delete(String(name ?? "").trim().toLowerCase()); if (!entries.size) stop(); return had; },
    close() { entries.clear(); stop(); },
    /** Resolves when every delivery started so far has finished. For tests. */
    async idle() { while (inflight.size) await Promise.allSettled([...inflight]); },
  };
}
