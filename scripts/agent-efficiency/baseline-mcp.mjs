#!/usr/bin/env node
// The "screenshots and coordinates" side: a tiny MCP server over stdio with four tools and no screen tree.
// Env: PN_SIM (simulator URL), BENCH_SESSION (session id). It never returns the labelled screen the simulator sends back.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const SIM = (process.env.PN_SIM ?? "http://localhost:4545").replace(/\/$/, "");
const SESSION = process.env.BENCH_SESSION ?? "bench";
const num = { type: "number" };
export const TOOLS = [
  { name: "screenshot", description: "Take a screenshot of the phone.", inputSchema: { type: "object", properties: {} } },
  { name: "tap", description: "Tap the phone at x, y (pixels from the top left of the screenshot).", inputSchema: { type: "object", properties: { x: num, y: num }, required: ["x", "y"] } },
  { name: "type_text", description: "Type text into the focused field. Set enter to press Enter after.", inputSchema: { type: "object", properties: { text: { type: "string" }, enter: { type: "boolean" } }, required: ["text"] } },
  { name: "swipe", description: "Scroll the screen up, down, left or right.", inputSchema: { type: "object", properties: { direction: { enum: ["up", "down", "left", "right"] } }, required: ["direction"] } },
];
const act = async (body) => (await fetch(`${SIM}/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: SESSION, ...body }) })).json();
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export async function callTool(name, a = {}) {
  if (name === "screenshot") {
    const r = await act({ action: "screenshot" });
    if (!r.ok) return text(r.error ?? "screenshot failed", true);
    return { content: [{ type: "image", data: readFileSync(r.path).toString("base64"), mimeType: "image/png" }] };
  }
  const body = name === "tap" ? { action: "tap_xy", x: a.x, y: a.y } : name === "type_text" ? { action: "type_keys", text: a.text, enter: a.enter === true }
    : name === "swipe" ? { action: "scroll", direction: a.direction } : null;
  if (!body) return text(`unknown tool ${name}`, true);
  const r = await act(body);   // the screen tree in the reply is dropped on purpose
  return r.ok ? text("done") : text(r.error ?? "failed", true);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  createInterface({ input: process.stdin }).on("line", async (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return;
    if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "screenshot-baseline", version: "0.0.1" } } });
    else if (m.method === "tools/list") send({ id: m.id, result: { tools: TOOLS } });
    else if (m.method === "tools/call") send({ id: m.id, result: await callTool(m.params.name, m.params.arguments).catch((e) => text(String(e.message), true)) });
    else send({ id: m.id, error: { code: -32601, message: "method not found" } });
  });
}
