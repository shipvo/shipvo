import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [] };
const { device } = await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;

test("no profile set: connected over wifi, as before", () => {
  dev.reset();
  assert.equal(device.net.online(), true);
  assert.equal(device.net.type(), "wifi");
  assert.equal(dev.state.networkProfile, "online");
});

test("connectivity follows the profile and subscribers are told on each change", () => {
  dev.reset();
  const seen = []; const off = device.net.onChange((o) => seen.push([o, device.net.type()]));
  dev.set({ networkProfile: "offline" });
  assert.equal(device.net.online(), false); assert.equal(device.net.type(), "none");
  const gens = { "2g": "2g", "3g": "3g", "slow-4g": "4g", "low-end-4g": "4g", spotty: "3g" };
  for (const [p, t] of Object.entries(gens)) { dev.set({ networkProfile: p }); assert.equal(device.net.online(), true); assert.equal(device.net.type(), t, p); }
  dev.set({ networkProfile: "online" });
  assert.equal(device.net.type(), "wifi");
  assert.deepEqual(seen[0], [false, "none"]);
  assert.deepEqual(seen.at(-1), [true, "wifi"]);
  assert.equal(seen.length, 6);
  dev.set({ networkProfile: "online" }); assert.equal(seen.length, 6); // no change, no call (slow-4g to low-end-4g is 4g to 4g, also silent)
  off();
});

test("reset returns to online and tells subscribers", () => {
  dev.set({ networkProfile: "2g" });
  let last; const off = device.net.onChange((o) => { last = o; });
  dev.reset(); assert.equal(device.net.type(), "wifi"); assert.equal(last, true); off();
});
