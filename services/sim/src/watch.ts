// Watch links for the hosted phone. The Worker signs a short-lived, read-only token for one session, serves the
// sandbox's /watch page and relays its socket. The token is the only credential in the URL; no API key ever is.
export type WatchEnv = { DB: D1Database; WATCH_SECRET?: string; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GITHUB_WEB?: string; GITHUB_API?: string };
export type Sandbox = (keyId: number, path: string, init?: RequestInit) => Promise<Response>;

export const WATCH_TTL_S = 3600;
const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function mac(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function seal(secret: string, payload: object) { const body = b64(enc.encode(JSON.stringify(payload))); return `${body}.${b64(await mac(secret, body))}`; }
async function open<T>(secret: string, token: string): Promise<T | null> {
  const [body, sig] = token.split("."); if (!body || !sig || token.split(".").length !== 2) return null;
  let given: Uint8Array; try { given = unb64(sig); } catch { return null; }
  const want = await mac(secret, body);
  if (given.length !== want.length) return null;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= given[i] ^ want[i];   // constant time
  if (diff) return null;
  try { return JSON.parse(new TextDecoder().decode(unb64(body))) as T; } catch { return null; }
}

type Claims = { use: "watch"; s: string; k: number; exp: number };
/** A read-only token for one session of one key. */
export const signWatchToken = (secret: string, session: string, keyId: number, now = Date.now()) => seal(secret, { use: "watch", s: session, k: keyId, exp: Math.floor(now / 1000) + WATCH_TTL_S } satisfies Claims);
/** The claims when the token is genuine, unexpired and for this session; otherwise null. */
export async function verifyWatchToken(secret: string, token: string, session: string, now = Date.now()): Promise<Claims | null> {
  const c = await open<Claims>(secret, token);
  if (!c || c.use !== "watch" || c.s !== session || typeof c.k !== "number" || !(c.exp > now / 1000)) return null;
  return c;
}
export const watchUrl = async (origin: string, secret: string, session: string, keyId: number) => `${origin}/watch/${encodeURIComponent(session)}?t=${await signWatchToken(secret, session, keyId)}`;

/** Adds the watch link to an open_app result (JSON-RPC response text). Other responses are returned unchanged. */
export async function addWatchUrl(body: string, link: (session: string) => Promise<string>): Promise<string> {
  let msg: any; try { msg = JSON.parse(body); } catch { return body; }
  const content = msg?.result?.content; if (!Array.isArray(content) || msg.result.isError) return body;
  const t = content.find((c: any) => c?.type === "text" && /^session: \S+/m.test(c.text)); if (!t) return body;
  const session = /^session: (\S+)/m.exec(t.text)![1];
  const url = await link(session);
  const i = t.text.indexOf("\n\n");
  const add = `watch_url: ${url}\nThe user can watch at ${url}.`;
  t.text = i < 0 ? `${t.text}\n${add}` : `${t.text.slice(0, i)}\n${add}${t.text.slice(i)}`;
  msg.result.structuredContent = { ...(msg.result.structuredContent ?? {}), watch_url: url };
  return JSON.stringify(msg);
}

/* ---------- the owner's sign-in cookie, for Take over ---------- */
const COOKIE = "sv_owner";
async function ownerOf(env: WatchEnv, req: Request): Promise<number | null> {
  const c = /(?:^|;\s*)sv_owner=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1]; if (!c || !env.WATCH_SECRET) return null;
  const v = await open<{ use: string; a: number; exp: number }>(env.WATCH_SECRET, c);
  return v && v.use === "owner" && v.exp > Date.now() / 1000 ? v.a : null;
}

const text = (status: number, msg: string) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const SOCKET_INPUT = new Set(["control", "tap", "swipe", "text", "key"]);
/** False for anything a viewer without Take over sends that could act on the phone (and for unparseable messages). */
export function allowFromViewer(data: string, canTakeOver: boolean): boolean {
  let j: any; try { j = JSON.parse(data); } catch { return false; }
  return canTakeOver || !SOCKET_INPUT.has(j?.type);
}

/** /watch/<session>, /watch/<session>/ws and the owner sign-in. Returns null for any other path. */
export async function handleWatch(req: Request, env: WatchEnv, sandbox: Sandbox): Promise<Response | null> {
  const url = new URL(req.url);
  const m = /^\/watch\/([^/]+)(\/ws)?$/.exec(url.pathname);
  if (url.pathname === "/watch/signin" || url.pathname === "/watch/signin/callback") return signIn(req, env, url);
  if (!m) return null;
  if (req.method !== "GET") return text(405, "Method not allowed");
  if (!env.WATCH_SECRET) return text(503, "Watch links are not available");
  const session = decodeURIComponent(m[1]);
  const claims = await verifyWatchToken(env.WATCH_SECRET, url.searchParams.get("t") ?? "", session);
  if (!claims) return text(403, "This watch link is not valid or has expired. Ask your assistant for a new one.");
  const key = await env.DB.prepare("SELECT account_id, expires_at FROM api_keys WHERE id = ? AND revoked_at IS NULL").bind(claims.k).first<{ account_id: number | null; expires_at: string | null }>();
  if (!key || (key.expires_at && key.expires_at < new Date().toISOString())) return text(403, "This watch link is not valid or has expired. Ask your assistant for a new one.");
  const owner = await ownerOf(env, req);
  const canTakeOver = owner !== null && key.account_id !== null && owner === key.account_id;
  const q = new URLSearchParams({ session, only: "1", hosted: "1" });
  if (canTakeOver) q.set("takeover", "1"); else if (env.GITHUB_CLIENT_ID) q.set("signin", `/watch/signin?next=${encodeURIComponent(url.pathname + url.search)}`);

  if (!m[2]) {
    const skin = url.searchParams.get("skin"); if (skin === "ios" || skin === "android") q.set("skin", skin);
    const r = await sandbox(claims.k, `/watch?${q}`).catch(() => null);
    if (!r?.ok) return text(502, "The phone is not available right now.");
    return new Response(r.body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return text(426, "Expected a WebSocket");
  const up = await sandbox(claims.k, `/watch/ws?${q}`, { headers: { upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": req.headers.get("sec-websocket-key") ?? "dGhlIHNhbXBsZSBub25jZQ==" } }).catch(() => null);
  const back = (up as any)?.webSocket as WebSocket | undefined;
  if (!back) return text(502, "The phone is not available right now.");
  back.accept();
  const pair = new WebSocketPair(); const [client, server] = [pair[0], pair[1]];
  server.accept();
  // Phone → viewer: only this session is listed. Viewer → phone: a viewer without Take over sends nothing that acts.
  back.addEventListener("message", (e) => {
    let out = e.data as string;
    if (typeof out === "string" && out.startsWith('{"type":"sessions"')) { try { const j = JSON.parse(out); j.sessions = j.sessions.filter((s: any) => s.session === session); out = JSON.stringify(j); } catch { return; } }
    try { server.send(out); } catch {}
  });
  server.addEventListener("message", (e) => {
    if (typeof e.data !== "string" || !allowFromViewer(e.data, canTakeOver)) return;
    try { back.send(e.data); } catch {}
  });
  back.addEventListener("close", () => { try { server.close(); } catch {} });
  server.addEventListener("close", () => { try { back.close(); } catch {} });
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

/* GitHub sign-in for Take over. The state is signed, so nothing is stored. */
async function signIn(req: Request, env: WatchEnv, url: URL): Promise<Response> {
  if (!env.WATCH_SECRET || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return text(503, "Sign-in is not available");
  const web = (env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, ""); const api = (env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, "");
  const safe = (n: string | null) => (n && /^\/watch\/[^/?#]+\?t=[A-Za-z0-9_.-]+$/.test(n) ? n : "/");
  if (url.pathname === "/watch/signin") {
    const state = await seal(env.WATCH_SECRET, { use: "state", next: safe(url.searchParams.get("next")), exp: Math.floor(Date.now() / 1000) + 600 });
    const gh = new URL(`${web}/login/oauth/authorize`);
    gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID); gh.searchParams.set("scope", "read:user"); gh.searchParams.set("state", state);
    gh.searchParams.set("redirect_uri", `${url.origin}/watch/signin/callback`);
    return new Response(null, { status: 302, headers: { location: gh.toString(), "cache-control": "no-store" } });
  }
  const st = await open<{ use: string; next: string; exp: number }>(env.WATCH_SECRET, url.searchParams.get("state") ?? "");
  if (!st || st.use !== "state" || st.exp < Date.now() / 1000 || !url.searchParams.get("code")) return text(400, "This sign-in link is not valid. Open the watch link again.");
  const h = { accept: "application/json", "content-type": "application/json", "user-agent": "shipvo-sim" };
  let ghId: number;
  try {
    const t: any = await (await fetch(`${web}/login/oauth/access_token`, { method: "POST", headers: h, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code") }) })).json();
    const u: any = t?.access_token ? await (await fetch(`${api}/user`, { headers: { ...h, authorization: `Bearer ${t.access_token}` } })).json() : null;
    if (!u?.id) return text(403, "Sign-in failed.");
    ghId = u.id;
  } catch { return text(502, "Sign-in failed."); }
  const acct = await env.DB.prepare("SELECT id FROM accounts WHERE github_id = ?").bind(ghId).first<{ id: number }>();
  if (!acct) return text(403, "No Shipvo account for this GitHub user.");
  const cookie = await seal(env.WATCH_SECRET, { use: "owner", a: acct.id, exp: Math.floor(Date.now() / 1000) + 8 * 3600 });
  return new Response(null, { status: 302, headers: { location: st.next, "set-cookie": `${COOKIE}=${cookie}; Path=/watch; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`, "cache-control": "no-store" } });
}
