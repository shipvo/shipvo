import test from "node:test";
import assert from "node:assert/strict";
import { createCharacter, CAST, POSES, GESTURES, EXPRESSIONS, VISEMES, HAND_POSES, visemesFromText } from "./rig.mjs";
import { cameraAt, EASE, matchCut, parallax, particles, progress } from "../camera.mjs";

const mara = () => createCharacter(CAST.mara, { seed: 1 });

test("every pose, expression and gesture resolves and renders", () => {
  for (const p of Object.keys(POSES)) assert.match(mara().pose(p).render(1), /^<g /);
  for (const e of Object.keys(EXPRESSIONS)) assert.match(mara().expression(e).render(1), /<path/);
  for (const g of Object.keys(GESTURES)) assert.match(mara().gesture(g, { at: 0, dur: 1 }).render(.5), /<g /);
  assert.equal(Object.keys(EXPRESSIONS).length, 8);
  assert.equal(HAND_POSES.length, 6);
});
test("unknown names throw", () => {
  assert.throws(() => mara().pose("nope"), /unknown pose/);
  assert.throws(() => mara().expression("nope"), /unknown expression/);
  assert.throws(() => mara().gesture("nope"), /unknown gesture/);
  assert.throws(() => mara().say([{ v: "zz", d: 1 }]), /unknown viseme/);
});
test("text maps to known visemes", () => {
  const v = visemesFromText("Move fast, mom!");
  assert.ok(v.every((s) => VISEMES[s.v] && s.d > 0));
  assert.deepEqual(v.map((s) => s.v).slice(0, 4), ["MBP", "O", "FV", "E"]);
});
test("say drives the mouth at the right time", () => {
  const c = mara(); const end = c.say([{ v: "O", d: .2 }, { v: "MBP", d: .2 }], { at: 1 });
  assert.equal(end, 1.4);
  assert.equal(c.state(.5).viseme, "rest");
  assert.equal(c.state(1.1).viseme, "O");
  assert.equal(c.state(1.3).viseme, "MBP");
  assert.ok(c.state(1.15).mouth.h > c.state(1.3).mouth.h);
});
test("expression blends smoothly", () => {
  const c = mara().expression("happy", { at: 1, dur: 1 });
  assert.equal(c.state(.5).expr.smile, EXPRESSIONS.neutral.smile);
  const mid = c.state(1.5).expr.smile;
  assert.ok(mid > EXPRESSIONS.neutral.smile && mid < EXPRESSIONS.happy.smile);
  assert.equal(c.state(2.1).expr.smile, EXPRESSIONS.happy.smile);
});
test("blink closes the eyes briefly", () => {
  const c = mara(); assert.ok(c.state(0.08 + 0.77 * 0).blink >= 0);
  const closed = [...Array(400)].map((_, i) => c.state(i / 100).blink).filter((b) => b > .9).length;
  assert.ok(closed > 0 && closed < 40);
});
test("output is deterministic for a frame, and changes between frames", () => {
  const build = () => mara().pose("talk", { at: .5 }).expression("happy", { at: 1 }).lookAt(.5, 0, { at: 1 }).gesture("wave", { at: 2, dur: 1 });
  const a = build(), b = build();
  assert.equal(a.render(2.4), b.render(2.4));
  assert.equal(a.render(7.25), build().render(7.25));
  assert.notEqual(a.render(2.4), a.render(2.5));
  assert.ok(!/NaN|undefined/.test(a.render(2.4)));
});
test("light companion renders too", () => {
  const p = createCharacter(CAST.pip).expression("surprised");
  assert.match(p.render(1), /data-character="pip"/);
});
test("camera: moves are eased and deterministic", () => {
  const shots = [{ type: "pushIn", t0: 0, t1: 4, from: 1, to: 1.4 }];
  assert.equal(cameraAt(shots, 0).zoom, 1);
  assert.ok(Math.abs(cameraAt(shots, 4).zoom - 1.4) < 1e-9);
  assert.ok(cameraAt(shots, 1).zoom < 1 + .4 * .25, "starts slow");
  assert.equal(progress(1, 0, 2, EASE.inOutCubic), .5);
  assert.equal(particles({ seed: 3, t: 2 }), particles({ seed: 3, t: 2 }));
});
test("match cut lands the anchor on the same screen spot", () => {
  const a = { x: 400, y: 300, scale: 1 }, b = { x: 900, y: 500, scale: .5 };
  const c = matchCut(a, b);
  assert.equal(c.zoom, 2);
  const sx = 640 + (b.x - c.x) * c.zoom, sy = 360 + (b.y - c.y) * c.zoom;
  assert.ok(Math.abs(sx - a.x) < 1e-9 && Math.abs(sy - a.y) < 1e-9);
});
test("parallax moves near layers more than far ones", () => {
  const out = parallax([{ depth: 0.1, svg: "<i/>" }, { depth: 1, svg: "<b/>" }], { x: 740, y: 360, zoom: 1 });
  const [far, near] = out.match(/translate\(([-\d.]+)/g).filter((_, i) => i % 2 === 0).map((s) => +s.slice(10));
  assert.ok(near < far);
});

test("mouthFn drives the recorded-voice visemes and falls back to say()", () => {
  const c = mara();
  c.mouthFn = (t) => Math.floor(t);
  assert.equal(c.state(0.5).viseme, "rest");
  assert.equal(c.state(1.5).viseme, "I");
  assert.equal(c.state(2.5).viseme, "E");
  assert.equal(c.state(3.5).viseme, "A");
  const d = mara(); d.say([{ v: "O", d: 1 }], { at: 0 });
  assert.equal(d.state(.5).viseme, "O"); // unset
  d.mouthFn = () => null;
  assert.equal(d.state(.5).viseme, "O"); // null falls through to say()
});
