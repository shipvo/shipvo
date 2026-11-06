import test from "node:test";
import assert from "node:assert/strict";
import { tileStates, tilePatch, groupByApp, panelFor, describePanel, shadeHtml, ShadeError } from "./shade.mjs";
import { shadeAction } from "./shade-actions.mjs";
import { renderFrame, statusClientScript, statusFromDevice } from "./frame.mjs";

test("Android: first pull shows four tiles, the second all eight", () => {
  assert.equal(tileStates("android", {}, false).length, 4);
  assert.deepEqual(tileStates("android", {}).map((t) => t.id), ["wifi", "mobile_data", "airplane", "location", "dark_mode", "dnd", "auto_rotate", "flashlight"]);
  assert.equal(panelFor("android", 10, 400, "none"), "shade"); assert.equal(panelFor("android", 10, 400, "shade"), "shade-expanded");
});
test("iPhone: top right is Control Center, the rest Notification Center", () => {
  assert.equal(panelFor("ios", 380, 393), "control"); assert.equal(panelFor("ios", 20, 393), "notifications"); assert.equal(panelFor("ios", 196, 393), "notifications");
  assert.deepEqual(tileStates("ios", {}).map((t) => t.id), ["airplane", "wifi", "mobile_data", "focus", "orientation_lock", "brightness", "dark_mode"]);
});
test("tilePatch flips, sets, and rejects bad input", () => {
  assert.deepEqual(tilePatch("android", "wifi", { wifi: true }), { wifi: false });
  assert.deepEqual(tilePatch("android", "dark_mode", {}), { darkMode: true });
  assert.deepEqual(tilePatch("android", "dnd", { dnd: true }, true), { dnd: true });
  assert.deepEqual(tilePatch("ios", "brightness", {}, 30), { brightness: 30 });
  assert.throws(() => tilePatch("ios", "brightness", {}, 300), { code: "bad_value" });
  assert.throws(() => tilePatch("android", "bogus", {}), { code: "unknown_tile" });
  assert.throws(() => tilePatch("android", "focus", {}), { code: "unknown_tile" });
});
test("notifications group by app, newest first", () => {
  const g = groupByApp([{ id: "1", app: "A", at: 1 }, { id: "2", app: "B", at: 5 }, { id: "3", app: "A", at: 9 }]);
  assert.deepEqual(g.map((x) => [x.app, x.items.map((n) => n.id)]), [["A", ["3", "1"]], ["B", ["2"]]]);
});
test("describePanel lists tiles and notifications", () => {
  const t = describePanel("android", "shade", { wifi: true }, [{ id: "n1", title: "Hi", body: "yo", at: Date.now() }]);
  assert.match(t, /tile wifi: on/); assert.match(t, /notification n1: Hi - yo \(now\)/);
});
test("the frame has the panels for each skin and a status bar that follows Wi-Fi", () => {
  assert.match(renderFrame({ skin: "android" }).html, /data-part="notification-shade"/);
  const ios = renderFrame({ skin: "ios" }).html; assert.match(ios, /data-part="control-center"/); assert.match(ios, /data-part="notification-center"/);
  assert.match(statusClientScript("app", "ios"), /pn:settings/);
  assert.equal(statusFromDevice({ wifi: false }).wifi, false); assert.equal(statusFromDevice({ wifi: false, mobileData: false }).signal, 0);
  assert.match(shadeHtml("android"), /Clear all/);
});

// A fake page: the same device surface the app exposes, kept in memory.
function fakePage(platform) {
  const st = { wifi: true, mobileData: true, airplane: false, darkMode: false, dnd: false, locationServices: true, autoRotate: true, flashlight: false, orientationLock: false, brightness: 70 };
  let notes = [{ id: "n1", title: "A", body: "a", at: 1, app: "App" }, { id: "n2", title: "B", body: "b", at: 2, app: "App" }];
  const dev = { state: { platform }, settings: () => ({ ...st }), notifications: () => notes, set: (p) => Object.assign(st, p), dismiss: (id) => { const l = notes.length; notes = notes.filter((n) => n.id !== id); return notes.length < l; }, clearAll: () => { const n = notes.length; notes = []; return n; } };
  const media = [];
  return { media, st, evaluate: async (fn, arg) => { globalThis.__pnDevice = dev; return fn(arg); }, emulateMedia: async (o) => media.push(o) };
}
test("toggle_tile changes the device and the colour scheme; hidden tiles fail", async () => {
  const page = fakePage("android"), shade = { open: "none" };
  await assert.rejects(shadeAction(page, shade, { action: "toggle_tile", tile: "wifi" }), { code: "tile_not_visible" });
  const r = await shadeAction(page, shade, { action: "open_notifications" }); assert.equal(r.panel, "shade"); assert.equal(r.tiles.length, 4);
  await assert.rejects(shadeAction(page, shade, { action: "toggle_tile", tile: "dark_mode" }), { code: "tile_not_visible" });
  assert.equal((await shadeAction(page, shade, { action: "open_notifications" })).panel, "shade-expanded");
  assert.equal((await shadeAction(page, shade, { action: "open_notifications" })).panel, "shade-expanded", "a repeat call stays expanded");
  await shadeAction(page, shade, { action: "toggle_tile", tile: "dark_mode" });
  assert.equal(page.st.darkMode, true); assert.deepEqual(page.media.at(-1), { colorScheme: "dark" });
  await shadeAction(page, shade, { action: "toggle_tile", tile: "wifi" }); assert.equal(page.st.wifi, false);
  await assert.rejects(shadeAction(page, shade, { action: "open_control_center" }), { code: "no_control_center" });
});
test("iPhone Control Center tiles and Notification Center dismiss", async () => {
  const page = fakePage("ios"), shade = { open: "none" };
  await shadeAction(page, shade, { action: "open_notifications" });
  await assert.rejects(shadeAction(page, shade, { action: "toggle_tile", tile: "airplane" }), { code: "tile_not_visible" });
  await shadeAction(page, shade, { action: "dismiss_notification", id: "n1" });
  await assert.rejects(shadeAction(page, shade, { action: "dismiss_notification", id: "n1" }), { code: "no_such_notification" });
  const c = await shadeAction(page, shade, { action: "dismiss_notification", all: true }); assert.equal(c.notifications.length, 0);
  await shadeAction(page, shade, { action: "open_control_center" });
  await shadeAction(page, shade, { action: "toggle_tile", tile: "airplane" }); assert.equal(page.st.airplane, true);
  await assert.rejects(shadeAction(page, shade, { action: "dismiss_notification" }), { code: "panel_closed" });
  assert.ok(new ShadeError("x", "y") instanceof Error);
});
test("the frame markup gives each panel tabindex and a Close button", () => {
  for (const skin of ["android", "ios"]) { const h = shadeHtml(skin); const n = (h.match(/class="sf-panel"/g) || []).length; assert.equal((h.match(/tabindex="-1"/g) || []).length, n); assert.equal((h.match(/data-part="close"/g) || []).length, n); }
});
