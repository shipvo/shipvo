// A spec data source with `refresh` runs again on its interval while the app is installed, with no tap and no model call.
import test from "node:test";
import assert from "node:assert/strict";
import { SpecHost } from "./spec-host.mjs";
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

test("cost limits still apply and a failed refresh keeps the last value", async () => {
  const sp = spec({ get: "https://api.example.com/p?x={{ [1,2,3].map(a, [1,2,3].map(b, a+b)) }}" });
  const { host, timers, tick, calls } = setup(sp, { maxCost: 1 });
  await tick(timers[0]);
  assert.equal(calls(), 0);
  assert.doesNotMatch(JSON.stringify(host.tree("s", "app")), /Price 10/);
});

test("replacing the spec reschedules and drops the old timer", () => {
  const { host, timers, cleared } = setup();
  assert.equal(host.update("s", "app", spec({ refresh: 120 })).ok, true);
  assert.equal(cleared(), 1);
  assert.equal(timers[1].ms, 120000);
});
