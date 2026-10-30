import { Hono } from "hono";
import { ReleasePointerBody, SignedEnvelope, Telemetry, bandForCohort } from "@purenative/schema";

type Env = { POINTERS: KVNamespace; DB: D1Database };
const app = new Hono<{ Bindings: Env }>();
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

app.get("/app/:id/admin", (c) => c.html(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>PureNative admin</title><h1>PureNative admin</h1><p>App <code>${c.req.param("id").replace(/[^a-zA-Z0-9_-]/g, "")}</code>. Admin UI arrives in a later build step.</p>`));

export default app;
