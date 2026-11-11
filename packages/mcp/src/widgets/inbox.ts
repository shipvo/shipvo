// The Assistant Inbox widget: an MCP Apps view (ui://shipvo/inbox.html) that a host such as ChatGPT draws in the chat
// next to an inbox_view result. It shows the shared inbox live and, with auto-continue on, posts each new message
// for this assistant into the chat (ui/message), so the assistant answers without the person typing.
// No libraries: it speaks the MCP Apps postMessage JSON-RPC itself, and gets fresh data by calling inbox_view
// through the host (tools/call), so it needs no network access of its own.

export const INBOX_WIDGET_URI = "ui://shipvo/inbox.html";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
/** Most posts per hour the widget makes into the chat on its own. Two assistants answering each other stop here. */
export const AUTO_POSTS_PER_HOUR = 20;
export const POLL_MS = 4000;
/** _meta on the inbox_view tool: the MCP Apps key, its older spelling, and ChatGPT's own keys. */
export const INBOX_TOOL_META = {
  ui: { resourceUri: INBOX_WIDGET_URI }, "ui/resourceUri": INBOX_WIDGET_URI,
  "openai/outputTemplate": INBOX_WIDGET_URI, "openai/widgetAccessible": true,
  "openai/toolInvocation/invoking": "Opening the inbox", "openai/toolInvocation/invoked": "Inbox open",
};
/** _meta on the widget resource. The page makes no network requests of its own, so it asks for no domains. */
export const INBOX_WIDGET_META = {
  ui: { prefersBorder: true, csp: { connectDomains: [] as string[], resourceDomains: [] as string[] } },
  "openai/widgetPrefersBorder": true, "openai/widgetDescription": "The shared Assistant Inbox of a Shipvo phone, updating live.",
  "openai/widgetCSP": { connect_domains: [] as string[], resource_domains: [] as string[] },
};

export const INBOX_WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assistant Inbox</title>
<style>
  :root { color-scheme: light dark; --fg:#1c1c1e; --muted:#6b6b70; --line:#e2e2e6; --bg:#fff; --chip:#f2f2f5; --accent:#2563eb; --ok:#15803d; }
  @media (prefers-color-scheme: dark) { :root { --fg:#f2f2f5; --muted:#a1a1a8; --line:#34343a; --bg:#1c1c1e; --chip:#2a2a2e; --accent:#60a5fa; --ok:#4ade80; } }
  * { box-sizing: border-box; } body { margin:0; font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: var(--fg); background: var(--bg); }
  header { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
  header h1 { font-size:15px; margin:0; flex:1; } .who { color: var(--muted); font-size:12px; }
  .badge { background: var(--accent); color:#fff; border-radius:999px; padding:1px 8px; font-size:12px; }
  label.auto { display:flex; align-items:center; gap:6px; font-size:12px; color: var(--muted); }
  nav { display:flex; gap:4px; padding:8px 12px 0; } nav button { border:0; background:none; color: var(--muted); padding:6px 10px; border-radius:8px; font: inherit; cursor:pointer; }
  nav button[aria-selected=true] { background: var(--chip); color: var(--fg); }
  ul { list-style:none; margin:0; padding:6px 12px 12px; max-height:340px; overflow:auto; }
  li { padding:8px 0; border-bottom:1px solid var(--line); } li:last-child { border-bottom:0; }
  .meta { font-size:12px; color: var(--muted); } .new { border-left:3px solid var(--accent); padding-left:8px; }
  .status { font-size:11px; padding:1px 6px; border-radius:6px; background: var(--chip); } .status.done { color: var(--ok); }
  .empty, .note { color: var(--muted); padding: 12px; } .note { font-size:12px; padding: 0 12px 10px; }
</style></head>
<body>
<header><h1>Assistant Inbox</h1><span class="who" id="who"></span><span class="badge" id="badge" hidden></span>
  <label class="auto"><input type="checkbox" id="auto" checked> Auto-continue</label></header>
<nav role="tablist"><button role="tab" id="t-msg" aria-selected="true">Messages</button><button role="tab" id="t-task" aria-selected="false">Tasks</button></nav>
<ul id="list" aria-live="polite"></ul>
<p class="note" id="note"></p>
<script>
(() => {
  const POLL_MS = ${POLL_MS}, CAP = ${AUTO_POSTS_PER_HOUR};
  let nextId = 1; const waiting = new Map();
  const send = (msg) => window.parent.postMessage({ jsonrpc: "2.0", ...msg }, "*");
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; waiting.set(id, { resolve, reject }); send({ id, method, params });
    setTimeout(() => { if (waiting.delete(id)) reject(new Error(method + " timed out")); }, 30000);
  });
  let state = null, session = null, tab = "msg", started = false;
  const told = new Set(); const posts = [];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const forMe = (to) => state && state.me && (to === state.me || to === "anyone");

  function render() {
    if (!state) return;
    $("who").textContent = state.me ? "you are " + state.me : "";
    const n = (state.unread_for_me || 0) + (state.open_for_me || 0);
    $("badge").hidden = !n; $("badge").textContent = n + " for you";
    const rows = tab === "msg"
      ? state.messages.slice().reverse().map((m) => '<li class="' + (!m.read && forMe(m.to) ? "new" : "") + '"><div class="meta">' + esc(m.from) + " → " + esc(m.to) + " · " + esc(m.sent_on) + (m.read ? "" : " · unread") + "</div>" + esc(m.body) + "</li>")
      : state.tasks.slice().reverse().map((h) => '<li class="' + (h.status !== "done" && forMe(h.to) ? "new" : "") + '"><div class="meta">' + esc(h.from) + " → " + esc(h.to) + ' · <span class="status ' + esc(h.status) + '">' + esc(h.status) + "</span></div><b>" + esc(h.title) + "</b>" + (h.reply ? '<div class="meta">Reply: ' + esc(h.reply) + "</div>" : "") + "</li>");
    $("list").innerHTML = rows.join("") || '<li class="empty">Nothing yet.</li>';
    send({ method: "ui/notifications/size-changed", params: { height: document.documentElement.scrollHeight } });
  }

  // New items for this assistant since the widget opened. The first view only marks what is there as seen.
  function arrivals(next) {
    const out = [];
    for (const m of next.messages) { const k = "m:" + m.id; if (!told.has(k)) { told.add(k); if (started && !m.read && forMe(m.to) && m.from !== next.me) out.push("a message from " + m.from + ': "' + m.body + '"'); } }
    for (const h of next.tasks) { const k = "t:" + h.id; if (!told.has(k)) { told.add(k); if (started && h.status !== "done" && forMe(h.to) && h.from !== next.me) out.push("a task from " + h.from + ': "' + h.title + '"'); } }
    started = true; return out;
  }

  async function autoContinue(items) {
    if (!items.length || !$("auto").checked) return;
    const hourAgo = Date.now() - 3600000; while (posts.length && posts[0] < hourAgo) posts.shift();
    if (posts.length >= CAP) { $("note").textContent = "Auto-continue paused: " + CAP + " posts in the last hour."; return; }
    posts.push(Date.now());
    const text = "New in the Shipvo inbox (session " + session + "): " + items.join("; ") + ". Read it with check_inbox or my_tasks, act on it, and reply.";
    try { const r = await request("ui/message", { role: "user", content: [{ type: "text", text }] }); if (r && r.isError) $("note").textContent = "The chat did not take the message; answer it yourself."; else $("note").textContent = ""; }
    catch { $("note").textContent = "This chat cannot post messages from the widget; read the inbox yourself."; }
  }

  function take(result) {
    const next = result && (result.structuredContent || result);
    if (!next || !Array.isArray(next.messages)) return;
    if (next.session) session = next.session;
    const items = arrivals(next); state = next; render(); autoContinue(items);
  }

  async function poll() {
    if (!session) return;
    try { const r = await request("tools/call", { name: "inbox_view", arguments: { session } }); if (r && !r.isError) take(r); }
    catch { /* the host may be busy; try again next tick */ }
  }

  window.addEventListener("message", (e) => {
    const d = e.data; if (!d || d.jsonrpc !== "2.0") return;
    if (d.id != null && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); return d.error ? w.reject(new Error(d.error.message)) : w.resolve(d.result); }
    if (d.method === "ui/notifications/tool-result") take(d.params);
    if (d.method === "ui/notifications/tool-input" && d.params && d.params.arguments && d.params.arguments.session) session = d.params.arguments.session;
  });
  $("t-msg").onclick = () => { tab = "msg"; $("t-msg").setAttribute("aria-selected", "true"); $("t-task").setAttribute("aria-selected", "false"); render(); };
  $("t-task").onclick = () => { tab = "task"; $("t-task").setAttribute("aria-selected", "true"); $("t-msg").setAttribute("aria-selected", "false"); render(); };

  request("ui/initialize", { appInfo: { name: "shipvo-inbox", version: "1" }, appCapabilities: {}, protocolVersion: "2026-01-26" })
    .then(() => send({ method: "ui/notifications/initialized", params: {} })).catch(() => {});
  setInterval(poll, POLL_MS);
})();
</script></body></html>`;
