import test from "node:test";
import assert from "node:assert/strict";
import { frameAt, shotAt, SHOTS, FPS, setScreen, SCREEN_LENGTH } from "./scenes.mjs";

test("shots are contiguous and match the storyboard (0 to 60 s)", () => {
  assert.equal(SHOTS[0].t0, 0);
  for (let i = 1; i < SHOTS.length; i++) assert.equal(SHOTS[i].t0, SHOTS[i - 1].t1);
  assert.equal(SHOTS.at(-1).t1, 60);
  assert.equal(shotAt(5).id, "counter");
  assert.equal(shotAt(14).id, "walkaway");
  assert.equal(shotAt(22).id, "chat");
  assert.equal(shotAt(32).id, "app");
  assert.equal(shotAt(44).id, "order");
});

test("every frame is 1280x720 SVG with no bad numbers", () => {
  for (let k = 0; k < 60 * FPS; k++) {
    const svg = frameAt(k / FPS);
    assert.match(svg, /^<svg [^>]*width="1280" height="720"/);
    assert.ok(!svg.includes("NaN") && !svg.includes("undefined"), `bad number at frame ${k}`);
  }
});

test("the camera moves in every shot (picture differs 1 s apart)", () => {
  for (const s of SHOTS) assert.notEqual(frameAt(s.t0 + 1).replace(/<filter.*?<\/filter>/gs, ""), frameAt(s.t0 + 2).replace(/<filter.*?<\/filter>/gs, ""));
});

test("frames are deterministic", () => {
  assert.equal(frameAt(9.5), frameAt(9.5));
});

test("a loaded screen recording appears in the app and order shots, at the time asked for", () => {
  const asked = [];
  setScreen("order", (sec) => { asked.push(sec); return "data:image/jpeg;base64,AAAA"; });
  assert.match(frameAt(36), /<image href="data:image\/jpeg;base64,AAAA"/);
  frameAt(50);
  assert.ok(Math.abs(asked.at(-1) - 4) < 1e-6, "film 50 s is 4 s into the recording");
  frameAt(59);
  assert.ok(asked.at(-1) <= SCREEN_LENGTH.order, "never past the end of the recording");
  setScreen("order", null);
});

test("exactly one caption shows at 46.5 s and none at 50 s", () => {
  assert.match(frameAt(46.5), /Your assistant can order\./);
  assert.doesNotMatch(frameAt(50), /Your assistant can order\./);
});
