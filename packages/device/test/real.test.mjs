import { test } from "node:test";
import assert from "node:assert/strict";
import { isHeadless, mayUseReal, openStream, realPosition, barcodeDetector } from "../src/real.ts";

const visible = (nav = {}) => ({ navigator: { userAgent: "Chrome", ...nav }, document: { visibilityState: "visible" } });

test("headless: webdriver, headless UA, hidden tab, no document", () => {
  assert.equal(isHeadless(visible({ webdriver: true })), true);
  assert.equal(isHeadless(visible({ userAgent: "HeadlessChrome/120" })), true);
  assert.equal(isHeadless({ navigator: {}, document: { visibilityState: "hidden" } }), true);
  assert.equal(isHeadless({}), true);
  assert.equal(isHeadless(visible()), false);
});

test("forced simulated mode never allows real hardware", () => {
  assert.equal(mayUseReal("simulated", visible()), false);
  assert.equal(mayUseReal("auto", visible()), true);
  assert.equal(mayUseReal("auto", visible({ webdriver: true })), false);
});

test("getUserMedia missing: null, no throw", async () => {
  assert.equal(await openStream({ video: true }, visible()), null);
  assert.equal(await openStream({ video: true }, visible({ mediaDevices: {} })), null);
});

test("getUserMedia throws NotAllowedError: null", async () => {
  const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
  const env = visible({ mediaDevices: { getUserMedia: async () => { throw err; } } });
  assert.equal(await openStream({ audio: true }, env), null);
});

test("getUserMedia that never answers times out and stops a late stream", async () => {
  let stopped = false, release;
  const late = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  const env = visible({ mediaDevices: { getUserMedia: () => new Promise((r) => { release = () => r(late); }) } });
  assert.equal(await openStream({ video: true }, env, 20), null);
  release(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(stopped, true);
});

test("getUserMedia success returns the stream", async () => {
  const s = { id: 1 };
  assert.equal(await openStream({ video: true }, visible({ mediaDevices: { getUserMedia: async () => s } })), s);
});

test("location: real position, refusal, missing", async () => {
  const ok = visible({ geolocation: { getCurrentPosition: (f) => f({ coords: { latitude: 1, longitude: 2, accuracy: 3 } }) } });
  assert.deepEqual(await realPosition(ok), { latitude: 1, longitude: 2, accuracy: 3 });
  const no = visible({ geolocation: { getCurrentPosition: (_f, e) => e({ code: 1 }) } });
  assert.equal(await realPosition(no), null);
  assert.equal(await realPosition(visible()), null);
});

test("BarcodeDetector only when the browser has one", () => {
  assert.equal(barcodeDetector({}), null);
  assert.ok(barcodeDetector({ BarcodeDetector: class {} }));
});
