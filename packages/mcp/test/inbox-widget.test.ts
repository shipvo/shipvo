import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import vm from "node:vm";

// The built server (pnpm build runs before pnpm test in CI).
const server = resolve(__dirname, "..", "dist", "server.js");
const env = { ...process.env, PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1", PN_API_KEYS: "", PN_APPS: "" } as Record<string, string>;
const URI = "ui://shipvo/inbox.html";
let c: Client;
beforeAll(async () => { c = new Client({ name: "widget", version: "1" }); await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env })); }, 60000);
afterAll(async () => { await c?.close(); });

describe("the Assistant Inbox widget (MCP Apps)", () => {
  it("inbox_view points hosts at the widget", async () => {
    const t = (await c.listTools()).tools.find((x) => x.name === "inbox_view")!;
    expect(t._meta).toMatchObject({ ui: { resourceUri: URI }, "ui/resourceUri": URI, "openai/outputTemplate": URI });
  });

  it("the widget is listed and reads back as an MCP App page", async () => {
    const list = (await c.listResources()).resources;
    expect(list.find((r) => r.uri === URI)).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    const page = (await c.readResource({ uri: URI })).contents[0] as { mimeType: string; text: string; _meta?: { ui?: { csp?: unknown } } };
    expect(page.mimeType).toBe("text/html;profile=mcp-app");
    expect(page.text).toMatch(/^<!doctype html>/);
    expect(page._meta?.ui?.csp).toEqual({ connectDomains: [], resourceDomains: [] });
  });

  it("posts only new items for this assistant, at most 20 an hour", async () => {
    const html = ((await c.readResource({ uri: URI })).contents[0] as { text: string }).text;
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    // A fake host: the page under test talks to it over postMessage, like an MCP Apps host.
    const el = () => ({ textContent: "", innerHTML: "", hidden: false, checked: true, onclick: null, setAttribute() {} });
    const els: Record<string, ReturnType<typeof el>> = {};
    const posted: string[] = []; let onMessage: (e: { data: unknown }) => void = () => {};
    const parent = { postMessage(m: { id?: number; method: string; params?: { content?: { text: string }[] } }) {
      if (m.method === "ui/message") posted.push(m.params!.content![0].text);
      if (m.id != null) queueMicrotask(() => onMessage({ data: { jsonrpc: "2.0", id: m.id, result: {} } }));
    } };
    const window = { parent, addEventListener: (type: string, f: typeof onMessage) => { if (type === "message") onMessage = f; } };
    const document = { getElementById: (id: string) => (els[id] ??= el()), documentElement: { scrollHeight: 100 } };
    vm.runInNewContext(script, { window, document, setInterval: () => 0, setTimeout: () => 0, queueMicrotask, Date, Map, Set, Array, String, Error, Promise });
    const msg = (id: number, from: string, to: string) => ({ id, from, to, body: `hi ${id}`, read: false, sent_on: "now" });
    const view = (messages: unknown[]) => onMessage({ data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { session: "team-1", me: "ChatGPT", messages, tasks: [] } } } });
    const tick = () => new Promise((r) => setTimeout(r, 5));

    view([msg(1, "Gemini", "ChatGPT")]); await tick();
    expect(posted).toEqual([]);                                      // what was there on open is only marked seen
    view([msg(1, "Gemini", "ChatGPT"), msg(2, "Gemini", "ChatGPT"), msg(3, "ChatGPT", "Gemini"), msg(4, "Gemini", "Claude")]); await tick();
    expect(posted).toHaveLength(1);                                  // not my own message, not one for someone else
    expect(posted[0]).toContain('a message from Gemini: "hi 2"');
    expect(posted[0]).toContain("session team-1");
    const all = [msg(1, "Gemini", "ChatGPT"), msg(2, "Gemini", "ChatGPT")];
    for (let i = 10; i < 40; i++) { all.push(msg(i, "Gemini", "anyone")); view(all); await tick(); }
    expect(posted).toHaveLength(20);
    expect(els.note.textContent).toMatch(/paused/);
  });

  it("in ChatGPT, uses window.openai to read the first result, poll and post", async () => {
    const html = ((await c.readResource({ uri: URI })).contents[0] as { text: string }).text;
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    const el = () => ({ textContent: "", innerHTML: "", hidden: false, checked: true, onclick: null, setAttribute() {} });
    const els: Record<string, ReturnType<typeof el>> = {};
    const msg = (id: number) => ({ id, from: "gemini", to: "chatgpt", body: `hi ${id}`, read: false, sent_on: "now" });
    let inbox = [msg(1)]; const prompts: string[] = []; const calls: unknown[] = []; let tick: () => Promise<void> = async () => {};
    const openai = { toolInput: { session: "team-1" }, toolOutput: { session: "team-1", me: "chatgpt", messages: inbox, tasks: [] },
      callTool: async (name: string, args: unknown) => { calls.push([name, args]); return { structuredContent: { session: "team-1", me: "chatgpt", messages: inbox, tasks: [] } }; },
      sendFollowUpMessage: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); } };
    const window = { openai, parent: { postMessage() {} }, addEventListener() {} };
    const document = { getElementById: (id: string) => (els[id] ??= el()), documentElement: { scrollHeight: 100 } };
    vm.runInNewContext(script, { window, document, setInterval: (f: () => Promise<void>) => { tick = f; return 0; }, setTimeout: () => 0, queueMicrotask, Date, Map, Set, Array, String, Error, Promise });
    expect(els.who.textContent).toBe("you are chatgpt");                 // drawn from toolOutput before any poll
    inbox = [msg(1), msg(2)]; await tick(); await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual([["inbox_view", { session: "team-1" }]]);
    expect(prompts).toHaveLength(1); expect(prompts[0]).toContain('a message from gemini: "hi 2"');
  });
});
