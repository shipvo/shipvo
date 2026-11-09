// Live data in the spec host: sources are fetched when an app starts, again when due, and a failure keeps the last good data.
import test from "node:test";
import assert from "node:assert/strict";
import { SpecHost, refreshEvery } from "./spec-host.mjs";

const SPEC = {
  spec: "shipvo.app/v0",
  app: { id: "prices", name: "Price Watch", icon: "chart", description: "Prices that update by themselves." },
  permissions: { network: ["api.example.test"] },
  data: { prices: { source: "http", get: "https://api.example.test/prices", cache: "10m", fields: { id: "text", name: "text", price: "text" } } },
  screens: [{ id: "home", title: "Prices", body: [{ type: "list", label: "Latest prices", from: "{{ prices }}", item: { title: "{{ item.name }}", trailing: "{{ item.price }}" }, empty: { message: "No prices yet" } }] }],
};
const names = (h) => h.tree("s", "p").children[0].children.map((c) => c.name);
function rig(over = {}) {
  const st = { body: [{ id: "1", name: "Concert A", price: "40" }], status: 200, calls: 0, now: 1_000_000 };
  const fetch = async () => { st.calls++; return { ok: st.status < 300, status: st.status, text: async () => JSON.stringify(st.body) }; };
  const changed = [];
  const h = new SpecHost({ fetch, now: () => st.now, onChange: (s, id, out) => changed.push([s, id, out.updated]), ...over });
  return { st, h, changed };
}

test("refreshEvery uses the source's cache time, else 5 minutes", () => {
  assert.equal(refreshEvery({ cache: "10m" }), 600_000);
  assert.equal(refreshEvery({ cache: "30s" }), 30_000);
  assert.equal(refreshEvery({}), 300_000);
});

test("data is loaded when the app starts, and changes show after a refresh", async () => {
  const { st, h } = rig();
  assert.equal((await h.create("s", "p", SPEC)).ok, true);
  assert.deepEqual(names(h), ["Concert A, 40"]);
  st.body = [{ id: "1", name: "Concert A", price: "55" }, { id: "2", name: "Concert B", price: "30" }];
  const r = await h.refresh("s", "p", { force: true });
  assert.deepEqual(r.updated, ["prices"]);
  assert.deepEqual(names(h), ["Concert A, 55", "Concert B, 30"]);
});

test("tick fetches only when a source is due, and tells onChange", async () => {
  const { st, h, changed } = rig();
  await h.create("s", "p", SPEC);
  assert.equal(st.calls, 1);
  st.now += 5 * 60_000; await h.tick(); assert.equal(st.calls, 1);     // not due yet (10m)
  st.body = [{ id: "9", name: "Late show", price: "20" }];
  st.now += 6 * 60_000; await h.tick(); assert.equal(st.calls, 2);     // due
  assert.deepEqual(names(h), ["Late show, 20"]);
  assert.deepEqual(changed, [["s", "p", ["prices"]]]);
});

test("a failing source keeps its last good data and reports the error", async () => {
  const { st, h } = rig();
  await h.create("s", "p", SPEC);
  st.status = 503; st.now += 20 * 60_000;
  const r = await h.refresh("s", "p");
  assert.deepEqual(r.updated, []);
  assert.equal(r.errors[0].source, "prices");
  assert.deepEqual(names(h), ["Concert A, 40"]);
  const src = h.sources("s", "p")[0];
  assert.equal(src.ok, false); assert.ok(src.error.message);
});

test("a source outside permissions.network is refused when the spec is checked, so nothing is fetched", async () => {
  const { st, h } = rig();
  const spec = structuredClone(SPEC); spec.permissions.network = ["other.example.test"];
  const made = await h.create("s", "p", spec);
  assert.equal(made.ok, false);
  assert.ok(made.errors.some((e) => /api\.example\.test|network/i.test(e.message + e.path)));
  assert.equal(st.calls, 0);
});

test("an update keeps working live data and fetches again for the new version", async () => {
  const { st, h } = rig();
  await h.create("s", "p", SPEC);
  const v2 = structuredClone(SPEC); v2.screens[0].body[0].label = "Prices now";
  const up = await h.update("s", "p", v2);
  assert.equal(up.ok, true); assert.equal(up.version, 2);
  assert.equal(st.calls, 2);
  assert.deepEqual(names(h), ["Concert A, 40"]);
});

test("tick refreshes apps side by side, so one slow host does not hold up the others", async () => {
  const slow = () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, text: async () => JSON.stringify([{ id: "1", name: "A", price: "1" }]) }), 150));
  const st = { now: 1_000_000 };
  const changed = [];
  const h = new SpecHost({ fetch: slow, now: () => st.now, onChange: (s, id) => changed.push(id) });
  for (const id of ["p1", "p2", "p3"]) assert.equal((await h.create("s", id, SPEC)).ok, true);
  st.now += 11 * 60_000;   // every source is due
  const t0 = Date.now();
  await h.tick();
  assert.ok(Date.now() - t0 < 350, `tick took ${Date.now() - t0} ms`);
  assert.deepEqual(changed.sort(), ["p1", "p2", "p3"]);
});

test("a background refresh that fails is reported to onChange, with the last good data kept", async () => {
  const { st, h } = rig();
  assert.equal((await h.create("s", "p", SPEC)).ok, true);
  st.now += 11 * 60_000; st.status = 503; st.body = "down";
  const seen = [];
  h.onChange = (s, id, out) => seen.push(out);
  await h.tick();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].updated, []); assert.equal(seen[0].errors[0].source, "prices");
  assert.deepEqual(names(h), ["Concert A, 40"]);
});

test("a refresh that finds the same data is not an update, so the open page is left alone", async () => {
  const { st, h } = rig();
  assert.equal((await h.create("s", "p", SPEC)).ok, true);
  st.now += 11 * 60_000;
  const out = await h.refresh("s", "p");
  assert.deepEqual(out.fetched, ["prices"]); assert.deepEqual(out.updated, []);
  st.body = [{ id: "1", name: "Concert A", price: "41" }];
  st.now += 11 * 60_000;
  assert.deepEqual((await h.refresh("s", "p")).updated, ["prices"]);
});
