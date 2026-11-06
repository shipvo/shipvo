import { test } from "node:test";
import assert from "node:assert/strict";
import { settingPatch, readSettings, describeSettings, SettingsError, SETTING_KEYS, settingsHtml } from "./settings.mjs";
import { settingsAction } from "./settings-actions.mjs";

test("each setting maps to a device field", () => {
  assert.deepEqual(settingPatch("dark_mode", true), { darkMode: true });
  assert.deepEqual(settingPatch("font_size", "largest"), { fontSize: "largest" });
  assert.deepEqual(settingPatch("bold_text", false), { boldText: false });
  assert.deepEqual(settingPatch("reduce_motion", true), { reduceMotion: true });
  assert.deepEqual(settingPatch("rtl", true), { rtl: true });
});

test("language ar turns RTL on, en and fr turn it off", () => {
  assert.deepEqual(settingPatch("language", "ar"), { language: "ar", rtl: true });
  assert.deepEqual(settingPatch("language", "fr"), { language: "fr", rtl: false });
});

test("unknown keys and bad values are typed errors", () => {
  const code = (f) => { try { f(); } catch (e) { assert.ok(e instanceof SettingsError); return e.code; } };
  assert.equal(code(() => settingPatch("volume", true)), "unknown_setting");
  assert.equal(code(() => settingPatch("toString", true)), "unknown_setting");
  assert.equal(code(() => settingPatch("dark_mode", "yes")), "bad_value");
  assert.equal(code(() => settingPatch("font_size", "huge")), "bad_value");
  assert.equal(code(() => settingPatch("language", "de")), "bad_value");
  assert.equal(code(() => settingPatch("rtl", 1)), "bad_value");
});

test("the text view lists every setting as a row", () => {
  const t = describeSettings(readSettings({}));
  for (const k of SETTING_KEYS) assert.ok(t.includes(k), k);
  assert.match(t, /switch dark_mode \(Dark mode\): off/); assert.match(t, /choice font_size \(Font size\): default/);
  assert.match(settingsHtml(), /role="dialog" aria-label="Settings"/);
});

test("get_settings and set_setting read and write the page's device", async () => {
  const dev = { s: { darkMode: false, fontSize: "default", boldText: false, reduceMotion: false, language: "en", rtl: false }, system() { return { ...this.s }; }, set(p) { Object.assign(this.s, p); } };
  const media = [];
  const page = { evaluate: async (fn, arg) => { globalThis.__pnDevice = dev; return fn(arg); }, emulateMedia: async (m) => media.push(m) };
  const r = await settingsAction(page, { action: "set_setting", key: "language", value: "ar" });
  assert.equal(r.settings.language, "ar"); assert.equal(r.settings.rtl, true);
  await settingsAction(page, { action: "set_setting", key: "dark_mode", value: true });
  assert.deepEqual(media.at(-1), { colorScheme: "dark", reducedMotion: "no-preference" });
  await settingsAction(page, { action: "set_setting", key: "reduce_motion", value: true });
  assert.equal(media.at(-1).reducedMotion, "reduce");
  assert.equal((await settingsAction(page, { action: "get_settings" })).settings.font_size, "default");
  await assert.rejects(settingsAction(page, { action: "set_setting", key: "nope", value: true }), { code: "unknown_setting" });
  await assert.rejects(settingsAction(page, { action: "set_setting", key: "rtl", value: "x" }), { code: "bad_value" });
  assert.equal(dev.s.rtl, true); delete globalThis.__pnDevice;
});
