import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrame, normalizeStatus, statusFromDevice, isDarkBackground, statusParts, statusClientScript } from "./frame.mjs";

test("each skin has its own markup and screen size", () => {
  const a = renderFrame({ skin: "android" }), i = renderFrame({ skin: "ios" });
  assert.deepEqual([a.width, a.height], [412, 915]);
  assert.deepEqual([i.width, i.height], [393, 852]);
  assert.match(a.html, /data-part="punch-hole"/); assert.doesNotMatch(a.html, /dynamic-island/);
  assert.match(i.html, /data-part="dynamic-island"/); assert.doesNotMatch(i.html, /punch-hole/);
  assert.notEqual(a.html, i.html);
  assert.match(a.css, /width:412px;height:915px/); assert.match(i.css, /width:393px;height:852px/);
  assert.ok(a.outerWidth > a.width && a.outerHeight > a.height);
});
test("has a Simulated label and the status bar parts", () => {
  for (const skin of ["android", "ios"]) {
    const f = renderFrame({ skin });
    assert.match(f.html, /data-part="simulated-label">Simulated</);
    for (const p of ["time", "signal", "wifi", "battery"]) assert.ok(f.html.includes(`data-part="${p}"`), p);
    assert.ok(f.html.indexOf('data-part="time"') < f.html.indexOf('data-part="signal"'));
  }
});
test("light and dark give different status colours", () => {
  const l = renderFrame({ skin: "ios", dark: false }), d = renderFrame({ skin: "ios", dark: true });
  assert.match(l.html, /data-theme="light"/); assert.match(d.html, /data-theme="dark"/);
  assert.match(l.css, /--sf-fg:#111/); assert.match(d.css, /--sf-fg:#fff/);
});
test("status object drives the bar", () => {
  const f = renderFrame({ status: { time: "12:30", signal: 2, battery: { level: 40, charging: true } } });
  assert.match(f.html, />12:30</); assert.match(f.html, /data-part="signal" data-level="2"/);
  assert.match(f.html, /data-part="battery" data-level="40" data-charging="true"/);
  const off = renderFrame({ status: { wifi: false } });
  assert.doesNotMatch(off.html, /data-part="wifi"/);
  const air = renderFrame({ status: { airplane: true } });
  assert.match(air.html, /data-part="airplane"/); assert.doesNotMatch(air.html, /data-part="(signal|wifi)"/);
});
test("odd input is clamped and escaped; unknown skin throws", () => {
  assert.deepEqual(normalizeStatus({ signal: 9, battery: -5, time: '<b>"1"' }), { time: "b1", signal: 4, wifi: true, airplane: false, battery: { level: 0, charging: false } });
  assert.doesNotMatch(renderFrame({ status: { time: "<script>" } }).html, /<script>/);
  assert.throws(() => renderFrame({ skin: "nokia" }), /Unknown skin/);
});
test("puts the screen HTML in the screen area", () => {
  assert.match(renderFrame({ screen: "<iframe id=x></iframe>" }).html, /sf-content"><iframe id=x><\/iframe>/);
});
test("is pure markup: no script and no scaling code", () => {
  const f = renderFrame({});
  assert.doesNotMatch(f.html, /<script/i); assert.doesNotMatch(f.css, /@import|url\(/);
});

test("renderFrame rejects an unknown skin", () => {
  assert.throws(() => renderFrame({ skin: "x" }), /Unknown skin/);
});
test("power and volume buttons sit on the frame edge and are not interactive", () => {
  for (const skin of ["android", "ios"]) {
    const f = renderFrame({ skin, status: { time: "7:05" } });
    for (const p of ["power", "volume-up", "volume-down"]) assert.ok(f.html.includes(`data-part="${p}"`), `${skin} ${p}`);
    assert.match(f.html, /data-part="power"[^>]*tabindex="-1" aria-hidden="true"/);
    assert.doesNotMatch(f.html, /sf-ov|lock-screen/);
  }
});

const at = new Date(2026, 10, 5, 14, 7);
test("network off shows no signal and no wifi; back on restores them", () => {
  const on = renderFrame({ status: statusFromDevice({ online: true }, at) }).html;
  const off = renderFrame({ status: statusFromDevice({ online: false }, at) }).html;
  assert.match(on, /data-part="wifi"/); assert.match(on, /data-part="signal" data-level="4"/);
  assert.doesNotMatch(off, /data-part="wifi"/); assert.match(off, /data-part="signal" data-level="0"/);
});
test("airplane shows the airplane icon, battery shows the level", () => {
  const f = renderFrame({ status: statusFromDevice({ airplane: true, battery: { level: 42, charging: true } }, at) }).html;
  assert.match(f, /data-part="airplane"/); assert.doesNotMatch(f, /data-part="signal"/);
  const b = renderFrame({ status: statusFromDevice({ battery: { level: 42, charging: true } }, at) }).html;
  assert.match(b, /data-part="battery" data-level="42" data-charging="true"/);
  assert.equal(statusFromDevice({ online: true, airplane: true }, at).wifi, false);
});
test("the clock is the real time in 12-hour form", () => {
  assert.equal(statusFromDevice({}, at).time, "2:07");
  assert.equal(statusFromDevice({}, new Date(2026, 0, 1, 0, 5)).time, "12:05");
  assert.match(renderFrame({ status: statusFromDevice({}, at) }).html, />2:07</);
});
test("status text colour follows the app's top background", () => {
  for (const c of ["#000", "#111827", "rgb(10, 20, 30)", "rgba(0,0,0,0.9)"]) assert.equal(isDarkBackground(c), true, c);
  for (const c of ["#fff", "#f5f5f5", "rgb(255,255,255)", "rgba(0,0,0,0)", "transparent", "", undefined, "red-ish"]) assert.equal(isDarkBackground(c), false, String(c));
  assert.match(renderFrame({ dark: isDarkBackground("#0b1020") }).html, /data-theme="dark"/);
  assert.match(renderFrame({ dark: isDarkBackground("#fff") }).html, /data-theme="light"/);
});
test("statusParts and the client script are usable", () => {
  const p = statusParts(statusFromDevice({ online: false }, at));
  assert.equal(p.time, "2:07"); assert.match(p.icons, /data-level="0"/);
  assert.doesNotThrow(() => new Function(statusClientScript("app")));
});

// Runs the real script against a minimal document and iframe window, then fires pn:status the way @shipvo/device does.
function runClient(appColor = "rgb(255, 255, 255)") {
  const node = (extra = {}) => ({ textContent: "", innerHTML: "", ...extra });
  const time = node(), icons = node();
  const props = {}, attrs = {};
  const body = { setAttribute: (k, v) => { attrs[k] = v; }, style: { setProperty: (k, v) => { props[k] = v; } },
    querySelector: (q) => (q === '[data-part="time"]' ? time : q === ".sf-icons" ? icons : null) };
  const listeners = {}, frameListeners = {};
  const win = { innerWidth: 412, __pnDevice: { status: () => ({ online: true, airplane: false, battery: { level: 100, charging: false } }) },
    document: { elementFromPoint: () => ({ parentElement: null, bg: appColor }) },
    getComputedStyle: (e) => ({ backgroundColor: e.bg }),
    addEventListener: (t, f) => { listeners[t] = f; } };
  const iframe = { contentWindow: win, addEventListener: (t, f) => { frameListeners[t] = f; } };
  const document = { hidden: false, querySelector: (q) => (q === '[data-part="phone-body"]' ? body : null), getElementById: (id) => (id === "app" ? iframe : null) };
  const timers = [];
  new Function("document", "setTimeout", "setInterval", statusClientScript("app"))(document, () => 0, (f) => timers.push(f));
  return { time, icons, props, attrs, win, listeners, timers, setColor: (c) => { win.document.elementFromPoint = () => ({ parentElement: null, bg: c }); } };
}
test("the client script redraws the bar on pn:status and flips only the status text colour", () => {
  const c = runClient();
  assert.match(c.icons.innerHTML, /data-part="wifi"/);
  assert.match(c.time.textContent, /^\d{1,2}:\d{2}$/);
  c.listeners["pn:status"]({ detail: { online: false, airplane: false, battery: { level: 15, charging: false } } });
  assert.match(c.icons.innerHTML, /data-part="signal" data-level="0"/);
  assert.doesNotMatch(c.icons.innerHTML, /data-part="wifi"/);
  assert.match(c.icons.innerHTML, /data-level="15"/);
  c.listeners["pn:status"]({ detail: { online: true, airplane: true, battery: { level: 80, charging: true } } });
  assert.match(c.icons.innerHTML, /data-part="airplane"/);
  assert.equal(c.attrs["data-theme"], "light"); assert.equal(c.props["--sf-status-fg"], "#111");
  assert.equal("--sf-bg" in c.props, false); assert.equal("--sf-fg" in c.props, false);
});
test("the client script falls back to the body colour when the sampled element is transparent", () => {
  const c = runClient("rgba(0, 0, 0, 0)");
  c.win.document.body = { bg: "rgb(10, 14, 30)" };
  c.timers[0]();
  assert.equal(c.attrs["data-theme"], "dark");
});
test("the client script picks light status text for a dark app background", () => {
  const c = runClient("rgb(10, 14, 30)");
  assert.equal(c.attrs["data-theme"], "dark"); assert.equal(c.props["--sf-status-fg"], "#fff"); assert.equal(c.props["--sf-status-bg"], "rgb(10, 14, 30)");
  c.setColor("rgb(255, 255, 255)"); c.timers[0]();
  assert.equal(c.attrs["data-theme"], "light");
});
