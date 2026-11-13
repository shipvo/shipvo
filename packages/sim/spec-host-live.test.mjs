// Live: create_app starts a spec app on the phone. The app has an icon, opens, shows its labelled controls, and
// taps, typing and choices change it. Android and iOS skins.
import { readFileSync } from "node:fs";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(11800, 150);
const root = mkdtempSync(join(tmpdir(), "sim-spec-host-"));
const dist = join(root, "dist"), dir = join(root, "state");
let proc;
const call = async (path, body) => (await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
const act = (session, body) => call("/act", { session, ...body });

// A small tracker: a list of gifts and a form that adds one.
const GIFTS = {
  spec: "shipvo.app/v0",
  app: { id: "gifts", name: "Gift Tracker", icon: "gift", description: "Gift ideas for the holidays." },
  data: { gifts: { source: "collection", fields: { id: "text", name: "text" }, seed: [{ id: "g1", name: "Scarf" }] } },
  actions: {
    add_gift: {
      description: "Add a gift idea.",
      input: { name: { type: "text" } },
      do: [{ insert: "gifts", value: { id: "{{ 'g' + string(count(gifts) + 1) }}", name: "{{ input.name }}" } }, { toast: "Gift added" }],
    },
  },
  screens: [{ id: "home", title: "Gifts", body: [
    { type: "list", label: "Gift ideas", from: "{{ gifts }}", item: { title: "{{ item.name }}" }, empty: { message: "No gifts yet" } },
    { type: "form", label: "Add a gift", fields: [{ name: "name", type: "text", label: "Gift name", required: true, maxLength: 100 }], submit: { label: "Add", action: "add_gift" } },
  ] }],
};

before(async () => {
  const require = createRequire(import.meta.url);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
    if (spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" }).status !== 0) throw new Error("could not install Chromium for playwright");
  }
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>home</title><h1>Home</h1>");
  proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", dir, "--dist", dist], { stdio: ["ignore", "ignore", "pipe"], cwd: here });
  let err = ""; proc.stderr.on("data", (d) => { err += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) { try { await fetch(`http://localhost:${PORT}/`); up = true; } catch { if (proc.exitCode !== null) throw new Error(`sim exited: ${err}`); await new Promise((r) => setTimeout(r, 200)); } }
  if (!up) throw new Error(`sim did not start: ${err}`);
});
after(async () => {
  if (proc && proc.exitCode === null) { const done = new Promise((r) => proc.once("exit", r)); proc.kill("SIGKILL"); await done; }
  proc?.stderr.destroy(); rmSync(root, { recursive: true, force: true });
});

for (const style of ["android", "ios"]) {
  test(`${style}: create_app installs a spec app that opens and can be used`, async () => {
    const sid = `sp-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    const r = await act(sid, { action: "create_app", id: "gifts", spec: GIFTS, style });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.current_app, "gifts");
    assert.equal(r.installed_apps.find((a) => a.id === "gifts").kind, "spec");
    assert.match(r.screen, /Gift ideas/);
    assert.match(r.screen, /Scarf/);
    // type into the form and submit: the list changes
    const ref = (text, role) => new RegExp(`${role} "${text}" \\[ref=([\\w]+)\\]`).exec(r.screen)?.[1];
    const typed = await act(sid, { action: "type", ref: ref("Gift name", "textbox"), text: "Mug" });
    assert.equal(typed.ok, true, JSON.stringify(typed));
    const added = await act(sid, { action: "tap", ref: ref("Add", "button") });
    assert.equal(added.ok, true, JSON.stringify(added));
    const screen = (await act(sid, { action: "screen" })).screen;
    assert.match(screen, /Mug/);
    const log = (await act(sid, { action: "device_log" })).log.find((e) => e.name === "create_app");
    assert.equal(log.source, "real");
  });
}

test("a spec with problems is refused with the path of each one, and nothing is installed", async () => {
  assert.ok((await call("/session", { session: "sp-bad" })).ok);
  const r = await act("sp-bad", { action: "create_app", id: "oops", spec: { spec: "0", app: { id: "oops" }, screens: [] } });
  assert.equal(r.ok, false);
  assert.equal(r.code, "invalid_spec");
  assert.match(r.error, /\//);
  const sw = await act("sp-bad", { action: "switch_app", id: "oops" });
  assert.equal(sw.code, "not_installed");
});

test("create_app twice with the same id says already_installed", async () => {
  assert.ok((await call("/session", { session: "sp-dup" })).ok);
  assert.equal((await act("sp-dup", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const r = await act("sp-dup", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.equal(r.code, "already_installed");
});

test("run_app_action changes the app's data and the open screen shows it; a bad input says why", async () => {
  assert.ok((await call("/session", { session: "sp-act" })).ok);
  assert.equal((await act("sp-act", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const r = await act("sp-act", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.screen, /Kite/);
  const bad = await act("sp-act", { action: "app_action", id: "gifts", action_name: "no_such", input: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "action_failed");
  const none = await act("sp-act", { action: "app_action", id: "ghost", action_name: "x" });
  assert.equal(none.code, "not_installed");
});

test("two assistants on one phone are told apart by the client name, with no name typed", async () => {
  const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
  assert.ok((await call("/session", { session: "sp-who" })).ok);
  assert.equal((await act("sp-who", { action: "create_app", id: "inbox", spec: INBOX })).ok, true);
  const sent = await act("sp-who", { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Please test checkout." }, agent: "openai-mcp" });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const none = await act("sp-who", { action: "app_action", id: "inbox", action_name: "check_inbox", input: {}, agent: "openai-mcp" });
  assert.deepEqual(none.value.messages, []);
  const got = await act("sp-who", { action: "app_action", id: "inbox", action_name: "check_inbox", input: {}, agent: "claude-ai" });
  assert.deepEqual(got.value.messages.map((m) => [m.from, m.to, m.body]), [["chatgpt", "claude", "Please test checkout."]]);
});

test("inbox_view shows the whole inbox and what waits for the caller, without marking anything read", async () => {
  const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
  assert.ok((await call("/session", { session: "sp-view" })).ok);
  assert.equal((await act("sp-view", { action: "inbox_view", agent: "claude-ai" })).code, "no_inbox");
  assert.equal((await act("sp-view", { action: "create_app", id: "inbox", spec: INBOX })).ok, true);
  await act("sp-view", { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Check the cart." }, agent: "openai-mcp" });
  await act("sp-view", { action: "app_action", id: "inbox", action_name: "hand_off", input: { to: "claude", title: "Test checkout", detail: "" }, agent: "openai-mcp" });
  const v = await act("sp-view", { action: "inbox_view", agent: "claude-ai" });
  assert.equal(v.me, "claude");
  assert.deepEqual(v.messages.map((m) => [m.from, m.to, m.body, m.read]), [["chatgpt", "claude", "Check the cart.", false]]);
  assert.deepEqual(v.tasks.map((h) => [h.from, h.title, h.status !== "done"]), [["chatgpt", "Test checkout", true]]);
  assert.equal(v.unread_for_me, 1); assert.equal(v.open_for_me, 1);
  assert.equal((await act("sp-view", { action: "inbox_view", agent: "openai-mcp" })).unread_for_me, 0);
  assert.equal((await act("sp-view", { action: "inbox_view", agent: "claude-ai" })).unread_for_me, 1);   // viewing reads nothing
});

for (const style of ["android", "ios"]) {
  test(`${style}: pending_banner tells each assistant what waits for it`, async () => {
    const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
    const sid = `sp-banner-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "inbox", spec: INBOX, style })).ok, true);
    assert.equal((await act(sid, { action: "pending_banner", agent: "claude-ai" })).banner, "");
    await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Review please." }, agent: "openai-mcp" });
    await act(sid, { action: "app_action", id: "inbox", action_name: "hand_off", input: { to: "claude", title: "Test checkout", detail: "" }, agent: "openai-mcp" });
    assert.equal((await act(sid, { action: "pending_banner", agent: "claude-ai" })).banner, "Inbox: 1 unread for claude, 1 task open");
    assert.equal((await act(sid, { action: "pending_banner", agent: "openai-mcp" })).banner, "");
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: wait_for_event returns when a message arrives for the caller, and times out when none does`, async () => {
    const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
    const sid = `sp-wait-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "inbox", spec: INBOX, style })).ok, true);
    const quiet = await act(sid, { action: "wait_for_event", timeout_ms: 300, agent: "claude-ai" });
    assert.equal(quiet.ok, true); assert.equal(quiet.event, false);
    // claude starts waiting; chatgpt sends a message half a second later
    const waiting = act(sid, { action: "wait_for_event", timeout_ms: 10000, agent: "claude-ai" });
    await new Promise((r) => setTimeout(r, 500));
    await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Review please." }, agent: "openai-mcp" });
    const t0 = Date.now(); const got = await waiting;
    assert.equal(got.event, true); assert.equal(got.pending.messages.length, 1); assert.deepEqual(got.pending.tasks, []);
    assert.ok(Date.now() - t0 < 5000);
    // the same unread message does not wake claude again; a new open task does once, and then not again while it stays open
    assert.equal((await act(sid, { action: "wait_for_event", timeout_ms: 300, agent: "claude-ai" })).event, false);
    await act(sid, { action: "app_action", id: "inbox", action_name: "hand_off", input: { to: "claude", title: "Test checkout", detail: "" }, agent: "openai-mcp" });
    const task = await act(sid, { action: "wait_for_event", timeout_ms: 2000, agent: "claude-ai" });
    assert.equal(task.event, true); assert.deepEqual(task.pending.messages, []); assert.equal(task.pending.tasks.length, 1);
    assert.equal((await act(sid, { action: "wait_for_event", timeout_ms: 300, agent: "claude-ai" })).event, false);
    // the sender has nothing waiting; a client with no name cannot wait
    assert.equal((await act(sid, { action: "wait_for_event", timeout_ms: 200, agent: "openai-mcp" })).event, false);
    const anon = await act(sid, { action: "wait_for_event", timeout_ms: 200 });
    assert.equal(anon.ok, false); assert.equal(anon.code, "no_caller");
    const bad = await act(sid, { action: "wait_for_event", timeout_ms: 99999, agent: "claude-ai" });
    assert.equal(bad.ok, false); assert.equal(bad.code, "bad_timeout");
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: register_wakeup POSTs a signed note when a message arrives for that assistant, with no one asking`, async () => {
    const { createServer } = await import("node:http");
    const { createHmac } = await import("node:crypto");
    const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
    const sid = `sp-wake-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "inbox", spec: INBOX, style })).ok, true);
    const posts = [];
    const rx = createServer(async (req, res) => { let raw = ""; for await (const c of req) raw += c; posts.push({ h: req.headers, raw }); res.writeHead(204); res.end(); });
    await new Promise((r) => rx.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${rx.address().port}/wake`;
      const refused = await act(sid, { action: "register_wakeup", name: "claude", url });
      assert.equal(refused.ok, false); assert.equal(refused.code, "host_not_allowed", JSON.stringify(refused).slice(0, 300));
      const reg = await act(sid, { action: "register_wakeup", name: "claude", url, allow_private: true });
      assert.equal(reg.ok, true); assert.equal(reg.wakeup.name, "claude"); assert.ok(reg.wakeup.secret);
      assert.deepEqual((await act(sid, { action: "list_wakeups" })).wakeups.map((w) => w.name), ["claude"]);
      await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Review the checkout flow." }, agent: "openai-mcp" });
      for (let i = 0; i < 50 && !posts.length; i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(posts.length, 1);
      const note = JSON.parse(posts[0].raw);
      assert.equal(note.to, "claude"); assert.equal(note.event, "message"); assert.equal(note.messages.length, 1);
      assert.ok(!posts[0].raw.includes("checkout"));
      const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(posts[0].h["x-shipvo-signature"]);
      assert.equal(m[2], createHmac("sha256", reg.wakeup.secret).update(`${m[1]}.${posts[0].raw}`).digest("hex"));
      const log = (await act(sid, { action: "device_log" })).log.filter((e) => e.name === "wakeup");
      assert.equal(log.length, 1); assert.equal(log[0].ok, true); assert.equal(log[0].status, 204); assert.equal(log[0].to, "claude");
      // the other assistant is not woken, and clearing stops it
      await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "chatgpt", body: "hi" }, agent: "claude-ai" });
      assert.equal((await act(sid, { action: "clear_wakeup", name: "claude" })).cleared, true);
      await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "again" }, agent: "openai-mcp" });
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(posts.length, 1);
    } finally { rx.close(); }
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: search_phone finds text in app data, can be narrowed to one app, and rejects bad input`, async () => {
    const INBOX = JSON.parse(readFileSync(new URL("../../templates/assistant-inbox/app.json", import.meta.url), "utf8"));
    const sid = `sp-search-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "inbox", spec: INBOX, style })).ok, true);
    await act(sid, { action: "app_action", id: "inbox", action_name: "send_message", input: { to: "claude", body: "Order the Marigold lamps" }, agent: "claude-ai" });
    const hit = await act(sid, { action: "search_phone", query: "marigold" });
    assert.equal(hit.ok, true, JSON.stringify(hit).slice(0, 300));
    assert.equal(hit.count, 1); assert.equal(hit.results[0].app, "inbox"); assert.equal(hit.results[0].kind, "row");
    assert.match(hit.results[0].snippet, /Marigold lamps/);
    assert.equal((await act(sid, { action: "search_phone", query: "marigold", app: "inbox" })).count, 1);
    assert.equal((await act(sid, { action: "search_phone", query: "marigold", app: "notifications" })).count, 0);
    assert.equal((await act(sid, { action: "search_phone", query: "zzz-none" })).count, 0);
    assert.equal((await act(sid, { action: "search_phone", query: "" })).code, "bad_query");
    assert.equal((await act(sid, { action: "search_phone", query: "x", app: "nope" })).code, "not_installed");
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: a PIN lock screen needs the PIN, survives a restart, and a wrong PIN is refused`, async () => {
    const sid = `sp-pin-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "set_lock_method", method: "pin", pin: "2468" })).ok, true);
    assert.equal((await act(sid, { action: "phone_apps" })).lock_method, "pin");
    await act(sid, { action: "lock" });
    assert.equal((await act(sid, { action: "unlock" })).code, "pin_required");
    assert.equal((await act(sid, { action: "unlock", pin: "1111" })).code, "wrong_pin");
    const r = await act(sid, { action: "restart" });
    assert.equal(r.locked, true);
    assert.equal((await act(sid, { action: "unlock", pin: "2468" })).locked, false);
    assert.equal((await act(sid, { action: "set_lock_method", method: "none" })).code, "wrong_pin");
    assert.equal((await act(sid, { action: "set_lock_method", method: "none", current: "2468" })).ok, true);
  });
  test(`${style}: share puts text into another app, and the clipboard survives switching apps`, async () => {
    const NOTES = JSON.parse(readFileSync(new URL("../../templates/notes-tasks/app.json", import.meta.url), "utf8"));
    const sid = `sp-share-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "notes", spec: NOTES, style })).ok, true);
    const tg = await act(sid, { action: "share_targets" });
    assert.deepEqual(tg.targets.map((x) => `${x.app}.${x.action}:${x.field}`).sort(), ["notes.add_note:body", "notes.add_task:title"]);
    assert.equal((await act(sid, { action: "share", to: "notes", text: "Buy rope" })).code, "pick_action");
    const r = await act(sid, { action: "share", to: "notes", action_name: "add_note", text: "Harbour list\nrope, hooks", from: "browser" });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    const notes = (await act(sid, { action: "export_apps", ids: ["notes"] })).apps[0].data.notes;
    assert.deepEqual(notes.map((n) => [n.title, n.body]), [["Harbour list", "Harbour list\nrope, hooks"]]);
    const ev = (await act(sid, { action: "app_activity", id: "notes" })).apps[0].events.filter((e) => e.name === "share");
    assert.equal(ev.length, 1); assert.equal(ev[0].action, "add_note"); assert.equal(ev[0].from, "browser");
    assert.equal((await act(sid, { action: "share", to: "nope", text: "x" })).code, "not_installed");
    assert.equal((await act(sid, { action: "set_clipboard", text: "lamp order 42" })).ok, true);
    assert.equal((await act(sid, { action: "get_clipboard" })).text, "lamp order 42");
    assert.equal((await act(sid, { action: "switch_app", id: "notes" })).ok, true);
    assert.equal((await act(sid, { action: "get_clipboard" })).text, "lamp order 42");
    await act(sid, { action: "device_reset" });
    assert.equal((await act(sid, { action: "get_clipboard" })).text, "");
  });
}

test("update_app is a new version: entered data stays, the screen changes, a bad spec changes nothing", async () => {
  assert.ok((await call("/session", { session: "sp-up" })).ok);
  assert.equal((await act("sp-up", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  await act("sp-up", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } });
  // the new version renames the list and adds a heading
  const v2 = structuredClone(GIFTS);
  v2.screens[0].body[0].label = "Ideas for the holidays";
  v2.screens[0].title = "Holiday gifts";
  const r = await act("sp-up", { action: "update_app", id: "gifts", spec: v2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.version, 2);
  assert.match(r.screen, /Ideas for the holidays/);
  assert.match(r.screen, /Kite/);   // the gift added in version 1 is still there
  assert.equal(r.installed_apps.find((a) => a.id === "gifts").version, "2");
  const bad = await act("sp-up", { action: "update_app", id: "gifts", spec: { spec: "shipvo.app/v0", screens: [] } });
  assert.equal(bad.ok, false); assert.equal(bad.code, "invalid_spec");
  const screen = (await act("sp-up", { action: "screen" })).screen;
  assert.match(screen, /Ideas for the holidays/);   // still version 2
  const none = await act("sp-up", { action: "update_app", id: "ghost", spec: v2 });
  assert.equal(none.code, "not_installed");
  const log = (await act("sp-up", { action: "device_log" })).log.filter((e) => e.name === "update_app");
  assert.deepEqual(log.map((e) => [e.from, e.version, e.source]), [["1", "2", "real"]]);
});

for (const style of ["android", "ios"]) {
  test(`pin_app and hide_app arrange the home screen (${style} style); data and update_app keep it`, async () => {
    const sid = `sp-pin-${style}`;
    assert.ok((await call("/session", { session: sid })).ok);
    const mk = (id) => ({ ...structuredClone(GIFTS), app: { id, name: `App ${id}`, icon: "gift" } });
    for (const id of ["aa", "bb", "cc"]) { const r = await act(sid, { action: "create_app", id, spec: mk(id), style, open: false }); assert.equal(r.ok, true, JSON.stringify(r)); }
    await act(sid, { action: "app_action", id: "bb", action_name: "add_gift", input: { name: "Kite" } });
    const order = (t) => [...t.matchAll(/\((\w+) \d/g)].map((m) => m[1]).join(",");
    const home = async () => (await act(sid, { action: "press_home" })).screen;
    assert.equal(order(await home()), "aa,bb,cc");
    assert.equal((await act(sid, { action: "pin_app", id: "cc", pinned: true })).ok, true);
    const p = await act(sid, { action: "pin_app", id: "bb", pinned: true });
    assert.equal(order(p.screen), "cc,bb,aa");   // pinned in the order pinned, then the rest
    const h = await act(sid, { action: "hide_app", id: "aa", hidden: true });
    assert.equal(order(h.screen), "cc,bb");
    assert.equal(h.installed_apps.length, 3);
    // hidden: still opens and runs actions
    assert.equal((await act(sid, { action: "app_action", id: "aa", action_name: "add_gift", input: { name: "Drum" } })).ok, true);
    // update_app keeps placement
    const v2 = mk("bb"); v2.screens[0].title = "New title";
    assert.equal((await act(sid, { action: "update_app", id: "bb", spec: v2 })).ok, true);
    assert.equal(order(await home()), "cc,bb");
    // unhide restores it unchanged, data included
    assert.equal(order((await act(sid, { action: "hide_app", id: "aa", hidden: false })).screen), "cc,bb,aa");
    assert.equal((await act(sid, { action: "switch_app", id: "bb" })).ok, true);
    assert.match((await act(sid, { action: "screen" })).screen, /Kite/);
    assert.equal((await act(sid, { action: "pin_app", id: "cc", pinned: false })).ok, true);
    assert.equal(order(await home()), "bb,aa,cc");
    for (const a of ["pin_app", "hide_app"]) assert.equal((await act(sid, { action: a, id: "ghost" })).code, "not_installed");
    const log = (await act(sid, { action: "device_log" })).log.map((e) => e.name);
    assert.ok(log.includes("pin_app") && log.includes("hide_app"));
  });
}

test("uninstall stops the app: actions say not_installed and a new create starts with fresh data", async () => {
  assert.ok((await call("/session", { session: "sp-un" })).ok);
  assert.equal((await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  assert.equal((await act("sp-un", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Kite" } })).ok, true);
  assert.equal((await act("sp-un", { action: "uninstall_app", id: "gifts" })).ok, true);
  assert.equal((await act("sp-un", { action: "app_action", id: "gifts", action_name: "add_gift", input: { name: "Drum" } })).code, "not_installed");
  assert.equal((await fetch(`http://localhost:${PORT}/spec/sp-un/gifts/`)).status, 404);
  const again = await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.equal(again.ok, true);
  assert.doesNotMatch(again.screen, /Kite/);
  assert.match(again.screen, /Scarf/);
  const dup = await act("sp-un", { action: "create_app", id: "gifts", spec: GIFTS });
  assert.match(dup.error, /uninstall_app/);
});

test("the control endpoint answers 400 for bad JSON and 413 for a huge body", async () => {
  assert.ok((await call("/session", { session: "sp-op" })).ok);
  assert.equal((await act("sp-op", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const url = `http://localhost:${PORT}/spec/sp-op/gifts/op`;
  assert.equal((await fetch(url, { method: "POST", body: "{nope" })).status, 400);
  assert.equal((await fetch(url, { method: "POST", body: "x".repeat(70000) })).status, 413);
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 200);
});

test("update_app keeps a setting the person changed", async () => {
  assert.ok((await call("/session", { session: "sp-st" })).ok);
  const base = structuredClone(GIFTS);
  base.state = { alerts: { type: "bool", default: false } };
  base.screens[0].body.push({ type: "toggle", label: "Gift alerts", bind: "state.alerts" });
  assert.equal((await act("sp-st", { action: "create_app", id: "gifts", spec: base })).ok, true);
  const op = await fetch(`http://localhost:${PORT}/spec/sp-st/gifts/op`, { method: "POST", body: JSON.stringify({ op: "toggle", label: "Gift alerts" }) });
  assert.equal(op.status, 200);
  const v2 = structuredClone(base); v2.screens[0].title = "Holiday gifts";
  const r = await act("sp-st", { action: "update_app", id: "gifts", spec: v2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.screen, /switch "Gift alerts" \[checked\]/);
});

test("a home-screen screenshot shows the created app's icon", async () => {
  const shot = async (sid) => { await act(sid, { action: "press_home" }); const r = await act(sid, { action: "screenshot", inline: true }); assert.ok(r.data, JSON.stringify(r)); return r.data; };
  assert.ok((await call("/session", { session: "sp-shot-a" })).ok);
  assert.ok((await call("/session", { session: "sp-shot-b" })).ok);
  assert.equal((await act("sp-shot-b", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  // The phone with the extra app has a different home screen from the one without.
  assert.notEqual(await shot("sp-shot-b"), await shot("sp-shot-a"));
});

test("export_apps then import_apps on a fresh phone restores spec, data and settings, Android and iOS, with the same screen", async () => {
  const withToggle = (id) => { const g = structuredClone(GIFTS); g.app.id = id; g.state = { alerts: { type: "bool", default: false } }; g.screens[0].body.push({ type: "toggle", label: "Gift alerts", bind: "state.alerts" }); return g; };
  assert.ok((await call("/session", { session: "ex-a" })).ok);
  assert.equal((await act("ex-a", { action: "create_app", id: "gifts-a", spec: withToggle("gifts-a"), style: "android" })).ok, true);
  assert.equal((await act("ex-a", { action: "create_app", id: "gifts-i", spec: withToggle("gifts-i"), style: "ios", open: false })).ok, true);
  for (const id of ["gifts-a", "gifts-i"]) {
    await act("ex-a", { action: "switch_app", id });
    await fetch(`http://localhost:${PORT}/spec/ex-a/${id}/op`, { method: "POST", body: JSON.stringify({ op: "toggle", label: "Gift alerts" }) });
    await act("ex-a", { action: "app_action", id, action_name: "add_gift", input: { name: `Kite ${id}` } });   // reloads the open app
  }
  // refs carry a frame number and a toast fades, so compare the screen without them
  const shows = async (sid, id) => { await act(sid, { action: "switch_app", id }); await act(sid, { action: "press_home" }); await act(sid, { action: "switch_app", id }); return (await act(sid, { action: "screen" })).screen.replace(/ \[ref=[^\]]*\]/g, "").split("\n").filter((l) => !/status "/.test(l)).join("\n"); };
  const before = { a: await shows("ex-a", "gifts-a"), i: await shows("ex-a", "gifts-i") };
  const ex = await act("ex-a", { action: "export_apps" });
  assert.equal(ex.ok, true, JSON.stringify(ex));
  assert.deepEqual(ex.apps.map((a) => [a.id, a.style]), [["gifts-a", "android"], ["gifts-i", "ios"]]);
  assert.match(JSON.stringify(ex), /Kite gifts-a/);
  assert.doesNotMatch(JSON.stringify(ex), /sk-|vault_value|"value":"secret/i);
  const one = await act("ex-a", { action: "export_apps", ids: ["gifts-i"] });
  assert.deepEqual(one.apps.map((a) => a.id), ["gifts-i"]);

  assert.ok((await call("/session", { session: "ex-b" })).ok);
  const im = await act("ex-b", { action: "import_apps", apps: JSON.parse(JSON.stringify(ex.apps)) });
  assert.equal(im.ok, true, JSON.stringify(im));
  assert.equal(await shows("ex-b", "gifts-a"), before.a);
  assert.equal(await shows("ex-b", "gifts-i"), before.i);
  // existing ids fail unless replace
  const dup = await act("ex-b", { action: "import_apps", apps: ex.apps });
  assert.equal(dup.code, "already_installed");
  assert.equal((await act("ex-b", { action: "import_apps", apps: ex.apps, replace: true })).ok, true);
  assert.equal(await shows("ex-b", "gifts-a"), before.a);
});

test("import_apps with a bad spec installs nothing and lists every problem with its path", async () => {
  assert.ok((await call("/session", { session: "ex-bad" })).ok);
  const bad = [{ id: "one", spec: { spec: "shipvo.app/v0", screens: [] } }, { id: "Bad Id", spec: GIFTS }, { id: "two", spec: { spec: "shipvo.app/v0", screens: [] } }];
  const r = await act("ex-bad", { action: "import_apps", apps: [{ id: "ok", spec: GIFTS }, ...bad] });
  assert.equal(r.code, "invalid_spec");
  assert.match(r.error, /apps\[1\]\.spec/); assert.match(r.error, /apps\[2\]\.id/); assert.match(r.error, /apps\[3\]\.spec/);
  assert.deepEqual((await act("ex-bad", { action: "export_apps" })).apps, []);
});

test("refresh_app on a spec app answers with what changed and logs data_refresh; an unknown app says not_installed", async () => {
  assert.ok((await call("/session", { session: "sp-ref" })).ok);
  assert.equal((await act("sp-ref", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const r = await act("sp-ref", { action: "refresh_app", id: "gifts" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.errors, []);
  assert.match(r.screen, /Scarf/);
  const log = (await act("sp-ref", { action: "device_log" })).log.find((e) => e.name === "data_refresh");
  assert.equal(log.app, "gifts");
  assert.equal((await act("sp-ref", { action: "refresh_app", id: "ghost" })).code, "not_installed");
});

test("app_activity lists versions with what changed, sources and events; limit and not_installed work", async () => {
  assert.ok((await call("/session", { session: "sp-act2" })).ok);
  assert.equal((await act("sp-act2", { action: "create_app", id: "gifts", spec: GIFTS })).ok, true);
  const next = structuredClone(GIFTS);
  next.screens.push({ id: "about", title: "About", body: [{ type: "text", value: "Hi" }] });
  assert.equal((await act("sp-act2", { action: "update_app", id: "gifts", spec: next })).ok, true);
  const r = await act("sp-act2", { action: "app_activity" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const app = r.apps.find((a) => a.id === "gifts");
  assert.equal(app.version, 2);
  assert.deepEqual(app.history.map((h) => h.version), [1, 2]);
  assert.deepEqual(app.history[1].changes, ["added screen 'about'"]);
  assert.deepEqual(app.sources, []);
  assert.deepEqual(app.events.map((e) => e.name), ["create_app", "update_app"]);
  assert.deepEqual(app.events[1].changes, ["added screen 'about'"]);
  const one = await act("sp-act2", { action: "app_activity", id: "gifts", limit: 1 });
  assert.equal(one.apps[0].events.length, 1);
  assert.equal((await act("sp-act2", { action: "app_activity", id: "ghost" })).code, "not_installed");
});

test("export_apps carries the home-screen layout and import_apps restores it; a bad layout is dropped with a warning", async () => {
  assert.ok((await call("/session", { session: "pl-a" })).ok);
  for (const id of ["gifts-p", "gifts-q"]) { const g = structuredClone(GIFTS); g.app.id = id; assert.equal((await act("pl-a", { action: "create_app", id, spec: g, open: false })).ok, true); }
  await act("pl-a", { action: "set_time", at: "2026-11-14T09:00:00" });   // a Saturday
  const lay = { pinned: true, position: 3, schedule: { days: ["sat"], from: "08:00", to: "18:00" } };
  assert.equal((await act("pl-a", { action: "arrange_apps", id: "gifts-p", ...lay })).ok, true);
  const ex = await act("pl-a", { action: "export_apps" });
  assert.deepEqual(ex.apps.find((a) => a.id === "gifts-p").placement, { pinned: 1, position: 3, schedule: { days: ["sat"], from: "08:00", to: "18:00" } });
  assert.equal("placement" in ex.apps.find((a) => a.id === "gifts-q"), false);

  assert.ok((await call("/session", { session: "pl-b" })).ok);
  const im = await act("pl-b", { action: "import_apps", apps: JSON.parse(JSON.stringify(ex.apps)) });
  assert.equal(im.ok, true, JSON.stringify(im));
  assert.equal(im.warnings, undefined);
  assert.deepEqual(im.installed_apps.find((a) => a.id === "gifts-p").placement, ex.apps[0].placement);
  await act("pl-b", { action: "set_time", at: "2026-11-14T09:00:00" });
  assert.match((await act("pl-b", { action: "press_home" })).screen, /button "Gift Tracker" \(gifts-p 1, pinned/);
  await act("pl-b", { action: "set_time", at: "2026-11-16T09:00:00" });    // a Monday: the Saturday-only app is off the home screen
  assert.match((await act("pl-b", { action: "press_home" })).screen, /\(gifts-p\): not showing now, scheduled sat/);

  assert.ok((await call("/session", { session: "pl-c" })).ok);
  const bad = JSON.parse(JSON.stringify(ex.apps)); bad[0].placement = { pinned: true, schedule: { days: ["noday"], from: "08:00" } };
  const r = await act("pl-c", { action: "import_apps", apps: bad });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.installed_apps.find((a) => a.id === "gifts-p").placement, { pinned: 1 });
  assert.deepEqual(r.warnings, ["apps[0].placement.schedule: not valid, dropped"]);
});

test("import_apps does not warn about a valid hand-written layout, and names each rejected field", async () => {
  const app = (placement) => ({ id: "gifts-h", style: "android", spec: GIFTS, placement });
  assert.ok((await call("/session", { session: "pl-h" })).ok);
  const ok = await act("pl-h", { action: "import_apps", apps: [app({ pinned: true, hidden: false, schedule: { days: ["Sat"], from: "08:00" } })] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.warnings, undefined);
  assert.deepEqual(ok.installed_apps.find((a) => a.id === "gifts-h").placement, { pinned: 1, schedule: { days: ["sat"], from: "08:00", to: "23:59" } });
  const bad = await act("pl-h", { action: "import_apps", replace: true, apps: [app({ pinned: "yes", position: 500, extra: 1 })] });
  assert.deepEqual(bad.warnings, ["apps[0].placement.pinned: not valid, dropped", "apps[0].placement.position: not valid, dropped", "apps[0].placement.extra: not recognised, ignored"]);
  const str = await act("pl-h", { action: "import_apps", replace: true, apps: [app("pinned")] });
  assert.deepEqual(str.warnings, ["apps[0].placement: not valid, ignored (expected an object)"]);
});

for (const style of ["android", "ios"]) {
  test(`${style}: backup_phone and restore_phone move apps, data, layout, settings and the clipboard to a new phone`, async () => {
    const NOTES = JSON.parse(readFileSync(new URL("../../templates/notes-tasks/app.json", import.meta.url), "utf8"));
    const a = `sp-bk-a-${style}`, b = `sp-bk-b-${style}`;
    assert.ok((await call("/session", { session: a, skin: style, phone: { settings: { dark_mode: true } } })).ok);
    { const _r = await act(a, { action: "create_app", id: "notes", spec: NOTES, style, open: false }); assert.equal(_r.ok, true, JSON.stringify(_r).slice(0, 400)); }
    { const _r = await act(a, { action: "app_action", id: "notes", action_name: "add_note", input: { title: "Harbour", body: "rope, hooks" } }); assert.equal(_r.ok, true, JSON.stringify(_r).slice(0, 400)); }
    { const _r = await act(a, { action: "pin_app", id: "notes", pinned: true }); assert.equal(_r.ok, true, JSON.stringify(_r).slice(0, 400)); }
    { const _r = await act(a, { action: "install_app", id: "tidewatch", permissions: { location: false } }); assert.equal(_r.ok, true, JSON.stringify(_r).slice(0, 400)); }
    const bk = await act(a, { action: "backup_phone" });
    assert.equal(bk.ok, true, JSON.stringify(bk).slice(0, 300));
    assert.equal(bk.backup.format, "shipvo.phone-backup/v0");
    assert.equal(bk.backup.settings.dark_mode, true); assert.equal(typeof bk.backup.clipboard, "string");
    const wire = { ...JSON.parse(JSON.stringify(bk.backup)), clipboard: "lamp order 42" };

    assert.ok((await call("/session", { session: b, skin: style })).ok);
    assert.equal((await act(b, { action: "restore_phone", backup: { ...wire, settings: { dark_mode: "on" } } })).code, "bad_backup");
    assert.ok(!(await act(b, { action: "phone_apps" })).installed_apps.some((x) => x.id === "notes"));
    const r = await act(b, { action: "restore_phone", backup: wire });
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
    assert.deepEqual(r.restored.apps, ["notes"]); assert.deepEqual(r.restored.store_apps, ["tidewatch"]);
    assert.deepEqual(r.installed_apps.find((x) => x.id === "tidewatch").permissions, { notifications: true, location: false }); assert.ok(r.restored.settings.includes("dark_mode")); assert.equal(r.restored.clipboard, true);
    const back = (await act(b, { action: "backup_phone" })).backup;
    const notes = back.apps.find((x) => x.id === "notes");
    assert.deepEqual(notes.data.notes.map((n) => [n.title, n.body]), [["Harbour", "rope, hooks"]]);
    assert.deepEqual(notes.placement, wire.apps.find((x) => x.id === "notes").placement);
    assert.equal(back.settings.dark_mode, true); assert.equal(back.clipboard, "lamp order 42");
    assert.deepEqual(back.store_apps.map((x) => x.id).sort(), wire.store_apps.map((x) => x.id).sort());
    assert.equal((await act(b, { action: "restore_phone", backup: wire })).code, "already_installed");
    { const _r = await act(b, { action: "restore_phone", backup: wire, replace: true }); assert.equal(_r.ok, true, JSON.stringify(_r).slice(0, 400)); }
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: with a spec app open (no device layer) the phone keeps the reminder itself, at the phone time, and it can be dismissed`, async () => {
    const sid = `sp-remsys-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "gifts", spec: GIFTS, style })).ok, true);
    assert.equal((await act(sid, { action: "set_time", at: "2026-11-14T09:00:00" })).ok, true);
    await act(sid, { action: "set_reminder", title: "Pay rent", in_minutes: 5 });
    await act(sid, { action: "set_time", at: "2026-11-14T09:05:00" });
    const got = (await act(sid, { action: "notifications" })).notifications.filter((n) => n.title === "Pay rent");
    assert.equal(got.length, 1); assert.match(got[0].id, /^sys\d+$/); assert.equal(got[0].app, "Reminders");
    assert.equal(new Date(got[0].at).toISOString().slice(0, 16), new Date("2026-11-14T09:05:00").toISOString().slice(0, 16));
    assert.deepEqual((await act(sid, { action: "list_reminders" })).fired.map((f) => [f.title, f.delivered]), [["Pay rent", true]]);
    assert.equal((await act(sid, { action: "dismiss_notification", id: got[0].id })).ok, true);
    assert.equal((await act(sid, { action: "notifications" })).notifications.filter((n) => n.title === "Pay rent").length, 0);
    assert.equal((await act(sid, { action: "dismiss_notification", id: got[0].id })).code, "not_found");
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: a reminder arrives as a notification when the phone clock reaches it, with the app closed`, async () => {
    const sid = `sp-rem-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "set_time", at: "2026-11-14T09:00:00" })).ok, true);
    const set = await act(sid, { action: "set_reminder", title: "Call Ada", body: "About the invoice", in_minutes: 10 });
    assert.equal(set.ok, true); assert.equal(set.reminder.at, "2026-11-14T09:10");
    await act(sid, { action: "press_home" });
    assert.equal((await act(sid, { action: "notifications" })).notifications.length, 0);
    await act(sid, { action: "set_time", at: "2026-11-14T09:09:00" });
    assert.equal((await act(sid, { action: "notifications" })).notifications.length, 0);
    await act(sid, { action: "set_time", at: "2026-11-14T09:10:00" });
    const got = (await act(sid, { action: "notifications" })).notifications;
    assert.equal(got.length, 1); assert.equal(got[0].title, "Call Ada"); assert.equal(got[0].body, "About the invoice"); assert.equal(got[0].data.reminder, set.reminder.id);
    const list = await act(sid, { action: "list_reminders" });
    assert.deepEqual(list.reminders, []); assert.deepEqual(list.fired.map((f) => [f.title, f.delivered]), [["Call Ada", true]]);
    // a daily reminder comes back the next day; cancelling stops it
    const d = await act(sid, { action: "set_reminder", title: "Standup", at: "2026-11-14T09:30", repeat: "daily" });
    await act(sid, { action: "set_time", at: "2026-11-14T09:30:00" });
    await act(sid, { action: "set_time", at: "2026-11-15T09:30:00" });
    assert.equal((await act(sid, { action: "notifications" })).notifications.filter((n) => n.title === "Standup").length, 2);
    assert.equal((await act(sid, { action: "cancel_reminder", id: d.reminder.id })).cancelled, true);
    await act(sid, { action: "set_time", at: "2026-11-16T09:30:00" });
    assert.equal((await act(sid, { action: "notifications" })).notifications.filter((n) => n.title === "Standup").length, 2);
    const bad = await act(sid, { action: "set_reminder", title: "x" });
    assert.equal(bad.ok, false); assert.equal(bad.code, "bad_time");
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: Contacts, Messages and Clock install and keep their data`, async () => {
    const spec = (n) => JSON.parse(readFileSync(new URL(`../../templates/${n}/app.json`, import.meta.url), "utf8"));
    const sid = `sp-sys-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    for (const id of ["contacts", "messages", "clock"]) assert.equal((await act(sid, { action: "create_app", id, spec: spec(id), style })).ok, true, id);
    const run = (id, action_name, input = {}, agent) => act(sid, { action: "app_action", id, action_name, input, ...(agent ? { agent } : {}) });
    await run("contacts", "add_contact", { name: "Ada Obi", phone: "+237 650 000 111" });
    assert.deepEqual((await run("contacts", "find_contacts", { text: "ada" })).value.contacts.map((c) => c.name), ["Ada Obi"]);
    await run("messages", "receive_text", { from: "Ada Obi", body: "Friday at nine?" });
    await run("messages", "send_text", { to: "Ada Obi", body: "Yes" });
    const conv = (await run("messages", "list_conversations")).value.threads;
    assert.deepEqual(conv.map((t) => [t.with, t.last, t.unread]), [["Ada Obi", "Yes", 1]]);
    assert.equal((await run("messages", "read_conversation", { with: "Ada Obi" })).value.texts.length, 2);
    assert.equal((await run("messages", "list_conversations")).value.threads[0].unread, 0);
    assert.equal((await run("clock", "add_alarm", { time: "06:45", label: "Boat" })).value.added, true);
    assert.equal((await run("clock", "add_alarm", { time: "6:45" })).value.added, false);
    assert.deepEqual((await run("clock", "list_alarms")).value.alarms.map((a) => [a.time, a.on]), [["06:45", true]]);
    // the data is on the phone: a restart keeps it
    await act(sid, { action: "restart" });
    assert.deepEqual((await run("contacts", "find_contacts", {})).value.contacts.map((c) => c.name), ["Ada Obi"]);
    assert.equal((await run("clock", "list_alarms")).value.alarms.length, 1);
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: Wi-Fi, mobile data and airplane mode change what apps read, and http data does not load offline`, async () => {
    const NET = {
      spec: "shipvo.app/v0",
      app: { id: "netwatch", name: "Net Watch" },
      permissions: { network: ["api.example.com"] },
      data: { price: { source: "http", get: "https://api.example.com/p", select: "price" } },
      screens: [{ id: "home", title: "Home", body: [{ type: "text", value: "{{ network.online ? 'Online on ' + network.type : 'Offline' }}" }] }],
    };
    const sid = `sp-net-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "netwatch", spec: NET, style })).ok, true);
    const shows = async (text) => { const r = await act(sid, { action: "screen" }); assert.match(r.screen, new RegExp(text), r.screen); };
    assert.deepEqual((await act(sid, { action: "get_connectivity" })).connectivity, { wifi: true, mobile_data: true, airplane: false, online: true, type: "wifi" });
    await shows("Online on wifi");
    assert.equal((await act(sid, { action: "set_connectivity", wifi: false })).connectivity.type, "cellular");
    await shows("Online on cellular");
    const air = await act(sid, { action: "set_connectivity", airplane: true });
    assert.deepEqual(air.connectivity, { wifi: false, mobile_data: false, airplane: true, online: false, type: "none" });
    await shows("Offline");
    const r = await act(sid, { action: "refresh_app", id: "netwatch" });
    assert.deepEqual(r.updated, []); assert.match(r.errors[0].message, /^offline/);
    assert.equal((await act(sid, { action: "set_connectivity", mobile_data: true })).code, "airplane_on");
    assert.equal((await act(sid, { action: "set_connectivity", wifi: true })).connectivity.online, true);
    assert.deepEqual((await act(sid, { action: "set_connectivity", airplane: false })).connectivity, { wifi: false, mobile_data: true, airplane: false, online: true, type: "cellular" });
    await act(sid, { action: "set_network_profile", profile: "offline" });
    assert.equal((await act(sid, { action: "get_connectivity" })).connectivity.online, false);
    await shows("Offline");
    await act(sid, { action: "set_network_profile", profile: "online" });
    // A spec app page has no device layer: the shade and Control Center (and so the tiles) cannot open over it,
    // so the redraw after a network change never leaves a panel half open, and controls still work after it.
    assert.equal((await act(sid, { action: style === "ios" ? "open_control_center" : "open_notifications" })).code, "no_device");
    assert.equal((await act(sid, { action: "set_connectivity", wifi: true })).ok, true);
    assert.equal((await act(sid, { action: "screen" })).ok, true);
    assert.equal((await act(sid, { action: "set_connectivity" })).code, "bad_value");
    const log = (await act(sid, { action: "device_log" })).log.filter((e) => e.name === "connectivity");
    assert.equal(log.length, 5); assert.equal(log[1].to.airplane, true);
  });
}

for (const style of ["android", "ios"]) {
  test(`${style}: /phones/export and /phones/import move a phone with its apps, data, room and the app's orders`, async () => {
    const NOTES = JSON.parse(readFileSync(new URL("../../templates/notes-tasks/app.json", import.meta.url), "utf8"));
    const sid = `sp-move-${style}`;
    assert.ok((await call("/session", { session: sid, skin: style, room: `rm-${style}` })).ok);
    assert.equal((await act(sid, { action: "create_app", id: "notes", spec: NOTES, style, open: false })).ok, true);
    assert.equal((await act(sid, { action: "app_action", id: "notes", action_name: "add_note", input: { title: "Harbour", body: "rope" } })).ok, true);
    // An order in the app's mock backend, the way Tide & Tackle places one.
    const order = { ref: "TT-1001", total: 3500 };
    const posted = await fetch(`http://localhost:${PORT}/s/~rm-${style}/o/orders`, { method: "POST", body: JSON.stringify({ order }) });
    assert.ok(posted.ok);
    const ex = await call("/phones/export", {});
    assert.equal(ex.format, "shipvo.phones/v0");
    const mine = ex.phones.find((p) => p.session === sid);
    assert.equal(mine.room, `rm-${style}`); assert.equal(mine.skin, style);
    assert.match(mine.backend.store, /TT-1001/);
    assert.ok(mine.backup.apps.some((a) => a.id === "notes"));

    assert.equal((await call("/end", { session: sid })).ended, true);         // the old phone is gone
    assert.equal((await call("/phones/import", { format: "x", phones: [] })).code, "bad_export");
    const im = await call("/phones/import", { format: ex.format, phones: [{ session: "bad id!", app: "tide" }, mine] });
    assert.deepEqual(im.imported, [sid], JSON.stringify(im).slice(0, 400));   // a bad phone is skipped, not fatal
    assert.deepEqual(im.failed.map((f) => f.session), ["bad id!"]);
    const back = (await act(sid, { action: "backup_phone" })).backup;
    assert.deepEqual(back.apps.find((a) => a.id === "notes").data.notes.map((n) => n.title), ["Harbour"]);
    const orders = await (await fetch(`http://localhost:${PORT}/s/~rm-${style}/orders`)).json();
    assert.deepEqual(orders.orders.map((o) => o.ref), ["TT-1001"]);
    const listed = (await call("/sessions", {})).sessions.find((s) => s.session === sid);
    assert.equal(listed.room, `rm-${style}`);
    await call("/end", { session: sid });
  });
}
