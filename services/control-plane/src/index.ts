import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ReleasePointerBody, SignedEnvelope, Telemetry, bandForCohort } from "@shipvo/schema";
import { adminPage, loginPage } from "./admin";
import { AGENT_ACTOR, describeOwner, listChallenges, resolveChallenge, runOwnerCommand } from "./owner";
import { auth } from "./auth";
import { vaultRoutes } from "./vault";
import { forbidden, type Action } from "./roles";
import { REVERT_EVENTS, sendRevertAlert } from "./alerts";
import { apps, publisher } from "./apps";
import { exportTelemetry } from "./export";
import { recordAudit } from "./audit";
import { decideOffer, type OfferResult } from "./offer";
import { TELEMETRY_LIMITS, check as rateCheck } from "./ratelimit";
import { installs, verifyReport } from "./installs";
import { FAILED_EVENTS, HEALTHY_EVENTS, DEFAULT_MIN_REPORTS, DEFAULT_MIN_INSTALLS, shouldHalt, tallyVotes, type InstallVote } from "./halt";

type Env = { POINTERS: KVNamespace; DB: D1Database; ADMIN_PASSWORD?: string; OWNER_TOKEN?: string; GITHUB_CLIENT_ID?: string; SIM_URL?: string; EXPORT_BUCKET?: R2Bucket; TELEMETRY_SECRET?: string; VAULT_MASTER_KEY?: string };
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
  const query = { hbc: c.req.query("hbc"), hbe: c.req.query("hbe"), nm: c.req.query("nm") };
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
async function maybeHalt(env: Env, appId: string, release: number): Promise<void> {
  if (!env.POINTERS) return;
  const raw = await env.POINTERS.get(`halt-config/${appId}`);
  if (!raw) return;
  let cfg: { threshold?: unknown; min_reports?: unknown; min_installs?: unknown };
  try { cfg = JSON.parse(raw); } catch { return; }
  if (!cfg || typeof cfg !== "object") return;
  const threshold = typeof cfg.threshold === "number" ? cfg.threshold : undefined;
  const minReports = typeof cfg.min_reports === "number" ? cfg.min_reports : DEFAULT_MIN_REPORTS;
  const minInstalls = typeof cfg.min_installs === "number" ? cfg.min_installs : DEFAULT_MIN_INSTALLS;
  // Only verified reports count. If D1 cannot be read there is nothing verified to count, so the error propagates and no halt happens.
  const failedList = FAILED_EVENTS.map((e) => `'${e}'`).join(",");
  const healthyList = HEALTHY_EVENTS.map((e) => `'${e}'`).join(",");
  const rows = (await env.DB.prepare(
    `SELECT t.install_id AS install_id, i.net_hash AS net_hash, MAX(t.event IN (${failedList})) AS failed, MAX(t.event IN (${healthyList})) AS healthy ` +
    "FROM telemetry t LEFT JOIN installs i ON i.app_id = t.app_id AND i.install_id = t.install_id " +
    "WHERE t.app_id = ? AND t.release = ? AND t.verified = 1 AND t.install_id IS NOT NULL GROUP BY t.install_id, i.net_hash"
  ).bind(appId, release).all<{ install_id: string; net_hash: string | null; failed: number; healthy: number }>()).results ?? [];
  const votes: InstallVote[] = rows.map((r) => ({ install_id: r.install_id, net_hash: r.net_hash, failed: !!r.failed, healthy: !!r.healthy }));
  const counts = tallyVotes(votes);
  const verdict = shouldHalt(counts, { threshold, minReports, minInstalls });
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
app.route("/", installs);
app.post("/t", async (c) => {
  const tooMany = (wait: number) => c.json({ error: "rate_limited" }, 429, { "retry-after": String(wait) });
  const ipWait = await rateCheck(c.env.POINTERS, "telemetry", TELEMETRY_LIMITS, { ip: c.req.header("cf-connecting-ip") ?? "unknown" });
  if (ipWait) return tooMany(ipWait);
  let body: any;
  const raw = await c.req.text();
  try { body = JSON.parse(raw); } catch { return c.json({ error: "bad_json" }, 400); }
  const t = Telemetry.safeParse(body);
  if (!t.success || !ID.test(t.data.app_id)) return c.json({ error: "bad_telemetry" }, 400);
  const d = t.data; const extra = body as Record<string, unknown>;
  // Old runtimes send no install id: they are limited per IP and per app only.
  const installId = typeof extra.install_id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(extra.install_id) ? extra.install_id : undefined;
  let stored = true;
  // Signed reports are marked verified. Everything else is still stored for dashboards.
  // The signature is the `x-shipvo-sig` header or a `sig` field. A body signature covers the raw body with that field removed.
  const sig = c.req.header("x-shipvo-sig") ?? extra.sig;
  const signed = typeof extra.sig === "string" && sig === extra.sig ? raw.replace(`,"sig":"${extra.sig}"`, "").replace(`"sig":"${extra.sig}",`, "").replace(`"sig":"${extra.sig}"`, "") : raw;
  const verified = extra.install_id !== undefined && sig !== undefined && await verifyReport(c.env.DB, d.app_id, extra.install_id, sig, signed) ? 1 : 0;
  // Per-install and per-app caps count unverified reports only. The install id in an unsigned body is
  // untrusted, so a flooder could otherwise lock out a real device or starve the crash reports that
  // maybeHalt needs. Signed reports skip these caps; the per-IP cap above still applies to all.
  if (!verified) {
    const wait = await rateCheck(c.env.POINTERS, "telemetry", TELEMETRY_LIMITS, { appId: d.app_id, installId });
    if (wait) return tooMany(wait);
  }
  try {
  await c.env.DB.prepare(
    "INSERT INTO telemetry (app_id, release, event, cold_start_ms, bytes_downloaded, apply_ms, device_class, published_at, device_model, android_api, via, verified, install_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(d.app_id, d.release, d.event, d.cold_start_ms ?? null, d.bytes_downloaded ?? null, d.apply_ms ?? null, d.device_class ?? null,
    typeof extra.published_at === "string" ? extra.published_at.slice(0, 40) : null,
    typeof extra.device_model === "string" ? extra.device_model.slice(0, 80) : null,
    Number.isInteger(extra.android_api) ? extra.android_api : null,
    extra.via === "patch" || extra.via === "full" ? extra.via : null, verified, verified ? extra.install_id : null).run();
  } catch (e) {
    // D1 can refuse writes (for example the Free plan daily limit). Never send a 5xx to the phone.
    stored = false;
    console.error("telemetry insert failed (event dropped; if D1 is not at its limit, check for schema errors)", e);
  }
  if (!stored && c.env.POINTERS) {
    try {
      const bump = async (k: string, ttl: number) => { const n = (Number(await c.env.POINTERS.get(k)) || 0) + 1; await c.env.POINTERS.put(k, String(n), { expirationTtl: ttl }); return n; };
      // KV read-then-put is not atomic: concurrent drops can undercount. Fine for an operator signal.
      await bump(`telemetry_dropped/${d.app_id}/${utcDay()}`, 7 * 86400);
      await bump(`telemetry_dropped_total/${utcDay()}`, 7 * 86400);
    } catch (e) { console.error("telemetry fallback counter failed", e); }
  }
  // Halting is a best-effort side effect: never fail the response.
  if (FAILED_EVENTS.includes(d.event)) { try { await maybeHalt(c.env, d.app_id, d.release); } catch (e) { console.error("halt check failed", e); } }
  if (stored && REVERT_EVENTS.has(d.event)) {
    const job = sendRevertAlert(c.env.DB, d.app_id, d.release, d.event, verified === 1);
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
  let auto_halt: { threshold: number; min_reports: number; min_installs: number } | null = null;
  const cfgRaw = c.env.POINTERS ? await c.env.POINTERS.get(`halt-config/${appId}`) : null;
  if (cfgRaw) { try { const v = JSON.parse(cfgRaw); if (v && typeof v.threshold === "number" && v.threshold > 0 && v.threshold <= 1) auto_halt = { threshold: v.threshold, min_reports: typeof v.min_reports === "number" ? v.min_reports : DEFAULT_MIN_REPORTS, min_installs: typeof v.min_installs === "number" ? v.min_installs : DEFAULT_MIN_INSTALLS }; } catch { /* corrupt: off */ } }
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
const ORDER_LIMIT_IP = 60, ORDER_LIMIT_INSTALL = 20, ORDER_WINDOW_S = 60;
/** Fixed-window counter in KV. Read-then-put is not atomic, so concurrent bursts can slip a few extra through. */
async function overLimit(kv: KVNamespace | undefined, key: string, max: number): Promise<boolean> {
  if (!kv) return false;
  const k = `rl/o/${key}/${Math.floor(Date.now() / (ORDER_WINDOW_S * 1000))}`;
  const n = (Number(await kv.get(k)) || 0) + 1;
  await kv.put(k, String(n), { expirationTtl: ORDER_WINDOW_S * 2 });
  return n > max;
}
const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

type PriceCheck = { ok: true } | { ok: false; reason: string };
/** Recompute the total from the published content the order names. Mirrors the app's `totals`. */
function checkPrice(o: any, content: any): PriceCheck {
  const products: any[] = Array.isArray(content?.products) ? content.products : [];
  let subtotal = 0;
  const priced: { department: string; total: number }[] = [];
  for (const l of o.lines) {
    const p = products.find((x) => x.id === (l?.product_id ?? l?.sku));
    if (!p) return { ok: false, reason: "unknown_product" };
    if (!Number.isInteger(l.quantity) || l.quantity < 1) return { ok: false, reason: "bad_quantity" };
    if (l.unit_price !== undefined && l.unit_price !== p.price) return { ok: false, reason: "line_price" };
    subtotal += p.price * l.quantity; priced.push({ department: p.department, total: p.price * l.quantity });
  }
  let discount = 0;
  if (o.promo) {
    const promo = (Array.isArray(content.promos) ? content.promos : []).find((x: any) => x.active && x.code === o.promo);
    if (!promo) return { ok: false, reason: "unknown_promo" };
    const base = promo.departments ? priced.filter((l) => promo.departments.includes(l.department)).reduce((a, l) => a + l.total, 0) : subtotal;
    discount = subtotal >= promo.min_subtotal ? Math.round((base * promo.percent) / 100) : 0;
  }
  const fee = o.slot_id ? ((Array.isArray(content.slots) ? content.slots : []).find((x: any) => x.id === o.slot_id)?.fee ?? 0) : 0;
  return o.total === subtotal - discount + fee ? { ok: true } : { ok: false, reason: "total" };
}

app.post("/o/:app", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const raw = await c.req.text();
  let body: any; try { body = JSON.parse(raw); } catch { return c.json({ error: "bad_json" }, 400); }
  const o = body?.order;
  if (!o || typeof o.id !== "string" || !Array.isArray(o.lines) || !Number.isFinite(o.total)) return c.json({ error: "bad_order" }, 400);
  const json = JSON.stringify({ order: o, content_version: body.content_version ?? null, release: body.release ?? null });
  if (json.length > 20_000) return c.json({ error: "too_large" }, 413);
  // Only cf-connecting-ip is trusted: x-forwarded-for can be set by the caller.
  const ip = c.req.header("cf-connecting-ip");
  const install = typeof body.install_id === "string" && body.install_id ? body.install_id.slice(0, 64) : "anon";
  if ((ip && (await overLimit(c.env.POINTERS, `${appId}/ip/${ip}`, ORDER_LIMIT_IP))) || (await overLimit(c.env.POINTERS, `${appId}/i/${install}`, ORDER_LIMIT_INSTALL)))
    return c.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(ORDER_WINDOW_S) } });
  const orderId = o.id.slice(0, 40);
  // Prices come from the published content version the order names, never from the caller.
  const cv = body.content_version;
  const version = typeof cv === "number" ? cv : typeof cv === "string" && /^\d{1,9}$/.test(cv) ? Number(cv) : NaN;
  const row: any = Number.isInteger(version) && version >= 0
    ? await c.env.DB.prepare("SELECT json FROM content_versions WHERE app_id = ? AND version = ?").bind(appId, version).first() : null;
  if (!row) return c.json({ error: "unknown_release", reason: "unknown_release" }, 422);
  let content: any; try { content = JSON.parse(row.json); } catch { content = null; }
  if (!Array.isArray(content?.products) || !content.products.length) return c.json({ error: "missing_catalogue", reason: "missing_catalogue" }, 422);
  const check = checkPrice(o, content);
  if (!check.ok) {
    // idem stays NULL, so this row never answers for an idempotency key and a corrected retry is stored.
    await c.env.DB.prepare("INSERT INTO orders (app_id, order_id, total, json, status, idem) VALUES (?,?,?,?,?,?)").bind(appId, orderId, Math.round(o.total), json, "price_mismatch", null).run();
    return c.json({ error: "price_mismatch", reason: check.reason, order_id: orderId, status: "price_mismatch" }, 422);
  }
  const status = body.simulated === true ? "simulated" : "unverified";
  const idem = `i:${install}:${orderId}:${await sha256Hex(raw)}`;
  const res: any = await c.env.DB.prepare("INSERT OR IGNORE INTO orders (app_id, order_id, total, json, status, idem) VALUES (?,?,?,?,?,?)").bind(appId, orderId, Math.round(o.total), json, status, idem).run();
  if (res?.meta?.changes === 0) {
    const first: any = await c.env.DB.prepare("SELECT order_id, status FROM orders WHERE app_id = ? AND idem = ?").bind(appId, idem).first();
    return c.json({ ok: true, order_id: first?.order_id ?? orderId, status: first?.status ?? status, duplicate: true }, 202);
  }
  return c.json({ ok: true, order_id: orderId, status }, 202);
});

/** Mark an order paid. Owner only (admin session or owner token). Repeating the call changes nothing. */
app.post("/app/:id/api/orders/:order/settle", async (c) => {
  const appId = c.req.param("id");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const actor = await owner(c, appId);
  if (!actor) return c.json({ error: "unauthorized" }, 401);
  const orderId = c.req.param("order");
  const { results } = await c.env.DB.prepare("SELECT status FROM orders WHERE app_id = ? AND order_id = ?").bind(appId, orderId).all();
  const statuses: string[] = (results ?? []).map((r: any) => r.status);
  if (!statuses.length) return c.json({ error: "not_found" }, 404);
  if (!statuses.includes("unverified")) {
    if (statuses.includes("settled")) return c.json({ ok: true, order_id: orderId, status: "settled", already_settled: true });
    const status = statuses[0];
    return c.json({ error: "not_settleable", status, message: `An order that is ${status} cannot be settled.` }, 409);
  }
  const now = new Date().toISOString();
  const upd: any = await c.env.DB.prepare("UPDATE orders SET status = 'settled' WHERE app_id = ? AND order_id = ? AND status = 'unverified'").bind(appId, orderId).run();
  // A concurrent call may have settled it between our check and the update: then do not audit twice.
  if (!upd?.meta?.changes) return c.json({ ok: true, order_id: orderId, status: "settled", already_settled: true });
  await c.env.DB.prepare("INSERT INTO audit (app_id, at, actor, command, args_json, ok) VALUES (?,?,?,?,?,?)")
    .bind(appId, now, actor, "settle_order", JSON.stringify({ order_id: orderId }), 1).run();
  return c.json({ ok: true, order_id: orderId, status: "settled" });
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
      if (v && typeof v.threshold === "number") return c.json({ enabled: true, threshold: v.threshold, min_reports: typeof v.min_reports === "number" ? v.min_reports : DEFAULT_MIN_REPORTS, min_installs: typeof v.min_installs === "number" ? v.min_installs : DEFAULT_MIN_INSTALLS });
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
  const t = body?.threshold, m = body?.min_reports === undefined ? DEFAULT_MIN_REPORTS : body.min_reports, mi = body?.min_installs;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > 1) return bad(c, "threshold must be a number above 0 and at most 1");
  if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 10000) return bad(c, "min_reports must be an integer from 1 to 10000");
  if (mi !== undefined && (typeof mi !== "number" || !Number.isInteger(mi) || mi < 1 || mi > 10000)) return bad(c, "min_installs must be an integer from 1 to 10000");
  // A body without min_installs keeps the stored value, so re-running `shipvo auto-halt` does not erase it.
  let kept: number | undefined;
  if (mi === undefined) { try { const old = JSON.parse((await c.env.POINTERS.get(`halt-config/${appId}`)) ?? "null"); if (typeof old?.min_installs === "number") kept = old.min_installs; } catch { /* corrupt: no value to keep */ } }
  const minInst = mi ?? kept;
  await c.env.POINTERS.put(`halt-config/${appId}`, JSON.stringify({ threshold: t, min_reports: m, ...(minInst === undefined ? {} : { min_installs: minInst }) }));
  return c.json({ enabled: true, threshold: t, min_reports: m, min_installs: minInst ?? DEFAULT_MIN_INSTALLS });
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
app.route("/vault", vaultRoutes(owner));
app.route("/apps", apps);

/** Hourly cron: copy new telemetry to the owner's R2 bucket as Parquet (only when the EXPORT_BUCKET binding is set). */
export default Object.assign(app, {
  scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(exportTelemetry(env).catch((e) => console.error("telemetry export failed", e)));
  },
});
