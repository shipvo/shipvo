// A spec data source with `refresh` runs again on its interval while the app is installed, with no tap and no model call.
import test from "node:test";
import assert from "node:assert/strict";
import { SpecHost, guardedFetch, isPrivateAddress } from "./spec-host.mjs";
import { validate } from "../spec/dist/index.js";

const spec = (extra = {}) => ({
  spec: "shipvo.app/v0",
  app: { id: "ticker", name: "Ticker", icon: "chart", description: "A price." },
  permissions: { network: ["api.example.com"] },
  data: { price: { source: "http", get: "https://api.example.com/p", select: "price", refresh: 60, ...extra } },
  screens: [{ id: "home", title: "Home", body: [{ type: "text", value: "Price {{ price }}" }] }]
});

function setup(sp = spec(), limits = {}) {
  const timers = [];
  let n = 0, cleared = 0;
  const fake = {
    setInterval: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearInterval: (t) => { cleared++; t.dead = true; }
  };
  const fetch = async () => { n++; return { ok: true, status: 200, text: async () => JSON.stringify({ price: n * 10 }) }; };
  const host = new SpecHost({ timers: fake, context: () => ({ fetch, secrets: () => undefined, ...limits }) });
  assert.equal(host.create("s", "app", sp).ok, true);
  const tick = async (t) => { await t.fn(); await new Promise((r) => setImmediate(r)); };
  return { host, timers, tick, calls: () => n, cleared: () => cleared };
}

test("a source with refresh: 60 runs again after 60 s and the screen updates", async () => {
  const { host, timers, tick, calls } = setup();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 60000);
  await tick(timers[0]);
  assert.equal(calls(), 1);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 10/);
  assert.match(host.page("s", "app"), /Price 10/);
  await tick(timers[0]);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 20/);
});

test("a refresh below 30 s gives a validator error with a path and suggestion", () => {
  const r = validate(spec({ refresh: 10 }));
  const e = r.errors.find((x) => x.path.endsWith("refresh"));
  assert.ok(e, JSON.stringify(r.errors));
  assert.match(e.path, /\$\.data\.price\.refresh/);
  assert.match(e.fix, /30/);
  assert.equal(validate(spec({ refresh: 30 })).errors.length, 0);
});

test("removing the app stops refreshes", async () => {
  const { host, timers, tick, calls, cleared } = setup();
  host.drop("s", "app");
  assert.equal(cleared(), 1);
  await tick(timers[0]);
  assert.equal(calls(), 0);
});

test("cost limits still apply: the refresh is rejected by the limit", async () => {
  const sp = spec({ get: "https://api.example.com/p?x={{ [1,2,3].map(a, [1,2,3].map(b, a+b)) }}" });
  const limited = setup(sp, { maxCost: 1 });
  await limited.tick(limited.timers[0]);
  assert.equal(limited.calls(), 0);
  assert.doesNotMatch(JSON.stringify(limited.host.tree("s", "app")), /Price 10/);
  // The same spec fetches when no limit is set, so the limit is what stopped it.
  const free = setup(sp);
  await free.tick(free.timers[0]);
  assert.equal(free.calls(), 1);
  assert.match(JSON.stringify(free.host.tree("s", "app")), /Price 10/);
});

test("a failed refresh keeps the last value", async () => {
  const timers = [];
  let n = 0;
  const fetch = async () => { n++; if (n === 2) throw new Error("offline"); return { ok: true, status: 200, text: async () => JSON.stringify({ price: 10 }) }; };
  const host = new SpecHost({ timers: { setInterval: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearInterval() {} }, context: () => ({ fetch, secrets: () => undefined }) });
  host.create("s", "app", spec());
  await timers[0].fn();
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 10/);
  await timers[0].fn();
  assert.equal(n, 2);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 10/);
});

test("a cache longer than refresh does not stop the value changing", async () => {
  const { runSource, memoryCache } = await import("../spec/dist/index.js");
  void runSource;
  const cache = memoryCache();
  const { host, timers, tick } = setup(spec({ cache: "5m" }), { cache });
  await tick(timers[0]);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 10/);
  await tick(timers[0]);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 20/);
});

test("an open page picks up a refreshed value through the view op, with no interaction", async () => {
  const { host, timers, tick } = setup();
  const before = host.op("s", "app", { op: "view" });
  assert.equal(before.ok, true);
  assert.doesNotMatch(before.html, /Price 10/);
  await tick(timers[0]);
  const after = host.op("s", "app", { op: "view" });
  assert.match(after.html, /Price 10/);
  assert.match(host.page("s", "app"), /op:"view"/);
});

test("replacing the spec reschedules and drops the old timer", () => {
  const { host, timers, cleared } = setup();
  assert.equal(host.update("s", "app", spec({ refresh: 120 })).ok, true);
  assert.equal(cleared(), 1);
  assert.equal(timers[1].ms, 120000);
});

test("the page script leaves an unchanged page alone and swaps it when data changed", async () => {
  const vm = await import("node:vm");
  const { host, timers, tick } = setup();
  const html = host.page("s", "app");
  const v = /data-v="([0-9a-f]+)"/.exec(html)[1];
  let swaps = 0, scrolled = [];
  const hostEl = { getAttribute: () => v };
  const doc = {
    hidden: false, activeElement: null,
    getElementById: () => hostEl,
    addEventListener() {},
    body: { appendChild() {}, insertBefore() {}, set innerHTML(_) { swaps++; } }
  };
  let poll;
  const win = { scrollY: 120, scrollTo: (x, y) => scrolled.push(y) };
  const script = /<script id="sv-host"[^>]*>([\s\S]*)<\/script>/.exec(html)[1];
  const fetch = async (_u, init) => ({ json: async () => host.op("s", "app", JSON.parse(init.body)) });
  vm.runInNewContext(script, { document: doc, window: win, location: { pathname: "/spec/s/app" }, fetch, setInterval: (fn) => { poll = fn; } });
  poll(); await new Promise((r) => setImmediate(r));
  assert.equal(swaps, 0, "an unchanged page is not rebuilt");
  await tick(timers[0]);
  poll(); await new Promise((r) => setImmediate(r));
  assert.equal(swaps, 1);
  assert.deepEqual(scrolled, [120], "scroll position is kept");
  poll(); await new Promise((r) => setImmediate(r));
  assert.equal(swaps, 1, "no second rebuild without new data");
});

test("the default fetch refuses loopback, private and link-local hosts", async () => {
  let reached = 0;
  const f = guardedFetch({ lookup: async (h) => [{ address: h === "sneaky.example.com" ? "10.0.0.5" : "93.184.216.34" }], fetchImpl: async () => { reached++; return { ok: true }; } });
  for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://169.254.169.254/latest", "http://10.1.2.3/x", "http://[::1]/x", "http://[::ffff:127.0.0.1]/x", "https://sneaky.example.com/x", "file:///etc/passwd"]) {
    await assert.rejects(() => f(u), undefined, u);
  }
  assert.equal(reached, 0);
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  await f("https://api.example.com/p");
  assert.equal(reached, 1);
});

test("the default fetch does not follow redirects and passes a timeout signal", async () => {
  let seen;
  const f = guardedFetch({ lookup: async () => [{ address: "93.184.216.34" }], fetchImpl: async (_u, init) => { seen = init; return {}; } });
  await f("https://api.example.com/p");
  assert.equal(seen.redirect, "manual");
  assert.ok(seen.signal instanceof AbortSignal);
});

test("a hung request that times out does not stop later ticks refreshing", async () => {
  const f = guardedFetch({ lookup: async () => [{ address: "93.184.216.34" }], timeoutMs: 20, fetchImpl: async (_u, init) => { if (hang) return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("timeout")))); return { ok: true, status: 200, text: async () => JSON.stringify({ price: 99 }) }; } });
  const keep = setTimeout(() => {}, 1000); // AbortSignal.timeout does not hold the event loop open
  let hang = true;
  const timers = [];
  const host = new SpecHost({ timers: { setInterval: (fn) => { const t = { fn }; timers.push(t); return t; }, clearInterval() {} }, context: () => ({ fetch: f, secrets: () => undefined }) });
  host.create("s", "app", spec());
  await timers[0].fn(); // hangs, then aborts after 20 ms
  assert.doesNotMatch(JSON.stringify(host.tree("s", "app")), /Price 99/);
  hang = false;
  await timers[0].fn();
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 99/);
  clearTimeout(keep);
});

test("refresh() fetches now, skips the cache, and reports only the sources whose data changed", async () => {
  const { host, calls } = setup();
  const a = await host.refresh("s", "app");
  assert.deepEqual(a, { updated: ["price"], errors: [] });
  assert.equal(calls(), 1);
  assert.match(JSON.stringify(host.tree("s", "app")), /Price 10/);
  const b = await host.refresh("s", "app", { sources: ["nope"] });
  assert.deepEqual(b, { updated: [], errors: [] });
  assert.equal(calls(), 1);
});

test("refresh() keeps the last data and names the source when a fetch fails", async () => {
  const host = new SpecHost({ context: () => ({ fetch: async () => { throw new Error("offline"); }, secrets: () => undefined }) });
  assert.equal(host.create("s", "app", spec()).ok, true);
  const out = await host.refresh("s", "app");
  assert.deepEqual(out.updated, []);
  assert.equal(out.errors[0].source, "price");
  assert.match(out.errors[0].message, /failed/);
});

test("history records what each version changed and sources() lists the http sources with their interval", () => {
  const { host } = setup();
  assert.deepEqual(host.history("s", "app").map((h) => h.changes), [["created: 1 screens, 0 actions, 1 data sources"]]);
  assert.deepEqual(host.sources("s", "app"), [{ name: "price", refresh: 60 }]);
  const next = spec({ refresh: 90 });
  next.screens = [...next.screens, { id: "about", title: "About", body: [{ type: "text", value: "Hi" }] }];
  assert.equal(host.update("s", "app", next).ok, true);
  assert.deepEqual(host.history("s", "app").at(-1).changes, ["added screen 'about'", "changed data 'price'"]);
  assert.deepEqual(host.sources("s", "app"), [{ name: "price", refresh: 90 }]);
});
