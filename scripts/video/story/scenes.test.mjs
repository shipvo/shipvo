import test from "node:test";
import assert from "node:assert/strict";
import { frameAt, shotAt, SHOTS, FPS, setScreen, SCREEN_LENGTH, setDialogue } from "./scenes.mjs";

test("shots are contiguous and match the storyboard (0 to 100 s)", () => {
  assert.equal(SHOTS[0].t0, 0);
  for (let i = 1; i < SHOTS.length; i++) assert.equal(SHOTS[i].t0, SHOTS[i - 1].t1);
  assert.equal(SHOTS.at(-1).t1, 100);
  assert.equal(shotAt(5).id, "counter");
  assert.equal(shotAt(14).id, "walkaway");
  assert.equal(shotAt(22).id, "chat");
  assert.equal(shotAt(32).id, "app");
  assert.equal(shotAt(44).id, "order");
  assert.equal(shotAt(60).id, "rush");
  assert.equal(shotAt(76).id, "list");
  assert.equal(shotAt(90).id, "sunset");
  assert.equal(shotAt(96).id, "endcard");
});

test("every frame is 1280x720 SVG with no bad numbers", () => {
  for (let k = 0; k < 100 * FPS; k++) {
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

test("the rush and list shots show the rush recording, never past its end", () => {
  const asked = [];
  setScreen("rush", (sec) => { asked.push(sec); return "data:image/jpeg;base64,BBBB"; });
  assert.match(frameAt(62), /<image href="data:image\/jpeg;base64,BBBB"/);
  assert.match(frameAt(85), /<image href="data:image\/jpeg;base64,BBBB"/);
  frameAt(89.9);
  assert.ok(asked.every((s) => s <= SCREEN_LENGTH.rush));
  setScreen("rush", null);
});

test("caption 3 shows at 79 s only, and the end card carries the line and the site", () => {
  assert.match(frameAt(79), /Every order, in one list\./);
  assert.doesNotMatch(frameAt(82), /Every order, in one list\./);
  assert.match(frameAt(98), /Every assistant can use your app\./);
  assert.match(frameAt(98), /shipvo\.dev/);
});

test("setDialogue burns the line in, escapes it, and resets cleanly", () => {
  const base = frameAt(5);
  assert.ok(!base.includes("Nobody comes in."));
  setDialogue({ lines: [{ start: 4, end: 6, who: "mara", text: "Nobody comes in." }, { start: 8, end: 9, who: "jun", text: "Tide & <Tackle>" }] });
  assert.ok(frameAt(5).includes("Mara: </tspan>Nobody comes in."));
  assert.ok(!frameAt(7).includes("tspan"));
  assert.ok(frameAt(8.5).includes("Tide &amp; &lt;Tackle&gt;"));
  setDialogue({ mouth: { mara: new Array(100 * FPS).fill(3) }, lines: [] });
  assert.notEqual(frameAt(5), base); // mouth level 3 changes the picture
  assert.ok(!frameAt(5).includes("Nobody comes in."));
  setDialogue({});
  assert.equal(frameAt(5), base); // mouthFn back to null, lines cleared
});

import { SEGMENTS, filmTime, totalLength, cutTimes, windowAt, WINDOW_W } from "./vertical.mjs";
import { CUTS, setView } from "./scenes.mjs";

test("vertical cut: segments run forward inside the film and stay between 30 and 45 s", () => {
  for (const s of SEGMENTS) assert.ok(s.from >= 0 && s.to <= 100 && s.to > s.from);
  for (let i = 1; i < SEGMENTS.length; i++) assert.ok(SEGMENTS[i].from >= SEGMENTS[i - 1].to);
  assert.ok(totalLength() >= 30 && totalLength() <= 45);
  assert.equal(filmTime(0), 0);
  assert.equal(filmTime(4.5), 8.6);
  assert.equal(filmTime(totalLength() + 1), null);
  const cuts = cutTimes(CUTS);
  assert.equal(cuts[0], 0);
  assert.ok(cuts.every((c, i) => i === 0 || c > cuts[i - 1]) && cuts.at(-1) < totalLength());
});

test("vertical cut: the window fits the frame and text stays inside it", () => {
  for (let u = 0; u < totalLength(); u += 1 / FPS) {
    const t = filmTime(u), w = windowAt(t);
    assert.ok(w.x >= 0 && w.x + WINDOW_W <= 1280, `window out of frame at ${t}`);
  }
  setDialogue({ lines: [{ start: 9.4, end: 10.37, who: "mara", text: "Nobody comes in." }] });
  setView(windowAt(9.8));
  const svg = frameAt(9.8);
  setView(null); setDialogue({});
  assert.ok(svg.includes("Nobody comes in.") && svg.includes('font-size="25"'));
});
