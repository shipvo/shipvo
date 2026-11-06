// Checks the craft standard for the story ad (.github/agents/prompts/video.md, "Story ads") without rendering.
// Run: node --test scripts/video/story/story.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENES, DURATION, CAPTIONS, CUT_VERTICAL, verticalDuration, verticalToMain, SFX, MUSIC_DIP, SHOTS, shotFor, RECORDINGS, recSrc, frameSvg, setFrameBase } from "./from-a-chat.mjs";
import { SOUNDS, sfxPlan } from "./audio.mjs";

setFrameBase("http://127.0.0.1:1");

test("main cut is 1:30 to 1:45 and the vertical cut is 30 to 45 s", () => {
  assert.ok(DURATION >= 90 && DURATION <= 105, `main ${DURATION}`);
  const v = verticalDuration(); assert.ok(v >= 30 && v <= 45, `vertical ${v}`);
});

test("scenes cover the film with no gaps and each has its own camera move", () => {
  assert.equal(SCENES[0].t0, 0); assert.equal(SCENES.at(-1).t1, DURATION);
  SCENES.forEach((s, i) => { if (i) assert.equal(s.t0, SCENES[i - 1].t1, `gap before ${s.id}`); assert.ok(shotFor(s), `scene ${s.id} has no camera shot`); });
  assert.equal(SHOTS.length, SCENES.length);
});

test("at most three captions, each short and on screen about 1.5 s", () => {
  assert.ok(CAPTIONS.length <= 3);
  for (const c of CAPTIONS) {
    assert.ok(c.text.split(/\s+/).length <= 7, c.text);
    const d = c.t1 - c.t0; assert.ok(d >= 1.2 && d <= 2.2, `${c.text} is on for ${d}s`);
  }
});

test("no static frame: the picture changes at least every 0.5 s", () => {
  for (let t = 0; t + 0.5 < DURATION; t += 0.5) assert.notEqual(frameSvg(t), frameSvg(t + 0.5), `frame at ${t}s equals the one 0.5 s later`);
});

test("a frame depends only on its time", () => { assert.equal(frameSvg(37.3), frameSvg(37.3)); });

test("Shipvo screens come from the real recordings, in the product beats", () => {
  assert.match(frameSvg(60), /\/order\/\d{4}\.jpg/); assert.match(frameSvg(75), /\/rush\/\d{4}\.jpg/); assert.match(frameSvg(88), /\/rush\/\d{4}\.jpg/);
  for (const [name, r] of Object.entries(RECORDINGS)) {
    assert.equal(recSrc("b", name, 0), `b/${name}/0001.jpg`); assert.equal(recSrc("b", name, 999), `b/${name}/${String(r.frames).padStart(4, "0")}.jpg`);
    assert.ok(Math.abs(r.frames / 30 - r.seconds) < 0.1, `${name}: frames match the recording length`);
  }
  assert.ok(!/<image/.test(frameSvg(2)), "the hook shows no app screen");
});

test("vertical cut keeps the hook, a product beat, the payoff and the end card, in order", () => {
  assert.equal(CUT_VERTICAL[0].t0, 0); assert.equal(CUT_VERTICAL.at(-1).t1, DURATION);
  CUT_VERTICAL.forEach((r, i) => { assert.ok(r.t1 > r.t0); if (i) assert.ok(r.t0 >= CUT_VERTICAL[i - 1].t1); });
  assert.ok(CUT_VERTICAL.some((r) => r.t0 <= 45 && r.t1 > 45), "a product beat"); assert.ok(CUT_VERTICAL.some((r) => r.t0 <= 91 && r.t1 > 91), "the payoff");
  assert.equal(verticalToMain(0).t, 0); assert.ok(verticalToMain(verticalDuration() - 0.01).t > 103);
  const f = frameSvg(45, { vertical: { focusX: 640 } }); assert.match(f, /viewBox="[\d.]+ 0 405 720"/);
});

test("sound effects sit inside the film and each kind can be synthesised", () => {
  for (const c of SFX) { assert.ok(c.t >= 0 && c.t < DURATION, `${c.kind} at ${c.t}`); assert.ok(SOUNDS[c.kind], `no sound for ${c.kind}`); }
  for (const k of ["tap", "whoosh", "ping", "bell", "murmur"]) assert.ok(SFX.some((c) => c.kind === k), `missing ${k}`);
  assert.ok(sfxPlan("vertical").every((c) => c.at >= 0 && c.at < verticalDuration()));
});

test("the music dips to near silence for a beat before the payoff and swells on it", () => {
  const payoff = SFX.find((c) => c.kind === "chime" && c.t > 80);
  assert.ok(MUSIC_DIP.level < 0.15 && MUSIC_DIP.t1 <= payoff.t && payoff.t - MUSIC_DIP.t1 < 1);
  assert.ok(SFX.some((c) => c.kind === "swell" && c.t > MUSIC_DIP.t0 && c.t < payoff.t));
});
