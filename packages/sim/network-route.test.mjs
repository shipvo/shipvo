import test from "node:test";
import assert from "node:assert/strict";
import { installNetworkRoute, setNetworkProfile, clearNetworkProfile } from "./network-route.mjs";
import { parseMockRules } from "./mock-rules.mjs";

// A fake page: records the one route handler and lets a test send requests through it.
function fakePage() {
  const page = { handlers: [], evals: [], route: async (_p, h) => { page.handlers.push(h); }, evaluate: async (_f, arg) => { page.evals.push(arg); } };
  page.request = async (url, { fetchBody = "real" } = {}) => {
    const out = { fulfilled: null, aborted: null, fell: false, fetched: false };
    const route = {
      request: () => ({ resourceType: () => "fetch", method: () => "GET", url: () => url }),
      fallback: async () => { out.fell = true; },
      fulfill: async (r) => { out.fulfilled = r; },
      abort: async (c) => { out.aborted = c; },
      fetch: async () => { out.fetched = true; return { status: () => 200, headers: () => ({}), body: async () => Buffer.from(fetchBody) }; },
    };
    await page.handlers.at(-1)(route);
    return out;
  };
  return page;
}
const mocks = () => parseMockRules([{ url: "https://x.test/m", response: { status: 201, body: "mocked" } }]);

test("offline profile aborts a fetch, online lets it through", async () => {
  const s = {}, page = fakePage();
  await setNetworkProfile(s, page, "offline");
  assert.equal((await page.request("https://x.test/a")).aborted, "internetdisconnected");
  await setNetworkProfile(s, page, "online");
  assert.equal((await page.request("https://x.test/a")).fell, true);
});

test("a profile with latency delays the fetch", async () => {
  const s = {}, page = fakePage();
  await setNetworkProfile(s, page, "slow-4g");
  const t0 = Date.now();
  const out = await page.request("https://x.test/a");
  assert.ok(Date.now() - t0 >= 140);
  assert.equal(out.fetched, true);
  assert.equal(out.fulfilled.status, 200);
});

for (const order of ["mocks first", "profile first"]) {
  test(`mocks and profile together, ${order}`, async () => {
    const s = {}, page = fakePage();
    if (order === "mocks first") { s.mocks = mocks(); await installNetworkRoute(s, page); await setNetworkProfile(s, page, "slow-4g"); }
    else { await setNetworkProfile(s, page, "slow-4g"); s.mocks = mocks(); await installNetworkRoute(s, page); }
    assert.equal(page.handlers.length, 1, "one route only");
    const t0 = Date.now();
    const out = await page.request("https://x.test/m");
    assert.ok(Date.now() - t0 >= 140, "mocked response is slowed by the profile");
    assert.equal(out.fulfilled.status, 201);
    assert.equal(out.fetched, false);
    await setNetworkProfile(s, page, "offline");
    assert.equal((await page.request("https://x.test/m")).aborted, "internetdisconnected", "mocked response fails under offline");
  });
}

test("mock delayMs is honoured under a profile", async () => {
  const s = {}, page = fakePage();
  s.mocks = parseMockRules([{ url: "https://x.test/m", response: { status: 200, body: "ok", delayMs: 200 } }]);
  await setNetworkProfile(s, page, "slow-4g");
  const t0 = Date.now();
  await page.request("https://x.test/m");
  assert.ok(Date.now() - t0 >= 340);
});

test("clearNetworkProfile (device_reset) puts the fetch layer back online", async () => {
  const s = {}, page = fakePage();
  await setNetworkProfile(s, page, "offline");
  clearNetworkProfile(s);
  assert.equal(s.netProfile, "online");
  assert.equal((await page.request("https://x.test/a")).fell, true);
});

test("an unknown profile throws unknown_profile and changes nothing", async () => {
  const s = {}, page = fakePage();
  await assert.rejects(() => setNetworkProfile(s, page, "5g"), { code: "unknown_profile" });
  assert.equal(s.netFetch, undefined);
});
