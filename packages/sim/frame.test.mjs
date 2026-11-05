import test from "node:test";
import assert from "node:assert/strict";
import { SKINS, frameMarkup, frameScript, statusModel, phoneStep, FRAME_CSS } from "./frame.mjs";

test("each skin has its own size, label and side buttons", () => {
  assert.deepEqual([SKINS.android.width, SKINS.android.height], [412, 915]);
  assert.deepEqual([SKINS.iphone.width, SKINS.iphone.height], [393, 852]);
  for (const skin of ["android", "iphone"]) {
    const h = frameMarkup({ skin });
    assert.match(h, new RegExp(`data-skin="${skin}"`));
    assert.match(h, new RegExp(`--w:${SKINS[skin].width}px;--h:${SKINS[skin].height}px`));
    for (const id of ["power", "volup", "voldn", "clock", "icons", "lock", "pmenu", "boot"]) assert.match(h, new RegExp(`id="${id}"`));
    assert.match(h, /Simulated/);
  }
  assert.match(FRAME_CSS, /\[data-skin=android\] \.cut\{[^}]*border-radius:50%/);
  assert.match(FRAME_CSS, /\[data-skin=iphone\] \.cut\{[^}]*width:120px/);
});
test("an unknown skin falls back to Android style", () => assert.match(frameMarkup({ skin: "x" }), /data-skin="android"/));
test("the page script is plain script with no external calls", () => {
  const js = frameScript();
  assert.doesNotThrow(() => new Function(js));
  assert.doesNotMatch(js, /https?:\/\//);
});

const T = new Date(2026, 10, 5, 14, 7);
test("status bar: clock is formatted from the real time", () => {
  assert.equal(statusModel({}, T, "").time, "2:07");
  assert.equal(statusModel({}, new Date(2026, 0, 1, 0, 0), "").time, "12:00");
});
test("status bar follows network, airplane and battery state", () => {
  assert.deepEqual(statusModel({ online: true }, T, "").icons, ["signal", "wifi"]);
  assert.deepEqual(statusModel({ online: false }, T, "").icons, ["nosignal"]);
  assert.deepEqual(statusModel({ online: true, airplane: true }, T, "").icons, ["airplane"]);
  assert.deepEqual(statusModel({ battery: { level: 17.4, charging: true } }, T, "").battery, { level: 17, charging: true });
  assert.equal(statusModel({ battery: { level: 400, charging: false } }, T, "").battery.level, 100);
  assert.equal(statusModel({}, T, "", 9).notifications, 3);
});
test("status bar text is light on a dark app and dark on a light app", () => {
  assert.equal(statusModel({}, T, "rgb(10, 10, 20)").textColor, "#fff");
  assert.equal(statusModel({}, T, "rgb(250, 250, 250)").textColor, "#111");
  assert.equal(statusModel({}, T, "rgba(0, 0, 0, 0)").textColor, "#111");
});

test("power button locks, and swipe up unlocks", () => {
  let s = { mode: "on", menu: false };
  let n = phoneStep(s, "power"); assert.equal(n.mode, "locked"); assert.equal(n.event, "lock");
  n = phoneStep(n, "unlock"); assert.equal(n.mode, "on"); assert.equal(n.event, "unlock");
});
test("restart boots, reloads the app once, and ends unlocked", () => {
  let n = phoneStep({ mode: "locked", menu: true }, "restart");
  assert.deepEqual([n.mode, n.reload, n.menu], ["booting", true, false]);
  assert.equal(phoneStep(n, "restart").reload, false);
  assert.equal(phoneStep(n, "booted").mode, "on");
});
test("long press opens the power menu; power off then power on cold-starts", () => {
  let n = phoneStep({ mode: "on", menu: false }, "longpress"); assert.equal(n.menu, true);
  assert.equal(phoneStep(n, "power").menu, false);
  n = phoneStep(n, "poweroff"); assert.equal(n.mode, "off");
  n = phoneStep(n, "power"); assert.deepEqual([n.mode, n.reload], ["booting", true]);
  assert.equal(phoneStep({ mode: "off", menu: false }, "longpress").menu, false);
});
