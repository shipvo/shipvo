import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ReleasePointerBody, SignedEnvelope, Telemetry, bandForCohort } from "@shipvo/schema";
import { adminPage, loginPage } from "./admin";
import { describeOwner, runOwnerCommand } from "./owner";
import { auth } from "./auth";

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

app.get("/health", (c) => c.json({ ok: true, service: "purenative-control", time: new Date().toISOString() }));

/** Static hot path: signed release pointer envelope per app / shell major / band. No device registry. */
app.get("/p/:app/:major/:band", async (c) => {
  const { app: appId, major } = c.req.param();
  const band = c.req.param("band").replace(/\.json$/, "");
  if (!ID.test(appId) || !/^\d+$/.test(major)) return c.json({ error: "bad_request" }, 400);
  if (!["b0", "b1", "b2"].includes(band)) return c.json({ error: "bad_band" }, 400);
  const raw = await c.env.POINTERS.get(`p/${appId}/${major}/${band}`);
  if (!raw) return c.json({ error: "no_release" }, 404);
  let release: number;
  try {
    const env = SignedEnvelope.parse(JSON.parse(raw));
    release = ReleasePointerBody.parse(JSON.parse(env.body)).release;
  } catch { return c.json({ error: "corrupt_pointer" }, 500); }
  const etag = `"${release}"`;
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(raw, { headers: { "content-type": "application/json", ETag: etag, "cache-control": "public, max-age=5" } });
});

/** Immutable bundle bytes. Integrity is checked on device against the sha256 inside the signed pointer. */
// Agent-facing web artifact of a release: /w/<app>/r<N>/index.html and its files; /w/<app>/releases.json lists them.
app.get("/w/:app/releases.json", async (c) => {
  const appId = c.req.param("app"); if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const raw = await c.env.POINTERS.get(`w/${appId}/releases`);
  return raw ? new Response(raw, { headers: { "content-type": "application/json", "cache-control": "public, max-age=5", "access-control-allow-origin": "*" } }) : c.json({ error: "not_found" }, 404);
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
  return new Response(buf, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
});

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
  return c.json({ ok: true }, 202);
});

/** Spike read-out: latest telemetry rows for an app. Public on purpose for the spike; behind Access later. */
app.get("/t/:app", async (c) => {
  const appId = c.req.param("app");
  if (!ID.test(appId)) return c.json({ error: "bad_request" }, 400);
  const { results } = await c.env.DB.prepare("SELECT * FROM telemetry WHERE app_id = ? ORDER BY id DESC LIMIT 100").bind(appId).all();
  return c.json(results);
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

export default app;
