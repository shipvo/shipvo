import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ReleasePointerBody, SignedEnvelope, Telemetry, bandForCohort } from "@shipvo/schema";
import { adminPage, loginPage } from "./admin";
import { AGENT_ACTOR, describeOwner, listChallenges, resolveChallenge, runOwnerCommand } from "./owner";
import { auth } from "./auth";
import { forbidden, type Action } from "./roles";
import { REVERT_EVENTS, sendRevertAlert } from "./alerts";
import { apps, publisher } from "./apps";
import { exportTelemetry } from "./export";
import { recordAudit } from "./audit";
import { checkPrices, contentFor, sha, RATE_PER_IP, RATE_PER_INSTALL } from "./orders";
import { decideOffer, type OfferResult } from "./offer";
import { FAILED_EVENTS, HEALTHY_EVENTS, shouldHalt } from "./halt";

type Env = { POINTERS: KVNamespace; DB: D1Database; ADMIN_PASSWORD?: string; OWNER_TOKEN?: string; GITHUB_CLIENT_ID?: string; SIM_URL?: string; EXPORT_BUCKET?: R2Bucket };
const app = new Hono<{ Bindings: Env }>();

/* ---------- owner auth: admin session cookie (HMAC) or bearer owner token for agents ---------- */
const enc = new TextEncoder();
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function owner(c: any, appId: string): Promise<string | null> {
  const auth = c.req.header("authorization") ?? "";
  if (c.env.OWNER_TOKEN && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), c.env.OWNER_TOKEN)) return AGENT_ACTOR;
  const cookie = getCookie(c, "pn_admin");
  if (!cookie || !c.env.ADMIN_PASSWORD) return null;
  const [app_, exp, sig] = cookie.split(".");
  if (app_ !== appId || Number(exp) < Date.now()) return null;
  return safeEqual(sig ?? "", await hmac(c.env.ADMIN_PASSWORD, `${app_}.${exp}`)) ? "owner (admin)" : null;
}
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Today's UTC date, used in the dropped-telemetry counter key. */
const utcDay = () => new Date().toISOString().slice(0, 10);

/** Events dropped today across all apps (D1 write failures). One KV read; null when KV cannot be read. */
async function droppedToday(env: Env): Promise<number | null> {
  if (!env.POINTERS) return null;
  try { return Number(await env.POINTERS.get(`telemetry_dropped_total/${utcDay()}`)) || 0; } catch { return null; }
}

app.get("/health", async (c) => c.json({ ok: true, service: "shipvo-control", time: new Date().toISOString(), telemetry_dropped_today: await droppedToday(c.env) }, 200, { "access-control-allow-origin": "*", "cache-control": "no-store" }));

/** Static hot path: signed release pointer envelope per app / shell major / (platform /) band. No device registry. Android pointers live at /p/<app>/<major>/<band>, iOS at /p/<app>/<major>/ios/<band>. */
async function servePointer(c: any, platform: "android" | "ios") {
  const { app: appId, major } = c.req.param();
  const band = c.req.param("band").replace(/\.json$/, "");
  if (!ID.test(appId) || !/^\d+$/.test(major)) return c.json({ error: "bad_request" }, 400);
  if (!["b0", "b1", "b2"].includes(band)) return c.json({ error: "bad_band" }, 400);
  const raw = await c.env.POINTERS.get(platform === "ios" ? `p/${appId}/${major}/ios/${band}` : `p/${appId}/${major}/${band}`);
  if (!raw) return c.json({ error: "no_release" }, 404);
  let body: ReturnType<typeof ReleasePointerBody.parse>;
  try {
    const env = SignedEnvelope.parse(JSON.parse(raw));
    body = ReleasePointerBody.parse(JSON.parse(env.body));
  } catch { return c.json({ error: "corrupt_pointer" }, 500); }
  // The halt key is read only when the earlier rules pass, as before.
  const query = { hbc: c.req.query("hbc"), nm: c.req.query("nm") };
  const decide = (haltedRelease?: string | null): OfferResult | null => {
    try { return decideOffer({ body, ...query, haltedRelease }); } catch { return null; }
  };
  let offer = decide();
  if (offer?.ok) offer = decide(await c.env.POINTERS.get(`halt/${appId}`));
  if (!offer) return c.json({ error: "corrupt_pointer" }, 500);
  if (!offer.ok) {
    const { ok: _ok, status, ...json } = offer;
    return c.json(json, status, status === 404 ? { "cache-control": "public, max-age=5" } : undefined);
  }
  const release = offer.release;
  const etag = `"${release}"`;
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(raw, { headers: { "content-type": "application/json", ETag: etag, "cache-control": "public, max-age=5" } });
}
app.get("/p/:app/:major/ios/:band", (c) => servePointer(c, "ios"));
app.get("/p/:app/:major/:band", (c) => servePointer(c, "android"));

/** Immutable bundle bytes. Integrity is checked on device against the sha256 inside the signed pointer. */
// Agent-facing web artifact of a release: /w/<app>/r<N>/index.html and its files; /w/<app>/releases.json lists them.
app.get("/w/:app/releases.json", async (c) => {
  const appId = c.req.param("app"); if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const raw = await c.env.POINTERS.get(`w/${appId}/releases`);
  return raw ? new Response(raw, { headers: { "content-type": "application/json", "cache-control": "public, max-age=5", "access-control-allow-origin": "*" } }) : c.json({ error: "not_found" }, 404);
});
app.get("/w/:app/store/:file", async (c) => {
  const { app: appId, file } = c.req.param();
  if (!ID.test(appId) || !/^[a-z0-9._-]{1,64}$/i.test(file)) return c.json({ error: "bad_request" }, 400);
  const v = await c.env.POINTERS.get(`w/${appId}/store/${file}`, "arrayBuffer");
  if (!v) return c.json({ error: "not_found" }, 404);
  const type = file.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(file) ? "image/jpeg" : file.endsWith(".webp") ? "image/webp" : file.endsWith(".svg") ? "image/svg+xml" : "application/json";
  return new Response(v, { headers: { "content-type": type, "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
});
app.get("/w/:app/:rel/*", async (c) => {
  const { app: appId, rel } = c.req.param();
  if (!ID.test(appId) || !/^r\d{1,6}$/.test(rel)) return c.json({ error: "bad_request" }, 400);
  const path = c.req.path.split(`/${rel}/`)[1] || "index.html";
  if (!/^[a-z0-9._\/-]{1,200}$/i.test(path) || path.includes("..")) return c.json({ error: "bad_request" }, 400);
  const v = await c.env.POINTERS.getWithMetadata(`w/${appId}/${rel}/${path}`, "arrayBuffer");
  if (!v.value) return c.json({ error: "not_found" }, 404);
  const type = path.endsWith(".html") ? "text/html; charset=utf-8" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".json") ? "application/json" : path.endsWith(".css") ? "text/css" : path.endsWith(".ico") ? "image/x-icon" : path.endsWith(".png") ? "image/png" : path.endsWith(".ttf") ? "font/ttf" : "application/octet-stream";
  return new Response(v.value, { headers: { "content-type": type, "cache-control": path.endsWith(".html") ? "public, max-age=60" : "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
});

app.get("/b/:app/:file", async (c) => {
  const { app: appId, file } = c.req.param();
  if (!ID.test(appId) || !/^[a-z0-9._-]{1,128}$/i.test(file)) return c.json({ error: "bad_request" }, 400);
  const buf = await c.env.POINTERS.get(`b/${appId}/${file}`, "arrayBuffer");
  if (!buf) return c.json({ error: "not_found" }, 404);
  const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "accept-ranges": "bytes" };
  // Resume support: a single `bytes=<n>-` range answers 206 with the tail. Anything else gets the whole file.
  const m = /^bytes=(\d+)-$/.exec(c.req.header("range") || "");
  if (m) {
    const start = Number(m[1]);
    if (start >= buf.byteLength) return new Response(null, { status: 416, headers: { "content-range": `bytes */${buf.byteLength}` } });
    return new Response(buf.slice(start), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${buf.byteLength - 1}/${buf.byteLength}` } });
  }
  return new Response(buf, { headers });
});

/**
 * Write KV `halt/<app>` when a release fails on too many devices. Settings live in KV `halt-config/<app>`:
 * {"threshold": number, "min_reports": number}. No config key means halting is off.
 */
async function maybeHalt(env: Env, appId: string, release: number, kv?: { failed: number; healthy: number }): Promise<void> {
  if (!env.POINTERS) return;
  const raw = await env.POINTERS.get(`halt-config/${appId}`);
  if (!raw) return;
  let cfg: { threshold?: unknown; min_reports?: unknown };
  try { cfg = JSON.parse(raw); } catch { return; }
  if (!cfg || typeof cfg !== "object") return;
  const threshold = typeof cfg.threshold === "number" ? cfg.threshold : undefined;
  const minReports = typeof cfg.min_reports === "number" ? cfg.min_reports : 20;
  let results: { event: string; n: number }[] = [];
  try {
    results = (await env.DB.prepare("SELECT event, COUNT(*) AS n FROM telemetry WHERE app_id = ? AND release = ? GROUP BY event").bind(appId, release).all<{ event: string; n: number }>()).results ?? [];
  } catch (e) {
    // D1 over its limit: fall back to the KV count so auto-halt still works.
    if (!kv) throw e;
    console.error("halt count read failed, using KV fallback", e);
  }
  const counts = { healthy: 0, failed: 0 };
  for (const r of results) {
    if (HEALTHY_EVENTS.includes(r.event)) counts.healthy += r.n;
    else if (FAILED_EVENTS.includes(r.event)) counts.failed += r.n;
  }
  if (kv) { counts.failed = Math.max(counts.failed, kv.failed); counts.healthy = Math.max(counts.healthy, kv.healthy); }
  const verdict = shouldHalt(counts, { threshold, minReports });
  if (!verdict.halt) return;
  const key = `halt/${appId}`;
  // KV has no compare-and-set: two concurrent failures may both write, and the later halted_at wins.
  const cur = await env.POINTERS.get(key);
  if (cur) { try { if (JSON.parse(cur).release === release) return; } catch { /* overwrite bad value */ } }
  const halted = { release, halted_at: new Date().toISOString(), reports: verdict.reports, failed: counts.failed, threshold };
  await env.POINTERS.put(key, JSON.stringify(halted));
  // recordAudit never throws, so a failed audit write cannot undo or block the halt.
  await recordAudit(env.DB, { app_id: appId, actor: "halt-rule", actor_kind: "system", action: "halt", release, before: null, after: JSON.stringify({ release, reports: verdict.reports, failed: counts.failed, threshold }) });
}

/** Device telemetry for the spike: applied / reverted / timings. */
app.post("/t", async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  const t = Telemetry.safeParse(body);
  if (!t.success || !ID.test(t.data.app_id)) return c.json({ error: "bad_telemetry" }, 400);
  const d = t.data; const extra = body as Record<string, unknown>;
  let stored = true;
  try {
  await c.env.DB.prepare(
    "INSERT INTO telemetry (app_id, release, event, cold_start_ms, bytes_downloaded, apply_ms, device_class, published_at, device_model, android_api, via) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(d.app_id, d.release, d.event, d.cold_start_ms ?? null, d.bytes_downloaded ?? null, d.apply_ms ?? null, d.device_class ?? null,
    typeof extra.published_at === "string" ? extra.published_at.slice(0, 40) : null,
    typeof extra.device_model === "string" ? extra.device_model.slice(0, 80) : null,
    Number.isInteger(extra.android_api) ? extra.android_api : null,
    extra.via === "patch" || extra.via === "full" ? extra.via : null).run();
  } catch (e) {
    // D1 can refuse writes (for example the Free plan daily limit). Never send a 5xx to the phone.
    stored = false;
    console.error("telemetry insert failed (event dropped; if D1 is not at its limit, check for schema errors)", e);
  }
  let kv: { failed: number; healthy: number } | undefined;
  if (!stored && c.env.POINTERS) {
    try {
      const bump = async (k: string, ttl: number) => { const n = (Number(await c.env.POINTERS.get(k)) || 0) + 1; await c.env.POINTERS.put(k, String(n), { expirationTtl: ttl }); return n; };
      // KV read-then-put is not atomic: concurrent drops can undercount. Fine for an operator signal.
      await bump(`telemetry_dropped/${d.app_id}/${utcDay()}`, 7 * 86400);
      await bump(`telemetry_dropped_total/${utcDay()}`, 7 * 86400);
      const isFailed = FAILED_EVENTS.includes(d.event), isHealthy = HEALTHY_EVENTS.includes(d.event);
      if (isFailed || isHealthy) {
        // Count both sides per release (1h TTL) so the fallback ratio is not failures against zero.
        const fk = `telemetry_failed/${d.app_id}/${d.release}`, hk = `telemetry_healthy/${d.app_id}/${d.release}`;
        const f = isFailed ? await bump(fk, 3600) : Number(await c.env.POINTERS.get(fk)) || 0;
        const h = isHealthy ? await bump(hk, 3600) : Number(await c.env.POINTERS.get(hk)) || 0;
        kv = { failed: f, healthy: h };
      }
    } catch (e) { console.error("telemetry fallback counter failed", e); }
  }
  // Halting is a best-effort side effect: never fail the response.
  if (FAILED_EVENTS.includes(d.event)) { try { await maybeHalt(c.env, d.app_id, d.release, kv); } catch (e) { console.error("halt check failed", e); } }
  if (stored && REVERT_EVENTS.has(d.event)) {
    const job = sendRevertAlert(c.env.DB, d.app_id, d.release, d.event);
    try { c.executionCtx.waitUntil(job); } catch { /* no execution context (tests, local): the job runs on its own */ }
  }
  return c.json(stored ? { ok: true } : { ok: true, stored: false }, 202);
});

/** Spike read-out: latest telemetry rows for an app. Public on purpose for the spike; behind Access later. */
app.get("/t/:app", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const { results } = await c.env.DB.prepare("SELECT * FROM telemetry WHERE app_id = ? ORDER BY id DESC LIMIT 100").bind(appId).all();
  return c.json(results);
});

/** Per-release summary: event counts and median apply_ms / cold_start_ms for the 20 newest releases. */
const TOP_RELEASES = "SELECT release FROM telemetry WHERE app_id = ? GROUP BY release ORDER BY MAX(id) DESC LIMIT 20";
const medianSql = (col: string) =>
  `SELECT release, AVG(v) AS m FROM (SELECT release, ${col} AS v, ROW_NUMBER() OVER (PARTITION BY release ORDER BY ${col}) AS rn, COUNT(*) OVER (PARTITION BY release) AS cnt FROM telemetry WHERE app_id = ? AND ${col} IS NOT NULL AND release IN (${TOP_RELEASES})) WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2) GROUP BY release`;
app.get("/t/:app/summary", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  // The summary stays public. A caller who presents this app's publish token is checked against its role.
  if ((c.req.header("authorization") ?? "").includes("sv_publish_")) {
    const pub = await publisher(c, appId);
    const no = pub ? forbidden(pub.role, "read_summary") : null; if (no) return c.json(no, 403);
  }
  const counts = await c.env.DB.prepare(`SELECT release, event, COUNT(*) AS n, MAX(id) AS last_id FROM telemetry WHERE app_id = ? AND release IN (${TOP_RELEASES}) GROUP BY release, event`).bind(appId, appId).all<{ release: number; event: string; n: number; last_id: number }>();
  const apply = await c.env.DB.prepare(medianSql("apply_ms")).bind(appId, appId).all<{ release: number; m: number }>();
  const cold = await c.env.DB.prepare(medianSql("cold_start_ms")).bind(appId, appId).all<{ release: number; m: number }>();
  const byRelease = new Map<number, { release: number; events: Record<string, number>; last: number }>();
  for (const r of counts.results) {
    const e = byRelease.get(r.release) ?? { release: r.release, events: {}, last: 0 };
    e.events[r.event] = r.n; e.last = Math.max(e.last, r.last_id);
    byRelease.set(r.release, e);
  }
  const med = (rows: { release: number; m: number }[]) => new Map(rows.map((r) => [r.release, r.m]));
  const a = med(apply.results), k = med(cold.results);
  const releases = [...byRelease.values()].sort((x, y) => y.last - x.last)
    .map((e) => ({ release: e.release, events: e.events, apply_ms_median: a.get(e.release) ?? null, cold_start_ms_median: k.get(e.release) ?? null }));
  // The halt object for this app, or null. A missing or corrupt value is null.
  let halted: unknown = null;
  const haltRaw = c.env.POINTERS ? await c.env.POINTERS.get(`halt/${appId}`) : null;
  if (haltRaw) { try { const v = JSON.parse(haltRaw); if (v && typeof v === "object") halted = v; } catch { /* corrupt: null */ } }
  // The auto-halt setting, so `shipvo status` can show it. Not secret. Null means off.
  let auto_halt: { threshold: number; min_reports: number } | null = null;
  const cfgRaw = c.env.POINTERS ? await c.env.POINTERS.get(`halt-config/${appId}`) : null;
  if (cfgRaw) { try { const v = JSON.parse(cfgRaw); if (v && typeof v.threshold === "number" && v.threshold > 0 && v.threshold <= 1) auto_halt = { threshold: v.threshold, min_reports: typeof v.min_reports === "number" ? v.min_reports : 20 }; } catch { /* corrupt: off */ } }
  return c.json({ releases, halted, auto_halt });
});

app.get("/band/:cohort", (c) => {
  try { return c.json({ band: bandForCohort(Number(c.req.param("cohort"))) }); }
  catch { return c.json({ error: "cohort must be 0-999" }, 400); }
});

/* ---------- live content: what every device renders; the admin publishes new versions ---------- */
app.get("/c/:app/content.json", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const raw = await c.env.POINTERS.get(`c/${appId}/content.json`);
  if (!raw) return c.json({ error: "no_content" }, 404);
  const version = (raw.match(/"version":(\d+)/) ?? [])[1] ?? "0";
  const etag = `"${version}"`;
  const h = { ETag: etag, "cache-control": "no-cache", "access-control-allow-origin": "*", "access-control-expose-headers": "ETag" };
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
  return new Response(raw, { headers: { ...h, "content-type": "application/json" } });
});

/* ---------- orders placed in the app ---------- */
app.post("/o/:app", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  let body: any; try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  const o = body?.order;
  if (!o || typeof o.id !== "string" || !o.id || o.id.length > 40 || !Array.isArray(o.lines) || !Number.isFinite(o.total)) return c.json({ error: "bad_order" }, 400);
  const json = JSON.stringify({ order: o, content_version: body.content_version ?? null, release: body.release ?? null });
  if (json.length > 20_000) return c.json({ error: "too_large" }, 413);
  const reply = (status: string, duplicate = false) => status === "price_mismatch"
    ? c.json({ ok: false, error: "price_mismatch", status, duplicate }, 422) : c.json({ ok: true, status, duplicate }, 202);
  const ip = await sha(c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown");
  const install = typeof body.install_id === "string" && body.install_id ? body.install_id.slice(0, 64) : null;
  // Idempotency key. Order ids are not unique across customers (the Tide app starts every customer at TT-1001),
  // so the key is the client's idempotency_key, else (install_id or IP hash) + order id + a hash of the
  // order body. Without the body hash, two customers behind one IP who both place TT-1001 would collide and the second order would be lost.
  // With it, only a byte-identical retry is a duplicate.
  // Another install or key can never collide with it, so nobody can squat an id to block a real order.
  const idem = typeof body.idempotency_key === "string" && body.idempotency_key ? "k:" + body.idempotency_key.slice(0, 64)
    : `${install ? `i:${install}` : `p:${ip}`}:${o.id}:${(await sha(json)).slice(0, 16)}`;
  const first = await c.env.DB.prepare("SELECT status FROM orders WHERE app_id = ? AND idem = ?").bind(appId, idem).first<{ status: string }>();
  if (first) return reply(first.status, true);
  // Rate limits per IP and per install, over the last minute. The count and the insert are not atomic,
  // so a burst can overshoot the limit slightly. That is fine at this scale.
  const since = new Date(Date.now() - 60_000).toISOString();
  const n = async (col: string, v: string) => (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE app_id = ? AND ${col} = ? AND received_at > ?`).bind(appId, v, since).first<{ n: number }>())?.n ?? 0;
  if ((await n("ip_hash", ip)) >= RATE_PER_IP || (install && (await n("install", install)) >= RATE_PER_INSTALL)) return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  // A price_mismatch row keeps idem NULL, so it never answers for the key: a retry with corrected content can succeed.
  // Simulated orders (from the simulator) stay labelled and are never settled. The label can only lower trust.
  const simulated = body.simulated === true || c.req.header("x-shipvo-simulated") === "1";
  let status: string = "unverified", why: string[] = [];
  if (simulated) status = "simulated";
  else {
    why = checkPrices(o, await contentFor(c.env.DB, c.env.POINTERS, appId, body.content_version));
    if (why.length) status = "price_mismatch";
  }
  const stored = why.length ? JSON.stringify({ order: o, content_version: body.content_version ?? null, release: body.release ?? null, price_errors: why.slice(0, 5) }) : json;
  const ins = await c.env.DB.prepare("INSERT INTO orders (app_id, order_id, total, json, status, simulated, ip_hash, install, idem) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id, idem) DO NOTHING")
    .bind(appId, o.id, Math.round(o.total), stored, status, simulated ? 1 : 0, ip, install, status === "price_mismatch" ? null : idem).run();
  if ((ins as any)?.meta?.changes === 0) {
    // A concurrent request with the same key won the race: report what it stored.
    const won = await c.env.DB.prepare("SELECT status FROM orders WHERE app_id = ? AND idem = ?").bind(appId, idem).first<{ status: string }>();
    if (won) return reply(won.status, true);
  }
  return reply(status);
});

/** The merchant's backend confirms payment for one order. Owner token only: an admin cookie or the app itself cannot do this. */
app.post("/app/:id/api/orders/:order/settle", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if ((await owner(c, appId)) !== AGENT_ACTOR) return c.json({ error: "unauthorized", message: "Send the owner token as a bearer token" }, 401);
  const body: any = await c.req.json().catch(() => ({}));
  // Order ids are not unique, so a backend may name the row with the same install_id or idempotency_key it was placed with.
  const sel = typeof body?.idempotency_key === "string" ? ["idem", "k:" + body.idempotency_key.slice(0, 64)] : typeof body?.install_id === "string" ? ["install", body.install_id.slice(0, 64)] : null;
  const rows = (await c.env.DB.prepare(`SELECT id, status, total FROM orders WHERE app_id = ? AND order_id = ?${sel ? ` AND ${sel[0]} = ?` : ""}`).bind(...(sel ? [appId, c.req.param("order"), sel[1]] : [appId, c.req.param("order")])).all<{ id: number; status: string; total: number }>()).results ?? [];
  if (!rows.length) return c.json({ error: "not_found" }, 404);
  if (rows.length > 1) return c.json({ error: "ambiguous", message: "Several orders share this id. Send idempotency_key or install_id in the body." }, 409);
  const row = rows[0];
  if (body?.amount !== undefined && body.amount !== row.total) return c.json({ error: "amount_mismatch", expected: row.total }, 409);
  if (row.status === "settled") return c.json({ ok: true, status: "settled", already: true });
  if (row.status !== "unverified") return c.json({ error: "cannot_settle", status: row.status }, 409);
  await c.env.DB.prepare("UPDATE orders SET status = 'settled', settled_at = ?, settlement_ref = ? WHERE id = ? AND status = 'unverified'")
    .bind(new Date().toISOString(), typeof body?.reference === "string" ? body.reference.slice(0, 80) : null, row.id).run();
  return c.json({ ok: true, status: "settled" });
});

/* ---------- admin ---------- */
app.get("/app/:id/admin", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.text("bad app id", 400);
  if (!(await owner(c, appId))) return c.html(loginPage(appId));
  return c.html(adminPage(appId));
});
app.post("/app/:id/admin/login", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.text("bad app id", 400);
  const form = await c.req.parseBody();
  if (!c.env.ADMIN_PASSWORD || !safeEqual(String(form.password ?? ""), c.env.ADMIN_PASSWORD)) return c.html(loginPage(appId, "Wrong password"), 401);
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  setCookie(c, "pn_admin", `${appId}.${exp}.${await hmac(c.env.ADMIN_PASSWORD, `${appId}.${exp}`)}`, { httpOnly: true, secure: true, sameSite: "Strict", path: `/app/${appId}`, maxAge: 7 * 24 * 3600 });
  return c.redirect(`/app/${appId}/admin`, 303);
});
app.get("/app/:id/api/describe", async (c) => {
  const appId = c.req.param("id");
  if (!(await owner(c, appId))) return c.json({ error: "unauthorized" }, 401);
  return c.json({ app: appId, commands: describeOwner() });
});
app.post("/app/:id/api/command", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const actor = await owner(c, appId);
  if (!actor) return c.json({ ok: false, error: { code: "unauthorized", message: "Sign in or send the owner token" } }, 401);
  let body: any; try { body = await c.req.json(); } catch { return c.json({ ok: false, error: { code: "bad_json", message: "JSON body required" } }, 400); }
  // A bearer owner token means an AI agent; a signed-in admin is the owner at the keyboard. Agents get the confirm gate.
  const agent = actor === AGENT_ACTOR;
  const list = (c.req.header("x-shipvo-agent-deny") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const local = agent ? { agentPolicy: c.req.header("x-shipvo-agent-policy") ?? undefined, agentDeny: list } : undefined;
  return c.json(await runOwnerCommand({ db: c.env.DB, kv: c.env.POINTERS, appId, actor, agent, local }, String(body?.name ?? ""), body?.args ?? {}));
});

// Approval challenges (agentPolicy "ask"). Anyone who is the owner may list them; only the signed-in admin session may decide.
// The owner token and publish tokens are agent credentials, so they get 403 here.
app.get("/app/:id/api/approvals", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if (!(await owner(c, appId))) return c.json({ error: "unauthorized" }, 401);
  const list = await listChallenges({ kv: c.env.POINTERS, appId });
  return c.json({ app: appId, approvals: list.map((x) => ({ id: x.id, command: x.command, args_hash: x.args_hash, requester: x.requester, plan: x.plan, created_at: x.created_at, expires_at: x.expires_at, approval_url: `/app/${appId}/admin?approve=${x.id}` })) });
});
for (const verb of ["approve", "deny"] as const) app.post(`/app/:id/api/approvals/:cid/${verb}`, async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const actor = await owner(c, appId);
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  if (actor === AGENT_ACTOR) return c.json({ ok: false, error: { code: "agent_cannot_approve", message: "Only the owner signed in to the admin can decide an approval. A token cannot." } }, 403);
  const r = await resolveChallenge({ db: c.env.DB, kv: c.env.POINTERS, appId, actor }, c.req.param("cid"), verb, actor, "admin session");
  return c.json(r, r.ok ? 200 : r.error.code === "approval_not_found" ? 404 : 409);
});

/**
 * Auto-halt settings for one app, stored in KV `halt-config/<app>`. Allowed for the owner (admin session or owner token)
 * or the app's publish token, which is what `shipvo auto-halt` sends. GET returns {enabled, threshold?, min_reports?}.
 * PUT {threshold, min_reports?} turns it on; DELETE turns it off.
 */
async function haltConfigAuth(c: any, appId: string) { return (await owner(c, appId)) || (await publisher(c, appId)); }
/** Owner and role-less publish tokens act as admin; a publish token with a role must be allowed the action. Returns a 403 Response or null. */
async function roleDenied(c: any, appId: string, action: Action): Promise<Response | null> {
  if (await owner(c, appId)) return null;
  const pub = await publisher(c, appId);
  const no = forbidden(pub?.role, action);
  return no ? c.json(no, 403) : null;
}
const bad = (c: any, message: string) => c.json({ error: "bad_halt_config", message }, 400);
app.get("/app/:id/api/halt-config", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if (!(await haltConfigAuth(c, appId))) return c.json({ error: "unauthorized" }, 401);
  { const no = await roleDenied(c, appId, "read_summary"); if (no) return no; }
  const raw = await c.env.POINTERS.get(`halt-config/${appId}`);
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v.threshold === "number") return c.json({ enabled: true, threshold: v.threshold, min_reports: typeof v.min_reports === "number" ? v.min_reports : 20 });
    } catch { /* corrupt: treated as off */ }
  }
  return c.json({ enabled: false });
});
app.put("/app/:id/api/halt-config", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if (!(await haltConfigAuth(c, appId))) return c.json({ error: "unauthorized" }, 401);
  { const no = await roleDenied(c, appId, "halt"); if (no) return no; }
  let body: any; try { body = await c.req.json(); } catch { return bad(c, "body must be JSON like {\"threshold\": 0.2}"); }
  const t = body?.threshold, m = body?.min_reports === undefined ? 20 : body.min_reports;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > 1) return bad(c, "threshold must be a number above 0 and at most 1");
  if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 10000) return bad(c, "min_reports must be an integer from 1 to 10000");
  await c.env.POINTERS.put(`halt-config/${appId}`, JSON.stringify({ threshold: t, min_reports: m }));
  return c.json({ enabled: true, threshold: t, min_reports: m });
});
app.delete("/app/:id/api/halt-config", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if (!(await haltConfigAuth(c, appId))) return c.json({ error: "unauthorized" }, 401);
  { const no = await roleDenied(c, appId, "halt"); if (no) return no; }
  await c.env.POINTERS.delete(`halt-config/${appId}`);
  return c.json({ enabled: false });
});

/** Audit rows for one app, newest first. ?limit= (default 50, max 200), ?before=<id>. Owner or the app's publish token. */
app.get("/audit/:app", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  if (!(await haltConfigAuth(c, appId))) return c.json({ error: "unauthorized" }, 401);
  { const no = await roleDenied(c, appId, "read_audit"); if (no) return no; }
  const lq = c.req.query("limit"), bq = c.req.query("before");
  const limit = lq === undefined ? 50 : Number(lq);
  if (!Number.isInteger(limit) || limit < 1) return c.json({ error: "bad_request", message: "limit must be a positive integer" }, 400);
  if (bq !== undefined && !/^\d+$/.test(bq)) return c.json({ error: "bad_request", message: "before must be a row id" }, 400);
  const n = Math.min(limit, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, app_id, at, actor, actor_kind, action, release, release_id, before, after FROM audit_log WHERE app_id = ?${bq !== undefined ? " AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
  ).bind(...(bq !== undefined ? [appId, Number(bq), n] : [appId, n])).all();
  return c.json({ app: appId, rows: results ?? [] }, 200, { "cache-control": "no-store" });
});

app.route("/auth", auth);
app.route("/apps", apps);

/** Hourly cron: copy new telemetry to the owner's R2 bucket as Parquet (only when the EXPORT_BUCKET binding is set). */
export default Object.assign(app, {
  scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(exportTelemetry(env).catch((e) => console.error("telemetry export failed", e)));
  },
});
