// Owner commands: everything the admin can do, as typed commands. The admin UI calls these, and so can an agent
// holding the owner token. Commands edit the DRAFT; `publish` validates it and makes it live on every device.
import { AppContent, ContentBlock } from "@purenative/schema";

type Content = AppContent;
type P = { type: "string" | "number" | "boolean" | "object"; required?: boolean; description: string; enum?: string[] };
export type OwnerCommand = { description: string; params: Record<string, P>; mutates: boolean; run: (draft: Content, a: any, env: OwnerEnv) => Promise<unknown> | unknown };
export type OwnerEnv = { db: D1Database; kv: KVNamespace; appId: string; actor: string };

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
    description: "Change a product. Only the fields you pass are changed.", mutates: true,
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
  remove_product: { description: "Remove a product.", mutates: true, params: { product_id: { type: "string", required: true, description: "Product id" } },
    run: (d, a) => { product(d, a.product_id); d.products = d.products.filter((p) => p.id !== a.product_id); return { removed: a.product_id }; } },
  list_promos: { description: "List promo codes.", params: {}, mutates: false, run: (d) => d.promos },
  upsert_promo: {
    description: "Create or change a promo code.", mutates: true,
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
  remove_home_block: { description: "Remove a home block.", mutates: true, params: { block_id: { type: "string", required: true, description: "Block id" } },
    run: (d, a) => { block(d, a.block_id); d.screens.home = d.screens.home.filter((x) => x.id !== a.block_id); return d.screens.home.map((x) => x.id); } },
  set_theme: { description: "Set the brand accent colour (#RRGGBB) and optionally the shop name and tagline.", mutates: true,
    params: { accent: { type: "string", description: "Accent colour #RRGGBB" }, name: { type: "string", description: "Shop name" }, tagline: { type: "string", description: "Tagline" } },
    run: (d, a) => { if (a.accent) d.theme.accent = String(a.accent); if (a.name) d.brand.name = String(a.name); if (a.tagline !== undefined) d.brand.tagline = String(a.tagline); return { theme: d.theme, brand: d.brand }; } },
  diff: { description: "What changed in the draft compared with the live version.", params: {}, mutates: false,
    run: async (d, _a, env) => diffContent(await liveContent(env), d) },
  publish: {
    description: "Validate the draft and make it live on every device (usually within seconds).", mutates: false,
    params: { note: { type: "string", description: "What changed, for the history" } },
    run: async (d, a, env) => {
      const live = await liveContent(env);
      const next = { ...d, version: (live?.version ?? 0) + 1, published_at: new Date().toISOString() };
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

export async function runOwnerCommand(env: OwnerEnv, name: string, args: Record<string, unknown>) {
  const cmd = OWNER_COMMANDS[name];
  if (!cmd) return { ok: false, error: { code: "unknown_command", message: `Unknown command '${name}'` } };
  for (const [k, p] of Object.entries(cmd.params)) {
    if (p.required && (args[k] === undefined || args[k] === null || args[k] === "")) return { ok: false, error: { code: "missing_param", message: `'${k}' is required` } };
    if (args[k] !== undefined && p.enum && !p.enum.includes(String(args[k]))) return { ok: false, error: { code: "bad_param", message: `'${k}' must be one of ${p.enum.join(", ")}` } };
  }
  const draft = await loadDraft(env);
  if (!draft) return { ok: false, error: { code: "no_content", message: "No content yet" } };
  let res: any;
  try {
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
  if (cmd.mutates || name === "publish" || name === "restore_version" || name === "discard_draft")
    await env.db.prepare("INSERT INTO audit (app_id, at, actor, command, args_json, ok) VALUES (?,?,?,?,?,?)")
      .bind(env.appId, new Date().toISOString(), env.actor, name, JSON.stringify(args).slice(0, 2000), res.ok ? 1 : 0).run();
  return res;
}

export const describeOwner = () => Object.entries(OWNER_COMMANDS).map(([name, c]) => ({ name, description: c.description, params: c.params, changes_draft: c.mutates }));
