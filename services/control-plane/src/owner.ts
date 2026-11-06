// Owner commands: everything the admin can do, as typed commands. The admin UI calls these, and so can an agent
// holding the owner token. Commands edit the DRAFT; `publish` validates it and makes it live on every device.
import { AppContent, ContentBlock, ShipvoPolicy } from "@shipvo/schema";
import { parseWebhookUrl } from "./alerts";

type Content = AppContent;
type P = { type: "string" | "number" | "boolean" | "object"; required?: boolean; description: string; enum?: string[] };
export type OwnerCommand = { description: string; params: Record<string, P>; mutates: boolean;
  /** Set on commands that cannot be undone or reach users: returns what would change (null = this call is harmless). */
  plan?: (draft: Content, a: any, env: OwnerEnv) => Promise<string[] | null> | string[] | null;
  /** Agents may not run this (it changes the rules agents follow). */
  adminOnly?: boolean;
  run: (draft: Content, a: any, env: OwnerEnv) => Promise<unknown> | unknown };
export type AgentPolicy = "ask" | "deny" | "allow";
/** agent: the caller is an AI agent holding the owner token (not the signed-in admin). `local` is a stricter policy the caller's own shipvo.json asked for. */
export type OwnerEnv = { db: D1Database; kv: KVNamespace; appId: string; actor: string; agent?: boolean; local?: { agentPolicy?: string; agentDeny?: string[] } };

/** The actor name for a caller holding the owner token (an AI agent). */
export const AGENT_ACTOR = "agent (owner token)";
const POLICY_KEY = (appId: string) => `c/${appId}/agent_policy`;
export async function loadPolicy(env: { kv: KVNamespace; appId: string }): Promise<{ agentPolicy: AgentPolicy; agentDeny: string[] }> {
  try {
    const p = JSON.parse((await env.kv.get(POLICY_KEY(env.appId))) ?? "{}");
    return { agentPolicy: ["ask", "deny", "allow"].includes(p.agentPolicy) ? p.agentPolicy : "ask", agentDeny: Array.isArray(p.agentDeny) ? p.agentDeny.map(String) : [] };
  } catch { return { agentPolicy: "ask", agentDeny: [] }; }
}
export type ReleasePolicy = ShipvoPolicy;
const RELEASE_POLICY_KEY = (appId: string) => `c/${appId}/release_policy`;
/** The stored release policy. A missing, corrupt or invalid value means no limit. */
export async function loadReleasePolicy(env: { kv: KVNamespace; appId: string }): Promise<ReleasePolicy> {
  try {
    const raw = JSON.parse((await env.kv.get(RELEASE_POLICY_KEY(env.appId))) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    // Keep every field that is valid on its own, so one bad field does not drop the other rules.
    const out: Record<string, unknown> = {};
    for (const k of ["maxBand", "agentMaxBand", "requireApprovalAbove", "blockedWeekdays", "blockedAfterHour", "timeZone", "maxCohortForAgents", "requireStageBeforeFull"]) {
      if (!(k in raw)) continue;
      // blockedAfterHour only makes sense with blockedWeekdays, so test it next to a valid one.
      if (ShipvoPolicy.safeParse({ ...(k === "blockedAfterHour" ? { blockedWeekdays: ["mon"] } : {}), [k]: raw[k] }).success) out[k] = raw[k];
    }
    if (!ShipvoPolicy.safeParse(out).success) delete out.blockedAfterHour;
    return out as ReleasePolicy;
  } catch { return {}; }
}
/** What a publish reaches. Telemetry has no device id, so this counts update reports, not phones. */
async function reach(env: OwnerEnv): Promise<string> {
  try {
    const r = await env.db.prepare("SELECT COUNT(*) AS n FROM telemetry WHERE app_id = ? AND event = 'applied'").bind(env.appId).first<{ n: number }>();
    return r?.n ? `Reaches every installed phone. ${r.n} update reports received so far (the number of phones is not known).` : "Reaches every installed phone. No update reports received yet (the number of phones is not known).";
  } catch { return "Reaches every installed phone (count unavailable)."; }
}

/* ---------- one-time owner approval challenges ----------
 * An agent under agentPolicy "ask" does not get to approve itself with confirm: true. The server issues a challenge bound to the
 * command and a hash of its arguments. Only the signed-in owner (admin session) can approve it. It works once, for 10 minutes. */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export type Challenge = { id: string; app_id: string; command: string; args_hash: string; requester: string; plan: string[]; status: "pending" | "approved" | "denied" | "used";
  created_at: string; expires_at: string; approved_by?: string; approved_how?: string; resolved_at?: string };
const challengeKey = (appId: string, id: string) => `c/${appId}/challenge/${id}`;
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
/** SHA-256 of the command name and its arguments in key-sorted JSON, so the same action always hashes the same. */
export async function argsHash(command: string, args: Record<string, unknown>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canon({ command, args })))))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function loadChallenge(env: { kv: KVNamespace; appId: string }, id: string): Promise<Challenge | null> {
  try { const raw = await env.kv.get(challengeKey(env.appId, id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
const saveChallenge = (env: { kv: KVNamespace }, c: Challenge) => env.kv.put(challengeKey(c.app_id, c.id), JSON.stringify(c), { expirationTtl: 86400 });
const expired = (c: Challenge) => Date.parse(c.expires_at) <= Date.now();
/** Pending, unexpired challenges, oldest first. */
export async function listChallenges(env: { kv: KVNamespace; appId: string }): Promise<Challenge[]> {
  const out: Challenge[] = []; let cursor: string | undefined;
  do {
    const l: any = await env.kv.list({ prefix: challengeKey(env.appId, ""), cursor });
    for (const k of l.keys) { const c = await loadChallenge(env, k.name.slice(challengeKey(env.appId, "").length)); if (c && c.status === "pending" && !expired(c)) out.push(c); }
    cursor = l.list_complete === false ? l.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
/** Owner decision on a challenge. Callers must have checked that this is a signed-in owner, never a token. */
export async function resolveChallenge(env: OwnerEnv, id: string, verb: "approve" | "deny", approver: string, how = "admin session"): Promise<{ ok: true; challenge: Challenge } | { ok: false; error: { code: string; message: string } }> {
  const c = await loadChallenge(env, id);
  if (!c) return { ok: false, error: { code: "approval_not_found", message: "No such approval." } };
  if (c.status !== "pending") return { ok: false, error: { code: "approval_not_pending", message: `This approval is already ${c.status}.` } };
  if (expired(c)) return { ok: false, error: { code: "approval_expired", message: "This approval expired. Ask the agent to try again." } };
  const next: Challenge = { ...c, status: verb === "approve" ? "approved" : "denied", approved_by: approver, approved_how: how, resolved_at: new Date().toISOString() };
  await saveChallenge(env, next);
  await env.db.prepare("INSERT INTO audit (app_id, at, actor, command, args_json, ok) VALUES (?,?,?,?,?,?)")
    .bind(env.appId, next.resolved_at, approver, "approval", JSON.stringify({ command: c.command, approval: next.status, approval_id: c.id, approved_by: approver, approved_how: how, args_hash: c.args_hash }), 1).run();
  return { ok: true, challenge: next };
}

export class OwnerError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const fail = (code: string, message: string): never => { throw new OwnerError(code, message); };
const product = (c: Content, id: string) => c.products.find((p) => p.id === id) ?? fail("not_found", `No product '${id}'`);
const block = (c: Content, id: string) => c.screens.home.find((b) => b.id === id) ?? fail("not_found", `No home block '${id}'`);
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

export const OWNER_COMMANDS: Record<string, OwnerCommand> = {
  get_draft: { description: "The full draft content (what will go live on publish).", params: {}, mutates: false, run: (d) => d },
  list_products: { description: "List products with price and stock.", params: {}, mutates: false,
    run: (d) => d.products.map((p) => ({ id: p.id, name: p.name, department: p.department, price: p.price, stock: p.stock, water: p.water })) },
  update_product: {
    description: "Change a product. Only the fields you pass are changed. A price change needs confirm: true when called by an agent.", mutates: true,
    plan: (d, a) => { if (a.price === undefined) return null; const p = product(d, a.product_id); const n = Math.round(Number(a.price)); return n === p.price ? null : [`Price of ${p.name}: ${p.price} → ${n} FCFA in the draft. Customers see it once you publish.`]; },
    params: {
      product_id: { type: "string", required: true, description: "Product id" }, name: { type: "string", description: "New name" },
      price: { type: "number", description: "Unit price in FCFA (whole number)" }, stock: { type: "number", description: "Units in stock" },
      description: { type: "string", description: "Description" }, image_url: { type: "string", description: "https image URL, or empty to remove" },
      water: { type: "string", description: "salt, fresh or both", enum: ["salt", "fresh", "both"] }, department: { type: "string", description: "Department id" },
    },
    run: (d, a) => {
      const p = product(d, a.product_id);
      if (a.name !== undefined) p.name = String(a.name);
      if (a.price !== undefined) p.price = Math.round(Number(a.price));
      if (a.stock !== undefined) p.stock = Math.max(0, Math.round(Number(a.stock)));
      if (a.description !== undefined) p.description = String(a.description);
      if (a.water !== undefined) p.water = a.water;
      if (a.department !== undefined) p.department = String(a.department);
      if (a.image_url !== undefined) { if (a.image_url) p.image_url = String(a.image_url); else delete p.image_url; }
      return p;
    },
  },
  add_product: {
    description: "Add a product.", mutates: true,
    params: {
      name: { type: "string", required: true, description: "Name" }, department: { type: "string", required: true, description: "Department id" },
      price: { type: "number", required: true, description: "Price in FCFA" }, stock: { type: "number", required: true, description: "Units in stock" },
      water: { type: "string", required: true, description: "salt, fresh or both", enum: ["salt", "fresh", "both"] },
      description: { type: "string", description: "Description" }, tags: { type: "string", description: "Comma-separated tags" },
    },
    run: (d, a) => {
      let id = slug(a.name); let n = 2; while (d.products.some((p) => p.id === id)) id = `${slug(a.name)}-${n++}`;
      const p = { id, name: String(a.name), department: String(a.department), price: Math.round(Number(a.price)), stock: Math.round(Number(a.stock)),
        water: a.water, tags: String(a.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean), description: String(a.description ?? "") };
      d.products.push(p as any); return p;
    },
  },
  remove_product: { description: "Remove a product.", mutates: true,
    plan: (d, a) => { const p = product(d, a.product_id); return [`Delete product ${p.name} (${p.id}, price ${p.price}, stock ${p.stock}) from the draft. Customers lose it once you publish.`]; }, params: { product_id: { type: "string", required: true, description: "Product id" } },
    run: (d, a) => { product(d, a.product_id); d.products = d.products.filter((p) => p.id !== a.product_id); return { removed: a.product_id }; } },
  list_promos: { description: "List promo codes.", params: {}, mutates: false, run: (d) => d.promos },
  upsert_promo: {
    description: "Create or change a promo code.", mutates: true,
    plan: (d, a) => { const code = String(a.code).trim().toUpperCase(); const o = d.promos.find((x) => x.code === code); return [o ? `Change offer ${code}: ${o.percent}% → ${Math.round(Number(a.percent))}% off in the draft.` : `Add offer ${code}: ${Math.round(Number(a.percent))}% off in the draft.`, "Customers can use it once you publish."]; },
    params: {
      code: { type: "string", required: true, description: "Code, 3-16 capital letters or digits" }, percent: { type: "number", required: true, description: "Percent off (1-90)" },
      min_subtotal: { type: "number", description: "Minimum cart subtotal in FCFA (default 0)" }, description: { type: "string", required: true, description: "Shown to customers" },
      departments: { type: "string", description: "Comma-separated department ids it applies to (empty = whole cart)" }, active: { type: "boolean", description: "Active (default true)" },
    },
    run: (d, a) => {
      const code = String(a.code).trim().toUpperCase();
      const promo: any = { code, percent: Math.round(Number(a.percent)), min_subtotal: Math.round(Number(a.min_subtotal ?? 0)), description: String(a.description), active: a.active ?? true };
      const depts = String(a.departments ?? "").split(",").map((x) => x.trim()).filter(Boolean); if (depts.length) promo.departments = depts;
      const i = d.promos.findIndex((p) => p.code === code); if (i >= 0) d.promos[i] = promo; else d.promos.push(promo);
      return promo;
    },
  },
  set_promo_active: { description: "Turn a promo code on or off.", mutates: true,
    plan: (d, a) => { const p = d.promos.find((x) => x.code === String(a.code).toUpperCase()) ?? fail("not_found", `No promo '${a.code}'`); return [`Turn offer ${p.code} (${p.percent}% off) ${a.active ? "on" : "off"} in the draft. Customers see it once you publish.`]; },
    params: { code: { type: "string", required: true, description: "Code" }, active: { type: "boolean", required: true, description: "On or off" } },
    run: (d, a) => { const p = d.promos.find((x) => x.code === String(a.code).toUpperCase()) ?? fail("not_found", `No promo '${a.code}'`); p.active = !!a.active; return p; } },
  list_home_blocks: { description: "List the home screen blocks in order.", params: {}, mutates: false, run: (d) => d.screens.home },
  update_home_block: {
    description: "Change fields of a home block (e.g. title, text, body, tone, color, limit, filter, label, action).", mutates: true,
    params: { block_id: { type: "string", required: true, description: "Block id" }, fields: { type: "object", required: true, description: "Fields to set, as a JSON object" } },
    run: (d, a) => {
      const b: any = block(d, a.block_id);
      const next = { ...b, ...(a.fields ?? {}), id: b.id, type: b.type };
      const ok = ContentBlock.safeParse(next); if (!ok.success) fail("invalid_block", ok.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      d.screens.home[d.screens.home.indexOf(b)] = ok.data as any; return ok.data;
    },
  },
  add_home_block: {
    description: "Add a block to the home screen. Types: hero, banner, departments, product_rail, promos, text, button.", mutates: true,
    params: { block: { type: "object", required: true, description: "The block as JSON, without id (one is generated)" }, position: { type: "number", description: "Index to insert at (default: end)" } },
    run: (d, a) => {
      const b = { ...(a.block ?? {}), id: `${a.block?.type ?? "block"}-${Date.now().toString(36)}` };
      const ok = ContentBlock.safeParse(b); if (!ok.success) fail("invalid_block", ok.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const at = a.position == null ? d.screens.home.length : Math.max(0, Math.min(d.screens.home.length, Number(a.position)));
      d.screens.home.splice(at, 0, ok.data as any); return ok.data;
    },
  },
  move_home_block: { description: "Move a home block to a new position (0 = top).", mutates: true,
    params: { block_id: { type: "string", required: true, description: "Block id" }, to_index: { type: "number", required: true, description: "New index" } },
    run: (d, a) => { const b = block(d, a.block_id); const list = d.screens.home.filter((x) => x !== b); list.splice(Math.max(0, Math.min(list.length, Number(a.to_index))), 0, b); d.screens.home = list; return list.map((x) => x.id); } },
  remove_home_block: { description: "Remove a home block.", mutates: true,
    plan: (d, a) => { const b = block(d, a.block_id); return [`Delete home block ${b.id} (${b.type}) from the draft. Customers lose it once you publish.`]; }, params: { block_id: { type: "string", required: true, description: "Block id" } },
    run: (d, a) => { block(d, a.block_id); d.screens.home = d.screens.home.filter((x) => x.id !== a.block_id); return d.screens.home.map((x) => x.id); } },
  set_theme: { description: "Set the brand accent colour (#RRGGBB) and optionally the shop name and tagline.", mutates: true,
    params: { accent: { type: "string", description: "Accent colour #RRGGBB" }, name: { type: "string", description: "Shop name" }, tagline: { type: "string", description: "Tagline" } },
    run: (d, a) => { if (a.accent) d.theme.accent = String(a.accent); if (a.name) d.brand.name = String(a.name); if (a.tagline !== undefined) d.brand.tagline = String(a.tagline); return { theme: d.theme, brand: d.brand }; } },
  diff: { description: "What changed in the draft compared with the live version.", params: {}, mutates: false,
    run: async (d, _a, env) => diffContent(await liveContent(env), d) },
  publish: {
    description: "Validate the draft and make it live on every device (usually within seconds). Needs confirm: true when called by an agent.", mutates: false,
    plan: async (d, _a, env) => { const ch = diffContent(await liveContent(env), d); return [await reach(env), ch.length ? `Changes: ${ch.join("; ")}.` : "No changes compared with the live version."]; },
    params: { note: { type: "string", description: "What changed, for the history" } },
    run: async (d, a, env) => {
      const live = await liveContent(env);
      // Next version comes from history as well as the live copy, so a missing or stale KV entry can't collide.
      const maxRow = await env.db.prepare("SELECT MAX(version) AS v FROM content_versions WHERE app_id = ?").bind(env.appId).first<{ v: number | null }>();
      const next = { ...d, version: Math.max(live?.version ?? 0, maxRow?.v ?? 0) + 1, published_at: new Date().toISOString() };
      const ok = AppContent.safeParse(next); if (!ok.success) fail("invalid_content", ok.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const json = JSON.stringify(ok.data!);
      await env.db.prepare("INSERT INTO content_versions (app_id, version, json, published_at, published_by, note) VALUES (?,?,?,?,?,?)")
        .bind(env.appId, next.version, json, next.published_at, env.actor, String(a.note ?? "").slice(0, 200)).run();
      await env.kv.put(`c/${env.appId}/content.json`, json);
      await env.db.prepare("INSERT OR REPLACE INTO content_draft (app_id, json, updated_at) VALUES (?,?,?)").bind(env.appId, json, next.published_at).run();
      return { version: next.version, published_at: next.published_at, bytes: json.length, changes: diffContent(live, ok.data!) };
    },
  },
  discard_draft: { description: "Throw away unpublished changes.", params: {}, mutates: false,
    plan: async (d, _a, env) => { const ch = diffContent(await liveContent(env), d); return ch.length ? [`Delete unpublished draft changes (cannot be undone): ${ch.join("; ")}. Does not reach phones.`] : null; },
    run: async (_d, _a, env) => { const live = await liveContent(env); if (!live) fail("no_live", "Nothing published yet"); await env.db.prepare("INSERT OR REPLACE INTO content_draft (app_id, json, updated_at) VALUES (?,?,?)").bind(env.appId, JSON.stringify(live), new Date().toISOString()).run(); return { reset_to: live!.version }; } },
  list_versions: { description: "Published versions, newest first.", params: {}, mutates: false,
    run: async (_d, _a, env) => (await env.db.prepare("SELECT version, published_at, published_by, note, length(json) AS bytes FROM content_versions WHERE app_id = ? ORDER BY version DESC LIMIT 30").bind(env.appId).all()).results },
  restore_version: { description: "Load an earlier published version into the draft (then publish to make it live).", mutates: false,
    params: { version: { type: "number", required: true, description: "Version to restore" } },
    run: async (_d, a, env) => {
      const row = await env.db.prepare("SELECT json FROM content_versions WHERE app_id = ? AND version = ?").bind(env.appId, Number(a.version)).first<{ json: string }>();
      if (!row) fail("not_found", `No version ${a.version}`);
      await env.db.prepare("INSERT OR REPLACE INTO content_draft (app_id, json, updated_at) VALUES (?,?,?)").bind(env.appId, row!.json, new Date().toISOString()).run();
      return { draft_from_version: Number(a.version) };
    } },
  list_orders: { description: "Recent orders from the app, newest first.", params: { limit: { type: "number", description: "How many (default 50)" } }, mutates: false,
    run: async (_d, a, env) => (await env.db.prepare("SELECT order_id, total, received_at, json FROM orders WHERE app_id = ? ORDER BY id DESC LIMIT ?").bind(env.appId, Math.min(200, Number(a.limit ?? 50))).all()).results.map((r: any) => ({ ...JSON.parse(r.json), received_at: r.received_at })) },
  // Agent API keys for the hosted simulator (sim.shipvo.dev). The key is shown once; only its hash is stored.
  create_api_key: {
    plan: (_d, a) => [`Create a '${a.scope}' API key${a.scope === "owner" ? " that can run owner commands, including publish" : ""}. Does not reach phones.`],
    description: "Create an API key that lets an AI agent open this app in the hosted simulator. Scope 'test' = sandbox sessions only; 'owner' = may also run owner commands; 'read' = reports only. The key is returned once.",
    params: { scope: { type: "string", required: true, description: "test, owner or read", enum: ["test", "owner", "read"] }, label: { type: "string", description: "What this key is for, e.g. 'Claude Code', 'PiPilot CI'" }, expires_in_days: { type: "number", description: "Optional: the key stops working after this many days (default: never)" } }, mutates: false,
    run: async (_d, a, env) => {
      const scope = String(a.scope); if (!["test", "owner", "read"].includes(scope)) fail("bad_scope", "scope must be test, owner or read");
      const rand = crypto.getRandomValues(new Uint8Array(24)); const body = btoa(String.fromCharCode(...rand)).replace(/[+/=]/g, (c) => ({ "+": "a", "/": "b", "=": "" }[c]!));
      const key = `sv_${scope}_${body}`; const prefix = key.slice(0, 12);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const days = Number(a.expires_in_days); const expires = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;
      await env.db.prepare("INSERT INTO api_keys (app_id, key_hash, prefix, scope, label, expires_at) VALUES (?,?,?,?,?,?)").bind(env.appId, hash, prefix, scope, String(a.label ?? ""), expires).run();
      return { key, prefix, scope, label: a.label ?? "", note: "Store this key now; it is not shown again. Use it as Authorization: Bearer <key> at https://sim.shipvo.dev/mcp" };
    },
  },
  list_api_keys: { description: "API keys for this app (prefix, scope, label, last use); never the key itself.", params: {}, mutates: false,
    run: async (_d, _a, env) => (await env.db.prepare("SELECT prefix, scope, label, created_at, last_used_at, revoked_at FROM api_keys WHERE app_id = ? ORDER BY id DESC").bind(env.appId).all()).results },
  revoke_api_key: { description: "Revoke an API key by its prefix (from list_api_keys).", plan: (_d, a) => [`Revoke API key ${a.prefix}. Whoever uses it is locked out (cannot be undone). Does not reach phones.`], params: { prefix: { type: "string", required: true, description: "Key prefix, e.g. sv_test_abc1" } }, mutates: false,
    run: async (_d, a, env) => { const r = await env.db.prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE app_id = ? AND prefix = ? AND revoked_at IS NULL").bind(env.appId, String(a.prefix)).run(); return { revoked: (r.meta?.changes ?? 0) > 0 }; } },
  set_alert_webhook: { description: "Set the https URL that gets a small JSON POST (app, release, event, time) when a release is reverted on devices, at most once per release per hour. Empty url removes it.",
    // mutates: false (it does not change the content draft). It is audited by name below, with the URL cut down to its host.
    mutates: false,
    plan: (_d, a) => { const raw = String(a.url ?? "").trim(); return [raw ? `Send revert alerts to ${hostOf(raw)}. Does not reach phones.` : "Stop sending revert alerts. Does not reach phones."]; },
    params: { url: { type: "string", description: "https:// URL, or empty to remove" } },
    run: async (_d, a, env) => {
      const raw = String(a.url ?? "").trim();
      if (!raw) { await env.db.prepare("DELETE FROM app_alerts WHERE app_id = ?").bind(env.appId).run(); return { alert_webhook: null }; }
      const url = parseWebhookUrl(raw); // throws bad_webhook_url
      await env.db.prepare("INSERT INTO app_alerts (app_id, webhook, updated_at) VALUES (?,?,?) ON CONFLICT(app_id) DO UPDATE SET webhook = excluded.webhook, updated_at = excluded.updated_at").bind(env.appId, url, new Date().toISOString()).run();
      return { alert_webhook: new URL(url).host }; // the URL may hold a token, so only the host is returned
    } },
  get_agent_policy: { description: "What AI agents may do without asking: agentPolicy (ask, deny or allow) and the per-command deny list.", params: {}, mutates: false,
    run: async (_d, _a, env) => loadPolicy(env) },
  set_agent_policy: { description: "Set agentPolicy (ask is the default, deny, or allow) and a comma-separated deny list of command names. Owner sign-in only: agents cannot call it.", mutates: false, adminOnly: true,
    params: { agentPolicy: { type: "string", required: true, description: "ask, deny or allow", enum: ["ask", "deny", "allow"] }, agentDeny: { type: "string", description: "Comma-separated commands agents may never run" } },
    run: async (_d, a, env) => {
      const v = { agentPolicy: String(a.agentPolicy), agentDeny: String(a.agentDeny ?? "").split(",").map((x) => x.trim()).filter(Boolean) };
      await env.kv.put(POLICY_KEY(env.appId), JSON.stringify(v)); return v;
    } },
  get_release_policy: { description: "The rules publishes must respect: maxBand, agentMaxBand, blockedWeekdays with blockedAfterHour and timeZone (UTC if none), and requireStageBeforeFull. Empty means no rules.", params: {}, mutates: false,
    run: async (_d, _a, env) => loadReleasePolicy(env) },
  set_release_policy: { description: "Set the release rules the control plane enforces on publish and promote. maxBand and agentMaxBand: b0, b1 or b2. blockedWeekdays: comma-separated mon..sun, blocked from blockedAfterHour (0-23, default all day) in timeZone (IANA name, UTC if empty). stagePercent with stageMinHours: a release must sit at that percent for that long before 100%. Leave a field out or empty for no rule. Owner sign-in only: agents cannot call it.", mutates: false, adminOnly: true,
    params: { maxBand: { type: "string", description: "Widest band any publish may reach", enum: ["b0", "b1", "b2", ""] }, agentMaxBand: { type: "string", description: "Widest band an agent publish may reach", enum: ["b0", "b1", "b2", ""] },
      blockedWeekdays: { type: "string", description: "Comma-separated weekdays (mon, tue, ...) with no publishing" }, blockedAfterHour: { type: "number", description: "Hour 0-23 from which those weekdays are blocked" },
      timeZone: { type: "string", description: "IANA time zone for the weekday rules (UTC if empty)" }, stagePercent: { type: "number", description: "Percent a release must sit at before 100% (1-99)" }, stageMinHours: { type: "number", description: "Hours it must sit there" } },
    run: async (_d, a, env) => {
      const v: Record<string, unknown> = {};
      if (a.maxBand) v.maxBand = String(a.maxBand);
      if (a.agentMaxBand) v.agentMaxBand = String(a.agentMaxBand);
      const days = String(a.blockedWeekdays ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (days.length) v.blockedWeekdays = days;
      if (a.blockedAfterHour !== undefined && a.blockedAfterHour !== "") v.blockedAfterHour = Number(a.blockedAfterHour);
      if (a.timeZone) v.timeZone = String(a.timeZone);
      if (a.stagePercent || a.stageMinHours) {
        if (!a.stagePercent || !a.stageMinHours) return fail("bad_param", "stagePercent and stageMinHours go together");
        v.requireStageBeforeFull = { percent: Number(a.stagePercent), minHours: Number(a.stageMinHours) };
      }
      // This command has no requireApprovalAbove param. Keep the stored value so tightening other rules does not switch the approval gate off.
      const kept = (await loadReleasePolicy(env)).requireApprovalAbove;
      if (kept) v.requireApprovalAbove = kept;
      const r = ShipvoPolicy.safeParse(v);
      if (!r.success) return fail("bad_param", r.error.issues.map((i) => `${i.path.join(".") || "policy"}: ${i.message}`).join("; "));
      await env.kv.put(RELEASE_POLICY_KEY(env.appId), JSON.stringify(r.data)); return r.data;
    } },
  audit_log: { description: "Who changed what, newest first.", params: {}, mutates: false,
    run: async (_d, _a, env) => (await env.db.prepare("SELECT at, actor, command, args_json, ok FROM audit WHERE app_id = ? ORDER BY id DESC LIMIT 100").bind(env.appId).all()).results },
};

export async function liveContent(env: { kv: KVNamespace; appId: string }): Promise<Content | null> {
  const raw = await env.kv.get(`c/${env.appId}/content.json`); return raw ? JSON.parse(raw) : null;
}

export async function loadDraft(env: OwnerEnv): Promise<Content | null> {
  const row = await env.db.prepare("SELECT json FROM content_draft WHERE app_id = ?").bind(env.appId).first<{ json: string }>();
  if (row) return JSON.parse(row.json);
  return liveContent(env);
}

export function diffContent(a: Content | null, b: Content): string[] {
  if (!a) return ["first publish"];
  const out: string[] = [];
  for (const p of b.products) {
    const o = a.products.find((x) => x.id === p.id);
    if (!o) { out.push(`added product ${p.name}`); continue; }
    if (o.price !== p.price) out.push(`${p.name}: price ${o.price} → ${p.price}`);
    if (o.stock !== p.stock) out.push(`${p.name}: stock ${o.stock} → ${p.stock}`);
    if (o.name !== p.name) out.push(`renamed ${o.name} → ${p.name}`);
    if (o.description !== p.description || o.image_url !== p.image_url) out.push(`${p.name}: details changed`);
  }
  for (const o of a.products) if (!b.products.some((p) => p.id === o.id)) out.push(`removed product ${o.name}`);
  for (const p of b.promos) { const o = a.promos.find((x) => x.code === p.code); if (!o) out.push(`added promo ${p.code}`); else if (JSON.stringify(o) !== JSON.stringify(p)) out.push(`promo ${p.code} changed${o.active !== p.active ? (p.active ? " (on)" : " (off)") : ""}`); }
  if (JSON.stringify(a.screens.home) !== JSON.stringify(b.screens.home)) out.push("home screen changed");
  if (a.theme.accent !== b.theme.accent) out.push(`accent ${a.theme.accent} → ${b.theme.accent}`);
  if (a.brand.name !== b.brand.name || a.brand.tagline !== b.brand.tagline) out.push("brand changed");
  return out;
}

// The URL may hold a token, so logs and plans show only the host.
const approvalUrl = (appId: string, id: string) => `/app/${appId}/admin?approve=${id}`;
const hostOf = (raw: string): string => { try { return new URL(raw).host || "the given URL"; } catch { return "the given URL"; } };
const auditArgs = (name: string, args: Record<string, unknown>) => name === "set_alert_webhook" ? { url: String(args.url ?? "").trim() ? hostOf(String(args.url)) : "" } : args;

export async function runOwnerCommand(env: OwnerEnv, name: string, args: Record<string, unknown>): Promise<any> {
  const cmd = OWNER_COMMANDS[name];
  if (!cmd) return { ok: false, error: { code: "unknown_command", message: `Unknown command '${name}'` } };
  for (const [k, p] of Object.entries(cmd.params)) {
    if (p.required && (args[k] === undefined || args[k] === null || args[k] === "")) return { ok: false, error: { code: "missing_param", message: `'${k}' is required` } };
    if (args[k] !== undefined && p.enum && !p.enum.includes(String(args[k]))) return { ok: false, error: { code: "bad_param", message: `'${k}' must be one of ${p.enum.join(", ")}` } };
  }
  const draft = await loadDraft(env);
  if (!draft) return { ok: false, error: { code: "no_content", message: "No content yet" } };
  // confirm: true is ignored: under "ask" only an owner-approved challenge (approval: <id>) lets a gated command run.
  const { confirm: _confirm, approval, ...rest } = args; args = rest;
  let usedChallenge: Challenge | null = null;
  let res: any;
  let denied = false, gated = false;
  try {
    if (env.agent) {
      if (cmd.adminOnly) fail("admin_only", `'${name}' needs the owner signed in to the admin; agents cannot run it.`);
      const stored = await loadPolicy(env);
      const rank = { allow: 0, ask: 1, deny: 2 } as Record<string, number>;
      const asked = env.local?.agentPolicy;
      // The caller's own shipvo.json can only make the rules stricter, never looser.
      const policy = asked && asked in rank && rank[asked]! > rank[stored.agentPolicy]! ? asked : stored.agentPolicy;
      if ([...stored.agentDeny, ...(env.local?.agentDeny ?? [])].includes(name)) { denied = true; fail("denied", `'${name}' is on this app's agent deny list.`); }
      const plan = cmd.plan ? await cmd.plan(draft, args, env) : null;
      if (plan) {
        gated = true;
        if (policy === "deny") { denied = true; fail("denied", `agentPolicy is "deny": agents may not run '${name}'.`); }
        if (policy === "ask") {
          const hash = await argsHash(name, args);
          if (typeof approval !== "string" || !approval) {
            const id = crypto.randomUUID(); const now = Date.now();
            const ch: Challenge = { id, app_id: env.appId, command: name, args_hash: hash, requester: env.actor, plan, status: "pending", created_at: new Date(now).toISOString(), expires_at: new Date(now + CHALLENGE_TTL_MS).toISOString() };
            await saveChallenge(env, ch);
            return { ok: false, error: { code: "needs_confirm", message: `Nothing was changed. The owner must approve this in the admin (${approvalUrl(env.appId, id)}). Then call '${name}' again with the same arguments and approval: "${id}".` }, code: "needs_confirm", plan,
              challenge: { id, command: name, args_hash: hash, app: env.appId, requester: env.actor, expires_at: ch.expires_at, approval_url: approvalUrl(env.appId, id) } };
          }
          const ch = await loadChallenge(env, approval);
          if (!ch || ch.app_id !== env.appId) fail("approval_not_found", "No such approval. Call again without approval to get a new one.");
          if (ch!.command !== name || ch!.args_hash !== hash) fail("approval_mismatch", "This approval was issued for a different command or different arguments. Nothing was run.");
          if (ch!.status === "used") fail("approval_used", "This approval was already used. Each approval works once.");
          if (ch!.status === "denied") fail("approval_denied", "The owner denied this approval.");
          if (expired(ch!)) fail("approval_expired", "This approval expired after 10 minutes. Call again without approval to get a new one.");
          if (ch!.status !== "approved") fail("approval_pending", `The owner has not approved this yet. They can do it at ${approvalUrl(env.appId, ch!.id)}.`);
          await saveChallenge(env, { ...ch!, status: "used" }); // spent before the command runs, so a replay cannot run it twice
          usedChallenge = ch!;
        }
      }
    }
    const result = await cmd.run(draft, args, env);
    if (cmd.mutates) {
      const ok = AppContent.safeParse({ ...draft }); // keep the draft valid at every step
      if (!ok.success) throw new OwnerError("invalid_content", ok.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      await env.db.prepare("INSERT OR REPLACE INTO content_draft (app_id, json, updated_at) VALUES (?,?,?)").bind(env.appId, JSON.stringify(draft), new Date().toISOString()).run();
    }
    res = { ok: true, result };
  } catch (e) {
    res = e instanceof OwnerError ? { ok: false, error: { code: e.code, message: e.message } } : { ok: false, error: { code: "internal", message: String(e) } };
  }
  if (cmd.mutates || gated || denied || name === "publish" || name === "restore_version" || name === "discard_draft" || name === "set_agent_policy" || name === "set_release_policy" || name === "set_alert_webhook")
    await env.db.prepare("INSERT INTO audit (app_id, at, actor, command, args_json, ok) VALUES (?,?,?,?,?,?)")
      .bind(env.appId, new Date().toISOString(), env.actor, name, JSON.stringify(denied ? { ...auditArgs(name, args), denied: true } : usedChallenge ? { ...auditArgs(name, args), approved_by: usedChallenge.approved_by, approval_id: usedChallenge.id, approved_how: usedChallenge.approved_how } : auditArgs(name, args)).slice(0, 2000), res.ok && !denied ? 1 : 0).run();
  return res;
}

export const describeOwner = () => Object.entries(OWNER_COMMANDS).map(([name, c]) => ({ name, description: c.description, params: c.params, changes_draft: c.mutates }));
