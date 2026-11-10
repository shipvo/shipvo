import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { createWakeups, sign, WakeupError } from "./wakeup.mjs";

function receiver(statuses = [200]) {
  const got = [];
  const srv = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    got.push({ headers: req.headers, body: raw });
    res.writeHead(statuses[Math.min(got.length - 1, statuses.length - 1)]); res.end("ok");
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ got, url: `http://127.0.0.1:${srv.address().port}/hook`, close: () => srv.close() })));
}
const mk = (data, opts = {}) => { const logs = []; return { logs, w: createWakeups(() => data, (e) => logs.push(e), { delays: [5, 5], ...opts }) }; };

test("a new message for the name is POSTed with a valid signature, and never the message text", async () => {
  const rx = await receiver();
  const data = { messages: [], handoffs: [] };
  const { w, logs } = mk(data);
  const reg = await w.register({ name: "ChatGPT", url: rx.url, allowPrivate: true });
  assert.equal(reg.name, "chatgpt"); assert.match(reg.secret, /^[0-9a-f]{48}$/);
  w.tick(); await w.idle(); assert.equal(rx.got.length, 0);
  data.messages.push({ id: "m1", to: "chatgpt", from: "claude", body: "secret plan", read: false });
  w.tick(); await w.idle();
  assert.equal(rx.got.length, 1);
  const { headers, body } = rx.got[0];
  const p = JSON.parse(body);
  assert.deepEqual({ to: p.to, event: p.event, messages: p.messages, tasks: p.tasks }, { to: "chatgpt", event: "message", messages: ["m1"], tasks: [] });
  assert.equal(p.summary, "1 new message for chatgpt on the phone");
  assert.ok(!body.includes("secret plan"));
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers["x-shipvo-signature"]);
  assert.ok(m); assert.equal(m[2], createHmac("sha256", reg.secret).update(`${m[1]}.${body}`).digest("hex")); assert.equal(m[2], sign(reg.secret, m[1], body).split("v1=")[1]);
  assert.equal(headers["x-shipvo-event"], "message");
  assert.deepEqual({ to: logs[0].to, ok: logs[0].ok, status: logs[0].status, attempts: logs[0].attempts }, { to: "chatgpt", ok: true, status: 200, attempts: 1 });
  assert.ok(!JSON.stringify(logs).includes(reg.secret));
  // the same message does not wake it again
  w.tick(); await w.idle(); assert.equal(rx.got.length, 1);
  w.close(); rx.close();
});

test("what was already waiting at registration does not wake; a new task does; other names and events are ignored", async () => {
  const rx = await receiver();
  const data = { messages: [{ id: "m0", to: "claude", read: false }], handoffs: [] };
  const { w } = mk(data);
  await w.register({ name: "claude", url: rx.url, events: ["task"], allowPrivate: true });
  w.tick(); await w.idle(); assert.equal(rx.got.length, 0);
  data.messages.push({ id: "m1", to: "claude", read: false });     // a message: the name listens for tasks only
  data.messages.push({ id: "m2", to: "gemini", read: false });     // someone else
  w.tick(); await w.idle(); assert.equal(rx.got.length, 0);
  data.handoffs.push({ id: "h1", to: "anyone", status: "open" });
  w.tick(); await w.idle();
  assert.equal(rx.got.length, 1); assert.equal(JSON.parse(rx.got[0].body).event, "task");
  w.close(); rx.close();
});

test("a failing URL is retried twice, then logged as failed; a 4xx is not retried", async () => {
  const rx = await receiver([500, 500, 200]);
  const data = { messages: [], handoffs: [] };
  const { w, logs } = mk(data);
  await w.register({ name: "x", url: rx.url, allowPrivate: true });
  data.messages.push({ id: "m1", to: "x", read: false });
  w.tick(); await w.idle();
  assert.equal(rx.got.length, 3); assert.deepEqual({ ok: logs[0].ok, attempts: logs[0].attempts, status: logs[0].status }, { ok: true, attempts: 3, status: 200 });
  rx.close();
  const bad = await receiver([404]);
  const { w: w2, logs: l2 } = mk(data);
  await w2.register({ name: "y", url: bad.url, allowPrivate: true });
  data.messages.push({ id: "m2", to: "y", read: false });
  w2.tick(); await w2.idle();
  assert.equal(bad.got.length, 1); assert.deepEqual({ ok: l2[0].ok, attempts: l2[0].attempts, status: l2[0].status }, { ok: false, attempts: 1, status: 404 });
  assert.match(l2[0].error, /404/);
  w.close(); w2.close(); bad.close();
});

test("private addresses, bad input and a duplicate-name replace are handled", async () => {
  const { w } = mk({ messages: [], handoffs: [] });
  const code = async (p) => { try { await w.register(p); return "ok"; } catch (e) { assert.ok(e instanceof WakeupError); return e.code; } };
  assert.equal(await code({ name: "x", url: "http://127.0.0.1:9/h" }), "host_not_allowed");
  assert.equal(await code({ name: "x", url: "http://192.168.1.5/h" }), "host_not_allowed");
  assert.equal(await code({ name: "x", url: "not a url" }), "bad_url");
  assert.equal(await code({ name: "x", url: "data:text/plain,hi" }), "bad_url");
  assert.equal(await code({ name: "", url: "https://example.com/h" }), "bad_name");
  assert.equal(await code({ name: "x", url: "https://example.com/h", events: ["report"] }), "bad_events");
  assert.equal(await code({ name: "x", url: "https://example.com/h", secret: "short" }), "bad_secret");
  const r = await w.register({ name: "x", url: "https://example.com/h", secret: "a-secret-of-16-chars" }); assert.equal(r.secret, undefined);
  await w.register({ name: "x", url: "https://example.com/other", allowPrivate: false });
  assert.deepEqual(w.list(), [{ name: "x", url: "https://example.com/other", events: ["message", "task"] }]);
  assert.equal(w.clear("x"), true); assert.equal(w.clear("x"), false); assert.deepEqual(w.list(), []);
  w.close();
});
