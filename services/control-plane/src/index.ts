import { Hono } from "hono";
import { ReleasePointer, bandForCohort } from "@purenative/schema";

type Env = { POINTERS: KVNamespace; DB: D1Database };
const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "purenative-control", time: new Date().toISOString() }));

/** Static hot path: signed release pointer per app / shell major / band. Cached at the edge, no device registry. */
app.get("/p/:app/:major/:band", async (c) => {
  const { app: appId, major } = c.req.param();
  const band = c.req.param("band").replace(/\.json$/, "");
  if (!["b0", "b1", "b2"].includes(band)) return c.json({ error: "bad_band" }, 400);
  const raw = await c.env.POINTERS.get(`p/${appId}/${major}/${band}`);
  if (!raw) return c.json({ error: "no_release" }, 404);
  const parsed = ReleasePointer.safeParse(JSON.parse(raw));
  if (!parsed.success) return c.json({ error: "corrupt_pointer" }, 500);
  const etag = `"${parsed.data.release}"`;
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(raw, { headers: { "content-type": "application/json", ETag: etag, "cache-control": "public, max-age=30" } });
});

/** Helper for clients and tests: which band does this local cohort fall in. */
app.get("/band/:cohort", (c) => {
  try { return c.json({ band: bandForCohort(Number(c.req.param("cohort"))) }); }
  catch { return c.json({ error: "cohort must be 0-999" }, 400); }
});

app.get("/app/:id/admin", (c) => c.html(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>PureNative admin</title><h1>PureNative admin</h1><p>App <code>${c.req.param("id").replace(/[^a-zA-Z0-9_-]/g, "")}</code>. Admin UI arrives in a later build step.</p>`));

export default app;
