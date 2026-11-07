import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { if (s === "react-native") return { url: "data:text/javascript,export const Appearance={},PixelRatio={},AccessibilityInfo={},I18nManager={},Dimensions={},Linking={}", shortCircuit: true }; try { return await next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; } }`));

const listeners = {};
const win = { dispatchEvent: (e) => { (listeners[e.type] ?? []).forEach((f) => f(e)); return true; }, addEventListener: (t, f) => { (listeners[t] ??= []).push(f); } };
globalThis.window = win;
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.document = { querySelectorAll: () => [], createElement: () => ({ setAttribute() {}, style: {}, remove() {} }), body: { appendChild() {} } };
await import("../src/index.web.ts");
const { installSystemSettings } = await import("../src/system-settings.ts");
const dev = globalThis.__pnDevice;
const attrs = {};
const w = { Intl, navigator: {}, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, addEventListener: win.addEventListener };
const rn = { Appearance: {}, PixelRatio: {}, AccessibilityInfo: { addEventListener: () => ({ remove() {} }) }, I18nManager: {}, Dimensions: { get: () => ({ width: 390, height: 844, scale: 3 }) } };
installSystemSettings(dev, rn, w);

test("dark mode flips Appearance and fires its listener", () => {
  assert.equal(rn.Appearance.getColorScheme(), "light");
  const seen = []; rn.Appearance.addChangeListener((p) => seen.push(p.colorScheme));
  dev.set({ darkMode: true });
  assert.equal(rn.Appearance.getColorScheme(), "dark"); assert.deepEqual(seen, ["dark"]);
});

test("font size changes PixelRatio.getFontScale", () => {
  assert.equal(rn.PixelRatio.getFontScale(), 1);
  dev.set({ fontSize: "largest" }); assert.equal(rn.PixelRatio.getFontScale(), 1.3);
  dev.set({ fontSize: "small" }); assert.equal(rn.PixelRatio.getFontScale(), 0.85);
});

test("a font size change fires Dimensions change with the new fontScale", () => {
  const seen = []; rn.Dimensions.addEventListener("change", (d) => seen.push(d.window.fontScale));
  dev.set({ fontSize: "large" });
  assert.deepEqual(seen, [1.15]); assert.equal(rn.Dimensions.get("window").fontScale, 1.15); assert.equal(rn.Dimensions.get("window").width, 390);
});

test("bold text and reduce motion are read through AccessibilityInfo, with events", async () => {
  const got = []; rn.AccessibilityInfo.addEventListener("boldTextChanged", (v) => got.push(["bold", v])); rn.AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => got.push(["motion", v]));
  assert.equal(await rn.AccessibilityInfo.isBoldTextEnabled(), false);
  dev.set({ boldText: true, reduceMotion: true });
  assert.equal(await rn.AccessibilityInfo.isBoldTextEnabled(), true); assert.equal(await rn.AccessibilityInfo.isReduceMotionEnabled(), true);
  assert.deepEqual(got, [["bold", true], ["motion", true]]);
});

test("RTL and language reach I18nManager, the document and Intl", () => {
  dev.set({ language: "ar", rtl: true });
  assert.equal(rn.I18nManager.getConstants().isRTL, true); assert.equal(rn.I18nManager.isRTL, true);
  assert.equal(attrs.dir, "rtl"); assert.equal(attrs.lang, "ar"); assert.equal(w.navigator.language, "ar");
  assert.equal(new w.Intl.NumberFormat().resolvedOptions().locale.startsWith("ar"), true);
  assert.equal(new w.Intl.NumberFormat("en").resolvedOptions().locale, "en");
});

test("each change is logged as simulated; reset restores the defaults", () => {
  const l = dev.log().filter((e) => e.kind === "setting");
  assert.ok(l.some((e) => e.detail.key === "fontSize" && e.detail.value === "largest" && e.source === "simulated"));
  dev.reset(); assert.deepEqual(dev.system(), { darkMode: false, fontSize: "default", boldText: false, reduceMotion: false, language: "en", rtl: false });
  assert.equal(rn.I18nManager.getConstants().isRTL, false);
});
