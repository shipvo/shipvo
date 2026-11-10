import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, sentences, vtt, flashes, LEAD, imgPath } from "./plan.mjs";

const script = { scenes: [
  { id: "a", visual: "x", min: 2, narration: "One. Two.", caption: "One. 2." },
  { id: "b", visual: "x", min: 10, narration: "Visit shipvo dot dev.", caption: "Visit shipvo.dev." },
] };
const man = { segments: [{ start: 0, end: 4, duration: 4 }, { start: 4.5, end: 6.5, duration: 2 }] };

test("sentences keep dots inside words", () => assert.deepEqual(sentences("Go to shipvo.dev/docs. Now."), ["Go to shipvo.dev/docs.", "Now."]));
test("scenes are contiguous and honour min length", () => {
  const p = buildPlan(script, man);
  assert.equal(p.scenes[0].start, 0);
  assert.equal(p.scenes[1].start, p.scenes[0].end);
  assert.ok(p.scenes[1].end - p.scenes[1].start >= 10);
  assert.equal(p.total, p.scenes[1].end);
});
test("cues use the caption text and start after the lead", () => {
  const p = buildPlan(script, man);
  assert.equal(p.cues[1].text, "2.");
  assert.equal(p.cues[0].start, LEAD);
  assert.ok(p.cues.at(-1).end <= p.total);
});
test("vtt is well formed", () => assert.match(vtt(buildPlan(script, man)), /^WEBVTT\n\n1\n00:00:00\.500 --> /));

test("doc video src points at a key the site media handler accepts", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["docs/getting-started.md", "docs/videos.md"]) {
    const md = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    const src = md.match(/<video[^>]*\ssrc="([^"]+)"/)?.[1];
    assert.match(src, /^\/media\/videos\/[a-z0-9-]+-[0-9a-f]{8}\.mp4$/, f);
    const key = src.slice("/media/".length);
    assert.match(key, /^[a-z0-9][a-z0-9/_.-]*$/);
    assert.ok(!key.includes(".."));
  }
});
test("flashes start at an offset from the scene start and stop at the scene end", () => {
  const s = { scenes: [{ ...script.scenes[0], flashes: [{ at: 1, text: "A" }] }, { ...script.scenes[1], flashes: [{ at: 9.5, text: "B" }] }] };
  const p = buildPlan(s, man);
  s.scenes[1].flashes[0].at = p.scenes[1].end - p.scenes[1].start - 0.5;
  const f = flashes(s, p);
  assert.equal(f[0].start, p.scenes[0].start + 1);
  assert.equal(f[0].end, f[0].start + 1.5);
  assert.equal(f[1].start, p.scenes[1].end - 0.5);
  assert.equal(f[1].end, p.scenes[1].end);
});
test("a flash that starts after its scene ends is dropped", () => {
  const s = { scenes: [{ ...script.scenes[0], flashes: [{ at: 999, text: "late" }] }, script.scenes[1]] };
  const p = buildPlan(s, man);
  assert.deepEqual(flashes(s, p), []);
});

test("imgPath takes dir/name as given and searches the default folders for a bare name", () => {
  assert.equal(imgPath("/p", "describe-an-app/shot", () => false), "/p/describe-an-app/shot.png");
  assert.equal(imgPath("/p", "shot", (f) => f === "/p/test-with-an-assistant/shot.png"), "/p/test-with-an-assistant/shot.png");
});
