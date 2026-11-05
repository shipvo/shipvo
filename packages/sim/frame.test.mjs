import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrame, normalizeStatus } from "./frame.mjs";

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
