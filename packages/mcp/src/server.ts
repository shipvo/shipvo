#!/usr/bin/env node
// PureNative MCP: agents use PureNative apps with no phone.
//   PN_SIM=http://localhost:4545  PN_CONTROL=https://purenative-control.purenative.workers.dev  PN_OWNER_TOKEN=...  purenative-mcp
// Tools: list_apps, open_app, screen, tap, type, scroll, back, screenshot, end_session (UI simulator);
//        owner_describe, owner_command (the app's live content, prices, orders: owner token required).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";

const SIM = (process.env.PN_SIM ?? "http://localhost:4545").replace(/\/$/, "");
const CONTROL = (process.env.PN_CONTROL ?? "https://purenative-control.purenative.workers.dev").replace(/\/$/, "");
const OWNER_TOKEN = process.env.PN_OWNER_TOKEN ?? "";
// Apps this server can open. Hosted: the account's apps. Local: one app served by the simulator.
const APPS: Record<string, { name: string; description: string }> = process.env.PN_APPS ? JSON.parse(process.env.PN_APPS)
  : { tide: { name: "Tide & Tackle", description: "Fishing-supplies shop in Douala: catalogue, cart, promo codes, delivery slots, cash or mobile money." } };

type Act = { ok: boolean; screen?: string | null; error?: string; path?: string };
async function sim(path: string, body: Record<string, unknown>): Promise<Act> {
  const r = await fetch(SIM + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}. Is it running at ${SIM}?`);
  return r.json() as Promise<Act>;
}
const sessions = new Map<string, { app: string; steps: number; startedAt: number }>();
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const result = (sid: string, r: Act) => { const s = sessions.get(sid); if (s) s.steps++; return text(r.ok ? (r.screen ?? "") : `Error: ${r.error}\n\nScreen now:\n${r.screen ?? ""}`); };
const need = (sid: string) => { if (!sessions.has(sid)) throw new Error(`no session "${sid}". Call open_app first.`); };

const server = new McpServer({ name: "purenative", version: "0.0.1" }, { instructions:
`You can use PureNative apps the way a person uses them on a phone, without a phone.
Call open_app to get a session and the first screen. The screen is an accessibility tree: every button, field and text, with a [ref=eN]. Act with tap/type/scroll/back using refs, and read the screen that comes back each time.
Only what is on screen is listed, like a phone: a horizontal product rail shows a few items, so "scroll right" on the rail (its ref) to see more; "scroll down" the page for the rest.
Finish a task by checking the final screen says what you expected (for example "Order placed"). Call end_session when done to get a report.` });

server.tool("list_apps", "Apps this server can open, with what each one does.", {}, async () =>
  text(Object.entries(APPS).map(([id, a]) => `${id}: ${a.name}. ${a.description}`).join("\n")));

server.tool("open_app", "Open an app in a fresh phone-sized session and return its first screen.", {
  app: z.string().describe("App id from list_apps, e.g. 'tide'"),
  session: z.string().optional().describe("Session name (default: generated). One session is one phone."),
  seed_cart: z.array(z.object({ id: z.string(), qty: z.number().int().positive() })).optional().describe("Start with these items already in the cart (test shortcuts)."),
  dark: z.boolean().optional().describe("Dark mode"),
}, async ({ app, session, seed_cart, dark }) => {
  if (!APPS[app]) throw new Error(`unknown app "${app}". Apps: ${Object.keys(APPS).join(", ")}`);
  const sid = session ?? `${app}-${Date.now().toString(36)}`;
  const r = await sim("/session", { session: sid, seed_cart, dark });
  sessions.set(sid, { app, steps: 0, startedAt: Date.now() });
  return text(`session: ${sid}\n\n${r.screen ?? ""}`);
});

const sid = z.string().describe("Session from open_app");
const ref = z.string().regex(/^e\d+$/).describe("Element ref from the screen, e.g. e42");
server.tool("screen", "The current screen as an accessibility tree with refs.", { session: sid }, async ({ session }) => { need(session); return result(session, await sim("/act", { session, action: "screen" })); });
server.tool("tap", "Tap a button, link or choice by ref. Returns the new screen.", { session: sid, ref }, async ({ session, ref }) => { need(session); return result(session, await sim("/act", { session, action: "tap", ref })); });
server.tool("type", "Type into a text field by ref (replaces its content). Returns the new screen.", { session: sid, ref, text: z.string(), enter: z.boolean().optional().describe("Press Enter afterwards") },
  async ({ session, ref, text: t, enter }) => { need(session); return result(session, await sim("/act", { session, action: "type", ref, text: t, enter })); });
server.tool("scroll", "Scroll the page (down/up) or a horizontal rail (right/left, give the rail's ref). Returns the new screen.", { session: sid, direction: z.enum(["down", "up", "left", "right"]), ref: ref.optional().describe("Scroll inside this element (a rail or list); omit for the page") },
  async ({ session, direction, ref }) => { need(session); return result(session, await sim("/act", { session, action: "scroll", direction, ref })); });
server.tool("back", "Go back one screen.", { session: sid }, async ({ session }) => { need(session); return result(session, await sim("/act", { session, action: "back" })); });
server.tool("screenshot", "A PNG of the phone screen (for checking layout, colours, images). The tree from `screen` is usually enough to act.", { session: sid }, async ({ session }) => {
  need(session); const r = await sim("/act", { session, action: "screenshot" });
  if (!r.ok || !r.path) throw new Error(r.error ?? "no screenshot");
  return { content: [{ type: "image" as const, data: readFileSync(r.path).toString("base64"), mimeType: "image/png" }, { type: "text" as const, text: r.screen ?? "" }] };
});
server.tool("end_session", "Close the session and get a report: steps taken, and the orders the app sent to its backend during the session.", { session: sid }, async ({ session }) => {
  need(session); const s = sessions.get(session)!; sessions.delete(session);
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
    if (!OWNER_TOKEN) throw new Error("PN_OWNER_TOKEN is not set: owner commands are disabled.");
    const r = await fetch(`${CONTROL}/app/${app}/api/command`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER_TOKEN}` }, body: JSON.stringify({ command, args: args ?? {} }) });
    return text(await r.text());
  });

await server.connect(new StdioServerTransport());
