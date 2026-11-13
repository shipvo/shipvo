import { test } from "node:test";
import assert from "node:assert/strict";

import { register } from "node:module";
// The source imports "./real" and "./types" without extensions; let node find the .ts files.
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

const events = [];
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [] };
await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;

test("network off is announced at once, logged as simulated, and net.online follows", () => {
  events.length = 0;
  dev.set({ online: false });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "pn:status");
  assert.equal(events[0].detail.online, false);
  const entry = dev.log().filter((l) => l.kind === "status").at(-1);
  assert.equal(entry.simulated, true); assert.equal(entry.source, "simulated");
  assert.equal(dev.status().online, false);
});

test("airplane and battery changes are announced; unrelated changes are not", () => {
  dev.reset(); events.length = 0;
  dev.set({ airplane: true, battery: { level: 15 } });
  assert.deepEqual(events.at(-1).detail, { online: false, airplane: true, battery: { level: 15, charging: false } });
  const n = events.length;
  dev.set({ clipboard: "x" });
  assert.equal(events.length, n);
});

test("reset restores the status and leaves the log empty", () => {
  dev.set({ airplane: true, battery: { level: 5 } });
  dev.reset();
  assert.deepEqual(dev.status(), { online: true, airplane: false, battery: { level: 100, charging: false } });
  assert.equal(dev.log().length, 0);
});

test("airplane mode turns the radios off, Wi-Fi can come back on and is online, and leaving restores them", () => {
  dev.reset();
  dev.set({ mobileData: false });
  dev.set({ airplane: true });
  assert.equal(dev.state.wifi, false); assert.equal(dev.state.mobileData, false); assert.equal(dev.status().online, false);
  dev.set({ wifi: true });
  assert.equal(dev.status().online, true); assert.equal(dev.status().airplane, true);
  dev.set({ airplane: false });
  assert.equal(dev.state.wifi, true); assert.equal(dev.state.mobileData, false); assert.equal(dev.status().online, true);
  dev.set({ wifi: false });
  assert.equal(dev.status().online, false);
});
