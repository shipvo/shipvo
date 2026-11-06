// Unit tests for the shared mock + profile route, using a fake Playwright page.
import test from "node:test";
import assert from "node:assert/strict";
import { ensureNetRoute, installProfile, clearProfile } from "./net-route.mjs";
import { parseMockRules } from "./mock-rules.mjs";

function fakePage() {
  const p = { handlers: [], route: async (_g, h) => { p.handlers.push(h); } };
  return p;
}
function fakeRoute(url, { type = "fetch", method = "GET" } = {}) {
  const r = { out: null, request: () => ({ url: () => url, method: () => method, resourceType: () => type }),
    fallback: async () => { r.out = "fallback"; }, abort: async () => { r.out = "abort"; },
    fulfill: async (o) => { r.out = o; }, fetch: async () => ({ status: () => 200, headers: () => ({}), body: async () => Buffer.from("real") }) };
  return r;
}
const mocks = (s) => { s.mocks = parseMockRules([{ url: "http://x/items", response: { status: 201, body: "mock" } }]); };
// Route handlers run most-recent-first in Playwright; with one handler the order of setup cannot matter.
const run = async (page, route) => { await page.handlers.at(-1)(route); return route; };

test("registers a single route for mocks and profiles", async () => {
  const s = {}, page = fakePage();
  await ensureNetRoute(s, page); await ensureNetRoute(s, page);
  assert.equal(page.handlers.length, 1);
});

for (const order of ["mocks-first", "profile-first"]) {
  test(`mock + offline profile fails the mocked request (${order})`, async () => {
    const s = {}, page = fakePage();
    if (order === "mocks-first") { mocks(s); await ensureNetRoute(s, page); installProfile(s, "offline"); }
    else { installProfile(s, "offline"); await ensureNetRoute(s, page); mocks(s); await ensureNetRoute(s, page); }
    assert.equal((await run(page, fakeRoute("http://x/items"))).out, "abort");
  });
  test(`mock + online profile serves the mock (${order})`, async () => {
    const s = {}, page = fakePage();
    if (order === "mocks-first") { mocks(s); await ensureNetRoute(s, page); installProfile(s, "online"); }
    else { installProfile(s, "online"); await ensureNetRoute(s, page); mocks(s); await ensureNetRoute(s, page); }
    const r = await run(page, fakeRoute("http://x/items"));
    assert.equal(r.out.status, 201);
  });
}

test("profile delays a mocked request and honours delayMs", async () => {
  const s = {}, page = fakePage();
  s.mocks = parseMockRules([{ url: "http://x/items", response: { status: 200, body: "m", delayMs: 60 } }]);
  await ensureNetRoute(s, page);
  installProfile(s, "slow-4g");
  const t = Date.now(); const r = await run(page, fakeRoute("http://x/items"));
  assert.equal(r.out.status, 200);
  assert.ok(Date.now() - t >= 190, "150 ms latency plus 60 ms rule delay");
});

test("profile delays an unmocked fetch", async () => {
  const s = {}, page = fakePage();
  await ensureNetRoute(s, page); installProfile(s, "slow-4g");
  const t = Date.now(); const r = await run(page, fakeRoute("http://x/other"));
  assert.equal(r.out.status, 200);
  assert.ok(Date.now() - t >= 140);
});

test("non-fetch requests pass through", async () => {
  const s = {}, page = fakePage();
  await ensureNetRoute(s, page); installProfile(s, "offline");
  assert.equal((await run(page, fakeRoute("http://x/a.js", { type: "script" }))).out, "fallback");
});

test("clearProfile (device_reset) makes fetches unthrottled again", async () => {
  const s = {}, page = fakePage();
  await ensureNetRoute(s, page); installProfile(s, "offline");
  assert.equal((await run(page, fakeRoute("http://x/o"))).out, "abort");
  clearProfile(s);
  assert.equal(s.netProfile, "online");
  assert.equal((await run(page, fakeRoute("http://x/o"))).out, "fallback");
});
