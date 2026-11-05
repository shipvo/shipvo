import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ReleasePointerBody, SignedEnvelope, Telemetry, bandForCohort, checkNativeModules } from "@shipvo/schema";
import { adminPage, loginPage } from "./admin";
import { describeOwner, runOwnerCommand } from "./owner";
import { auth } from "./auth";
import { apps } from "./apps";
import { FAILED_EVENTS, HEALTHY_EVENTS, shouldHalt } from "./halt";

type Env = { POINTERS: KVNamespace; DB: D1Database; ADMIN_PASSWORD?: string; OWNER_TOKEN?: string; GITHUB_CLIENT_ID?: string; SIM_URL?: string };
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
  if (c.env.OWNER_TOKEN && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), c.env.OWNER_TOKEN)) return "agent (owner token)";
  const cookie = getCookie(c, "pn_admin");
  if (!cookie || !c.env.ADMIN_PASSWORD) return null;
  const [app_, exp, sig] = cookie.split(".");
  if (app_ !== appId || Number(exp) < Date.now()) return null;
  return safeEqual(sig ?? "", await hmac(c.env.ADMIN_PASSWORD, `${app_}.${exp}`)) ? "owner (admin)" : null;
}
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

app.get("/health", (c) => c.json({ ok: true, service: "shipvo-control", time: new Date().toISOString() }, 200, { "access-control-allow-origin": "*", "cache-control": "no-store" }));

/** Static hot path: signed release pointer envelope per app / shell major / (platform /) band. No device registry. Android pointers live at /p/<app>/<major>/<band>, iOS at /p/<app>/<major>/ios/<band>. */
async function servePointer(c: any, platform: "android" | "ios") {
  const { app: appId, major } = c.req.param();
  const band = c.req.param("band").replace(/\.json$/, "");
  if (!ID.test(appId) || !/^\d+$/.test(major)) return c.json({ error: "bad_request" }, 400);
  if (!["b0", "b1", "b2"].includes(band)) return c.json({ error: "bad_band" }, 400);
  const raw = await c.env.POINTERS.get(platform === "ios" ? `p/${appId}/${major}/ios/${band}` : `p/${appId}/${major}/${band}`);
  if (!raw) return c.json({ error: "no_release" }, 404);
  let release: number;
  try {
    const env = SignedEnvelope.parse(JSON.parse(raw));
    const body = ReleasePointerBody.parse(JSON.parse(env.body));
    release = body.release;
    // A shell may say which Hermes bytecode versions it runs: ?hbc=96,98. Without it, every release is offered.
    const hbc = c.req.query("hbc");
    if (hbc !== undefined && body.hermes_bytecode_version !== undefined) {
      const ok = hbc.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (ok.length === 0) return c.json({ error: "bad_request" }, 400);
      if (!ok.includes(body.hermes_bytecode_version)) return c.json({ error: "hermes_bytecode_mismatch" }, 404, { "cache-control": "public, max-age=5" });
    }
    // A shell may list its native modules: ?nm=@scope/pkg@1.2.3,other@2.0.0. Without it, or without required_native_modules, every release is offered.
    const nm = c.req.query("nm");
    if (nm !== undefined && body.required_native_modules !== undefined) {
      const shell: Record<string, string> = {};
      for (const item of nm.split(",").filter(Boolean)) { const i = item.lastIndexOf("@"); if (i <= 0) return c.json({ error: "bad_request" }, 400); shell[item.slice(0, i)] = item.slice(i + 1); }
      const bad = checkNativeModules(body.required_native_modules, shell);
      if (bad) return c.json({ error: bad.reason, module: bad.module, required: bad.required, ...(bad.have ? { have: bad.have } : {}) }, 404, { "cache-control": "public, max-age=5" });
    }
  } catch { return c.json({ error: "corrupt_pointer" }, 500); }
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
  let cfg: { threshold?: unknown; min_reports?: unknown };
  try { cfg = JSON.parse(raw); } catch { return; }
  if (!cfg || typeof cfg !== "object") return;
  const threshold = typeof cfg.threshold === "number" ? cfg.threshold : undefined;
  const minReports = typeof cfg.min_reports === "number" ? cfg.min_reports : 20;
  const { results } = await env.DB.prepare("SELECT event, COUNT(*) AS n FROM telemetry WHERE app_id = ? AND release = ? GROUP BY event").bind(appId, release).all<{ event: string; n: number }>();
  const counts = { healthy: 0, failed: 0 };
  for (const r of results ?? []) {
    if (HEALTHY_EVENTS.includes(r.event)) counts.healthy += r.n;
    else if (FAILED_EVENTS.includes(r.event)) counts.failed += r.n;
  }
  const verdict = shouldHalt(counts, { threshold, minReports });
  if (!verdict.halt) return;
  const key = `halt/${appId}`;
  const cur = await env.POINTERS.get(key);
  if (cur) { try { if (JSON.parse(cur).release === release) return; } catch { /* overwrite bad value */ } }
  await env.POINTERS.put(key, JSON.stringify({ release, halted_at: new Date().toISOString(), reports: verdict.reports, failed: counts.failed, threshold }));
}

/** Device telemetry for the spike: applied / reverted / timings. */
app.post("/t", async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  const t = Telemetry.safeParse(body);
  if (!t.success || !ID.test(t.data.app_id)) return c.json({ error: "bad_telemetry" }, 400);
  const d = t.data; const extra = body as Record<string, unknown>;
  await c.env.DB.prepare(
    "INSERT INTO telemetry (app_id, release, event, cold_start_ms, bytes_downloaded, apply_ms, device_class, published_at, device_model, android_api, via) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(d.app_id, d.release, d.event, d.cold_start_ms ?? null, d.bytes_downloaded ?? null, d.apply_ms ?? null, d.device_class ?? null,
    typeof extra.published_at === "string" ? extra.published_at.slice(0, 40) : null,
    typeof extra.device_model === "string" ? extra.device_model.slice(0, 80) : null,
    Number.isInteger(extra.android_api) ? extra.android_api : null,
    extra.via === "patch" || extra.via === "full" ? extra.via : null).run();
  if (FAILED_EVENTS.includes(d.event)) await maybeHalt(c.env, d.app_id, d.release);
  return c.json({ ok: true }, 202);
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
  return c.json({ releases });
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
  if (!o || typeof o.id !== "string" || !Array.isArray(o.lines) || !Number.isFinite(o.total)) return c.json({ error: "bad_order" }, 400);
  const json = JSON.stringify({ order: o, content_version: body.content_version ?? null, release: body.release ?? null });
  if (json.length > 20_000) return c.json({ error: "too_large" }, 413);
  await c.env.DB.prepare("INSERT INTO orders (app_id, order_id, total, json) VALUES (?,?,?,?)").bind(appId, o.id.slice(0, 40), Math.round(o.total), json).run();
  return c.json({ ok: true }, 202);
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
  return c.json(await runOwnerCommand({ db: c.env.DB, kv: c.env.POINTERS, appId, actor }, String(body?.name ?? ""), body?.args ?? {}));
});

app.route("/auth", auth);
app.route("/apps", apps);

export default app;
