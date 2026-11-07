import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { if (s === "react-native") return { url: "data:text/javascript,export const Linking={}", shortCircuit: true }; try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

const events = []; const banners = [];
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, style: {}, remove() {} }), body: { appendChild: (b) => banners.push(b) } };
await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;
dev.set({ permissions: { notifications: "granted" } });

test("Wi-Fi and mobile data both off take the network offline", () => {
  dev.set({ wifi: false }); assert.equal(dev.status().online, true);
  dev.set({ mobileData: false }); assert.equal(dev.status().online, false);
  assert.equal(events.at(-1).type, "pn:status");
  dev.set({ wifi: true }); assert.equal(dev.status().online, true);
  dev.reset(); assert.equal(dev.settings().mobileData, true);
});

test("settings changes are announced and logged as simulated", () => {
  events.length = 0; dev.set({ darkMode: true });
  assert.equal(events.at(-1).type, "pn:settings"); assert.equal(events.at(-1).detail.darkMode, true);
  const e = dev.log().filter((l) => l.kind === "settings").at(-1); assert.equal(e.source, "simulated");
});

test("Do Not Disturb keeps a notification in the shade without a banner", () => {
  dev.reset({ permissions: { notifications: "granted" } });
  banners.length = 0; dev.set({ dnd: true });
  const id = dev.push({ title: "Hi", body: "there" });
  assert.equal(banners.length, 0); assert.equal(dev.notifications()[0].id, id);
  dev.set({ dnd: false }); dev.push({ title: "Two", body: "x" }); assert.equal(banners.length, 1);
});

test("notifications carry time and app; dismiss and clear all remove them", () => {
  dev.reset({ permissions: { notifications: "granted" } });
  const a = dev.push({ title: "A", body: "a" }); dev.push({ title: "B", body: "b" });
  const n = dev.notifications(); assert.ok(n[0].at > 0); assert.ok(n[0].app);
  assert.equal(dev.dismiss(a), true); assert.equal(dev.dismiss(a), false); assert.equal(dev.notifications().length, 1);
  assert.equal(dev.clearAll(), 1); assert.equal(dev.notifications().length, 0);
});
