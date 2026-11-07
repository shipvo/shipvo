// The secret vault, slice 1: one-time tickets, the vault page, and encrypted storage.
// A value enters only through POST /vault/t/<ticket>. No endpoint returns a value, and nothing here logs one.
import { Hono } from "hono";
import { encryptSecret } from "./vault-crypto";

type Env = { DB: D1Database; VAULT_MASTER_KEY?: string };
type Who = (c: any, appId: string) => Promise<string | null>;
type Service = { domain: string; label: string; help: string; check: (value: string, f: typeof fetch) => Promise<{ valid: boolean | null; access: "read" | "write"; warning?: string }> };

export const TICKET_TTL_MS = 10 * 60_000;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_VALUE = 4096;

/** Known services get a fixed read-only test call. The URL is fixed here, never taken from a request. */
export const SERVICES: Record<string, Service> = {
  stripe: {
    domain: "api.stripe.com", label: "Stripe",
    help: "In the Stripe dashboard open Developers, API keys, Create restricted key. Give every permission 'None' or 'Read', then copy the key that starts with rk_. Do not paste a key that starts with sk_: it can change and move money.",
    async check(value, f) {
      const full = value.startsWith("sk_");
      let valid: boolean | null = null;
      try {
        const r = await f("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${value}` }, signal: AbortSignal.timeout(5000) });
        valid = r.ok ? true : r.status === 401 ? false : null;
      } catch { valid = null; }
      return { valid, access: full ? "write" : "read", warning: full ? "full_access_key" : undefined };
    },
  },
};

/** Plain-English text for the codes that JSON clients get. */
const WARNINGS: Record<string, string> = { full_access_key: "This key can change data and move money. Replace it with a restricted read-only key." };
const FAILURES: Record<string, string> = {
  bad_request: "We could not read that form. Go back and try again.",
  ticket_not_valid: "This link has already been used or has expired. Ask the assistant for a new one.",
  ticket_mismatch: "This link was made for a different app or key. Ask the assistant for a new one.",
  too_large: "That key is too long. Check that you copied only the key, then try again.",
  bad_value: "The key must not contain spaces or line breaks. Copy it again and paste only the key.",
  vault_not_configured: "The vault is not set up on this server yet, so nothing was saved. Tell the owner of this server.",
  save_failed: "Something went wrong and the key was not saved. Your link still works: go back and try again.",
};
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const newTicketId = () => { const r = crypto.getRandomValues(new Uint8Array(32)); return "vt_" + btoa(String.fromCharCode(...r)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); };
const TICKET = /^vt_[A-Za-z0-9_-]{43}$/;
const PAGE_HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#4a4a4a;--line:#767676;--accent:#1b4fd8;--on-accent:#fff;--warn-bg:#fff3cd;--warn-fg:#4d3b00}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--fg:#f0f0f0;--muted:#c4c4c4;--line:#8a8a8a;--accent:#8ab0ff;--on-accent:#0b1020;--warn-bg:#4a3b00;--warn-fg:#ffecb3}}
body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;background:var(--bg);color:var(--fg)}
input,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box;margin:.4rem 0;border-radius:8px;min-height:44px}
input{background:var(--bg);color:var(--fg);border:1px solid var(--line)}
button{background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);font-weight:600;cursor:pointer}
input:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
dl{display:grid;grid-template-columns:auto 1fr;gap:.2rem 1rem}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
.warn{background:var(--warn-bg);color:var(--warn-fg);padding:.6rem;border-radius:6px}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

export function vaultRoutes(who: Who, deps: { fetch?: typeof fetch } = {}) {
  const v = new Hono<{ Bindings: Env }>();
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  /** Ask for a one-time ticket. Authenticated as the app's owner or the assistant acting for them. */
  v.post("/tickets", async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const appId = typeof b?.app === "string" ? b.app : "";
    const name = typeof b?.name === "string" ? b.name : "";
    const service = typeof b?.service === "string" ? b.service.toLowerCase() : "";
    const purpose = typeof b?.purpose === "string" ? b.purpose.slice(0, 200) : "";
    const access = b?.access === undefined ? "read" : b.access;
    if (!ID.test(appId) || !NAME.test(name) || (access !== "read" && access !== "write")) return c.json({ error: "bad_request" }, 400);
    const known = SERVICES[service];
    const domain = known ? known.domain : service;
    if (!known && !HOST.test(domain)) return c.json({ error: "bad_service", message: "Use a known service name or the service's domain." }, 400);
    const actor = await who(c, appId);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const now = Date.now();
    const id = newTicketId();
    await c.env.DB.prepare("DELETE FROM vault_tickets WHERE expires_at < ?").bind(new Date(now - 86400_000).toISOString()).run();
    await c.env.DB.prepare("INSERT INTO vault_tickets (id_hash, app_id, name, service, domain, access, purpose, requested_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(await sha256(id), appId, name, service, domain, access, purpose, actor, new Date(now).toISOString(), new Date(now + TICKET_TTL_MS).toISOString()).run();
    const url = `${new URL(c.req.url).origin}/vault/t/${id}`;
    return c.json({ ticket: id, url, expires_in: TICKET_TTL_MS / 1000 }, 201, { "cache-control": "no-store" });
  });

  /** Whether a key is saved, never the key. Same owner check as tickets. */
  v.get("/status/:app/:name", async (c) => {
    const appId = c.req.param("app"), name = c.req.param("name");
    if (!ID.test(appId) || !NAME.test(name)) return c.json({ error: "bad_request" }, 400);
    if (!(await who(c, appId))) return c.json({ error: "unauthorized" }, 401);
    const row: any = await c.env.DB.prepare("SELECT access, valid FROM vault_secrets WHERE app_id = ? AND name = ?").bind(appId, name).first();
    const out = row ? { saved: true, valid: row.valid === null ? null : row.valid === 1, access: row.access } : { saved: false, valid: null, access: null };
    return c.json(out, 200, { "cache-control": "no-store" });
  });

  async function load(c: any) {
    const id = c.req.param("ticket");
    if (!TICKET.test(id)) return null;
    return await c.env.DB.prepare("SELECT * FROM vault_tickets WHERE id_hash = ?").bind(await sha256(id)).first();
  }
  const gone = (c: any) => c.html(page("Link not valid", "<h1>This link is not valid</h1><p>It may have been used or it may have expired. Ask the assistant for a new one.</p>"), 410, PAGE_HEADERS);

  /** The form page. Reading it does not use the ticket up. */
  v.get("/t/:ticket", async (c) => {
    const t: any = await load(c);
    if (!t || t.used_at || t.expires_at < new Date().toISOString()) return gone(c);
    const s = SERVICES[t.service];
    const help = s ? s.help : `Make a key for ${t.domain} that can only read. Give it the fewest permissions the app needs.`;
    return c.html(page("Save a key", `<h1>Save a key for ${esc(t.app_id)}</h1>
<dl><dt>App</dt><dd>${esc(t.app_id)}</dd><dt>Key name</dt><dd>${esc(t.name)}</dd><dt>Service</dt><dd>${esc(s?.label ?? t.domain)} (${esc(t.domain)})</dd><dt>Purpose</dt><dd>${esc(t.purpose || "Not given")}</dd></dl>
<p>${esc(help)}</p>
<form method="post" autocomplete="off"><label>Key<input name="value" type="password" required maxlength="${MAX_VALUE}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label><button type="submit">Save key</button></form>
<p>The key goes straight into the vault. The assistant is told only that it was saved. This link works once and expires in 10 minutes.</p>`), 200, PAGE_HEADERS);
  });

  /** The only way a value enters the vault. */
  v.post("/t/:ticket", async (c) => {
    const asJson = (c.req.header("content-type") ?? "").includes("application/json");
    const fail = (status: 400 | 410 | 413 | 500 | 503, error: string) => asJson ? c.json({ error, message: FAILURES[error] ?? FAILURES.save_failed }, status, { "cache-control": "no-store" }) : c.html(page("Not saved", `<h1>Not saved</h1><p>${esc(FAILURES[error] ?? FAILURES.save_failed)}</p>`), status, PAGE_HEADERS);
    let value = "", claimApp: unknown, claimName: unknown;
    try {
      if (asJson) { const b: any = await c.req.json(); value = b?.value; claimApp = b?.app; claimName = b?.name; }
      else { const f = await c.req.formData(); value = f.get("value") as string; claimApp = f.get("app"); claimName = f.get("name"); }
    } catch { return fail(400, "bad_request"); }
    if (typeof value !== "string" || !value) return fail(400, "bad_request");
    if (value.length > MAX_VALUE) return fail(413, "too_large");
    if (/[\s\u0000-\u001f\u007f]/.test(value)) return fail(400, "bad_value");
    const t: any = await load(c);
    if (!t) return fail(410, "ticket_not_valid");
    if ((claimApp != null && claimApp !== t.app_id) || (claimName != null && claimName !== t.name)) return fail(400, "ticket_mismatch");
    if (!c.env.VAULT_MASTER_KEY) return fail(503, "vault_not_configured");
    // Use the ticket up first, in one statement: of two racing posts only one gets a changed row.
    const nowIso = new Date().toISOString();
    const used = await c.env.DB.prepare("UPDATE vault_tickets SET used_at = ? WHERE id_hash = ? AND used_at IS NULL AND expires_at >= ?").bind(nowIso, t.id_hash, nowIso).run();
    if ((used as any)?.meta?.changes !== 1) return fail(410, "ticket_not_valid");

    let check: { valid: boolean | null; access: "read" | "write"; warning?: string } = { valid: null, access: t.access };
    let sealed: Awaited<ReturnType<typeof encryptSecret>>;
    const id = { app: t.app_id, name: t.name, domain: t.domain };
    // If anything after the claim fails, give the ticket back so the person does not start over.
    const release = () => c.env.DB.prepare("UPDATE vault_tickets SET used_at = NULL WHERE id_hash = ?").bind(t.id_hash).run().catch(() => undefined);
    try {
      const svc = SERVICES[t.service];
      check = svc ? await svc.check(value, doFetch) : check;
      sealed = await encryptSecret(c.env.VAULT_MASTER_KEY, id, value);
    } catch { await release(); return fail(503, "vault_not_configured"); }
    try {
      await c.env.DB.prepare("INSERT INTO vault_secrets (owner, app_id, name, domain, access, warning, valid, wrapped_key, ciphertext, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id, name) DO UPDATE SET owner = excluded.owner, domain = excluded.domain, access = excluded.access, warning = excluded.warning, valid = excluded.valid, wrapped_key = excluded.wrapped_key, ciphertext = excluded.ciphertext, created_at = excluded.created_at, last_used_at = NULL, use_count = 0")
        .bind(t.requested_by, t.app_id, t.name, t.domain, check.access, check.warning ?? null, check.valid === null ? null : check.valid ? 1 : 0, sealed.wrapped_key, sealed.ciphertext, nowIso).run();
      // A key saved again is a new key: clear an earlier revocation (the table may not exist on an old database).
      try { await c.env.DB.prepare("DELETE FROM vault_revoked WHERE app_id = ? AND name = ?").bind(t.app_id, t.name).run(); } catch { /* no table yet */ }
    } catch { await release(); return fail(500, "save_failed"); }
    const out = { saved: true, app: t.app_id, name: t.name, valid: check.valid, access: check.access, ...(check.warning ? { warning: check.warning, warning_text: WARNINGS[check.warning] } : {}) };
    if (asJson) return c.json(out, 201, { "cache-control": "no-store" });
    return c.html(page("Saved", `<h1>Saved</h1><p>The key ${esc(t.name)} for ${esc(t.app_id)} is in the vault. You can close this page.</p>${check.valid === false ? "<p class=warn>The service refused this key. Save a working one with a new link.</p>" : ""}${check.valid === null && SERVICES[t.service] ? "<p class=warn>We could not check this key with the service. It is saved, but it may not work.</p>" : ""}${check.warning ? `<p class=warn>${esc(WARNINGS[check.warning] ?? "")}</p>` : ""}`), 201, PAGE_HEADERS);
  });

  return v;
}
