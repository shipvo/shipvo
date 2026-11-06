import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

const attrs = {};
const root = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
const win = { devicePixelRatio: 2, navigator: {}, Intl, dispatchEvent: () => true };
win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window = win; globalThis.document = { documentElement: root, createElement: () => ({}), head: { appendChild() {} }, querySelectorAll: () => [] };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
await import("../src/index.web.ts");
const dev = globalThis.__pnDevice;
const dark = () => win.matchMedia("(prefers-color-scheme: dark)");

test("dark mode flips the colour scheme and fires the change listener", () => {
  const seen = []; dark().addEventListener("change", (e) => seen.push(e.matches));
  assert.equal(dark().matches, false);
  dev.set({ darkMode: true });
  assert.equal(dark().matches, true); assert.deepEqual(seen, [true]);
  dev.set({ darkMode: false }); assert.deepEqual(seen, [true, false]);
});

test("font size steps scale the pixel ratio the web export reads for the font scale", () => {
  const steps = { small: 0.85, default: 1, large: 1.3, "extra-large": 1.6 };
  for (const [k, v] of Object.entries(steps)) { dev.set({ fontSize: k }); assert.equal(win.devicePixelRatio, 2 * v); }
  dev.set({ fontSize: "default" });
});

test("reduce motion and bold text are readable", () => {
  const rm = () => win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  assert.equal(rm(), false); dev.set({ reduceMotion: true, boldText: true });
  assert.equal(rm(), true); assert.ok("data-pn-bold-text" in attrs); assert.equal(dev.settings().boldText, true);
  dev.set({ reduceMotion: false, boldText: false }); assert.equal(rm(), false); assert.ok(!("data-pn-bold-text" in attrs));
});

test("Arabic sets right-to-left, other languages clear it, and Intl and navigator follow", () => {
  dev.set({ language: "ar" });
  assert.equal(dev.settings().rtl, true); assert.equal(attrs.dir, "rtl"); assert.equal(attrs.lang, "ar");
  assert.equal(win.navigator.language, "ar"); assert.equal(new win.Intl.NumberFormat().resolvedOptions().locale, "ar");
  dev.set({ language: "fr" }); assert.equal(dev.settings().rtl, false); assert.equal(attrs.dir, "ltr");
  dev.set({ rtl: true }); assert.equal(dev.settings().language, "fr"); assert.equal(attrs.dir, "rtl");
});

test("each change is logged as simulated", () => {
  dev.set({ boldText: true });
  const e = dev.log().filter((l) => l.kind === "setting_changed").at(-1);
  assert.deepEqual(e.detail, { key: "boldText", value: true }); assert.equal(e.source, "simulated");
});
