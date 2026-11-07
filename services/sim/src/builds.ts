// Uploaded builds: private to the account, deleted on expiry. The R2 object holds the build and its custom
// metadata holds the account and the expiry, so no table is needed. Takes the bucket as a parameter so tests can fake it.
export interface BuildBucket {
  put(key: string, body: ArrayBuffer | Uint8Array, o: { customMetadata: Record<string, string> }): Promise<unknown>;
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
  delete(key: string): Promise<unknown>;
  list(o: { prefix: string; cursor?: string; include?: string[] }): Promise<{ objects: { key: string; customMetadata?: Record<string, string> }[]; truncated: boolean; cursor?: string }>;
}
export type BuildEnv = { BUILDS?: BuildBucket; MAX_BUILD_BYTES?: string; BUILD_TTL_S?: string };

/** Used when MAX_BUILD_BYTES is missing or not a positive number: the limit is never "unlimited". */
export const DEFAULT_MAX_BUILD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_BUILD_TTL_S = 3600;
const pos = (v: string | undefined, d: number) => { const n = Number(v); return v && Number.isFinite(n) && n > 0 ? n : d; };
const reply = (o: unknown, status: number, h: Record<string, string>) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...h } });
const TOO_LARGE = { code: "build_too_large", message: "the build is too large. Make it smaller: remove unused images, fonts and packages, drop assets the simulator does not need, then upload again." };

/** Read the body, stopping as soon as it passes `max`. Returns null when it is too large. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = []; let n = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export async function builds(req: Request, env: BuildEnv, url: URL, account: number | null, headers: Record<string, string> = {}): Promise<Response> {
  const bucket = env.BUILDS;
  if (!bucket) return reply({ code: "builds_unavailable", message: "uploaded builds are not enabled here" }, 503, headers);
  if (account == null) return reply({ code: "unauthorized", message: "this key has no account" }, 401, headers);
  if (req.method === "POST" && url.pathname === "/builds") {
    const body = await readCapped(req, pos(env.MAX_BUILD_BYTES, DEFAULT_MAX_BUILD_BYTES));
    if (!body) return reply(TOO_LARGE, 413, headers);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expires_at = new Date(Date.now() + pos(env.BUILD_TTL_S, DEFAULT_BUILD_TTL_S) * 1000).toISOString();
    await bucket.put(`builds/${id}`, body, { customMetadata: { account: String(account), app: (url.searchParams.get("app") ?? "").slice(0, 80), expires_at } });
    return reply({ id, expires_at, bytes: body.byteLength }, 201, headers);
  }
  const m = req.method === "GET" && /^\/builds\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (!m) return reply({ code: "not_found" }, 404, headers);
  const head = await bucket.head(`builds/${m[1]}`);
  const meta = head?.customMetadata;
  // Another account's build answers the same as a missing one, so ids cannot be probed.
  if (!head || !meta || meta.account !== String(account)) return reply({ code: "build_not_found" }, 404, headers);
  if (meta.expires_at < new Date().toISOString()) { await bucket.delete(`builds/${m[1]}`); return reply({ code: "build_expired" }, 410, headers); }
  return reply({ id: m[1], app: meta.app, expires_at: meta.expires_at }, 200, headers);
}

/** Delete every build whose expiry has passed (the hourly cron). Returns how many were deleted. */
export async function sweepBuilds(env: BuildEnv, now = new Date().toISOString()): Promise<number> {
  if (!env.BUILDS) return 0;
  let cursor: string | undefined, n = 0;
  do {
    const l = await env.BUILDS.list({ prefix: "builds/", cursor, include: ["customMetadata"] });
    for (const o of l.objects) if ((o.customMetadata?.expires_at ?? "") < now) { await env.BUILDS.delete(o.key); n++; }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return n;
}
