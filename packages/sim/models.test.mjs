// The phone models a session can be.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, DEFAULT_MODEL, findModel, modelContext } from "./models.mjs";
import { SKINS } from "./frame.mjs";

test("every model has a name, a platform, a screen, a pixel ratio and a user agent of its platform", () => {
  assert.ok(MODELS.length >= 10);
  assert.equal(new Set(MODELS.map((m) => m.name)).size, MODELS.length);
  for (const m of MODELS) {
    assert.ok(m.platform === "android" || m.platform === "ios", m.name);
    assert.ok(Number.isInteger(m.width) && Number.isInteger(m.height) && m.height > m.width && m.width >= 320, m.name);
    assert.ok(m.scale >= 2 && m.scale <= 4, m.name);
    assert.match(m.userAgent, m.platform === "ios" ? /iPhone; CPU iPhone OS/ : /Linux; Android \d+/, m.name);
  }
  assert.ok(MODELS.some((m) => m.platform === "android") && MODELS.some((m) => m.platform === "ios"));
});

test("each platform's default is a model of that platform", () => {
  assert.equal(findModel(DEFAULT_MODEL.android).platform, "android");
  assert.equal(findModel(DEFAULT_MODEL.ios).platform, "ios");
});

test("a model is found whatever the letter case or spacing, and an unknown name gives null", () => {
  assert.equal(findModel("iphone 16 pro").name, "iPhone 16 Pro");
  assert.equal(findModel("  PIXEL   8 ").name, "Pixel 8");
  assert.equal(findModel("Nokia 3310"), null);
  assert.equal(findModel(undefined), null);
});

test("the app gets the phone's screen without the status bar and the bottom bar", () => {
  const m = findModel("iPhone 16 Pro"), c = modelContext(m);
  assert.deepEqual(c.screen, { width: 402, height: 874 });
  assert.deepEqual(c.viewport, { width: 402, height: 874 - SKINS.ios.status - SKINS.ios.bar });
  assert.equal(c.deviceScaleFactor, 3);
  assert.equal(c.userAgent, m.userAgent);
  const p = modelContext(findModel("Pixel 8"));
  assert.deepEqual(p.viewport, { width: 412, height: 915 - SKINS.android.status - SKINS.android.bar });
});
