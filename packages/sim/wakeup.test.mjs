import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createWakeups, isBlockedAddress, sign, WakeupError } from "./wakeup.mjs";

const noSleep = { sleep: async () => {} };
async function receiver(statuses) {
  const got = [];
  const srv = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    got.push({ body: raw, sig: req.headers["x-shipvo-signature"], type: req.headers["content-type"] });
    res.writeHead(statuses[Math.min(got.length - 1, statuses.length - 1)]); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { got, url: `http://127.0.0.1:${srv.address().port}/hook`, close: () => srv.close() };
}

test("a message for the name makes the receiver get a signed POST that verifies; a wrong secret fails", async () => {
  const r = await receiver([200]); const log = [];
  const w = createWakeups({ allowLocal: true, log: (e) => log.push(e), ...noSleep });
  const reg = await w.register({ name: "Claude", url: r.url, events: ["message"] });
  assert.equal(reg.name, "claude");
  assert.equal(await w.notify({ to: "claude", event: "message", summary: "New message from chatgpt" }), true);
  assert.equal(r.got.length, 1);
  assert.equal(r.got[0].type, "application/json");
  assert.deepEqual(JSON.parse(r.got[0].body), { to: "claude", event: "message", summary: "New message from chatgpt" });
  assert.equal(r.got[0].sig, sign(reg.secret, r.got[0].body));
  assert.notEqual(r.got[0].sig, sign("wrong-secret", r.got[0].body));
  assert.deepEqual(log.map((e) => [e.attempt, e.ok, e.source]), [[1, true, "simulated"]]);
  assert.equal(await w.notify({ to: "claude", event: "handoff", summary: "x" }), false);   // not subscribed
  assert.equal(await w.notify({ to: "gemini", event: "message", summary: "x" }), false);   // not registered
  assert.equal(r.got.length, 1);
  r.close();
});

test("a failing receiver is tried once and retried 3 times, each attempt logged, then dropped", async () => {
  const r = await receiver([500]); const log = []; const waits = [];
  const w = createWakeups({ allowLocal: true, log: (e) => log.push(e), sleep: async (ms) => { waits.push(ms); } });
  await w.register({ name: "claude", url: r.url, events: ["message"] });
  assert.equal(await w.notify({ to: "claude", event: "message", summary: "s" }), false);
  assert.equal(r.got.length, 4);
  assert.deepEqual(log.map((e) => [e.attempt, e.status, e.ok]), [[1, 500, false], [2, 500, false], [3, 500, false], [4, 500, false]]);
  assert.ok(log.every((e) => e.name === "wakeup_attempt" && e.source === "simulated"));
  assert.equal(waits.length, 3);
  assert.ok(waits[0] < waits[1] && waits[1] < waits[2]);
  r.close();
});

test("a receiver that recovers stops the retries", async () => {
  const r = await receiver([503, 200]);
  const w = createWakeups({ allowLocal: true, ...noSleep });
  await w.register({ name: "claude", url: r.url, events: ["message"] });
  assert.equal(await w.notify({ to: "claude", event: "message", summary: "s" }), true);
  assert.equal(r.got.length, 2);
  r.close();
});

test("private, local and non-https addresses are refused at registration", async () => {
  const w = createWakeups({ resolve: async (h) => (h === "intranet.example" ? ["10.0.0.5"] : ["93.184.216.34"]) });
  const code = async (url) => w.register({ name: "claude", url, events: ["message"] }).then(() => "ok", (e) => e.code);
  for (const u of ["https://localhost/h", "https://127.0.0.1/h", "https://10.1.2.3/h", "https://192.168.1.9/h", "https://169.254.169.254/h", "https://[::1]/h", "https://[fd00::1]/h", "https://[::ffff:10.0.0.1]/h", "https://intranet.example/h"])
    assert.equal(await code(u), "private_address", u);
  assert.equal(await code("http://example.com/h"), "bad_url");
  assert.equal(await code("not a url"), "bad_url");
  assert.equal(await code("https://example.com/h"), "ok");
  assert.deepEqual(w.list(), [{ name: "claude", url: "https://example.com/h", events: ["message"] }]);
  await assert.rejects(w.register({ name: "x", url: "https://example.com", events: ["nope"] }), (e) => e instanceof WakeupError && e.code === "bad_event");
  assert.throws(() => w.remove("ghost"), (e) => e.code === "no_wakeup");
  assert.deepEqual(w.remove("claude"), { removed: "claude" });
  assert.deepEqual(w.list(), []);
});

test("a redirect to a private address is refused and not retried", async () => {
  const log = []; const seen = [];
  const fetch = async (url) => { seen.push(url); return new Response(null, { status: 302, headers: { location: "https://10.0.0.1/internal" } }); };
  const w = createWakeups({ fetch, resolve: async () => ["93.184.216.34"], log: (e) => log.push(e), ...noSleep });
  await w.register({ name: "claude", url: "https://hooks.example/h", events: ["message"] });
  assert.equal(await w.notify({ to: "claude", event: "message", summary: "s" }), false);
  assert.deepEqual(seen, ["https://hooks.example/h"]);
  assert.deepEqual(log.map((e) => e.error), ["private_address"]);
});

test("isBlockedAddress", () => {
  for (const a of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.0.1", "224.0.0.1", "::", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "junk"]) assert.equal(isBlockedAddress(a), true, a);
  for (const a of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.equal(isBlockedAddress(a), false, a);
});
