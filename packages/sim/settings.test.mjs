import { test } from "node:test";
import assert from "node:assert/strict";
import { settingPatch, readSettings, describeSettings, SettingsError, SETTING_KEYS, settingsHtml, secretRowsHtml, loadSecrets, revokeSecret, settingsClientScript } from "./settings.mjs";
import { renderFrame } from "./frame.mjs";
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
  assert.equal(r.note, undefined);
  const f = await settingsAction(page, { action: "set_setting", key: "font_size", value: "largest" });
  assert.match(f.note, /PixelRatio\.getFontScale/);
  await settingsAction(page, { action: "set_setting", key: "dark_mode", value: true });
  assert.deepEqual(media.at(-1), { colorScheme: "dark", reducedMotion: "no-preference" });
  await settingsAction(page, { action: "set_setting", key: "reduce_motion", value: true });
  assert.equal(media.at(-1).reducedMotion, "reduce");
  assert.equal((await settingsAction(page, { action: "get_settings" })).settings.font_size, "largest");
  await assert.rejects(settingsAction(page, { action: "set_setting", key: "nope", value: true }), { code: "unknown_setting" });
  await assert.rejects(settingsAction(page, { action: "set_setting", key: "rtl", value: "x" }), { code: "bad_value" });
  assert.equal(dev.s.rtl, true); delete globalThis.__pnDevice;
});

const KEYS = [{ app: "shop", name: "stripe", domain: "api.stripe.com", access: "read", last_used_at: "2026-11-01T10:00:00Z", value: "rk_live_SECRET", wrapped: "WRAPPED" }];

test("secret rows show metadata and never a key value", async () => {
  const seen = [];
  const rows = await loadSecrets(async (u) => { seen.push(u); return { ok: true, json: async () => ({ keys: KEYS }) }; }, ["shop"]);
  assert.deepEqual(seen, ["/vault-ui/keys?app=shop"]);
  const html = secretRowsHtml(rows);
  for (const t of ["stripe", "App: shop", "api.stripe.com", "Access: read", "2026-11-01T10:00:00Z"]) assert.ok(html.includes(t), t);
  assert.doesNotMatch(JSON.stringify(rows) + html, /SECRET|WRAPPED|rk_live/);
  assert.match(secretRowsHtml([{ name: "<i>", app: "a", domain: "d", access: "x", last_used_at: null }]), /&lt;i&gt;.*Last used: never/s);
});

test("secrets empty state renders, and a failing app is skipped", async () => {
  assert.match(secretRowsHtml([]), /data-part="secrets-empty">No saved keys yet/);
  assert.deepEqual(await loadSecrets(async () => ({ ok: false }), ["shop"]), []);
  assert.deepEqual(await loadSecrets(async () => { throw new Error("x"); }, ["shop"]), []);
});

test("the Secrets screen is in both skins and wired by the client script", () => {
  for (const skin of ["android", "ios"]) {
    const h = renderFrame({ skin }).html;
    assert.match(h, /data-part="settings-secrets"/); assert.match(h, /data-part="secrets-screen"[^>]*aria-label="Secrets"/);
  }
  assert.match(settingsClientScript(), /\/vault-ui\/keys\?app=/);
});

test("revoke asks to confirm, then sends DELETE", async () => {
  const calls = [], asked = [];
  const fetchFn = async (u, o) => { calls.push([u, o.method]); return { ok: true }; };
  assert.match(secretRowsHtml([{ name: "stripe", app: "shop" }]), /data-part="secret-revoke" data-app="shop" data-name="stripe"/);
  assert.equal(await revokeSecret(fetchFn, (m) => { asked.push(m); return true; }, { app: "shop", name: "stripe" }), true);
  assert.equal(asked.length, 1);
  assert.deepEqual(calls, [["/vault-ui/keys/shop/stripe", "DELETE"]]);
  assert.equal(await revokeSecret(async () => ({ ok: false }), () => true, { app: "shop", name: "x" }), false);
});

test("cancel sends nothing and keeps the row", async () => {
  const calls = [];
  assert.equal(await revokeSecret(async (u) => { calls.push(u); return { ok: true }; }, () => false, { app: "shop", name: "stripe" }), false);
  assert.deepEqual(calls, []);
  assert.match(settingsClientScript(), /secret-revoke/);
});
