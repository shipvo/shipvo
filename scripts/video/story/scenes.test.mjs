import test from "node:test";
import assert from "node:assert/strict";
import { frameAt, shotAt, SHOTS, FPS } from "./scenes.mjs";

test("shots are contiguous and match the storyboard (0 to 22 s)", () => {
  assert.equal(SHOTS[0].t0, 0);
  for (let i = 1; i < SHOTS.length; i++) assert.equal(SHOTS[i].t0, SHOTS[i - 1].t1);
  assert.equal(SHOTS.at(-1).t1, 22);
  assert.equal(shotAt(5).id, "counter");
  assert.equal(shotAt(14).id, "walkaway");
});

test("every frame is 1280x720 SVG with no bad numbers", () => {
  for (let k = 0; k < 22 * FPS; k++) {
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
