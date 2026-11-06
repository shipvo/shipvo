// People sign in with an email magic link. This is separate from developer auth (auth.ts).
// Login tokens and session tokens are stored only as SHA-256 hashes.
import { Hono } from "hono";

export type PeopleEnv = { DB: D1Database; MAIL_WEBHOOK_URL?: string; PEOPLE_LOGIN_URL?: string };
export type Mailer = (env: PeopleEnv, mail: { to: string; subject: string; text: string }) => Promise<void>;

export const LOGIN_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86400_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const token = (prefix: string) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Default mailer: POST the message as JSON to MAIL_WEBHOOK_URL. */
const webhookMailer: Mailer = async (env, mail) => {
  if (!env.MAIL_WEBHOOK_URL) throw new Error("mail_not_configured");
  const r = await fetch(env.MAIL_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mail) });
  if (!r.ok) throw new Error(`mail_failed_${r.status}`);
};

/** The signed-in person's id from `Authorization: Bearer sv_person_…`, or null. */
export async function personId(c: { req: { header(n: string): string | undefined }; env: PeopleEnv }): Promise<number | null> {
  const t = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t.startsWith("sv_person_")) return null;
  const row = await c.env.DB.prepare("SELECT person_id, expires_at FROM people_sessions WHERE token_hash = ?").bind(await sha256(t)).first<{ person_id: number; expires_at: string }>();
  return row && row.expires_at > new Date().toISOString() ? row.person_id : null;
}

export function peopleRoutes(send: Mailer = webhookMailer) {
  const r = new Hono<{ Bindings: PeopleEnv }>();

  /** Ask for a sign-in link. The answer is the same whether or not the email is known. */
  r.post("/login", async (c) => {
    const { email } = (await c.req.json().catch(() => ({}))) as { email?: unknown };
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!EMAIL.test(e)) return c.json({ error: "bad_request", message: "a valid email is required" }, 400);
    const t = token("sv_login");
    const now = new Date();
    await c.env.DB.prepare("INSERT INTO people_login_tokens (token_hash, email, created_at, expires_at) VALUES (?,?,?,?)")
      .bind(await sha256(t), e, now.toISOString(), new Date(now.getTime() + LOGIN_TTL_MS).toISOString()).run();
    const link = c.env.PEOPLE_LOGIN_URL ? `${c.env.PEOPLE_LOGIN_URL}${c.env.PEOPLE_LOGIN_URL.includes("?") ? "&" : "?"}token=${t}` : t;
    try { await send(c.env, { to: e, subject: "Your Shipvo sign-in link", text: `Use this to sign in to Shipvo. It works once and expires in 15 minutes.\n\n${link}\n` }); }
    catch (err) {
      console.error("people login mail failed", (err as Error).message);
      return c.json({ error: "mail_unavailable", message: "Sign-in email could not be sent. Try again later." }, 503);
    }
    return c.json({ ok: true, message: "If the address is valid, a sign-in link is on its way." }, 202, { "cache-control": "no-store" });
  });

  /** Exchange a login token for a session token. One use only. */
  r.post("/verify", async (c) => {
    const { token: t } = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    if (typeof t !== "string" || !t.startsWith("sv_login_")) return c.json({ error: "bad_request" }, 400);
    const nowIso = new Date().toISOString();
    const h = await sha256(t);
    // One conditional UPDATE claims the token, so two racing requests cannot both win.
    const claimed = await c.env.DB.prepare("UPDATE people_login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(nowIso, h, nowIso).run();
    if (!(claimed as any).meta?.changes) return c.json({ error: "invalid_or_expired" }, 410);
    const row = (await c.env.DB.prepare("SELECT email FROM people_login_tokens WHERE token_hash = ?").bind(h).first<{ email: string }>())!;
    await c.env.DB.prepare("INSERT INTO people (email, created_at, last_login_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at").bind(row.email, nowIso, nowIso).run();
    const p = (await c.env.DB.prepare("SELECT id FROM people WHERE email = ?").bind(row.email).first<{ id: number }>())!;
    await c.env.DB.prepare("INSERT OR IGNORE INTO phones (person_id, created_at, updated_at) VALUES (?,?,?)").bind(p.id, nowIso, nowIso).run();
    const session = token("sv_person");
    const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await c.env.DB.prepare("INSERT INTO people_sessions (token_hash, person_id, created_at, expires_at) VALUES (?,?,?,?)").bind(await sha256(session), p.id, nowIso, expires_at).run();
    return c.json({ session, expires_at }, 200, { "cache-control": "no-store" });
  });

  return r;
}
