import test from "node:test";
import assert from "node:assert/strict";
import { applyProfile, getProfile, PROFILES } from "./network-profiles.mjs";

const body = (n) => async () => new Response(new Uint8Array(n));
const fakeClock = () => { const c = { waited: 0, sleep: async (ms) => { c.waited += ms; } }; return c; };

test("offline always rejects with a network TypeError", async () => {
  const f = applyProfile(body(10), "offline", { clock: fakeClock() });
  await assert.rejects(f("http://x/"), TypeError);
});

test("3g waits at least latency + bytes*8/downKbps for a body of known size", async () => {
  const clock = fakeClock(); const p = PROFILES["3g"]; const n = 50000;
  const res = await applyProfile(body(n), "3g", { seed: 1000, clock })("http://x/");
  assert.equal((await res.arrayBuffer()).byteLength, n);
  assert.ok(clock.waited >= p.latencyMs + (n * 8) / p.downKbps, `waited ${clock.waited}`);
});

test("online adds no wait", async () => {
  const clock = fakeClock();
  await applyProfile(body(1000), "online", { clock })("http://x/");
  assert.equal(clock.waited, 0);
});

test("spotty with a fixed seed fails the same requests each run", async () => {
  const run = async () => {
    const f = applyProfile(body(10), "spotty", { seed: 7, clock: fakeClock() });
    const out = [];
    for (let i = 0; i < 30; i++) out.push(await f("http://x/").then(() => "ok", (e) => (e instanceof TypeError ? "fail" : "other")));
    return out;
  };
  const a = await run();
  assert.deepEqual(a, await run());
  assert.ok(a.includes("fail") && a.includes("ok"));
});

test("a bad name throws unknown_profile", () => {
  assert.throws(() => getProfile("5g"), (e) => e.code === "unknown_profile");
  assert.throws(() => getProfile("__proto__"), (e) => e.code === "unknown_profile");
});
