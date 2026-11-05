#!/usr/bin/env node
// Shipvo MCP: agents use Shipvo apps with no phone.
//   PN_SIM=http://localhost:4545  PN_CONTROL=https://api.shipvo.dev  PN_OWNER_TOKEN=...  shipvo-mcp
// Remote (Streamable HTTP, what Claude, ChatGPT, Cursor connect to over the network):
//   shipvo-mcp --http 8787  with PN_API_KEYS="key1,key2" (Authorization: Bearer <key>) → POST/GET/DELETE /mcp
// Tools: list_apps, open_app, screen, tap, type, scroll, back, screenshot, end_session (UI simulator);
//        owner_describe, owner_command (the app's live content, prices, orders: owner token required).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { classify, compactDiff, fieldValue } from "./change.js";

const SIM = (process.env.PN_SIM ?? "http://localhost:4545").replace(/\/$/, "");
const CONTROL = (process.env.PN_CONTROL ?? "https://api.shipvo.dev").replace(/\/$/, "");
const OWNER_TOKEN = process.env.PN_OWNER_TOKEN ?? "";
// Apps this server can open. Hosted: the account's apps. Local: the app the simulator serves (it is asked on
// first use), or PN_APPS (JSON) to override. Falls back to the sample app when the simulator cannot be reached.
const TIDE = { tide: { name: "Tide & Tackle", description: "Fishing-supplies shop in Douala: catalogue, cart, promo codes, delivery slots, cash or mobile money." } };
type AppInfo = Record<string, { name: string; description: string }>;
async function localApps(): Promise<AppInfo> {
  if (process.env.PN_APPS) return JSON.parse(process.env.PN_APPS);
  try {
    const r = await fetch(SIM + "/apps", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (r.ok) {
      const out: AppInfo = {};
      for (const a of ((await r.json()) as { apps?: { id: string; name?: string }[] }).apps ?? []) out[a.id] = { name: a.name ?? a.id, description: "The app this simulator serves." };
      if (Object.keys(out).length) return out;
    }
  } catch {}
  return TIDE;
}

type Act = { ok: boolean; screen?: string | null; error?: string; code?: string; path?: string };
async function sim(path: string, body: Record<string, unknown>): Promise<Act> {
  const r = await fetch(SIM + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}. Is it running at ${SIM}?`);
  return r.json() as Promise<Act>;
}
const sessions = new Map<string, { app: string; steps: number; startedAt: number; tree?: string }>();
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
// Action result with a "Change:" line on top. Compares this tree with the session's last one.
// compact: on "content changed", return only the added/removed lines instead of the full tree.
const acted = (sid: string, action: string, r: Act, o: { compact?: boolean; ref?: string } = {}) => {
  const s = sessions.get(sid);
  if (!r.ok || r.screen == null) return result(sid, r);
  const prev = s?.tree; if (s) s.tree = r.screen;
  const change = classify(prev, r.screen, action);
  const head = [`Change: ${change}`];
  if (action === "type" && o.ref) { const v = fieldValue(r.screen, o.ref); if (v !== undefined) head.push(`Value of ${o.ref}: ${JSON.stringify(v)}`); }
  const body = o.compact && change === "content changed" && prev !== undefined ? `Changed lines (+ added, - removed; refs as on the full screen):\n${compactDiff(prev, r.screen)}` : r.screen;
  return result(sid, { ...r, screen: head.join("\n") + "\n\n" + body });
};
const result = (sid: string, r: Act) => { const s = sessions.get(sid); if (s) s.steps++; return text(r.ok ? (r.screen ?? "") : `Error${r.code ? ` [${r.code}]` : ""}: ${r.error}${/no session/.test(String(r.error)) ? " (sessions expire with the phone; call open_app again)" : ""}\n\nScreen now:\n${r.screen ?? ""}`); };
// Sessions live in the simulator; this map only tracks step counts. A client may reconnect between calls
// (ChatGPT does), so an unknown id is forwarded and the simulator answers if it knows it.
const need = (_sid: string) => {};

type Ctx = { app?: string; scope?: "test" | "owner" | "read"; ownerToken?: string; publicApps?: string };
function makeServer(ctx: Ctx = {}) {
const server = new McpServer({ name: "shipvo", version: "0.0.4" }, { instructions:
`You can use Shipvo apps the way a person uses them on a phone, without a phone.
Call open_app to get a session and the first screen. The screen is an accessibility tree: every button, field and text, with a [ref=eN]. Act with tap/type/scroll/back using refs, and read the screen that comes back each time.
Only what is on screen is listed, like a phone: a horizontal product rail shows a few items, so "scroll right" on the rail (its ref) to see more; "scroll down" the page for the rest.
System sheets (permission dialogs, the camera, the fingerprint prompt, payment prompts, notification banners, the share sheet) appear in the tree like any other screen: answer them by tapping, as a person would. Use set_device to decide what the phone has (a barcode in front of the camera, a location, whether the fingerprint matches, whether the payment is approved, network off) before the app asks for it.
Finish a task by checking the final screen says what you expected (for example "Order placed"). Call end_session when done to get a report.` });

// ctx.app: the app(s) this key opens, comma-separated (the beta app plus any the key owner has registered).
const keyApps = ctx.app ? ctx.app.split(",").map((s) => s.trim()).filter(Boolean) : null;
const allowed = async (id: string) => (keyApps ? keyApps.includes(id) : !!(await localApps())[id]);
server.tool("list_apps", "Apps this server can open, with what each one does. Optional query filters by name, description or category (e.g. 'shop', 'douala').", { query: z.string().optional() }, async ({ query }) => {
  const APPS = await localApps(); const ids = keyApps ?? Object.keys(APPS); const q = (query ?? "").toLowerCase();
  let dir: Record<string, { name: string; description: string; category: string }> = {};
  try { const r = await fetch(`${CONTROL}/apps/public${q ? `?q=${encodeURIComponent(q)}` : ""}`); if (r.ok) for (const a of ((await r.json()) as any).apps) dir[a.app_id] = a; } catch {}
  const lines = ids.map((id) => {
    const d = dir[id] ?? APPS[id]; const desc = d ? `${d.name}. ${d.description}${"category" in d ? ` [${(d as any).category}]` : ""}` : `published with shipvo`;
    return q && !`${id} ${desc}`.toLowerCase().includes(q) ? null : `${id}: ${desc} (open_app("${id}@latest"))`;
  }).filter(Boolean);
  return text(lines.join("\n") || `no apps match "${query}"`);
});

server.tool("open_app", "Open an app in a fresh phone-sized session and return its first screen.", {
  app: z.string().describe("App id from list_apps, optionally with a release: 'tide' (local build), 'tide@latest' or 'tide@r13' (the published release phones run)"),
  session: z.string().optional().describe("Session name (default: generated). One session is one phone."),
  seed_cart: z.array(z.object({ product_id: z.string().optional(), id: z.string().optional(), quantity: z.number().int().positive().optional(), qty: z.number().int().positive().optional() }).refine((l) => (l.product_id ?? l.id) && (l.quantity ?? l.qty), "each line needs product_id (or id) and quantity (or qty)")).optional().describe("Start with these items already in the cart (test shortcut). Each line: { product_id, quantity }; { id, qty } also works."),
  dark: z.boolean().optional().describe("Dark mode"),
}, async ({ app, session, seed_cart, dark }) => {
  const id = app.split("@")[0];
  if (!(await allowed(id))) throw new Error(keyApps ? `this key opens: ${keyApps.join(", ")}` : `unknown app "${id}". Apps: ${Object.keys(await localApps()).join(", ")}`);
  if (ctx.scope === "read") throw new Error("this key is read-only: it cannot open sessions");
  const sid = session ?? `${id}-${Date.now().toString(36)}`;
  const r = await sim("/session", { session: sid, app, seed_cart: seed_cart?.map((l) => ({ ...l, product_id: l.product_id ?? l.id, quantity: l.quantity ?? l.qty })), dark }) as Act & { release?: string | number };
  sessions.set(sid, { app: id, steps: 0, startedAt: Date.now(), tree: r.screen ?? undefined });
  return text(`session: ${sid}\napp: ${id} release: ${r.release ?? "local"}\n\n${r.screen ?? ""}`);
});

server.tool("list_sessions", "Open simulator sessions (phones) on this server: id, app, release and when each started. Use to resume after a reconnect.", {}, async () => {
  const r = await sim("/sessions", {}) as Act & { sessions?: { session: string; app: string; release: string | number; started_at: string | null }[] };
  const rows = (r.sessions ?? []).filter((s) => !keyApps || keyApps.includes(s.app));
  return text(rows.length ? rows.map((s) => `${s.session}: ${s.app} release ${s.release}${s.started_at ? ` since ${s.started_at}` : ""}`).join("\n") : "no open sessions");
});
const sid = z.string().describe("Session from open_app");
const compact = z.boolean().optional().describe("When the change is 'content changed', return only the added/removed lines, not the whole screen");
const CH = " The result starts with 'Change: none | content changed | new screen | scrolled'.";
const ref = z.string().regex(/^e\d+$/).describe("Element ref from the screen, e.g. e42");
server.tool("screen", "The current screen as an accessibility tree with refs.", { session: sid }, async ({ session }) => { need(session); const r = await sim("/act", { session, action: "screen" }); const s = sessions.get(session); if (s && r.ok && r.screen != null) s.tree = r.screen; return result(session, r); });
server.tool("tap", "Tap a button, link or choice by ref. Returns the new screen." + CH, { session: sid, ref, compact }, async ({ session, ref, compact }) => { need(session); return acted(session, "tap", await sim("/act", { session, action: "tap", ref }), { compact }); });
server.tool("type", "Type into a text field by ref (replaces its content). Returns the new screen." + CH + " Also gives the field's value after typing.", { session: sid, ref, text: z.string(), enter: z.boolean().optional().describe("Press Enter afterwards"), compact },
  async ({ session, ref, text: t, enter, compact }) => { need(session); return acted(session, "type", await sim("/act", { session, action: "type", ref, text: t, enter }), { compact, ref }); });
server.tool("scroll", "Scroll the page (down/up) or a horizontal rail (right/left, give the rail's ref). Returns the new screen." + CH, { session: sid, direction: z.enum(["down", "up", "left", "right"]), ref: ref.optional().describe("Scroll inside this element (a rail or list); omit for the page"), compact },
  async ({ session, direction, ref, compact }) => { need(session); return acted(session, "scroll", await sim("/act", { session, action: "scroll", direction, ref }), { compact }); });
server.tool("back", "Go back one screen." + CH, { session: sid, compact }, async ({ session, compact }) => { need(session); return acted(session, "back", await sim("/act", { session, action: "back" }), { compact }); });
server.tool("screenshot", "A PNG of the phone screen (for checking layout, colours, images). The tree from `screen` is usually enough to act.", { session: sid }, async ({ session }) => {
  need(session); const r = await sim("/act", { session, action: "screenshot" });
  if (!r.ok || !r.path) throw new Error(r.error ?? "no screenshot");
  return { content: [{ type: "image" as const, data: readFileSync(r.path).toString("base64"), mimeType: "image/png" }, { type: "text" as const, text: r.screen ?? "" }] };
});
// The simulated device: what the phone has, and what happens to it.
server.tool("set_device", "Change what the simulated phone has: location, a barcode in front of the camera, permission states, whether the fingerprint will match, whether a payment will be approved, network on/off. Takes effect for the next action.", {
  session: sid,
  location: z.object({ latitude: z.number(), longitude: z.number(), accuracy: z.number().optional() }).optional(),
  camera: z.object({ barcode: z.object({ type: z.string(), data: z.string() }).nullable().optional(), delayMs: z.number().optional() }).optional(),
  permissions: z.object({ camera: z.enum(["granted", "denied", "undetermined"]).optional(), location: z.enum(["granted", "denied", "undetermined"]).optional(), notifications: z.enum(["granted", "denied", "undetermined"]).optional() }).optional(),
  biometrics: z.object({ enrolled: z.boolean().optional(), nextResult: z.enum(["success", "fail", "cancel"]).optional() }).optional(),
  payment: z.object({ nextResult: z.enum(["approve", "decline", "timeout", "insufficient_funds"]).optional(), pin: z.string().optional() }).optional(),
  online: z.boolean().optional(),
}, async ({ session, ...device }) => { need(session); return result(session, await sim("/act", { session, action: "set_device", device })); });
server.tool("push_notification", "Deliver a push notification to the simulated phone; it appears as a banner the agent can tap.", { session: sid, title: z.string(), body: z.string(), data: z.record(z.unknown()).optional() },
  async ({ session, title, body, data }) => { need(session); return result(session, await sim("/act", { session, action: "push_notification", title, body, data })); });
server.tool("notifications", "The notification shade: notifications delivered to the simulated phone in this session (their banners vanish after 5 s, like a heads-up on a real phone).", { session: sid },
  async ({ session }) => { need(session); return text(JSON.stringify((await sim("/act", { session, action: "notifications" }) as { notifications?: unknown }).notifications ?? [], null, 2)); });
server.tool("open_notification", "Tap a notification from the shade (newest if no id is given): the app handles it exactly as if its banner was tapped.", { session: sid, id: z.string().optional() },
  async ({ session, id }) => { need(session); return result(session, await sim("/act", { session, action: "open_notification", id })); });
server.tool("open_url", "Open a deep link (such as myapp://item/3) in the running app, as a push tap, auth callback or share link would. Fails with no_url_listener if the app does not listen for URLs.", { session: sid, url: z.string().describe("The URL to deliver, e.g. myapp://item/3") }, { title: "Open a deep link", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async ({ session, url }) => { need(session); return result(session, await sim("/act", { session, action: "open_url", url })); });
server.tool("device_log", "What the app did with the device in this session: permission prompts and answers, location reads, scans, fingerprint checks, payments, notifications, shares.", { session: sid },
  async ({ session }) => { need(session); const r = await sim("/act", { session, action: "device_log" }) as Act & { log?: unknown[]; capabilities?: unknown }; return text(JSON.stringify({ note: "Everything here is simulated: no real biometric check or money movement took place.", capabilities: r.capabilities, log: r.log ?? [] }, null, 2)); });

server.tool("device_reset", "Put the simulated phone back to a known state (permissions undetermined, default location, nothing in front of the camera, log cleared), optionally with a new profile.", { session: sid, platform: z.enum(["android", "ios"]).optional(), api: z.number().optional() },
  async ({ session, ...device }) => { need(session); return result(session, await sim("/act", { session, action: "device_reset", device })); });

server.tool("end_session", "Close the session and get a report: steps taken, and the orders the app sent to its backend during the session.", { session: sid }, async ({ session }) => {
  need(session); const s = sessions.get(session) ?? { app: session.split("-")[0], steps: 0, startedAt: Date.now() }; sessions.delete(session);
  let orders: unknown[] = [];
  try { orders = (JSON.parse(readFileSync(`${process.env.PN_SIM_DIR ?? "/tmp/pn-ui"}/${session}.json`, "utf8")) as { orders: unknown[] }).orders; } catch {}
  return text(JSON.stringify({ session, app: s.app, steps: s.steps, seconds: Math.round((Date.now() - s.startedAt) / 1000), orders }, null, 2));
});

// Owner side: the same typed commands the admin at /app/<id>/admin uses.
server.tool("owner_describe", "List the owner commands of an app (content, prices, offers, orders, publish). Needs PN_OWNER_TOKEN.", { app: z.string() }, async ({ app }) => {
  const r = await fetch(`${CONTROL}/app/${app}/api/describe`); return text(await r.text());
});
server.tool("owner_command", "Run an owner command against the live app (changes are audited; `publish` makes them live on every phone within seconds).", { app: z.string(), command: z.string(), args: z.record(z.unknown()).optional() },
  async ({ app, command, args }) => {
    if (ctx.scope && ctx.scope !== "owner") throw new Error(`this key has scope "${ctx.scope}": owner commands need an owner key`);
    if (keyApps && !keyApps.includes(app)) throw new Error(`this key is for: ${keyApps.join(", ")}`);
    const token = ctx.ownerToken || OWNER_TOKEN;
    if (!token) throw new Error("owner commands are not enabled on this server.");
    const r = await fetch(`${CONTROL}/app/${app}/api/command`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ name: command, args: args ?? {} }) });
    return text(await r.text());
  });

return server;
}

// ---- transport: stdio (local) or Streamable HTTP (remote) ----
const argi = process.argv.indexOf("--http");
if (argi < 0) {
  await makeServer().connect(new StdioServerTransport());
} else {
  const port = Number(process.argv[argi + 1] || 8787);
  const keys = new Set((process.env.PN_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean));
  // Stateless (MCP 2026-07-28, and fine for 2025-era clients): no protocol session. Every request gets its own
  // McpServer and transport, built from that request's x-shipvo-* headers, so scope never outlives the request.
  // Simulator sessions are separate: they live in the simulator and travel as the `session` tool argument.
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true })); }
    if (url.pathname !== "/mcp") { res.writeHead(404); return res.end(); }
    // Keys: Bearer <key>. With no keys configured, the server is open (local use behind a tunnel you control).
    if (keys.size) { const k = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""); if (!keys.has(k)) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "invalid_api_key" })); } }
    // No server-initiated streams and nothing to close without sessions.
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST", "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server is stateless, use POST" }, id: null })); }
    let body: unknown;
    try { let raw = ""; for await (const ch of req) raw += ch; body = raw ? JSON.parse(raw) : undefined; }
    catch { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })); }
    // Behind sim.shipvo.dev the Worker has checked the key and says which app and scope it grants; locally
    // there are no such headers and every app is allowed. A client's mcp-session-id header is ignored.
    const h = (n: string) => (req.headers[n] as string) || undefined;
    const server = makeServer({ app: h("x-shipvo-app"), publicApps: h("x-shipvo-public"), scope: h("x-shipvo-scope") as Ctx["scope"], ownerToken: h("x-shipvo-owner-token") });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, body); }
    catch (e) { if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null })); } }
  });
  httpServer.listen(port, () => console.error(`Shipvo MCP over HTTP on http://localhost:${port}/mcp (${keys.size ? keys.size + " key(s)" : "no auth"})`));
}
