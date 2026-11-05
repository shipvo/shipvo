import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORMATS, baseFrame, captionFilter, chapters, drawTouches, layout, parseBackground, videoClock } from "../src/demo.js";
import { newRec, render } from "../src/recorder.js";

// Three 16x16 flat-colour JPEGs (light, green, blue) made with Chromium; ffmpeg scales them to the phone screen.
const shots = (JSON.parse(readFileSync(join(__dirname, "fixtures", "frames.json"), "utf8")) as string[]).map((b) => Buffer.from(b, "base64"));
const ffmpeg = process.env.SHIPVO_FFMPEG || "ffmpeg";
const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
const hasFfmpeg = !encoders.error && encoders.status === 0;
const hasX264 = hasFfmpeg && /libx264/.test(encoders.stdout);
const info = (f: string) => spawnSync(ffmpeg, ["-i", f], { encoding: "utf8" }).stderr;
const px = (b: Buffer, w: number, x: number, y: number) => [...b.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];

function session(wait = 0) {
  const rec = newRec({ format: "9:16", fps: 30 }, 1000);
  rec.frames.push({ t: 1000, png: shots[0]! });
  rec.touches.push({ t: 1500 + wait, kind: "tap", x: 196, y: 400 });
  rec.frames.push({ t: 1501 + wait, png: shots[1]! });
  rec.markers.push({ t: 1500 + wait, caption: "Add to cart" });
  rec.touches.push({ t: 2200 + wait, kind: "swipe", x1: 196, y1: 600, x2: 196, y2: 300 });
  rec.frames.push({ t: 2300 + wait, png: shots[2]! });
  return rec;
}

describe("demo video maths", () => {
  it("cuts long waits to 0.6 s and keeps short gaps", () => {
    const c = videoClock([0, 200, 20_200, 20_700]);
    expect(c(200)).toBe(200);
    expect(c(20_200)).toBe(800);
    expect(c(20_700)).toBe(1300);
    expect(c(10_200)).toBeCloseTo(500, 0);
  });
  it("sizes 9:16 as 1080x1920 and 16:9 as 1920x1080, with the phone centred", () => {
    expect(FORMATS["9:16"]).toEqual({ w: 1080, h: 1920 });
    expect(FORMATS["16:9"]).toEqual({ w: 1920, h: 1080 });
    const l = layout("9:16");
    expect(l.sx * 2 + l.sw).toBe(1080);
    expect(l.sy * 2 + l.sh).toBe(1920);
  });
  it("reads backgrounds and rejects unknown ones", () => {
    expect(parseBackground("#fff").top).toEqual([255, 255, 255]);
    expect(parseBackground("rgb(1,2,3)").top).toEqual([1, 2, 3]);
    expect(() => parseBackground("sparkly")).toThrow(/background/);
    expect(() => newRec({ background: "sparkly" })).toThrow();
  });
  it("draws a tap: the pixel at the tap changes, and fades out", () => {
    const l = layout("9:16"), base = baseFrame(l, "plain");
    const x = Math.round(l.sx + 196 * (l.sw / 393)), y = Math.round(l.sy + 400 * (l.sw / 393));
    const f = Buffer.from(base);
    drawTouches(f, l, [{ t: 0, tv: 0, kind: "tap", x: 196, y: 400 }], 100);
    expect(px(f, l.w, x, y)).not.toEqual(px(base, l.w, x, y));
    const late = Buffer.from(base);
    drawTouches(late, l, [{ t: 0, tv: 0, kind: "tap", x: 196, y: 400 }], 2000);
    expect(late.equals(base)).toBe(true);
  });
  it("gives chapters in video time and a caption filter per marker", () => {
    const clock = videoClock([0, 10_000, 10_500]);
    const ch = chapters([{ t: 10_000, caption: "Add: to cart" }], clock);
    expect(ch).toEqual([{ t: 0.6, caption: "Add: to cart" }]);
    const f = captionFilter(ch, 5, layout("9:16"))!;
    expect(f).toContain("Add\\: to cart");
    expect(f).toContain("between(t,0.6,4.6)");
    expect(captionFilter([], 5, layout("9:16"))).toBeUndefined();
  });
});

describe("render", () => {
  const out = mkdtempSync(join(tmpdir(), "demo-"));
  it.skipIf(!hasX264)("writes an MP4 of the expected size, duration and chapters", async () => {
    const short = await render(session(0), { out: join(out, "short.mp4") });
    const v = await render(session(30_000), { out: join(out, "demo.mp4") });
    expect(v.duration_s).toBeLessThan(short.duration_s + 1); // a 30 s wait adds under a second
    expect(v.width).toBe(1080); expect(v.height).toBe(1920);
    expect(v.duration_s).toBeGreaterThan(1.5); expect(v.duration_s).toBeLessThan(4);
    const i = info(join(out, "demo.mp4"));
    expect(i).toMatch(/h264/); expect(i).toMatch(/1080x1920/);
    expect(existsSync(join(out, "demo.mp4")) && statSync(join(out, "demo.mp4")).size > 1000).toBe(true);
    expect(readFileSync(join(out, "demo.mp4")).subarray(4, 8).toString()).toBe("ftyp");
    expect(v.chapters).toEqual([{ t: v.chapters[0]!.t, caption: "Add to cart" }]);
  });
  it("says what is missing when ffmpeg is absent", async () => {
    const old = process.env.SHIPVO_FFMPEG; process.env.SHIPVO_FFMPEG = "/nonexistent/ffmpeg";
    try { await expect(render(session(), { out: join(out, "x.mp4") })).rejects.toThrow(/ffmpeg_missing/); } finally { if (old === undefined) delete process.env.SHIPVO_FFMPEG; else process.env.SHIPVO_FFMPEG = old; }
  });
});
