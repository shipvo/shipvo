import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [] };
const { device } = await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;

test("default: connected over wifi, nothing changed", () => {
  assert.equal(device.net.online(), true);
  assert.deepEqual(device.net.connection(), { isConnected: true, type: "wifi" });
});

test("offline profile is not connected and notifies a subscriber", () => {
  const seen = []; const off = device.net.onChange((o) => seen.push(o));
  dev.set({ networkProfile: "offline" });
  assert.deepEqual(seen, [false]);
  assert.deepEqual(device.net.connection(), { isConnected: false, type: "none" });
  dev.set({ networkProfile: "online" });
  assert.deepEqual(seen, [false, true]);
  off();
});

test("cellular profiles report the matching generation", () => {
  const want = { "2g": "2g", "3g": "3g", "slow-4g": "4g", "low-end-4g": "4g", spotty: "3g" };
  for (const [p, gen] of Object.entries(want)) {
    dev.set({ networkProfile: p });
    assert.deepEqual(device.net.connection(), { isConnected: true, type: "cellular", generation: gen }, p);
    assert.equal(device.net.online(), true);
  }
  dev.set({ networkProfile: "online" });
  assert.deepEqual(device.net.connection(), { isConnected: true, type: "wifi" });
});

test("reset puts the network profile back to online", () => {
  dev.set({ networkProfile: "offline" });
  assert.equal(device.net.online(), false);
  dev.reset();
  assert.equal(device.net.online(), true);
  assert.deepEqual(device.net.connection(), { isConnected: true, type: "wifi" });
});
