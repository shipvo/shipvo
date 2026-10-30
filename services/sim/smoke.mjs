// Hosted smoke test: open the app, tap a product, add to cart, check the cart, each call on a NEW connection
// (the way ChatGPT talks to MCP servers). Usage: node smoke.mjs <mcp-url> <api-key>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const [url, key] = process.argv.slice(2);
const call = async (name, args) => { const c = new Client({ name: "smoke", version: "0" }); await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } })); const r = await c.callTool({ name, arguments: args }); await c.close(); if (r.isError) throw new Error(r.content[0].text); return r.content[0].text; };
const ref = (scr, re) => { const m = scr.split("\n").map((l) => l.match(/- (\w+) "([^"]+)".*\[ref=(e\d+)\]/)).filter(Boolean).find((m) => re.test(m[2]) && m[1] !== "heading"); if (!m) throw new Error(`missing ${re}\n${scr}`); return m[3]; };
const s = `smoke-${Date.now().toString(36)}`; const t0 = Date.now();
let scr = await call("open_app", { app: "tide@latest", session: s });
scr = await call("tap", { session: s, ref: ref(scr, /^Chrome Spoon/) });
scr = await call("tap", { session: s, ref: ref(scr, /^Add 1 to cart/) });
scr = await call("tap", { session: s, ref: ref(scr, /^Open cart/) });
if (!/Chrome Spoon/.test(scr) || !/Choose delivery and pay/.test(scr)) throw new Error("cart does not show the item\n" + scr);
const rep = await call("end_session", { session: s });
console.log(`SMOKE OK: open → product → add → cart across 5 connections in ${((Date.now() - t0) / 1000).toFixed(1)}s`); console.log(rep.split("\n").slice(0, 5).join("\n"));
