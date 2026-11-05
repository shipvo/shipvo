import test from "node:test";
import assert from "node:assert/strict";
import { SKINS, frameMarkup, frameScript, statusModel, phoneStep, appInteractive, FRAME_CSS } from "./frame.mjs";

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

test("the app is inert unless the phone is on with no menu open", () => {
  for (const mode of ["locked", "booting", "off"]) assert.equal(appInteractive({ mode, menu: false }), false, mode);
  assert.equal(appInteractive({ mode: "on", menu: true }), false);
  assert.equal(appInteractive({ mode: "on", menu: false }), true);
  const js = frameScript();
  assert.match(js, /setAttribute\("inert",""\)/);
  assert.match(js, /removeAttribute\("inert"\)/);
});

// A tiny fake page: just enough DOM to run the page script and watch what it does.
function runPhone({ withDevice = true } = {}) {
  const els = {}, listeners = {}, timers = [], log = [], focused = [];
  const el = (id) => els[id] ??= { id, hidden: false, style: {}, dataset: {}, children: [], attrs: {}, _html: "", _text: "", writes: 0,
    addEventListener(t, fn) { (listeners[id + ":" + t] ??= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute: () => "app.html",
    focus() { focused.push(id); },
    set innerHTML(v) { this._html = v; this.writes++; }, get innerHTML() { return this._html },
    set textContent(v) { this._text = v; this.writes++; }, get textContent() { return this._text } };
  const frame = el("app");
  const win = {};
  frame.contentWindow = win; frame.contentDocument = { body: {} };
  win.getComputedStyle = () => ({ backgroundColor: "rgb(255, 255, 255)" });
  let isLocked = false;
  const dev = () => ({ state: {}, notifications: () => [], frameEvent: (k) => log.push(k), lock() { isLocked = true; }, unlock() { isLocked = false; }, locked: () => isLocked });
  if (withDevice) win.__pnDevice = dev();
  const doc = { getElementById: el, addEventListener(t, fn) { (listeners["doc:" + t] ??= []).push(fn); } };
  const g = { document: doc, window: { innerWidth: 1000, innerHeight: 1000, addEventListener() {} }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval() { return 0; }, Date };
  new Function("document", "window", "setTimeout", "clearTimeout", "setInterval", frameScript())(g.document, g.window, g.setTimeout, g.clearTimeout, g.setInterval);
  const fire = (key, e = {}) => (listeners[key] || []).forEach((fn) => fn(e));
  return { els, fire, timers, log, focused, win, boot: () => { if (!withDevice) win.__pnDevice = dev(); timers.filter((t) => t.ms === 1600).at(-1).fn(); } };
}

test("the script sets inert on the app and Back in every non-interactive state", () => {
  const p = runPhone();
  assert.equal("inert" in p.els.app.attrs, false);
  p.fire("power:click"); // locks
  assert.equal(p.els.lock.hidden, false);
  assert.equal("inert" in p.els.app.attrs && "inert" in p.els.back.attrs, true);
  assert.equal(p.focused.at(-1), "unlock");
  p.fire("unlock:click");
  assert.equal("inert" in p.els.app.attrs, false);
});
test("the Unlock button is visible and shows a focus ring", () => {
  assert.doesNotMatch(FRAME_CSS, /\.unlock\{[^}]*opacity:0/);
  assert.match(FRAME_CSS, /\.unlock:focus-visible\{outline:/);
  assert.match(frameMarkup(), />Unlock<\/button>/);
});
test("the status bar is not a live region and unchanged values are not rewritten", () => {
  assert.doesNotMatch(frameMarkup(), /id="status"[^>]*role=/);
  const p = runPhone();
  const before = [p.els.clock.writes, p.els.icons.writes, p.els.dots.writes, p.els.ln.writes];
  p.els.app.contentWindow.__pnDevice.state = {};
  p.fire("app:load");
  assert.deepEqual([p.els.clock.writes, p.els.icons.writes, p.els.dots.writes, p.els.ln.writes], before);
});
test("the power menu takes focus, and Escape or Cancel closes it", () => {
  const p = runPhone();
  p.fire("power:pointerdown");
  p.timers.find((t) => t.ms === 600).fn();
  assert.equal(p.els.pmenu.hidden, false);
  assert.equal(p.focused.at(-1), "restart");
  p.fire("doc:keydown", { key: "Escape" });
  assert.equal(p.els.pmenu.hidden, true);
  assert.equal("inert" in p.els.app.attrs, false);
  p.fire("power:pointerdown"); p.timers.filter((t) => t.ms === 600).at(-1).fn();
  p.fire("doc:keydown", { key: "a" });
  assert.equal(p.els.pmenu.hidden, false);
  p.fire("pmcancel:click");
  assert.equal(p.els.pmenu.hidden, true);
});
test("power_on is logged by the new document after the reload, not the old one", () => {
  const p = runPhone();
  p.fire("power:pointerdown"); p.timers.find((t) => t.ms === 600).fn();
  p.fire("poweroff:click");
  assert.deepEqual(p.log, ["power_menu", "power_off"]);
  p.fire("power:click"); // swallowed: it ends the long press
  p.fire("power:click"); // power on: reload starts
  assert.equal(p.log.includes("power_on"), false);
  p.win.__pnDevice = { state: {}, notifications: () => [], frameEvent: (k) => (p.log2 ??= []).push(k) };
  p.boot();
  assert.deepEqual(p.log2, ["power_on"]);
  assert.equal(p.log.includes("power_on"), false);
});
test("a restart event waits for the new document's device and retries", () => {
  const p = runPhone({ withDevice: false });
  p.fire("power:pointerdown"); p.timers.find((t) => t.ms === 600).fn();
  p.fire("restart:click");
  p.timers.filter((t) => t.ms === 1600).at(-1).fn(); // device not there yet
  assert.equal(p.log.includes("restart"), false);
  p.win.__pnDevice = { state: {}, notifications: () => [], frameEvent: (k) => p.log.push(k) };
  p.timers.filter((t) => t.ms === 250).at(-1).fn();
  assert.equal(p.log.at(-1), "restart");
});
